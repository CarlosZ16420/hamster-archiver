'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { inspectUserDataState, pathExists } = require('./mcp-application-services');
const { prepareUserDataTarget } = require('./storage-migration');
const { writeJsonAtomic } = require('./store');

const PROCESS_EXIT_TIMEOUT_MS = 90_000;
const STARTUP_VALIDATION_TIMEOUT_MS = 45_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForProcessExit(pid, {
  timeoutMs = PROCESS_EXIT_TIMEOUT_MS,
  delayImpl = delay,
  isRunning = (targetPid) => {
    try { process.kill(targetPid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  },
  cancelled = async () => false
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cancelled()) throw new Error('迁移已取消，因为主程序未能正常退出。');
    if (!isRunning(pid)) return;
    await delayImpl(100);
  }
  throw new Error('主程序在 90 秒内没有完全退出，用户数据未迁移。');
}

async function waitForValidation(child, validationFile, expectedVersion, {
  fsImpl = fs,
  timeoutMs = STARTUP_VALIDATION_TIMEOUT_MS,
  delayImpl = delay
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(validationFile, fsImpl)) {
      const validation = JSON.parse(await fsImpl.readFile(validationFile, 'utf8'));
      if (String(validation.version || '') !== String(expectedVersion || '')) {
        throw new Error(`启动验证版本不一致：期望 ${expectedVersion}，实际 ${validation.version || 'unknown'}。`);
      }
      return validation;
    }
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`迁移后应用在启动验证前退出（代码 ${child.exitCode}）。`);
    }
    await delayImpl(100);
  }
  throw new Error('迁移后应用未在 45 秒内完成启动验证。');
}

async function restoreLocationPointer(plan, fsImpl = fs) {
  if (plan.originalLocation?.exists) {
    const temporaryPath = `${plan.locationFilePath}.${process.pid}.restore.tmp`;
    await fsImpl.mkdir(path.dirname(plan.locationFilePath), { recursive: true });
    await fsImpl.writeFile(temporaryPath, Buffer.from(plan.originalLocation.contentBase64 || '', 'base64'));
    await fsImpl.rename(temporaryPath, plan.locationFilePath);
  } else {
    await fsImpl.rm(plan.locationFilePath, { force: true });
  }
}

async function launchApplication(plan, { spawnImpl = spawn } = {}) {
  const child = spawnImpl(plan.applicationExecutable, [], {
    cwd: plan.applicationRoot,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      HAMSTER_UPDATE_VALIDATION_FILE: plan.validationFile
    }
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  return child;
}

async function runUserDataMigration(plan, dependencies = {}) {
  const fsImpl = dependencies.fsImpl || fs;
  const inspectState = dependencies.inspectUserDataState || inspectUserDataState;
  const prepareTarget = dependencies.prepareUserDataTarget || prepareUserDataTarget;
  const writePointer = dependencies.writeJsonAtomic || writeJsonAtomic;
  const waitExit = dependencies.waitForProcessExit || waitForProcessExit;
  const launchApp = dependencies.launchApplication || launchApplication;
  const validateStartup = dependencies.waitForValidation || waitForValidation;
  let pointerUpdated = false;
  let launchedChild = null;

  await fsImpl.mkdir(plan.runRoot, { recursive: true });
  await fsImpl.writeFile(plan.startedFile, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8');
  try {
    await waitExit(plan.targetPid, {
      cancelled: () => pathExists(plan.cancelledFile, fsImpl)
    });
    if (await pathExists(plan.targetDirectory, fsImpl)) {
      throw new Error('目标目录在应用退出前已经出现，已停止迁移以避免覆盖或合并。');
    }
    const current = await inspectState(plan.sourceDirectory, { fsImpl });
    if (current.treeFingerprint !== plan.expectedSourceTreeFingerprint) {
      throw new Error('应用退出后的用户数据状态与调度时不一致，已停止迁移。');
    }

    const prepared = await prepareTarget(plan.sourceDirectory, plan.targetDirectory);
    if (prepared.mode !== 'copied') throw new Error(`迁移目标状态无效：${prepared.mode}。`);
    const manifestDirectory = path.join(plan.targetDirectory, 'config');
    const manifestPath = path.join(manifestDirectory, `user-data-migration-${plan.migrationId}.json`);
    const manifest = {
      schemaVersion: 1,
      migrationId: plan.migrationId,
      sourceDirectory: plan.sourceDirectory,
      targetDirectory: plan.targetDirectory,
      sourceRetained: true,
      mode: prepared.mode,
      sourceTreeFingerprint: current.treeFingerprint,
      copiedAt: new Date().toISOString(),
      recovery: '若启动验证失败，位置指针会恢复到原目录；源目录和目标目录均保留供人工核对。'
    };
    await fsImpl.mkdir(manifestDirectory, { recursive: true });
    await writePointer(manifestPath, manifest);
    await writePointer(plan.locationFilePath, {
      version: 1,
      userDataDirectory: prepared.target,
      savedAt: new Date().toISOString(),
      migrationId: plan.migrationId
    });
    pointerUpdated = true;

    launchedChild = await launchApp(plan);
    const validation = await validateStartup(launchedChild, plan.validationFile, plan.currentVersion, { fsImpl });
    await writePointer(path.join(plan.runRoot, 'completed.json'), {
      migrationId: plan.migrationId,
      targetDirectory: prepared.target,
      validatedAt: validation.validatedAt || new Date().toISOString(),
      version: validation.version
    });
    launchedChild.unref?.();
    return { completed: true, targetDirectory: prepared.target, manifestPath };
  } catch (error) {
    let pointerRecoveryError = null;
    if (pointerUpdated) {
      try { await restoreLocationPointer(plan, fsImpl); } catch (recoveryError) { pointerRecoveryError = recoveryError; }
    }
    const failure = {
      migrationId: plan.migrationId,
      error: error.message,
      failedAt: new Date().toISOString(),
      sourceDirectory: plan.sourceDirectory,
      targetDirectory: plan.targetDirectory,
      sourceRetained: true,
      targetRetained: await pathExists(plan.targetDirectory, fsImpl),
      pointerRestored: pointerUpdated ? !pointerRecoveryError : true,
      pointerRecoveryError: pointerRecoveryError?.message || '',
      recovery: '保留源目录和目标目录；先核对 failed.json 与目标 config 下的迁移清单，再决定重试或手动切换。'
    };
    await writePointer(path.join(plan.runRoot, 'failed.json'), failure).catch(() => {});
    if (failure.targetRetained) {
      await fsImpl.mkdir(path.join(plan.targetDirectory, 'config'), { recursive: true }).catch(() => {});
      await writePointer(path.join(plan.targetDirectory, 'config', `user-data-migration-failed-${plan.migrationId}.json`), failure).catch(() => {});
    }
    if (!launchedChild || launchedChild.exitCode !== null) {
      await launchApp({ ...plan, validationFile: '' }).then((child) => child.unref?.()).catch(() => {});
    }
    const wrapped = new Error(pointerRecoveryError
      ? `${error.message}；位置指针恢复失败：${pointerRecoveryError.message}`
      : error.message);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function readPlan(planPath, fsImpl = fs) {
  const plan = JSON.parse(await fsImpl.readFile(planPath, 'utf8'));
  const requiredPaths = [
    'sourceDirectory', 'targetDirectory', 'locationFilePath', 'applicationExecutable',
    'applicationRoot', 'runRoot', 'startedFile', 'cancelledFile', 'validationFile'
  ];
  if (plan.schemaVersion !== 1 || !Number.isSafeInteger(plan.targetPid) || plan.targetPid <= 0 ||
      requiredPaths.some((key) => !path.isAbsolute(String(plan[key] || '')))) {
    throw new Error('用户数据迁移计划无效。');
  }
  return plan;
}

if (require.main === module) {
  const planPath = process.env.HAMSTER_USER_DATA_MIGRATION_PLAN;
  readPlan(planPath)
    .then((plan) => runUserDataMigration(plan))
    .catch(async (error) => {
      try {
        const runRoot = planPath ? path.dirname(planPath) : process.cwd();
        await writeJsonAtomic(path.join(runRoot, 'worker-failed.json'), {
          error: error.message,
          failedAt: new Date().toISOString()
        });
      } catch {}
      process.exitCode = 1;
    });
}

module.exports = {
  PROCESS_EXIT_TIMEOUT_MS,
  STARTUP_VALIDATION_TIMEOUT_MS,
  launchApplication,
  readPlan,
  restoreLocationPointer,
  runUserDataMigration,
  waitForProcessExit,
  waitForValidation
};
