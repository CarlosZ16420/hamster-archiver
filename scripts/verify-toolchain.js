#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '..');
const dependencyLock = require('../dependency-lock.json');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function isExactPackageVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ''));
}

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw new Error(`${label} 缺少有效 SHA-256。`);
}

function verifyDependencyMetadata({ strictNode = false } = {}) {
  if (dependencyLock.schemaVersion !== 1) throw new Error('dependency-lock.json 版本不受支持。');
  if (packageJson.engines?.node !== dependencyLock.node) {
    throw new Error('package.json 的 Node.js 版本没有与 dependency-lock.json 精确同步。');
  }
  if (packageJson.packageManager !== 'npm@' + dependencyLock.npm) {
    throw new Error('package.json 的 npm 版本没有与 dependency-lock.json 精确同步。');
  }
  if (strictNode && process.versions.node !== dependencyLock.node) {
    throw new Error(`Node.js 版本不一致：要求 ${dependencyLock.node}，实际 ${process.versions.node}。`);
  }
  const npmAgent = String(process.env.npm_config_user_agent || '').match(/(?:^|\s)npm\/([^\s]+)/);
  if (strictNode && npmAgent && npmAgent[1] !== dependencyLock.npm) {
    throw new Error('npm 版本不一致：要求 ' + dependencyLock.npm + '，实际 ' + npmAgent[1] + '。');
  }
  const rootLock = packageLock.packages?.[''];
  if (!rootLock || packageLock.lockfileVersion !== 3) throw new Error('package-lock.json 格式无效。');
  for (const [name, version] of Object.entries(dependencyLock.packages)) {
    if (!isExactPackageVersion(version)) throw new Error(`${name} 的锁定版本不是精确版本。`);
    if (packageJson.devDependencies?.[name] !== version) {
      throw new Error(`package.json 中的 ${name} 必须精确锁定为 ${version}。`);
    }
    if (rootLock.devDependencies?.[name] !== version) {
      throw new Error(`package-lock.json 根依赖中的 ${name} 没有与锁定版本同步。`);
    }
    if (packageLock.packages?.[`node_modules/${name}`]?.version !== version) {
      throw new Error(`package-lock.json 实际解析的 ${name} 不是 ${version}。`);
    }
  }
  for (const [name, value] of Object.entries(packageJson.devDependencies || {})) {
    if (!(name in dependencyLock.packages)) throw new Error(`直接依赖 ${name} 尚未写入 dependency-lock.json。`);
    if (!isExactPackageVersion(value)) throw new Error(`直接依赖 ${name} 使用了浮动版本 ${value}。`);
  }
  for (const [name, tool] of Object.entries(dependencyLock.bundledTools || {})) {
    if (!tool.version || !tool.executable || !tool.versionText || !Array.isArray(tool.files)) {
      throw new Error(`内置工具 ${name} 的锁定信息不完整。`);
    }
    assertDigest(tool.source?.sha256, `${tool.displayName || name} 来源包`);
    const sourceUrl = new URL(tool.source.url);
    if (sourceUrl.protocol !== 'https:') throw new Error(`${tool.displayName || name} 必须使用 HTTPS 来源。`);
    if (!tool.files.includes(tool.executable)) throw new Error(`${tool.displayName || name} 的文件清单缺少主程序。`);
  }
  return {
    node: dependencyLock.node,
    npm: dependencyLock.npm,
    packages: { ...dependencyLock.packages }
  };
}

async function pathIsFile(relativePath) {
  try { return (await fs.stat(path.join(projectRoot, relativePath))).isFile(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function verifyTool(name, tool) {
  for (const relativePath of tool.files) {
    if (!(await pathIsFile(relativePath))) {
      throw new Error(`${tool.displayName || name} 缺少锁定文件：${relativePath}`);
    }
  }
  let result;
  try {
    result = await execFileAsync(path.join(projectRoot, tool.executable), tool.versionArgs || [], {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    throw new Error(`${tool.displayName || name} 无法执行版本检查。${output ? `\n${output}` : ''}`);
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (!output.includes(tool.versionText)) {
    throw new Error(`${tool.displayName || name} 版本不一致：要求 ${tool.versionText}。`);
  }
  return {
    name,
    displayName: tool.displayName || name,
    version: tool.version,
    architecture: tool.architecture,
    files: [...tool.files]
  };
}

async function verifyInstalledPackages() {
  for (const [name, version] of Object.entries(dependencyLock.packages)) {
    const installedPath = path.join(projectRoot, 'node_modules', name, 'package.json');
    let installed;
    try { installed = JSON.parse(await fs.readFile(installedPath, 'utf8')); } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`缺少 ${name}，请使用 npm ci 安装锁定依赖。`);
      throw error;
    }
    if (installed.version !== version) throw new Error(`${name} 安装版本不一致：要求 ${version}，实际 ${installed.version}。`);
  }
  if (process.platform === 'win32') {
    const electronExecutable = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
    let result;
    try {
      result = await execFileAsync(electronExecutable, ['--version'], { windowsHide: true, timeout: 15_000 });
    } catch (error) {
      throw new Error('锁定的 Electron 运行时无法执行版本检查：' + (error.message || error));
    }
    const actualVersion = String(result.stdout || '').trim().replace(/^v/, '');
    if (actualVersion !== dependencyLock.packages.electron) {
      throw new Error('Electron 运行时版本不一致：要求 ' + dependencyLock.packages.electron + '，实际 ' + actualVersion + '。');
    }
  }
}

async function verifyToolchain({ strictNode = false, requireInstalledPackages = false, requireTools = true } = {}) {
  const dependencies = verifyDependencyMetadata({ strictNode });
  if (requireInstalledPackages) await verifyInstalledPackages();
  const tools = {};
  if (requireTools) {
    for (const [name, tool] of Object.entries(dependencyLock.bundledTools)) {
      tools[name] = await verifyTool(name, tool);
    }
  }
  return { dependencies, tools };
}

if (require.main === module) {
  const dependenciesOnly = process.argv.includes('--dependencies-only');
  verifyToolchain({
    strictNode: !process.argv.includes('--allow-node-mismatch'),
    requireInstalledPackages: process.argv.includes('--installed'),
    requireTools: !dependenciesOnly
  }).then((report) => {
    console.log('依赖锁定检查通过：Node.js ' + report.dependencies.node + '，npm ' + report.dependencies.npm + '；' + Object.keys(report.dependencies.packages).length + ' 个直接依赖。');
    for (const tool of Object.values(report.tools)) console.log(`${tool.displayName} ${tool.version} (${tool.architecture}) 校验通过。`);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  dependencyLock,
  isExactPackageVersion,
  verifyDependencyMetadata,
  verifyInstalledPackages,
  verifyTool,
  verifyToolchain
};
