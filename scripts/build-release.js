'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');
const { embedWindowsIcon } = require('./embed-windows-icon');
const { createFileIntegrityEntries, hashFile } = require('../src/core/tool-integrity');
const { dependencyLock, verifyToolchain } = require('./verify-toolchain');
const { assertPathInsideLocalRoot, makeLocalLayout } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const electronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist');
const releaseName = `HamsterArchiver-v${packageJson.version}-win-x64`;
const localLayout = makeLocalLayout(projectRoot);
const outputRoot = path.join(localLayout.stagingRoot, releaseName);
assertPathInsideLocalRoot(outputRoot, localLayout.root, '发行构建目录');

async function exists(targetPath) {
  try { await fs.access(targetPath); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function copyVerifiedFile(relativePath, destinationRoot) {
  const sourcePath = path.join(projectRoot, relativePath);
  const destinationPath = path.join(destinationRoot, relativePath);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
  const [sourceDigest, destinationDigest] = await Promise.all([
    hashFile(sourcePath),
    hashFile(destinationPath)
  ]);
  if (sourceDigest !== destinationDigest) throw new Error('发布工具复制校验失败：' + relativePath);
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Windows x64 发行包只能在受支持的 Windows x64 环境中构建。');
  }
  const toolchain = await verifyToolchain({
    requireInstalledPackages: true,
    requireTools: true
  });
  if (toolchain.dependencies.npm === 'unknown') {
    throw new Error('无法记录实际 npm 版本；请通过 npm run build:release 或 npm run release:local 构建。');
  }
  if (!(await exists(path.join(electronDist, 'electron.exe')))) {
    throw new Error('缺少 Electron 运行时，请先执行 npm ci。');
  }
  for (const requiredTool of [
    path.join(projectRoot, 'assets', 'app-icon.png'),
    path.join(projectRoot, 'assets', 'app-icon.ico')
  ]) {
    if (!(await exists(requiredTool))) throw new Error(`发布包缺少必需工具：${requiredTool}`);
  }

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.cp(electronDist, outputRoot, { recursive: true });
  await fs.rename(path.join(outputRoot, 'electron.exe'), path.join(outputRoot, 'HamsterArchiver.exe'));
  await embedWindowsIcon(
    path.join(outputRoot, 'HamsterArchiver.exe'),
    path.join(projectRoot, 'assets', 'app-icon.ico')
  );
  await fs.rm(path.join(outputRoot, 'resources', 'default_app.asar'), { force: true });

  const appDirectory = path.join(outputRoot, 'resources', 'app');
  await fs.mkdir(appDirectory, { recursive: true });
  await fs.cp(path.join(projectRoot, 'src'), path.join(appDirectory, 'src'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'assets'), path.join(appDirectory, 'assets'), { recursive: true });
  for (const tool of Object.values(dependencyLock.bundledTools)) {
    for (const relativePath of tool.files) await copyVerifiedFile(relativePath, outputRoot);
  }
  await fs.copyFile(path.join(projectRoot, 'README.md'), path.join(outputRoot, 'README.md'));
  if (await exists(path.join(projectRoot, 'README.en.md'))) {
    await fs.copyFile(path.join(projectRoot, 'README.en.md'), path.join(outputRoot, 'README.en.md'));
  }
  const readmeAssets = path.join(projectRoot, 'README.assets');
  if (await exists(readmeAssets)) {
    await fs.cp(readmeAssets, path.join(outputRoot, 'README.assets'), { recursive: true });
  }
  await fs.copyFile(path.join(projectRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE'));
  await fs.writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify({
    name: packageJson.name,
    productName: 'Hamster Archiver',
    version: packageJson.version,
    description: packageJson.description,
    main: 'src/main.js',
    license: 'MIT'
  }, null, 2)}\n`, 'utf8');

  const userDataDirectory = path.join(outputRoot, 'userdata');
  for (const directory of ['config', 'warehouse', 'logs', 'processed', 'electron']) {
    await fs.mkdir(path.join(userDataDirectory, directory), { recursive: true });
  }
  await fs.writeFile(path.join(userDataDirectory, 'README.txt'), [
    'Hamster Archiver portable user data directory',
    '',
    '设置、仓库、缩略图、日志和默认 processed 都保存在这里。',
    '压缩暂存目录会在“打包后文件存放点”旁自动建立，不在 userdata 中。',
    '备份软件时，请把整个 userdata 文件夹一并备份。',
    '程序运行时不要移动、覆盖或同步正在写入的 SQLite 文件。',
    ''
  ].join('\r\n'), 'utf8');

  const localeDirectory = path.join(outputRoot, 'locales');
  if (await exists(localeDirectory)) {
    const keepLocales = new Set(['en-US.pak', 'zh-CN.pak']);
    for (const name of await fs.readdir(localeDirectory)) {
      if (!keepLocales.has(name)) await fs.rm(path.join(localeDirectory, name), { force: true });
    }
  }

  let commit = '';
  if (process.env.HAMSTER_RELEASE_COMMIT) {
    commit = String(process.env.HAMSTER_RELEASE_COMMIT).trim().slice(0, 40);
  } else {
    try {
      commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    } catch { /* 非 Git 环境也可以构建 */ }
  }
  const integrityPaths = [
    'HamsterArchiver.exe',
    'resources/app/package.json',
    'resources/app/src/main.js',
    'resources/app/src/core/archive-engine.js',
    'resources/app/src/core/media-service.js',
    'resources/app/src/core/paths.js',
    'resources/app/src/core/tool-integrity.js',
    'resources/app/src/core/update-manager.js',
    ...Object.values(dependencyLock.bundledTools).flatMap((tool) => tool.files)
  ];
  const integrityFiles = await createFileIntegrityEntries(outputRoot, integrityPaths);
  const releaseManifest = {
    schemaVersion: 2,
    name: releaseName,
    version: packageJson.version,
    platform: 'win32-x64',
    commit,
    builtAt: new Date().toISOString(),
    portableUserData: 'userdata',
    toolchain: {
      node: toolchain.dependencies.node,
      npm: toolchain.dependencies.npm,
      electron: toolchain.dependencies.packages.electron,
      resedit: toolchain.dependencies.packages.resedit,
      bundledTools: Object.fromEntries(Object.entries(toolchain.tools).map(([name, tool]) => [name, {
        version: tool.version,
        architecture: tool.architecture
      }]))
    },
    integrity: {
      algorithm: 'sha256',
      files: integrityFiles
    }
  };
  await fs.writeFile(
    path.join(outputRoot, 'release-manifest.json'),
    JSON.stringify(releaseManifest, null, 2) + '\n',
    'utf8'
  );
  console.log(outputRoot);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
