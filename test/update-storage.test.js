'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanupUpdateRuns, withUpdateOperation, claimUpdateRun, setUpdateRunState, readJson } = require('../src/core/update-storage');
const { prepareInstalledUpdate, prepareUpdate, prepareOnlineUpdate, withPreparedUpdate, hashFile,
  readUpdateSuccessNotice, acknowledgeUpdateSuccess } = require('../src/core/update-manager');
const { promisify } = require('node:util');
const execute = promisify(require('node:child_process').execFile);

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-storage-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profile');
  await fs.mkdir(path.join(profile, 'updates'), { recursive: true });
  await fs.writeFile(path.join(profile, 'settings.json'), 'user data');
  return { root, profile, updates: path.join(profile, 'updates') };
}

async function run(f, name, record = {}) {
  const directory = path.join(f.updates, name);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'update-run.json'), JSON.stringify({ schemaVersion: 1,
    version: '4.8.6', phase: 'failed', ownerPid: 0, ...record }));
  await fs.writeFile(path.join(directory, 'package.zip'), 'temporary package');
  return directory;
}

test('a successful update retires abandoned, failed and superseded runs but keeps live workers and user data', async t => {
  const f = await fixture(t);
  const failed = await run(f, 'failed');
  await fs.mkdir(path.join(failed, 'rollback'));
  await fs.writeFile(path.join(failed, 'failed.json'), '{"error":"failed"}');
  await run(f, 'interrupted-download', { phase: 'preparing', ownerPid: 123456 });
  await run(f, 'old-ready', { version: '4.8.5', phase: 'ready' });
  const live = await run(f, 'active-worker');
  await fs.writeFile(path.join(live, 'started.json'), JSON.stringify({ pid: process.pid }));
  await fs.mkdir(path.join(f.updates, 'personal-folder'));
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.6', confirmedSuccess: true,
    alive: pid => pid === process.pid });
  assert.deepEqual((await fs.readdir(f.updates)).sort(), ['active-worker', 'personal-folder']);
  assert.equal(await fs.readFile(path.join(f.profile, 'settings.json'), 'utf8'), 'user data');
});

test('the next update removes inactive partial files but retains the sole recovery copy until success', async t => {
  const f = await fixture(t);
  const recovery = await run(f, 'failed-recovery');
  await fs.mkdir(path.join(recovery, 'rollback'));
  await run(f, 'cancelled-installer', { phase: 'applying', workerPid: 123456 });
  await run(f, 'incomplete', { phase: 'preparing', ownerPid: 123456 });
  await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true, alive: () => false });
  assert.deepEqual(await fs.readdir(f.updates), ['failed-recovery']);
});

test('startup keeps a pending package and retires it after detecting the installed version', async t => {
  const f = await fixture(t);
  await run(f, 'ready', { phase: 'ready' });
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.5' });
  assert.deepEqual(await fs.readdir(f.updates), ['ready']);
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.6' });
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('background success removes large update files while preserving the unshown release notes', async t => {
  const f = await fixture(t);
  const directory = await run(f, 'completed', { phase: 'applying' });
  await fs.mkdir(path.join(directory, 'rollback'));
  await fs.writeFile(path.join(directory, 'completed.json'), JSON.stringify({ version: '4.8.6' }));
  await fs.writeFile(path.join(directory, 'update-notice.json'), JSON.stringify({ schemaVersion: 1,
    fromVersion: '4.8.5', toVersion: '4.8.6', releaseNotes: { 'zh-CN': ['测试说明'], 'en-US': ['Test notes'] } }));
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.6', confirmedSuccess: true,
    keepNoticeRoots: [directory] });
  assert.deepEqual((await fs.readdir(directory)).sort(), ['update-notice.json', 'update-run.json']);
  const notice = await readUpdateSuccessNotice({ userDataDirectory: f.profile, currentVersion: '4.8.6' });
  assert.deepEqual(notice.releaseNotes['en-US'], ['Test notes']);
  // Another entry may be updating during acknowledgment. Persist dismissal even
  // when cleanup must wait, so the next launch never repeats this dialog.
  await withUpdateOperation(f.profile, () => acknowledgeUpdateSuccess(notice, {
    userDataDirectory: f.profile, currentVersion: '4.8.6', applicationRoot: ''
  }));
  assert.equal(await readUpdateSuccessNotice({ userDataDirectory: f.profile, currentVersion: '4.8.6' }), null);
  assert.equal((await readUpdateSuccessNotice({ userDataDirectory: f.profile,
    currentVersion: '4.8.6', includeAcknowledged: true })).acknowledged, true);
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.6', confirmedSuccess: true,
    keepNoticeRoots: [directory] });
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('cleanup and another preparation cannot race a live download operation', async t => {
  const f = await fixture(t);
  await run(f, 'partial');
  await withUpdateOperation(f.profile, async () => {
    await cleanupUpdateRuns({ userDataDirectory: f.profile, confirmedSuccess: true });
    assert.deepEqual((await fs.readdir(f.updates)).sort(), ['operation.json', 'partial']);
    await assert.rejects(withUpdateOperation(f.profile, async () => {}), /另一项更新/);
  });
  await fs.writeFile(path.join(f.updates, 'operation.json'), JSON.stringify({ pid: 123456, token: 'stale' }));
  await withUpdateOperation(f.profile, async () => {});
  assert.deepEqual(await fs.readdir(f.updates), ['partial']);
});

test('a crashed truncated operation lock can be recovered, while a fresh writer remains protected', async t => {
  const f = await fixture(t);
  const lock = path.join(f.updates, 'operation.json');
  await fs.writeFile(lock, '{');
  await assert.rejects(withUpdateOperation(f.profile, async () => {}), /另一项更新/);
  const old = new Date(Date.now() - 60_000);
  await fs.utimes(lock, old, old);
  await withUpdateOperation(f.profile, async () => {});
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('competing recoveries of a dead operation owner cannot acquire two simultaneous locks', async t => {
  const f = await fixture(t);
  const lock = path.join(f.updates, 'operation.json');
  await fs.writeFile(lock, JSON.stringify({ pid: 123456, token: 'dead' }));
  await fs.writeFile(`${lock}.recovery`, JSON.stringify({ pid: 123456, token: 'dead-recovery' }));
  let holders = 0, maximum = 0;
  const action = async () => {
    holders++;
    maximum = Math.max(maximum, holders);
    await new Promise(resolve => setTimeout(resolve, 50));
    holders--;
  };
  const results = await Promise.allSettled([withUpdateOperation(f.profile, action), withUpdateOperation(f.profile, action)]);
  assert.equal(maximum, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'UPDATE_BUSY');
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('claiming confirmation waits for the same lock used by cleanup snapshots', async t => {
  const f = await fixture(t);
  const directory = await run(f, '4.8.6-1800000000000-abcdef', { phase: 'ready' });
  let claiming;
  await withUpdateOperation(f.profile, async () => {
    claiming = claimUpdateRun(directory, 'confirming');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await readJson(path.join(directory, 'update-run.json'))).phase, 'ready');
  });
  await claiming;
  await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
  await fs.access(path.join(directory, 'package.zip'));
});

test('a package awaiting user confirmation cannot be retired by a concurrent update', async t => {
  const f = await fixture(t);
  const prepared = { runRoot: await run(f, 'ready-dialog', { phase: 'ready' }) };
  await withPreparedUpdate(prepared, async () => {
    await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
    await fs.access(path.join(prepared.runRoot, 'package.zip'));
  });
  await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('ownership survives state transitions on a real managed run while another entry attempts cleanup', async t => {
  const f = await fixture(t);
  const directory = await run(f, '4.8.6-1800000000000-abcdef', { phase: 'preparing', ownerPid: process.pid });
  let finished = false;
  const observer = (async () => {
    while (!finished) {
      const record = await readJson(path.join(directory, 'update-run.json'));
      assert.equal(record.ownerPid, process.pid);
      await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
    }
  })();
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      for (const phase of ['prepared', 'confirming', 'launching']) await setUpdateRunState(directory, phase);
    }
  } finally { finished = true; await observer; }
  await fs.access(path.join(directory, 'package.zip'));
  await setUpdateRunState(directory, 'ready');
  await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('cleanup removes only the matching Mac stage and backup after startup is confirmed', async t => {
  const f = await fixture(t);
  const directory = await run(f, 'mac-recovery');
  const applicationBundle = path.join(f.root, 'Applications', 'Hamster Archiver.app');
  await fs.mkdir(applicationBundle, { recursive: true });
  const backup = path.join(path.dirname(applicationBundle), '.hamster-backup-mac-recovery.app');
  const staged = path.join(path.dirname(applicationBundle), '.hamster-stage-mac-recovery.app');
  await fs.mkdir(backup);
  await fs.mkdir(staged);
  await fs.writeFile(path.join(directory, 'control.json'), JSON.stringify({ applicationBundle,
    packageRoot: path.join(directory, 'Hamster Archiver.app') }));
  const options = { userDataDirectory: f.profile, currentVersion: '4.8.7',
    applicationRoot: path.join(applicationBundle, 'Contents', 'Resources'), confirmedSuccess: true,
    processPaths: [path.join(backup, 'Contents', 'MacOS', 'Hamster Archiver')], onWarning: () => {} };
  await cleanupUpdateRuns(options);
  await fs.access(backup);
  await fs.access(directory);
  await cleanupUpdateRuns({ ...options, processPaths: [] });
  await assert.rejects(fs.access(backup), { code: 'ENOENT' });
  await assert.rejects(fs.access(staged), { code: 'ENOENT' });
  await fs.access(applicationBundle);
});

test('unsafe update and Mac backup junctions never redirect cleanup into other files', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
  await fs.symlink(outside, path.join(f.updates, '4.8.6-1800000000000-abcdef'), process.platform === 'win32' ? 'junction' : 'dir');
  const directory = await run(f, 'mac-linked-backup');
  const applicationBundle = path.join(f.root, 'Hamster Archiver.app');
  await fs.mkdir(applicationBundle);
  await fs.symlink(outside, path.join(f.root, '.hamster-backup-mac-linked-backup.app'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(directory, 'control.json'), JSON.stringify({ applicationBundle,
    packageRoot: path.join(directory, 'Hamster Archiver.app') }));
  await cleanupUpdateRuns({ userDataDirectory: f.profile, confirmedSuccess: true,
    applicationRoot: path.join(applicationBundle, 'Contents', 'Resources'), processPaths: [], onWarning: () => {} });
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  await fs.access(directory);
});

test('a substituted updates directory is never followed for preparation or cleanup', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
  await fs.rmdir(f.updates);
  await fs.symlink(outside, f.updates, process.platform === 'win32' ? 'junction' : 'dir');
  await cleanupUpdateRuns({ userDataDirectory: f.profile, confirmedSuccess: true });
  await assert.rejects(withUpdateOperation(f.profile, async () => {}), /安全的本地目录/);
  assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
});

test('success also retires identifiable orphan Mac backups left by older updater cleanup', async t => {
  const f = await fixture(t);
  const target = path.join(f.root, 'Hamster Archiver.app');
  const token = 'mac-4.8.6-beta.mac.1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const backup = path.join(f.root, `.hamster-backup-${token}.app`);
  for (const bundle of [target, backup]) {
    await fs.mkdir(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'Contents', 'Resources', 'release-manifest.json'), JSON.stringify({
      platform: 'darwin-universal', version: bundle === target ? '4.8.7-beta.mac.1' : '4.8.5-beta.mac.1', commit: 'a'.repeat(40)
    }));
  }
  const options = { userDataDirectory: f.profile, confirmedSuccess: true, currentVersion: '4.8.7-beta.mac.1',
    applicationRoot: path.join(target, 'Contents', 'Resources'), processPaths: [path.join(backup, 'Contents', 'MacOS', 'Hamster Archiver')] };
  await cleanupUpdateRuns(options);
  await fs.access(backup);
  await cleanupUpdateRuns({ ...options, processPaths: [] });
  await assert.rejects(fs.access(backup), { code: 'ENOENT' });
  await fs.access(target);
});

test('installed update reuses a verified pending download, and downloads again if its bytes are damaged', {
  skip: process.platform !== 'win32'
}, async t => {
  const f = await fixture(t);
  const content = Buffer.from('installer fixture');
  const digest = createHash('sha256').update(content).digest('hex');
  let downloads = 0;
  const options = { userDataDirectory: f.profile, currentVersion: '4.8.5', release: { latestVersion: '4.8.6',
    asset: { name: 'HamsterArchiver-Setup-v4.8.6-win-x64.exe', digest,
      downloadUrl: 'https://github.com/installer.exe' } }, fetchImpl: async () => { downloads++; return new Response(content); } };
  const first = await prepareInstalledUpdate(options);
  await cleanupUpdateRuns({ userDataDirectory: f.profile, beforeUpdate: true });
  await fs.access(first.installerPath); // The preparer-to-confirmation handoff is still owned.
  await withPreparedUpdate(first, async () => {});
  const second = await prepareInstalledUpdate(options);
  assert.equal(second.reused, true);
  assert.equal(downloads, 1);
  assert.deepEqual(await fs.readdir(f.updates), [path.basename(second.runRoot)]);
  await withPreparedUpdate(second, async () => {});
  await fs.writeFile(second.installerPath, 'damaged');
  const third = await prepareInstalledUpdate(options);
  assert.equal(third.reused, false);
  assert.equal(downloads, 2);
  assert.equal(await hashFile(third.installerPath), digest);
  assert.deepEqual(await fs.readdir(f.updates), [path.basename(third.runRoot)]);
  await withPreparedUpdate(third, async () => {});
  await cleanupUpdateRuns({ userDataDirectory: f.profile, currentVersion: '4.8.6' });
  assert.deepEqual(await fs.readdir(f.updates), []);
});

test('portable reuse re-extracts verified bytes instead of trusting a changed staged application', {
  skip: process.platform !== 'win32'
}, async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'HamsterArchiver.exe'), 'new application');
  const { createFileIntegrityEntries } = require('../src/core/tool-integrity');
  await fs.writeFile(path.join(source, 'release-manifest.json'), JSON.stringify({ schemaVersion: 2,
    version: '4.8.6', platform: 'win32-x64', integrity: { files: await createFileIntegrityEntries(source, ['HamsterArchiver.exe']) } }));
  const archive = path.join(f.root, 'package.zip');
  const sevenZipPath = path.resolve(__dirname, '..', 'tools', '7zip', '7z.exe');
  await execute(sevenZipPath, ['a', '-tzip', archive, source], { windowsHide: true });
  let downloads = 0;
  const options = { userDataDirectory: f.profile, applicationRoot: path.join(f.root, 'app'), sevenZipPath,
    currentVersion: '4.8.5', release: { latestVersion: '4.8.6', asset: {
      name: 'HamsterArchiver-v4.8.6-win-x64.zip', downloadUrl: 'https://github.com/package.zip', digest: await hashFile(archive) } },
    fetchImpl: async () => { downloads++; return new Response(await fs.readFile(archive)); } };
  const first = await prepareUpdate(options);
  await fs.writeFile(path.join(first.packageRoot, 'HamsterArchiver.exe'), 'changed staged file');
  await withPreparedUpdate(first, async () => {});
  const second = await prepareUpdate(options);
  assert.equal(downloads, 1);
  assert.equal(second.reused, true);
  assert.equal(await fs.readFile(path.join(second.packageRoot, 'HamsterArchiver.exe'), 'utf8'), 'new application');
  assert.deepEqual(await fs.readdir(f.updates), [path.basename(second.runRoot)]);
  await withPreparedUpdate(second, async () => {});
  const fallback = await prepareOnlineUpdate({ ...options,
    release: { ...options.release, distributionMode: 'portable', asset: {
      name: 'HamsterArchiver-v4.8.6-win-x64.7z', digest: 'a'.repeat(64), downloadUrl: 'https://github.com/package.7z',
      fallbackAsset: options.release.asset
    } }, fetchImpl: async url => {
      assert.match(url, /package\.7z$/);
      return new Response(null, { status: 404 });
    } });
  assert.equal(fallback.reused, true);
  assert.equal(downloads, 1);
  assert.deepEqual(await fs.readdir(f.updates), [path.basename(fallback.runRoot)]);
});
