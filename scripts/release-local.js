'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');
const { hashFile } = require('../src/core/tool-integrity');
const { assertPathInsideLocalRoot, makeLocalLayout } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const layout = makeLocalLayout(projectRoot);
const releaseName = `HamsterArchiver-v${packageJson.version}-win-x64`;
const stagingBuild = path.join(layout.stagingRoot, releaseName);
const stagedZip = path.join(layout.stagingRoot, `${releaseName}.staging.zip`);
const finalZip = path.join(layout.packageRoot, `${releaseName}.zip`);
const finalSha = `${finalZip}.sha256`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || 'inherit',
    timeout: options.timeout
  });
}

async function exists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(targetPath, label) {
  try {
    return JSON.parse(await fsp.readFile(targetPath, 'utf8'));
  } catch (error) {
    throw new Error(`${label}（${targetPath}）不存在或内容无效。`, { cause: error });
  }
}

async function prepareReleasePrerequisites(npmCli) {
  const electronPackage = path.join(projectRoot, 'node_modules', 'electron', 'package.json');
  const electronExtractorPackage = path.join(
    projectRoot,
    'node_modules',
    '@electron-internal',
    'extract-zip',
    'package.json'
  );
  if (!(await exists(electronPackage)) || !(await exists(electronExtractorPackage))) {
    console.log('缺少本地 npm 依赖，正在按锁文件安装一次。');
    run(process.execPath, [npmCli, 'ci'], { timeout: 600000 });
  }

  const sevenZipPath = path.join(projectRoot, 'tools', '7zip', '7z.exe');
  const ffmpegPath = path.join(projectRoot, 'tools', 'ffmpeg', 'ffmpeg.exe');
  if (!(await exists(sevenZipPath)) || !(await exists(ffmpegPath))) {
    if (!(await exists(sevenZipPath))) {
      const systemSevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
      if (!(await exists(systemSevenZip))) {
        throw new Error('缺少内置工具且系统没有可用于恢复的 7-Zip。');
      }
      await fsp.mkdir(path.dirname(sevenZipPath), { recursive: true });
      await fsp.copyFile(systemSevenZip, sevenZipPath);
    }
    console.log('缺少锁定的发行工具，正在从固定来源恢复并校验一次。');
    run(process.execPath, [npmCli, 'run', 'tools:prepare'], { timeout: 600000 });
  }
}

function renameWithPowerShell(sourcePath, destinationPath) {
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Move-Item -LiteralPath $env:HAMSTER_RENAME_SOURCE -Destination $env:HAMSTER_RENAME_DESTINATION -ErrorAction Stop'
  ], {
    env: {
      ...process.env,
      HAMSTER_RENAME_SOURCE: sourcePath,
      HAMSTER_RENAME_DESTINATION: destinationPath
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
        try {
          renameWithPowerShell(sourcePath, destinationPath);
          return;
        } catch (fallbackError) {
          error.cause = fallbackError;
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function assertApplicationStopped() {
  const processes = run('tasklist.exe', [
    '/FI', 'IMAGENAME eq HamsterArchiver.exe', '/FO', 'CSV', '/NH'
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  if (/"HamsterArchiver\.exe"/i.test(processes)) {
    throw new Error('检测到 HamsterArchiver.exe 正在运行；请正常退出后再发行。');
  }
}

async function promoteCurrent(suffix) {
  let previousCurrent = null;
  if (await exists(layout.currentBuild)) {
    previousCurrent = path.join(layout.historyRoot, `current-${suffix}`);
    await renameWithRetry(layout.currentBuild, previousCurrent);
  }
  try {
    await renameWithRetry(stagingBuild, layout.currentBuild);
    return previousCurrent;
  } catch (error) {
    if (previousCurrent && !(await exists(layout.currentBuild))) {
      await renameWithRetry(previousCurrent, layout.currentBuild);
    }
    throw error;
  }
}

async function replacePackage(digest, suffix) {
  const packageHistory = path.join(layout.historyRoot, 'packages');
  const priorZip = path.join(packageHistory, `${releaseName}-${suffix}.zip`);
  const priorSha = `${priorZip}.sha256`;
  const temporarySha = `${finalSha}.new`;
  let savedZip = false;
  let savedSha = false;

  await fsp.mkdir(packageHistory, { recursive: true });
  await fsp.rm(temporarySha, { force: true });
  if (await exists(finalZip)) {
    await renameWithRetry(finalZip, priorZip);
    savedZip = true;
  }
  if (await exists(finalSha)) {
    await renameWithRetry(finalSha, priorSha);
    savedSha = true;
  }

  try {
    await renameWithRetry(stagedZip, finalZip);
    await fsp.writeFile(
      temporarySha,
      `${digest} *${path.basename(finalZip)}\r\n`,
      'ascii'
    );
    await renameWithRetry(temporarySha, finalSha);
  } catch (error) {
    await fsp.rm(temporarySha, { force: true });
    if (await exists(finalZip)) await renameWithRetry(finalZip, stagedZip);
    if (savedZip) await renameWithRetry(priorZip, finalZip);
    if (savedSha) await renameWithRetry(priorSha, finalSha);
    throw error;
  }
}

async function main() {
  const argumentsSet = new Set(process.argv.slice(2));
  const fullChecks = argumentsSet.delete('--full-checks');
  if (argumentsSet.size > 0) {
    throw new Error(`未知本地发行参数：${[...argumentsSet].join(', ')}`);
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('本地发行只支持 Windows x64。');
  }
  for (const target of [
    stagingBuild, stagedZip, layout.currentBuild, layout.packageRoot,
    layout.historyRoot, layout.productionData
  ]) {
    assertPathInsideLocalRoot(target, layout.root);
  }
  assertApplicationStopped();

  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  if (status) {
    throw new Error('发行前工作树必须干净；请先提交本轮修改。');
  }

  const npmCli = String(process.env.npm_execpath || '').trim();
  if (!npmCli) throw new Error('无法定位当前 npm CLI。请通过 npm run release:local 启动。');
  await prepareReleasePrerequisites(npmCli);
  run(process.execPath, [path.join('scripts', 'prepare-electron-runtime.js')]);

  console.log(fullChecks
    ? '本地发行模式：完整验证'
    : '本地发行模式：日常快速提升（跳过完整源码测试矩阵）');
  if (fullChecks) {
    for (const script of [
      'verify:dependencies', 'check', 'test', 'publish:check', 'verify:tools'
    ]) {
      run(process.execPath, [npmCli, 'run', script]);
    }
  }

  const commit = run('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  await fsp.mkdir(layout.stagingRoot, { recursive: true });
  await fsp.rm(stagedZip, { force: true });
  run(process.execPath, [path.join('scripts', 'build-release.js')], {
    env: { ...process.env, HAMSTER_RELEASE_COMMIT: commit }
  });

  const manifest = JSON.parse(await fsp.readFile(
    path.join(stagingBuild, 'release-manifest.json'),
    'utf8'
  ));
  if (manifest.version !== packageJson.version || manifest.commit !== commit) {
    throw new Error('发行清单与当前版本或提交不一致。');
  }

  const sevenZip = path.join(projectRoot, 'tools', '7zip', '7z.exe');
  run(sevenZip, ['a', '-tzip', '-mx=9', stagedZip, releaseName], {
    cwd: layout.stagingRoot
  });
  run(sevenZip, ['t', stagedZip]);
  const digest = await hashFile(stagedZip);

  const smokeRoot = path.join(
    layout.root,
    'development',
    'smoke',
    `release-${Date.now()}`
  );
  await fsp.mkdir(smokeRoot, { recursive: true });
  try {
    const smokeResultPath = path.join(smokeRoot, 'smoke-result.json');
    run(path.join(stagingBuild, 'HamsterArchiver.exe'), [], {
      env: {
        ...process.env,
        HAMSTER_SMOKE_TEST: '1',
        HAMSTER_SMOKE_USER_DATA_DIR: smokeRoot,
        // Hosted Windows runners do not reliably preserve stdout from a GUI
        // executable. The app writes this only after every smoke assertion.
        HAMSTER_SMOKE_RESULT_FILE: smokeResultPath
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000
    });
    const smokeResult = await readJson(smokeResultPath, '发行包烟雾测试结果');
    if (!smokeResult.ok || smokeResult.stage !== 'complete' ||
        smokeResult.version !== packageJson.version || !smokeResult.completedAt) {
      const details = smokeResult.details ? ` ${JSON.stringify(smokeResult.details)}` : '';
      throw new Error(`发行包烟雾测试失败：${smokeResult.stage || '未知阶段'}。${details}`);
    }
  } finally {
    await fsp.rm(smokeRoot, { recursive: true, force: true });
  }

  const startupIntegrityRoot = path.join(
    layout.root,
    'development',
    'smoke',
    `startup-integrity-${Date.now()}`
  );
  await fsp.mkdir(startupIntegrityRoot, { recursive: true });
  try {
    const cachePath = path.join(startupIntegrityRoot, 'cache', 'release-integrity-v1.json');
    const cacheReceipts = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const validationPath = path.join(startupIntegrityRoot, `startup-${attempt + 1}.json`);
      run(path.join(stagingBuild, 'HamsterArchiver.exe'), [], {
        env: {
          ...process.env,
          HAMSTER_STARTUP_INTEGRITY_TEST: '1',
          HAMSTER_SMOKE_USER_DATA_DIR: startupIntegrityRoot,
          HAMSTER_UPDATE_VALIDATION_FILE: validationPath
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000
      });
      const validation = await readJson(validationPath, `第 ${attempt + 1} 次打包启动验收`);
      if (validation.version !== packageJson.version || !validation.validatedAt) {
        throw new Error(`第 ${attempt + 1} 次打包启动验收与当前版本不一致。`);
      }
      const cache = await readJson(cachePath, `第 ${attempt + 1} 次启动完整性缓存`);
      const cacheStat = await fsp.stat(cachePath);
      cacheReceipts.push({ source: JSON.stringify(cache), modifiedMs: cacheStat.mtimeMs });
    }
    if (cacheReceipts[0].source !== cacheReceipts[1].source ||
        cacheReceipts[0].modifiedMs !== cacheReceipts[1].modifiedMs) {
      throw new Error('打包启动完整性缓存在第二次启动时被重写，未按预期命中。');
    }
  } finally {
    await fsp.rm(startupIntegrityRoot, { recursive: true, force: true });
  }

  // A local test release is only complete when both desktop distributions are
  // available: the portable Current executable and the NSIS installer.
  run(process.execPath, [path.join('scripts', 'build-installer.js')], {
    timeout: 1800000
  });

  await fsp.writeFile(
    path.join(stagingBuild, 'user-data-location.json'),
    JSON.stringify({ userDataDirectory: '../../data/production' }, null, 2) + '\n',
    'utf8'
  );
  await fsp.mkdir(layout.productionData, { recursive: true });
  await fsp.mkdir(layout.historyRoot, { recursive: true });
  await fsp.mkdir(layout.packageRoot, { recursive: true });

  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const previousCurrent = await promoteCurrent(suffix);
  try {
    await replacePackage(digest, suffix);
  } catch (error) {
    if (await exists(layout.currentBuild)) {
      await renameWithRetry(layout.currentBuild, stagingBuild);
    }
    if (previousCurrent) await renameWithRetry(previousCurrent, layout.currentBuild);
    throw error;
  }

  console.log('');
  console.log(`发行模式：${fullChecks ? '完整验证' : '日常快速提升'}`);
  console.log(`当前构建：${layout.currentBuild}`);
  console.log(`便携版程序：${path.join(layout.currentBuild, 'HamsterArchiver.exe')}`);
  console.log(`发行压缩包：${finalZip}`);
  console.log(`安装程序：${path.join(layout.installerRoot, `HamsterArchiver-Setup-v${packageJson.version}-win-x64.exe`)}`);
  console.log(`SHA-256：${digest}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
