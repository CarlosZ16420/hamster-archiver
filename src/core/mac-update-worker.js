'use strict';

// Copied outside the .app before replacement; use only Node built-ins.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function applyMacUpdate(control, dependencies = {}) {
  const executeImpl = dependencies.executeImpl || execute;
  const alive = dependencies.alive || (pid => {
    try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  });
  const runRoot = path.resolve(control.runRoot);
  const target = path.resolve(control.applicationBundle);
  const source = path.resolve(control.packageRoot);
  if (!target.endsWith('.app') || source !== path.join(runRoot, 'Hamster Archiver.app') ||
      !Number.isSafeInteger(control.targetPid) || control.targetPid <= 0 ||
      !/^\d+\.\d+\.\d+(?:-beta\.mac\.\d+)?$/.test(control.version || '')) throw new Error('Invalid Mac updater control.');
  const token = path.basename(runRoot);
  const staged = path.join(path.dirname(target), `.hamster-stage-${token}.app`);
  const backup = path.join(path.dirname(target), `.hamster-backup-${token}.app`);
  let moved = false, installed = false, launchAttempted = false;
  const write = (name, value) => fs.writeFile(path.join(runRoot, name), JSON.stringify(value));
  const launch = async () => {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^(?:HAMSTER_(?:UPDATE|SMOKE|STARTUP_INTEGRITY|USER_DATA_VALIDATION)|ELECTRON_RUN_AS_NODE)/.test(name)) delete environment[name];
    await executeImpl('/usr/bin/open', ['-n', target], { env: environment });
  };
  try {
    await write('started.json', { pid: process.pid });
    const deadline = Date.now() + (dependencies.exitTimeoutMs ?? 90_000);
    while (alive(control.targetPid) && Date.now() < deadline) await delay(250);
    if (alive(control.targetPid)) throw new Error('The application did not exit safely. No files were replaced.');
    const original = await fs.lstat(target);
    if (original.isSymbolicLink() || original.dev !== control.targetIdentity.dev || original.ino !== control.targetIdentity.ino) {
      throw new Error('The installed application changed after confirmation.');
    }
    for (const candidate of [staged, backup]) {
      try { await fs.lstat(candidate); throw new Error('Recovery path already exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await executeImpl('/usr/bin/ditto', [source, staged]);
    const metadata = JSON.parse(await fs.readFile(path.join(staged, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
    if (metadata.version !== control.version) throw new Error('The staged Mac application version changed.');
    await executeImpl('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]);
    // Validate startup using a fresh profile, before allowing the selected
    // version to open the real Warehouse (especially when downgrading).
    const profile = path.join(runRoot, 'validation-profile');
    await fs.mkdir(profile);
    const environment = { ...process.env, HAMSTER_STARTUP_INTEGRITY_TEST: '1', HAMSTER_SMOKE_USER_DATA_DIR: profile };
    for (const name of Object.keys(environment)) {
      if (/^(?:HAMSTER_(?:UPDATE|USER_DATA_VALIDATION|SMOKE_TEST|MCP_ENABLED)|ELECTRON_RUN_AS_NODE)/.test(name)) delete environment[name];
    }
    const verification = await executeImpl(path.join(staged, 'Contents', 'MacOS', 'Hamster Archiver'), [], {
      timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: environment
    });
    if (!String(verification.stdout).includes('HAMSTER_STARTUP_INTEGRITY_TEST_OK')) throw new Error('The selected Mac app did not pass isolated startup validation.');
    const processes = await executeImpl('/bin/ps', ['-axo', 'pid=,comm=']);
    for (const line of String(processes.stdout).split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (match && Number(match[1]) !== process.pid && match[2].startsWith(path.join(target, 'Contents', 'MacOS') + path.sep)) {
        throw new Error('The application was reopened during update validation. Close it before trying again.');
      }
    }
    const unchanged = await fs.lstat(target);
    if (unchanged.dev !== control.targetIdentity.dev || unchanged.ino !== control.targetIdentity.ino) throw new Error('The installed application changed during update validation.');
    await fs.rename(target, backup);
    moved = true;
    await fs.rename(staged, target);
    installed = true;
    launchAttempted = true;
    await launch();
    await write('completed.json', { version: control.version, backup, completedAt: new Date().toISOString() });
  } catch (error) {
    // Once Launch Services was asked to open the app, it may be running even
    // if the command fails. Preserve both bundles for manual recovery.
    if (!launchAttempted) {
      if (installed) await fs.rename(target, staged);
      if (moved) await fs.rename(backup, target);
    }
    await write('failed.json', { version: control.version, error: error.message, backup, failedAt: new Date().toISOString() });
    // Never kill a user process. Recovery only replaces the app after its
    // original process exited; startup validation uses no user data.
    if (!launchAttempted && !alive(control.targetPid)) await launch().catch(() => {});
    throw error;
  }
}

if (require.main === module) fs.readFile(process.argv[2], 'utf8').then(JSON.parse).then(applyMacUpdate)
  .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { applyMacUpdate };
