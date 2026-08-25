'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const {
  APPLY_UPDATE_SCRIPT,
  INSTALL_STAGE_ITEMS_SCRIPT,
  UPDATE_LAUNCHER_SCRIPT,
  consumeUpdateFailure,
  hashFile,
  validateUpdatePackage,
  launchUpdate,
  manualUpdateInstructions,
  normalizeDigest,
  normalizeVersion,
  resolvePowerShellExecutable
} = require('../src/core/update-manager');
const { createFileIntegrityEntries } = require('../src/core/tool-integrity');

const execFileAsync = promisify(execFile);

test('update digest accepts GitHub SHA256 format and rejects malformed values', () => {
  const digest = 'a'.repeat(64);
  assert.equal(normalizeDigest(`sha256:${digest.toUpperCase()}`), digest);
  assert.equal(normalizeDigest(digest), digest);
  assert.equal(normalizeDigest(`${digest}  HamsterArchiver-v4.0.1-win-x64.zip`), digest);
  assert.equal(normalizeDigest('sha256:not-a-digest'), '');
});

test('update manifest version accepts a Release v prefix but keeps other differences visible', () => {
  assert.equal(normalizeVersion('v4.4.6'), '4.4.6');
  assert.equal(normalizeVersion(' V4.4.6 '), '4.4.6');
  assert.notEqual(normalizeVersion('4.4.5'), normalizeVersion('v4.4.6'));
});

test('update package hashing produces a stable SHA256 value', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'package.zip');
  await fs.writeFile(filePath, 'hamster archive update');
  assert.equal(await hashFile(filePath), '4422e5fb2510e3d5c57321f0db705bc9dde2ecb2d1daff34162668109612ed1a');
});


test('local update package accepts only a newer verified Windows x64 release', async function (t) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-local-update-package-'));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const executablePath = path.join(packageRoot, 'HamsterArchiver.exe');
  await fs.writeFile(executablePath, 'verified executable');
  const integrityFiles = await createFileIntegrityEntries(packageRoot, ['HamsterArchiver.exe']);
  const writeManifest = (overrides = {}) => fs.writeFile(
    path.join(packageRoot, 'release-manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      version: '4.5.3',
      platform: 'win32-x64',
      integrity: { files: integrityFiles },
      ...overrides
    })
  );
  await writeManifest();
  assert.equal((await validateUpdatePackage(packageRoot, '4.5.2')).version, '4.5.3');
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.3'), /不高于当前版本/);
  await writeManifest({ platform: 'linux-x64' });
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.2'), /Windows x64/);
  await writeManifest();
  await fs.writeFile(executablePath, 'tampered executable');
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.2'), /关键文件(?:大小不一致| SHA-256 校验失败)/);
});

test('update script requires the current portable executable name', () => {
  assert.match(APPLY_UPDATE_SCRIPT, /HamsterArchiver\.exe/);
  assert.doesNotMatch(APPLY_UPDATE_SCRIPT, /HamsterArchive\.exe/);
  assert.match(APPLY_UPDATE_SCRIPT, /started\.json/);
  assert.match(UPDATE_LAUNCHER_SCRIPT, /Start-Process/);
  assert.match(UPDATE_LAUNCHER_SCRIPT, /apply-update\.ps1/);
  assert.match(APPLY_UPDATE_SCRIPT, /Normalize-Version/);
});

test('Windows stage installation replaces existing directories instead of nesting them', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-stage-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stageRoot = path.join(root, 'stage');
  const applicationRoot = path.join(root, 'application');
  await Promise.all([
    fs.mkdir(path.join(stageRoot, 'resources', 'app'), { recursive: true }),
    fs.mkdir(path.join(stageRoot, 'userdata'), { recursive: true }),
    fs.mkdir(path.join(applicationRoot, 'resources', 'app'), { recursive: true }),
    fs.mkdir(path.join(applicationRoot, 'userdata'), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(stageRoot, 'resources', 'app', 'version.txt'), 'new'),
    fs.writeFile(path.join(stageRoot, 'userdata', 'marker.txt'), 'empty-new-userdata'),
    fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'version.txt'), 'old'),
    fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'stale.txt'), 'remove-me'),
    fs.writeFile(path.join(applicationRoot, 'userdata', 'marker.txt'), 'keep-existing-userdata')
  ]);
  const scriptPath = path.join(root, 'install-stage.ps1');
  await fs.writeFile(scriptPath, `\uFEFF${INSTALL_STAGE_ITEMS_SCRIPT}\n` + String.raw`
$items = @(Get-ChildItem -LiteralPath ([string]$env:HAMSTER_TEST_STAGE) -Force | Where-Object { $_.Name -ne 'userdata' })
Install-StageItems -Items $items -DestinationRoot ([string]$env:HAMSTER_TEST_APPLICATION)
`, 'utf8');
  await execFileAsync(resolvePowerShellExecutable(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      HAMSTER_TEST_STAGE: stageRoot,
      HAMSTER_TEST_APPLICATION: applicationRoot
    }
  });

  assert.equal(await fs.readFile(path.join(applicationRoot, 'resources', 'app', 'version.txt'), 'utf8'), 'new');
  await assert.rejects(() => fs.access(path.join(applicationRoot, 'resources', 'app', 'stale.txt')), /ENOENT/);
  await assert.rejects(() => fs.access(path.join(applicationRoot, 'resources', 'resources')), /ENOENT/);
  assert.equal(await fs.readFile(path.join(applicationRoot, 'userdata', 'marker.txt'), 'utf8'), 'keep-existing-userdata');
});

test('PowerShell resolver prefers the stable Windows system path', () => {
  const root = 'C:\\Windows';
  const expected = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  assert.equal(resolvePowerShellExecutable({ SystemRoot: root }, (candidate) => candidate === expected), expected);
  assert.equal(resolvePowerShellExecutable({}, () => false), 'powershell.exe');
});

test('update launch waits for updater handshake before returning', async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-launch-'));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  let detached = false;
  child.unref = () => { detached = true; };
  child.kill = () => {};
  const launchPromise = launchUpdate({
    prepared: { runRoot, applicationRoot: runRoot, packageRoot: runRoot, version: '4.1.2' },
    targetPid: 4567
  }, {
    spawnImpl: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    existsSyncImpl: () => false,
    existsImpl: async () => true,
    startupTimeoutMs: 50,
    startupPollIntervalMs: 1
  });
  const result = await launchPromise;
  assert.equal(result.updaterPid, 1234);
  assert.equal(detached, true);
});

test('update launch reports a PowerShell spawn failure and keeps diagnostics', async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-failure-'));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};
  child.unref = () => {};
  await assert.rejects(() => launchUpdate({
    prepared: { runRoot, applicationRoot: runRoot, packageRoot: runRoot, version: '4.1.2' },
    targetPid: 4567
  }, {
    spawnImpl: () => {
      queueMicrotask(() => child.emit('error', new Error('blocked by policy')));
      return child;
    },
    existsSyncImpl: () => false,
    startupTimeoutMs: 50,
    startupPollIntervalMs: 1
  }), /自动更新助手未能启动.*blocked by policy/s);
  await fs.access(path.join(runRoot, 'launcher.log'));
});

test('failed replacement is surfaced once on the next application start', async (t) => {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-notice-'));
  t.after(() => fs.rm(userDataRoot, { recursive: true, force: true }));
  const runRoot = path.join(userDataRoot, 'updates', '4.1.2-test');
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(path.join(runRoot, 'failed.json'), JSON.stringify({
    version: '4.1.2',
    error: 'replacement failed',
    failedAt: '2026-08-19T00:00:00.000Z'
  }));
  const failure = await consumeUpdateFailure(userDataRoot);
  assert.equal(failure.version, '4.1.2');
  assert.equal(failure.error, 'replacement failed');
  await fs.access(path.join(runRoot, 'failed.json'));
  await fs.access(path.join(runRoot, 'failed.notified.json'));
  assert.equal(await consumeUpdateFailure(userDataRoot), null);
});

test('manual update guide recommends warehouse export and import instead of copying userdata', () => {
  const guide = manualUpdateInstructions();
  assert.match(guide, /导出仓库/);
  assert.match(guide, /并入外部仓库/);
  assert.match(guide, /HamsterArchiver\.exe/);
  assert.doesNotMatch(guide, /复制.*userdata/i);
  const englishGuide = manualUpdateInstructions('en-US');
  assert.match(englishGuide, /Import external warehouse/i);
  assert.doesNotMatch(englishGuide, /copy.*userdata/i);
});

test('Windows updater completes a real PowerShell handshake and writes failure diagnostics', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-powershell-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applicationRoot = path.join(root, 'application');
  const packageRoot = path.join(root, 'package');
  const runRoot = path.join(root, 'run');
  await Promise.all([
    fs.mkdir(applicationRoot, { recursive: true }),
    fs.mkdir(packageRoot, { recursive: true }),
    fs.mkdir(runRoot, { recursive: true })
  ]);
  const result = await launchUpdate({
    prepared: { runRoot, applicationRoot, packageRoot, version: '4.1.2' },
    targetPid: 2_147_483_647
  });
  await fs.access(result.startedFile);
  const failurePath = path.join(runRoot, 'failed.json');
  let failureCreated = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(failurePath);
      failureCreated = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(failureCreated, true);
  assert.match(await fs.readFile(path.join(runRoot, 'update.log'), 'utf8'), /更新失败/);
});

test('Windows updater survives the launcher process exiting after the handshake', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-survival-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applicationRoot = path.join(root, 'application');
  const packageRoot = path.join(root, 'package');
  const runRoot = path.join(root, 'run');
  await Promise.all([
    fs.mkdir(applicationRoot, { recursive: true }),
    fs.mkdir(packageRoot, { recursive: true }),
    fs.mkdir(runRoot, { recursive: true })
  ]);
  const fixturePath = path.join(root, 'launcher-fixture.js');
  const updateManagerPath = path.resolve(__dirname, '..', 'src', 'core', 'update-manager.js');
  await fs.writeFile(fixturePath, `'use strict';\nconst { launchUpdate } = require(${JSON.stringify(updateManagerPath)});\nlaunchUpdate({ prepared: ${JSON.stringify({ runRoot, applicationRoot, packageRoot, version: '4.1.2' })}, targetPid: process.pid }).then(() => process.exit(0)).catch((error) => { console.error(error.stack); process.exit(1); });\n`);
  await execFileAsync(process.execPath, [fixturePath], { windowsHide: true, timeout: 15_000 });
  const failurePath = path.join(runRoot, 'failed.json');
  let failureCreated = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(failurePath);
      failureCreated = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(failureCreated, true);
});
