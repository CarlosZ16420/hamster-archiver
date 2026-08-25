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
    await fsp.rename(layout.currentBuild, previousCurrent);
  }
  try {
    await fsp.rename(stagingBuild, layout.currentBuild);
    return previousCurrent;
  } catch (error) {
    if (previousCurrent && !(await exists(layout.currentBuild))) {
      await fsp.rename(previousCurrent, layout.currentBuild);
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
    await fsp.rename(finalZip, priorZip);
    savedZip = true;
  }
  if (await exists(finalSha)) {
    await fsp.rename(finalSha, priorSha);
    savedSha = true;
  }

  try {
    await fsp.rename(stagedZip, finalZip);
    await fsp.writeFile(
      temporarySha,
      `${digest} *${path.basename(finalZip)}\r\n`,
      'ascii'
    );
    await fsp.rename(temporarySha, finalSha);
  } catch (error) {
    await fsp.rm(temporarySha, { force: true });
    if (await exists(finalZip)) await fsp.rename(finalZip, stagedZip);
    if (savedZip) await fsp.rename(priorZip, finalZip);
    if (savedSha) await fsp.rename(priorSha, finalSha);
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

  console.log(fullChecks
    ? '本地发行模式：完整验证'
    : '本地发行模式：日常快速提升（跳过完整源码测试矩阵）');
  if (fullChecks) {
    const npmCli = String(process.env.npm_execpath || '').trim();
    if (!npmCli) throw new Error('无法定位当前 npm CLI。请通过 npm run release:local 启动。');
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
    const smokeOutput = run(path.join(stagingBuild, 'HamsterArchiver.exe'), [], {
      env: {
        ...process.env,
        HAMSTER_SMOKE_TEST: '1',
        HAMSTER_SMOKE_USER_DATA_DIR: smokeRoot
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000
    });
    if (!smokeOutput.includes('HAMSTER_SMOKE_TEST_OK')) {
      throw new Error('发行包烟雾测试没有返回成功标记。');
    }
  } finally {
    await fsp.rm(smokeRoot, { recursive: true, force: true });
  }

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
      await fsp.rename(layout.currentBuild, stagingBuild);
    }
    if (previousCurrent) await fsp.rename(previousCurrent, layout.currentBuild);
    throw error;
  }

  console.log('');
  console.log(`发行模式：${fullChecks ? '完整验证' : '日常快速提升'}`);
  console.log(`当前构建：${layout.currentBuild}`);
  console.log(`发行压缩包：${finalZip}`);
  console.log(`SHA-256：${digest}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
