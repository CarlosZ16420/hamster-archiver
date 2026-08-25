#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { hashFile, resolveIntegrityPath } = require('../src/core/tool-integrity');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '..');
const dependencyLock = require('../dependency-lock.json');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function isExactPackageVersion(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(value || ''));
}

function parseNumericVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-|$)/);
  return match ? match.slice(1).map(Number) : null;
}

function isVersionInCaretRange(value, range) {
  const actual = parseNumericVersion(value);
  if (!actual) return false;
  return String(range || '').split('||').some((part) => {
    const minimum = parseNumericVersion(part.trim().replace(/^\^/, ''));
    if (!minimum || actual[0] !== minimum[0]) return false;
    return actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2]);
  });
}

function isSupportedNodeVersion(value, range = dependencyLock.development?.node) {
  return isVersionInCaretRange(value, range);
}

function isSupportedNpmVersion(value, range = dependencyLock.development?.npm) {
  return isVersionInCaretRange(value, range);
}

function assertDigest(value, label) {
  if (!/^[a-f0-9]{64}$/.test(String(value || ''))) throw new Error(`${label} 缺少有效 SHA-256。`);
}

function assertLockedFileIntegrity(entry, label) {
  if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0) throw new Error(`${label} 缺少有效文件大小。`);
  assertDigest(entry?.sha256, label);
}

function verifyDependencyMetadata() {
  if (dependencyLock.schemaVersion !== 3) throw new Error('dependency-lock.json 版本不受支持。');
  if (packageJson.engines?.node !== dependencyLock.development?.node) {
    throw new Error('package.json 的 Node.js 兼容范围没有与 dependency-lock.json 同步。');
  }
  if (packageJson.engines?.npm !== dependencyLock.development?.npm) {
    throw new Error('package.json 的 npm 兼容范围没有与 dependency-lock.json 同步。');
  }
  if (!isSupportedNodeVersion(process.versions.node)) {
    throw new Error(`Node.js 版本不受支持：要求 ${dependencyLock.development.node}，实际 ${process.versions.node}。`);
  }
  const npmAgent = String(process.env.npm_config_user_agent || '').match(/(?:^|\s)npm\/([^\s]+)/);
  const currentNpm = npmAgent?.[1] || null;
  if (currentNpm && !isSupportedNpmVersion(currentNpm)) {
    throw new Error(`npm 版本不受支持：要求 ${dependencyLock.development.npm}，实际 ${currentNpm}。`);
  }
  const rootLock = packageLock.packages?.[''];
  if (!rootLock || packageLock.lockfileVersion !== 3) throw new Error('package-lock.json 格式无效。');
  for (const [packagePath, metadata] of Object.entries(packageLock.packages)) {
    if (!packagePath) continue;
    if (!metadata.resolved || new URL(metadata.resolved).origin !== 'https://registry.npmjs.org') {
      throw new Error(`${packagePath} 没有锁定到官方 npm 仓库。`);
    }
    if (!/^sha512-/.test(String(metadata.integrity || ''))) {
      throw new Error(`${packagePath} 缺少 npm 包完整性摘要。`);
    }
  }
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
  const electronArtifact = dependencyLock.packageArtifacts?.electron;
  if (!electronArtifact || electronArtifact.path !== 'node_modules/electron/dist/electron.exe') {
    throw new Error('Electron 可执行文件尚未写入完整性锁定。');
  }
  resolveIntegrityPath(projectRoot, electronArtifact.path);
  assertLockedFileIntegrity(electronArtifact, 'Electron 可执行文件');
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
    const integrityPaths = Object.keys(tool.fileIntegrity || {});
    if (!integrityPaths.includes(tool.executable) || !integrityPaths.every((file) => tool.files.includes(file))) {
      throw new Error(`${tool.displayName || name} 的关键二进制完整性清单无效。`);
    }
    for (const relativePath of integrityPaths) {
      resolveIntegrityPath(projectRoot, relativePath);
      assertLockedFileIntegrity(tool.fileIntegrity[relativePath], `${tool.displayName || name} 文件 ${relativePath}`);
    }
  }
  return {
    node: process.versions.node,
    npm: currentNpm || 'unknown',
    supportedNode: dependencyLock.development.node,
    supportedNpm: dependencyLock.development.npm,
    currentNode: process.versions.node,
    packages: { ...dependencyLock.packages }
  };
}

async function verifyRequiredFile(relativePath, label) {
  const absolutePath = resolveIntegrityPath(projectRoot, relativePath);
  try {
    if (!(await fs.stat(absolutePath)).isFile()) throw new Error(`${label} 不是文件：${relativePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} 缺少必需文件：${relativePath}`);
    throw error;
  }
  return absolutePath;
}

async function verifyLockedFile(relativePath, integrity, label) {
  const absolutePath = resolveIntegrityPath(projectRoot, relativePath);
  let stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} 缺少锁定文件：${relativePath}`);
    throw error;
  }
  if (!stats.isFile() || stats.size !== integrity.bytes) {
    throw new Error(`${label} 文件大小不一致：${relativePath}`);
  }
  if (await hashFile(absolutePath) !== integrity.sha256) {
    throw new Error(`${label} SHA-256 校验失败：${relativePath}`);
  }
  return absolutePath;
}

async function verifyTool(name, tool) {
  for (const relativePath of tool.files) {
    const integrity = tool.fileIntegrity[relativePath];
    if (integrity) await verifyLockedFile(relativePath, integrity, tool.displayName || name);
    else await verifyRequiredFile(relativePath, tool.displayName || name);
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
    const electronArtifact = dependencyLock.packageArtifacts.electron;
    const electronExecutable = await verifyLockedFile(electronArtifact.path, electronArtifact, 'Electron 可执行文件');
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

async function verifyToolchain({ requireInstalledPackages = false, requireTools = true } = {}) {
  const dependencies = verifyDependencyMetadata();
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
    requireInstalledPackages: process.argv.includes('--installed'),
    requireTools: !dependenciesOnly
  }).then((report) => {
    console.log('依赖检查通过：当前 Node.js ' + report.dependencies.currentNode + '（兼容范围 ' + report.dependencies.supportedNode + '），npm ' + report.dependencies.npm + '（兼容范围 ' + report.dependencies.supportedNpm + '）；' + Object.keys(report.dependencies.packages).length + ' 个直接依赖。');
    for (const tool of Object.values(report.tools)) console.log(`${tool.displayName} ${tool.version} (${tool.architecture}) 校验通过。`);
  }).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  dependencyLock,
  isExactPackageVersion,
  isSupportedNodeVersion,
  isSupportedNpmVersion,
  verifyDependencyMetadata,
  verifyInstalledPackages,
  verifyTool,
  verifyToolchain
};
