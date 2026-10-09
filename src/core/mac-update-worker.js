'use strict';

// Copied outside the .app before replacement; use only Node built-ins.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { readJson } = require('./update-storage');
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
  const message = (zh, en) => control.language === 'en-US' ? en : zh;
  const staged = path.join(path.dirname(target), `.hamster-stage-${token}.app`);
  const backup = path.join(path.dirname(target), `.hamster-backup-${token}.app`);
  let moved = false, installed = false, launchAttempted = false;
  const write = (name, value) => fs.writeFile(path.join(runRoot, name), JSON.stringify(value));
  const validationFile = path.join(runRoot, 'validation.json');
  const launch = async (validate = false) => {
    const environment = { ...process.env };
    for (const name of Object.keys(environment)) if (/^(?:HAMSTER_(?:UPDATE|SMOKE|STARTUP_INTEGRITY|USER_DATA_VALIDATION)|ELECTRON_RUN_AS_NODE)/.test(name)) delete environment[name];
    if (!validate) {
      await executeImpl('/usr/bin/open', ['-n', target], { env: environment });
      return;
    }
    environment.HAMSTER_UPDATE_VALIDATION_FILE = validationFile;
    environment.HAMSTER_UPDATE_NOTICE_FILE = path.join(runRoot, 'update-notice.json');
    const executable = path.join(target, 'Contents', 'MacOS', 'Hamster Archiver');
    let launchedPid;
    if (dependencies.launchImpl) launchedPid = await dependencies.launchImpl(executable, environment);
    else {
      // Start the exact replacement executable, without Launch Services choosing
      // another registered copy with the same bundle identity.
      const child = spawn(executable, [], { detached: true, stdio: 'ignore', env: environment, cwd: path.dirname(target) });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      launchedPid = child.pid;
      child.unref();
    }
    const deadline = Date.now() + (dependencies.validationTimeoutMs ?? 45_000);
    while (Date.now() < deadline) {
      const validation = await readJson(validationFile);
      if (validation) {
        let correctPath = validation.applicationBundle === target;
        // Older Betas report only their version. Check the exact child process
        // rather than requiring a field they cannot provide during rollback.
        if (!validation.applicationBundle && Number.isSafeInteger(launchedPid) && launchedPid > 0) {
          const processInfo = await executeImpl('/bin/ps', ['-p', String(launchedPid), '-o', 'comm=']);
          correctPath = String(processInfo.stdout).trim() === executable;
        }
        if (validation.version !== control.version || !correctPath) {
          throw new Error(message('Mac 新版本启动后报告的版本或应用位置不一致，已保留恢复文件。',
            'The installed Mac app reported a different version or application path. Recovery files were preserved.'));
        }
        return;
      }
      await delay(100);
    }
    throw new Error(message('Mac 新版本未确认启动完成，已保留恢复文件。',
      'The installed Mac app did not confirm startup. Recovery files were preserved.'));
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
    await fs.unlink(validationFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await launch(true);
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
