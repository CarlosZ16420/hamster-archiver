'use strict';

// Update-owned files only. This module also runs beside the detached Mac worker.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const RECORD = 'update-run.json';

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function readJson(file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function directoryInfo(directory) {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory) return null;
    return info;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function updatesDirectory(userDataDirectory, create = false) {
  // Canonicalize the profile, but never follow a substituted updates symlink.
  if (create) await fs.mkdir(userDataDirectory, { recursive: true });
  let profile;
  try { profile = await fs.realpath(userDataDirectory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const root = path.join(profile, 'updates');
  if (create) await fs.mkdir(root, { recursive: true });
  if (!await directoryInfo(root)) {
    if (create) throw new Error('更新目录不是安全的本地目录。');
    return null;
  }
  return root;
}

function busyError() {
  return Object.assign(new Error('另一项更新操作正在进行。'), { code: 'UPDATE_BUSY' });
}

async function acquireUpdateLock(lock, depth = 0) {
  if (depth > 16) throw busyError();
  const token = crypto.randomUUID();
  const owner = JSON.stringify({ pid: process.pid, token });
  async function claim() {
    let handle;
    try {
      handle = await fs.open(lock, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      throw busyError();
    }
    try { await handle.writeFile(owner); }
    catch (error) { await handle.close(); await fs.rm(lock, { force: true }); throw error; }
    if ((await readJson(lock))?.token !== token) { await handle.close(); throw busyError(); }
    return async () => {
      await handle.close();
      if ((await readJson(lock))?.token === token) await fs.unlink(lock);
    };
  }
  try { return await claim(); }
  catch (error) { if (error.code !== 'UPDATE_BUSY') throw error; }
  // Serialize re-reading and removing a dead owner with an independent gate.
  // The same protocol recovers a gate whose own process crashed.
  const releaseRecovery = await acquireUpdateLock(`${lock}.recovery`, depth + 1);
  try {
    const previous = await readJson(lock);
    const info = await fs.lstat(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (isAlive(previous?.pid) || (!previous && info && Date.now() - info.mtimeMs < 30_000)) throw busyError();
    if (info) await fs.unlink(lock);
    // A direct claimant may win after unlink. wx rejects it without deleting its lock.
    return await claim();
  } finally { await releaseRecovery(); }
}

async function withUpdateOperation(userDataDirectory, action) {
  const root = await updatesDirectory(userDataDirectory, true);
  const release = await acquireUpdateLock(path.join(root, 'operation.json'));
  try {
    for (const name of await fs.readdir(root)) {
      if (!/^operation\.json(?:\.recovery)+$/.test(name)) continue;
      const file = path.join(root, name);
      const prior = await readJson(file);
      if (isAlive(prior?.pid)) continue;
      try { const retire = await acquireUpdateLock(file); await retire(); }
      catch (error) { if (error.code !== 'UPDATE_BUSY') throw error; }
    }
    return await action();
  }
  finally {
    await release();
  }
}

async function claimUpdateRun(runRoot, phase) {
  if (!await readJson(path.join(runRoot, RECORD))) return; // Old in-flight helpers use started.json.
  const updatesRoot = path.dirname(runRoot);
  if (path.basename(updatesRoot) !== 'updates') throw new Error('更新目录不是安全的本地目录。');
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      return await withUpdateOperation(path.dirname(updatesRoot), async () => {
        if (!await directoryInfo(runRoot)) throw new Error('更新目录不是安全的本地目录。');
        await setUpdateRunState(runRoot, phase);
      });
    } catch (error) {
      if (error.code !== 'UPDATE_BUSY' || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function setUpdateRunState(runRoot, phase, extra = {}) {
  const previous = await readJson(path.join(runRoot, RECORD));
  if (!previous) return; // Legacy prepared runs remain compatible.
  const temporary = path.join(runRoot, `.update-run-${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...previous, ...extra, phase,
      ownerPid: ['preparing', 'prepared', 'confirming', 'launching'].includes(phase) ? process.pid : 0 }));
    const deadline = Date.now() + 1500;
    while (true) {
      try { await fs.rename(temporary, path.join(runRoot, RECORD)); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
  } finally { await fs.rm(temporary, { force: true }); }
}

async function runActive(runRoot, record, alive = isAlive) {
  const started = await readJson(path.join(runRoot, 'started.json'));
  if (alive(started?.pid) || alive(record?.workerPid) || alive(record?.ownerPid)) return true;
  const info = await directoryInfo(runRoot);
  const mount = path.join(runRoot, 'mount');
  try {
    const mounted = await fs.lstat(mount);
    // A mounted DMG must be detached by its owner, never recursively deleted.
    if (mounted.isSymbolicLink() || (mounted.isDirectory() && (await fs.stat(mount)).dev !== info.dev)) return true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return false;
}

function legacyVersion(name) {
  return /^(?:installer-(?:local-)?|mac-)?(\d+\.\d+\.\d+(?:-beta\.mac\.\d+)?)-/.exec(name)?.[1] || '';
}

function managedName(name) {
  return /^(?:(?:installer-(?:local-)?)?\d+\.\d+\.\d+-\d{13}-[a-f0-9]{6}|local-\d{13}-[a-f0-9]{6}|mac-\d+\.\d+\.\d+(?:-beta\.mac\.\d+)?-[a-f0-9-]{36})$/.test(name);
}

async function runs(root) {
  const result = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runRoot = path.join(root, entry.name);
    if (!await directoryInfo(runRoot)) continue;
    const record = await readJson(path.join(runRoot, RECORD));
    if (record?.schemaVersion !== 1 && !managedName(entry.name)) continue;
    result.push({ runRoot, record, version: record?.version || legacyVersion(entry.name) });
  }
  return result;
}

async function hasRecovery(runRoot) {
  if (await directoryInfo(path.join(runRoot, 'rollback'))) return true;
  const control = await readJson(path.join(runRoot, 'control.json'));
  return Boolean(control?.applicationBundle);
}

async function removeMacRecovery(run, { applicationRoot, processPaths, platform }) {
  const control = await readJson(path.join(run.runRoot, 'control.json'));
  if (!control?.applicationBundle) return;
  const target = path.resolve(control.applicationBundle);
  const runningBundle = applicationRoot ? path.resolve(applicationRoot, '..', '..') : '';
  if (target !== runningBundle || !target.endsWith('.app') || !await directoryInfo(target) ||
      path.resolve(control.packageRoot || '') !== path.join(run.runRoot, 'Hamster Archiver.app')) {
    throw new Error('保留更新恢复文件：无法确认当前应用的位置。');
  }
  const paths = processPaths ?? (platform === 'darwin'
    ? String((await execute('/bin/ps', ['-axo', 'comm='])).stdout).split('\n').map(line => line.trim()) : []);
  // Derive the only two permissible sibling paths; never trust a backup path in JSON.
  for (const prefix of ['.hamster-stage-', '.hamster-backup-']) {
    const sibling = path.join(path.dirname(target), `${prefix}${path.basename(run.runRoot)}.app`);
    const info = await fs.lstat(sibling).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!info) continue;
    if (!await directoryInfo(sibling) || paths.some(file => file === sibling || file.startsWith(`${sibling}${path.sep}`))) {
      throw new Error('保留更新恢复文件：恢复应用仍在使用或位置不安全。');
    }
    await fs.rm(sibling, { recursive: true, force: true });
  }
}

async function cleanupOrphanMacApps(root, { applicationRoot, currentVersion, processPaths, platform }) {
  if (!applicationRoot || (platform !== 'darwin' && !processPaths)) return;
  const target = path.resolve(applicationRoot, '..', '..');
  if (!target.endsWith('.app') || !await directoryInfo(target)) return;
  const current = await readJson(path.join(target, 'Contents', 'Resources', 'release-manifest.json'));
  if (current?.platform !== 'darwin-universal' || current.version !== currentVersion) return;
  const paths = processPaths ?? String((await execute('/bin/ps', ['-axo', 'comm='])).stdout).split('\n').map(line => line.trim());
  for (const entry of await fs.readdir(path.dirname(target), { withFileTypes: true })) {
    const match = /^\.hamster-(?:stage|backup)-(mac-.+)\.app$/.exec(entry.name);
    if (!match || !managedName(match[1]) || !entry.isDirectory()) continue;
    // Previous versions deleted the run directory but left its sibling backup.
    if (await fs.lstat(path.join(root, match[1])).catch(error => { if (error.code !== 'ENOENT') throw error; })) continue;
    const sibling = path.join(path.dirname(target), entry.name);
    if (!await directoryInfo(sibling) || paths.some(file => file.startsWith(`${sibling}${path.sep}`))) continue;
    const manifest = await readJson(path.join(sibling, 'Contents', 'Resources', 'release-manifest.json'));
    if (manifest?.platform !== 'darwin-universal' || !/^[a-f0-9]{40}$/.test(manifest.commit || '')) continue;
    await fs.rm(sibling, { recursive: true, force: true });
  }
}

async function cleanupUpdateRuns(options) {
  const { userDataDirectory, currentVersion = '', applicationRoot = '',
  beforeUpdate = false, confirmedSuccess = false, keepRoots = [], keepNoticeRoots = [], operationOwned = false,
  isObsolete = version => version === currentVersion, alive = isAlive, processPaths,
  platform = process.platform, detachMount = mount => execute('/usr/bin/hdiutil', ['detach', mount]),
  onWarning = message => console.warn(`UPDATE_CLEANUP_WARNING ${message}`) } = options;
  const root = await updatesDirectory(userDataDirectory);
  if (!root) return;
  if (!operationOwned) {
    try {
      await withUpdateOperation(userDataDirectory, () => cleanupUpdateRuns({ ...options, operationOwned: true }));
    } catch (error) { if (error.code !== 'UPDATE_BUSY') onWarning(error.message); }
    return;
  }
  const keep = new Set(keepRoots.map(file => path.resolve(file)));
  const keepNotices = new Set(keepNoticeRoots.map(file => path.resolve(file)));
  for (const run of await runs(root)) {
    try {
      if (keep.has(run.runRoot)) continue;
      if (await runActive(run.runRoot, run.record, alive)) {
        const started = await readJson(path.join(run.runRoot, 'started.json'));
        if (alive(started?.pid) || alive(run.record?.workerPid) || alive(run.record?.ownerPid) || platform !== 'darwin') continue;
        const mount = path.join(run.runRoot, 'mount');
        const info = await fs.lstat(mount);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        // A crashed owner's DMG can be detached normally; never force an in-use mount.
        await detachMount(mount);
        if (await runActive(run.runRoot, run.record, alive)) continue;
      }
      const completed = await readJson(path.join(run.runRoot, 'completed.json'));
      const notice = await readJson(path.join(run.runRoot, 'update-notice.json'));
      const failed = await readJson(path.join(run.runRoot, 'failed.json'));
      const installed = Boolean(currentVersion && (notice?.toVersion === currentVersion || completed?.version === currentVersion || isObsolete(run.version)));
      const recovery = await hasRecovery(run.runRoot);
      // A ready package is useful until installed, superseded, or another update is selected.
      const ready = ['ready', 'prepared'].includes(run.record?.phase) || (!run.record && !failed && !completed && !notice);
      if (ready && !beforeUpdate && !confirmedSuccess && !isObsolete(run.version)) continue;
      if (recovery && !confirmedSuccess && !installed) continue;
      if (recovery) await removeMacRecovery(run, { applicationRoot, processPaths, platform });
      const acknowledged = await fs.lstat(path.join(run.runRoot, 'acknowledged.json'))
        .catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (keepNotices.has(run.runRoot) && !acknowledged) {
        for (const entry of await fs.readdir(run.runRoot)) {
          if (entry === 'update-notice.json' || entry === RECORD || entry === 'acknowledged.json') continue;
          await fs.rm(path.join(run.runRoot, entry), { recursive: true, force: true });
        }
      } else await fs.rm(run.runRoot, { recursive: true, force: true });
    } catch (error) { onWarning(error.message); }
  }
  if (confirmedSuccess) {
    try { await cleanupOrphanMacApps(root, { applicationRoot, currentVersion, processPaths, platform }); }
    catch (error) { onWarning(error.message); }
  }
}

async function beginUpdateRun({ userDataDirectory, kind, version, assetName, digest,
  applicationRoot = '', currentVersion = '', hashFile }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ||
      !assetName || path.basename(assetName) !== assetName || /[\\/]/.test(assetName)) {
    throw new Error('更新包版本或文件名无效。');
  }
  const root = await updatesDirectory(userDataDirectory, true);
  const prefix = kind === 'mac' ? 'mac-' : kind === 'installed' ? 'installer-' : '';
  const suffix = kind === 'mac' ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const runRoot = path.join(root, `${prefix}${version}-${suffix}`);
  const archiveName = kind === 'portable' ? `package${path.extname(assetName).toLowerCase()}` : assetName;
  const archivePath = path.join(runRoot, archiveName);
  const candidates = await runs(root);
  await fs.mkdir(runRoot);
  await fs.writeFile(path.join(runRoot, RECORD), JSON.stringify({ schemaVersion: 1, kind, version,
    assetName, digest, archiveName, phase: 'preparing', ownerPid: process.pid }));
  let reused = false;
  let consumedRoot;
  try {
    for (const candidate of candidates.reverse()) {
      if (candidate.version !== version || await runActive(candidate.runRoot, candidate.record) ||
          await hasRecovery(candidate.runRoot)) continue;
      if (candidate.record && (candidate.record.kind !== kind || candidate.record.digest !== digest ||
          candidate.record.assetName !== assetName)) continue;
      const cachedArchive = path.join(candidate.runRoot, archiveName);
      try {
        const info = await fs.lstat(cachedArchive);
        if (!info.isFile() || info.isSymbolicLink() || await hashFile(cachedArchive) !== digest) continue;
        await fs.rename(cachedArchive, archivePath);
        reused = true;
        consumedRoot = candidate.runRoot;
        break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await cleanupUpdateRuns({ userDataDirectory, currentVersion, applicationRoot, beforeUpdate: true,
      operationOwned: true, keepRoots: [runRoot, ...candidates.filter(candidate => candidate.version === version &&
        candidate.runRoot !== consumedRoot).map(candidate => candidate.runRoot)] });
    return { runRoot, archivePath, reused };
  } catch (error) {
    await fs.rm(runRoot, { recursive: true, force: true }).catch(cleanup => console.warn(`UPDATE_CLEANUP_WARNING ${cleanup.message}`));
    throw error;
  }
}

async function finishUpdateRun(runRoot, { userDataDirectory, currentVersion, applicationRoot, record = {} }) {
  // Keep continuous ownership until the caller shows confirmation or starts
  // the worker. Only an explicit Later/cancel releases a verified package.
  await setUpdateRunState(runRoot, 'prepared', record);
  await cleanupUpdateRuns({ userDataDirectory, currentVersion, applicationRoot, beforeUpdate: true,
    operationOwned: true, keepRoots: [runRoot] });
}

async function discardUpdateRun(runRoot) {
  await setUpdateRunState(runRoot, 'failed', { workerPid: 0 }).catch(error => console.warn(`UPDATE_CLEANUP_WARNING ${error.message}`));
  await fs.rm(runRoot, { recursive: true, force: true }).catch(error => console.warn(`UPDATE_CLEANUP_WARNING ${error.message}`));
}

module.exports = { beginUpdateRun, cleanupUpdateRuns, discardUpdateRun, withUpdateOperation,
  finishUpdateRun, claimUpdateRun, setUpdateRunState, runActive, readJson, isAlive };
