'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extract } = require('@electron-internal/extract-zip');
const dependencyLock = require('../dependency-lock.json');
const { hashFile } = require('../src/core/tool-integrity');

const projectRoot = path.resolve(__dirname, '..');
const electronRoot = path.join(projectRoot, 'node_modules', 'electron');
const electronPackagePath = path.join(electronRoot, 'package.json');
const checksumsPath = path.join(electronRoot, 'checksums.json');
const runtimePath = path.join(electronRoot, 'dist', 'electron.exe');

function parseArguments(argv) {
  const argumentsSet = new Set(argv);
  const allowDownload = argumentsSet.delete('--allow-download');
  if (argumentsSet.size > 0) {
    throw new Error(`未知 Electron 运行时准备参数：${[...argumentsSet].join(', ')}`);
  }
  return { allowDownload };
}

function uniquePaths(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function getCacheRoots(env = process.env) {
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return uniquePaths([
    env.electron_config_cache,
    path.join(localAppData, 'electron', 'Cache')
  ]);
}

function renameWithPowerShell(sourcePath, destinationPath) {
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Move-Item -LiteralPath $env:HAMSTER_ELECTRON_RENAME_SOURCE -Destination $env:HAMSTER_ELECTRON_RENAME_DESTINATION -ErrorAction Stop'
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HAMSTER_ELECTRON_RENAME_SOURCE: sourcePath,
      HAMSTER_ELECTRON_RENAME_DESTINATION: destinationPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function renameWithRetry(sourcePath, destinationPath, { attempts = 4, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fsp.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      if (attempt === attempts) {
        if (process.platform !== 'win32') throw error;
        renameWithPowerShell(sourcePath, destinationPath);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function verifyFile(targetPath, expected) {
  let stats;
  try {
    stats = await fsp.stat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stats.isFile()) return false;
  if (Number.isSafeInteger(expected.bytes) && stats.size !== expected.bytes) return false;
  return await hashFile(targetPath) === expected.sha256;
}

async function findVerifiedCachedArchive(cacheRoots, archiveName, expectedSha256) {
  for (const cacheRoot of cacheRoots) {
    let entries;
    try {
      entries = await fsp.readdir(cacheRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const candidates = [path.join(cacheRoot, archiveName)];
    for (const entry of entries) {
      if (entry.isDirectory()) candidates.push(path.join(cacheRoot, entry.name, archiveName));
    }
    for (const candidate of candidates) {
      if (await verifyFile(candidate, { sha256: expectedSha256 })) return candidate;
    }
  }
  return null;
}

async function verifyInstalledRuntime(version) {
  const artifact = dependencyLock.packageArtifacts.electron;
  if (!(await verifyFile(runtimePath, artifact))) return false;
  try {
    const installedVersion = (await fsp.readFile(path.join(electronRoot, 'dist', 'version'), 'utf8'))
      .trim()
      .replace(/^v/, '');
    const platformPath = (await fsp.readFile(path.join(electronRoot, 'path.txt'), 'utf8')).trim();
    return installedVersion === version && platformPath === 'electron.exe';
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function installFromCache(archivePath, version) {
  const distPath = path.join(electronRoot, 'dist');
  const nonce = `${process.pid}-${Date.now()}`;
  const stagingPath = path.join(electronRoot, `.dist-staging-${nonce}`);
  const backupPath = path.join(electronRoot, `.dist-backup-${nonce}`);
  let savedPrevious = false;

  await fsp.rm(stagingPath, { recursive: true, force: true });
  await extract(archivePath, { dir: stagingPath });
  const stagedRuntime = path.join(stagingPath, 'electron.exe');
  if (!(await verifyFile(stagedRuntime, dependencyLock.packageArtifacts.electron))) {
    await fsp.rm(stagingPath, { recursive: true, force: true });
    throw new Error('本机 Electron 缓存解压后的运行时完整性校验失败；未修改现有运行时。');
  }

  try {
    if (fs.existsSync(distPath)) {
      await renameWithRetry(distPath, backupPath);
      savedPrevious = true;
    }
    await renameWithRetry(stagingPath, distPath);
    await fsp.writeFile(path.join(electronRoot, 'path.txt'), 'electron.exe', 'utf8');
    if (!(await verifyInstalledRuntime(version))) {
      throw new Error('Electron 运行时恢复后校验失败。');
    }
    if (savedPrevious) await fsp.rm(backupPath, { recursive: true, force: true });
  } catch (error) {
    await fsp.rm(distPath, { recursive: true, force: true });
    if (savedPrevious) await renameWithRetry(backupPath, distPath);
    await fsp.rm(stagingPath, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const { allowDownload } = parseArguments(process.argv.slice(2));
  let electronPackage;
  let checksums;
  try {
    electronPackage = JSON.parse(await fsp.readFile(electronPackagePath, 'utf8'));
    checksums = JSON.parse(await fsp.readFile(checksumsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('缺少 electron NPM 包；请先执行 npm ci。未尝试下载 Electron 运行时。');
    }
    throw error;
  }

  const version = electronPackage.version;
  if (version !== dependencyLock.packages.electron) {
    throw new Error(`Electron 包版本不一致：要求 ${dependencyLock.packages.electron}，实际 ${version}。`);
  }
  if (await verifyInstalledRuntime(version)) {
    console.log(`Electron ${version} 运行时已通过完整性校验。`);
    return;
  }

  const archiveName = `electron-v${version}-win32-x64.zip`;
  const expectedArchiveSha256 = checksums[archiveName];
  if (!/^[a-f0-9]{64}$/.test(String(expectedArchiveSha256 || ''))) {
    throw new Error(`Electron 包缺少 ${archiveName} 的 SHA-256。`);
  }
  const cachedArchive = await findVerifiedCachedArchive(
    getCacheRoots(),
    archiveName,
    expectedArchiveSha256
  );
  if (cachedArchive) {
    await installFromCache(cachedArchive, version);
    console.log(`已从校验通过的本机缓存恢复 Electron ${version} 运行时；未进行网络下载。`);
    return;
  }

  if (!allowDownload) {
    throw new Error([
      `缺少 Electron ${version} 运行时，且未找到校验通过的本机缓存。`,
      '本次未进行网络下载。确认允许下载后，请运行：npm run electron:prepare -- --allow-download'
    ].join('\n'));
  }

  execFileSync(process.execPath, [path.join(electronRoot, 'install.js')], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (!(await verifyInstalledRuntime(version))) {
    throw new Error('Electron 运行时下载完成后未通过锁定完整性校验。');
  }
  console.log(`Electron ${version} 运行时已下载并通过完整性校验。`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  findVerifiedCachedArchive,
  getCacheRoots,
  parseArguments,
  verifyFile
};
