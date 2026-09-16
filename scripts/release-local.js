'use strict';

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');
const { hashFile } = require('../src/core/tool-integrity');
const { assertPathInsideLocalRoot, makeLocalLayout } = require('../src/core/local-paths');
const { openCheckpoint, runStage } = require('./release-checkpoint');

const projectRoot = path.resolve(__dirname, '..');
const layout = makeLocalLayout(projectRoot);
const releaseName = `HamsterArchiver-v${packageJson.version}-win-x64`;
const stagingBuild = path.join(layout.stagingRoot, releaseName);
const stagedZip = path.join(layout.stagingRoot, `${releaseName}.staging.zip`);
const finalZip = path.join(layout.packageRoot, `${releaseName}.zip`);
const finalSha = `${finalZip}.sha256`;
const installerPath = path.join(layout.installerRoot, `HamsterArchiver-Setup-v${packageJson.version}-win-x64.exe`);
const installerSha = `${installerPath}.sha256`;

function parseOptions(argv) {
  const options = { outputs: new Set(['current']), smoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--smoke') options.smoke = true;
    else if (name === '--outputs') {
      const value = argv[++index];
      if (!value) throw new Error(`参数 ${name} 缺少值。`);
      options.outputs = new Set(value.split(',').map(item => item.trim()).filter(Boolean));
    } else throw new Error(`未知本地发行参数：${name}`);
  }
  const unknownOutputs = [...options.outputs].filter(item => !['current', 'zip', 'installer'].includes(item));
  if (options.outputs.size === 0 || unknownOutputs.length > 0) {
    throw new Error(`发行输出必须从 current、zip、installer 中选择：${unknownOutputs.join(', ')}`);
  }
  return options;
}

function manifestMatches(target, commit) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'release-manifest.json'), 'utf8'));
    return manifest.version === packageJson.version && manifest.commit === commit;
  } catch {
    return false;
  }
}

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

async function prepareNpmDependencies(npmCli) {
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
}

async function prepareReleasePrerequisites(npmCli) {
  await prepareNpmDependencies(npmCli);

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
  const options = parseOptions(process.argv.slice(2));
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('本地发行只支持 Windows x64。');
  }
  if (options.smoke && process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('--smoke 仅供正式云端构建使用；本地 Current 和本地兜底不执行自动测试。');
  }
  for (const target of [
    stagingBuild, stagedZip, layout.currentBuild, layout.packageRoot,
    layout.historyRoot, layout.productionData, layout.releaseRunsRoot
  ]) {
    assertPathInsideLocalRoot(target, layout.root);
  }
  if (options.outputs.has('current')) assertApplicationStopped();

  const status = run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  if (status) {
    throw new Error('发行前工作树必须干净；请先提交本轮修改。');
  }

  const commit = run('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim();
  const checkpoint = await openCheckpoint({
    version: packageJson.version,
    commit,
    request: { outputs: [...options.outputs].sort(), smoke: options.smoke }
  });
  await runStage(checkpoint, 'source', async () => ({ clean: true }));
  if (options.outputs.size === 1 && options.outputs.has('current') && manifestMatches(layout.currentBuild, commit)) {
    console.log(`Current 已对应 ${commit}，无需重新构建：${layout.currentBuild}`);
    return;
  }

  const npmCli = String(process.env.npm_execpath || '').trim();
  if (!npmCli) throw new Error('无法定位当前 npm CLI。请通过 npm run release:local 启动。');
  await runStage(checkpoint, 'dependencies', async () => {
    await prepareReleasePrerequisites(npmCli);
    run(process.execPath, [path.join('scripts', 'prepare-electron-runtime.js'), '--allow-download']);
    return { electron: packageJson.devDependencies.electron };
  }, { reusable: receipt => [
    path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(projectRoot, 'tools', '7zip', '7z.exe'),
    path.join(projectRoot, 'tools', 'ffmpeg', 'ffmpeg.exe')
  ].every(fs.existsSync) && receipt.result?.electron === packageJson.devDependencies.electron });

  console.log(`本地构建：自动测试=无，输出=${[...options.outputs].join(',')}`);
  await fsp.mkdir(layout.stagingRoot, { recursive: true });
  await runStage(checkpoint, 'build', async () => {
    run(process.execPath, [path.join('scripts', 'build-release.js')], {
      env: { ...process.env, HAMSTER_RELEASE_COMMIT: commit }
    });
    return { directory: stagingBuild };
  }, { reusable: () => manifestMatches(stagingBuild, commit) });

  const manifest = JSON.parse(await fsp.readFile(
    path.join(stagingBuild, 'release-manifest.json'),
    'utf8'
  ));
  if (manifest.version !== packageJson.version || manifest.commit !== commit) {
    throw new Error('发行清单与当前版本或提交不一致。');
  }

  const smokeRoot = path.join(
    layout.root,
    'development',
    'smoke',
    `release-${Date.now()}`
  );
  if (options.smoke) await runStage(checkpoint, 'smoke', async () => {
    await fsp.mkdir(smokeRoot, { recursive: true });
    try {
      const smokeResultPath = path.join(smokeRoot, 'smoke-result.json');
      run(path.join(stagingBuild, 'HamsterArchiver.exe'), [], {
        env: {
          ...process.env,
          HAMSTER_SMOKE_TEST: '1',
          HAMSTER_SMOKE_MODE: 'minimal',
          HAMSTER_SMOKE_USER_DATA_DIR: smokeRoot,
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
      return smokeResult;
    } finally {
      await fsp.rm(smokeRoot, { recursive: true, force: true });
    }
  });

  await fsp.mkdir(layout.productionData, { recursive: true });
  await fsp.mkdir(layout.historyRoot, { recursive: true });
  await fsp.mkdir(layout.packageRoot, { recursive: true });

  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  let digest = null;
  if (options.outputs.has('zip')) digest = await runStage(checkpoint, 'zip', async () => {
    await fsp.rm(stagedZip, { force: true });
    const sevenZip = path.join(projectRoot, 'tools', '7zip', '7z.exe');
    run(sevenZip, ['a', '-tzip', '-mx=5', stagedZip, releaseName], { cwd: layout.stagingRoot });
    run(sevenZip, ['t', stagedZip]);
    const zipDigest = await hashFile(stagedZip);
    await replacePackage(zipDigest, suffix);
    return zipDigest;
  }, { reusable: receipt => fs.existsSync(finalZip) && fs.existsSync(finalSha) && receipt.result && fs.readFileSync(finalSha, 'ascii').startsWith(receipt.result) });

  if (options.outputs.has('installer')) await runStage(checkpoint, 'installer', async () => {
    run(process.execPath, [path.join('scripts', 'build-installer.js')], { timeout: 1800000 });
    const digestText = (await fsp.readFile(installerSha, 'ascii')).trim();
    return { path: installerPath, digest: digestText.split(/\s+/)[0] };
  }, { reusable: async receipt => fs.existsSync(installerPath) && fs.existsSync(installerSha) &&
    Boolean(receipt.result?.digest) && await hashFile(installerPath) === receipt.result.digest &&
    fs.readFileSync(installerSha, 'ascii').startsWith(receipt.result.digest) });

  if (options.outputs.has('current')) await runStage(checkpoint, 'promote-current', async () => {
    await fsp.writeFile(
      path.join(stagingBuild, 'user-data-location.json'),
      JSON.stringify({ userDataDirectory: '../../data/production' }, null, 2) + '\n',
      'utf8'
    );
    await promoteCurrent(suffix);
    return { directory: layout.currentBuild };
  }, { reusable: () => manifestMatches(layout.currentBuild, commit) });

  console.log('');
  console.log('自动测试：无（本地构建器只负责生成产物）');
  console.log(`产物烟雾：${options.smoke ? '已执行' : '未执行'}`);
  console.log(`检查点：${checkpoint.target}`);
  if (options.outputs.has('current')) console.log(`当前构建：${layout.currentBuild}`);
  if (options.outputs.has('zip')) console.log(`发行压缩包：${finalZip}\nSHA-256：${digest}`);
  if (options.outputs.has('installer')) console.log(`安装程序：${installerPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseOptions };
