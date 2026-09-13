'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { checkForUpdates: defaultCheckForUpdates } = require('./update-checker');
const {
  prepareUpdate: defaultPrepareUpdate,
  prepareLocalUpdate: defaultPrepareLocalUpdate,
  prepareInstalledUpdate: defaultPrepareInstalledUpdate,
  prepareLocalInstalledUpdate: defaultPrepareLocalInstalledUpdate,
  launchUpdate: defaultLaunchUpdate,
  launchInstalledUpdate: defaultLaunchInstalledUpdate
} = require('./update-manager');
const { resolveApplicationPath } = require('./paths');

const UI_SECTIONS = new Set(['workbench', 'catalog', 'settings']);
const UI_THEMES = new Set(['classic', 'day', 'night', 'forest', 'twilight']);
const MIGRATION_SKIPPED_ROOT_ENTRIES = new Set(['electron', 'updates', 'mcp']);
const MIGRATION_WORKER_START_TIMEOUT_MS = 8_000;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizePath(value, label) {
  const text = String(value || '').trim();
  if (!text || text.includes('\0') || !path.isAbsolute(text)) {
    throw codedError('INVALID_PATH', `${label}必须是绝对本地路径。`);
  }
  return path.resolve(text);
}

function comparisonPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function pathsOverlap(left, right) {
  const a = comparisonPath(left);
  const b = comparisonPath(right);
  if (a === b) return true;
  const relativeAB = path.relative(a, b);
  const relativeBA = path.relative(b, a);
  const inside = (relative) => Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  return inside(relativeAB) || inside(relativeBA);
}

async function pathExists(targetPath, fsImpl = fsp) {
  try {
    await fsImpl.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoLinkedAncestor(targetPath, fsImpl = fsp) {
  let current = path.dirname(targetPath);
  while (current && current !== path.dirname(current)) {
    try {
      const stats = await fsImpl.lstat(current);
      if (stats.isSymbolicLink()) {
        throw codedError('LINKED_TARGET_PARENT', '用户数据目标目录不能位于符号链接或目录联接之下。');
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      current = path.dirname(current);
    }
  }
}

async function inspectUserDataState(root, { fsImpl = fsp } = {}) {
  const resolvedRoot = normalizePath(root, '当前用户数据目录');
  const hash = crypto.createHash('sha256');
  const impact = { files: 0, directories: 0, bytes: 0 };

  async function visit(absolutePath, relativePath) {
    const stats = await fsImpl.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw codedError('USER_DATA_LINK_UNSUPPORTED', `用户数据区包含不支持迁移的链接：${relativePath || '.'}`);
    }
    const normalizedRelative = String(relativePath || '').replace(/\\/g, '/');
    if (stats.isDirectory()) {
      impact.directories += 1;
      hash.update(`d\0${normalizedRelative}\0${Math.trunc(stats.mtimeMs)}\0`);
      const entries = (await fsImpl.readdir(absolutePath, { withFileTypes: true }))
        .filter((entry) => relativePath || !MIGRATION_SKIPPED_ROOT_ENTRIES.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name, 'en'));
      for (const entry of entries) {
        const childRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;
        await visit(path.join(absolutePath, entry.name), childRelative);
      }
      return;
    }
    if (!stats.isFile()) {
      throw codedError('USER_DATA_ENTRY_UNSUPPORTED', `用户数据区包含不支持迁移的特殊文件：${normalizedRelative}`);
    }
    impact.files += 1;
    impact.bytes += stats.size;
    hash.update(`f\0${normalizedRelative}\0${stats.size}\0${Math.trunc(stats.mtimeMs)}\0`);
  }

  await visit(resolvedRoot, '');
  return { root: resolvedRoot, impact, treeFingerprint: hash.digest('hex') };
}

function stateFingerprint(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function publicUpdateResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    updateAvailable: Boolean(result.updateAvailable),
    installable: Boolean(result.installable),
    distributionMode: result.distributionMode,
    provider: result.provider,
    source: result.source,
    releaseUrl: result.releaseUrl,
    releaseNotes: result.releaseNotes,
    releases: result.releases,
    historyIncomplete: Boolean(result.historyIncomplete)
  };
}

async function waitForFile(targetPath, {
  timeoutMs = MIGRATION_WORKER_START_TIMEOUT_MS,
  intervalMs = 50,
  fsImpl = fsp,
  delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pathExists(targetPath, fsImpl)) return true;
    await delayImpl(intervalMs);
  }
  return false;
}

async function readOptionalFile(filePath, fsImpl = fsp) {
  try {
    return { exists: true, contentBase64: (await fsImpl.readFile(filePath)).toString('base64') };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, contentBase64: '' };
    throw error;
  }
}

function createMcpApplicationServices(context = {}) {
  const {
    app,
    net,
    queueManager,
    appStore,
    applicationRoot,
    activeUserDataLocationPath,
    isInstalledDistribution = false,
    getMainWindow = () => null,
    showUi,
    copyText,
    openPath,
    requestQuitForRestart,
    checkForUpdates = defaultCheckForUpdates,
    prepareUpdate = defaultPrepareUpdate,
    prepareLocalUpdate = defaultPrepareLocalUpdate,
    prepareInstalledUpdate = defaultPrepareInstalledUpdate,
    prepareLocalInstalledUpdate = defaultPrepareLocalInstalledUpdate,
    launchUpdate = defaultLaunchUpdate,
    launchInstalledUpdate = defaultLaunchInstalledUpdate,
    spawnImpl = spawn,
    fsImpl = fsp,
    processId = process.pid,
    processExecutable = process.execPath,
    platform = process.platform,
    temporaryDirectory = os.tmpdir(),
    workerScriptPath = path.join(__dirname, 'mcp-user-data-migration-worker.js'),
    onUpdateProgress
  } = context;

  if (!app || !queueManager || !appStore) throw new Error('MCP application services require app, queueManager and appStore.');
  if (typeof showUi !== 'function' || typeof copyText !== 'function' || typeof openPath !== 'function' ||
      typeof requestQuitForRestart !== 'function') {
    throw new Error('MCP application services require controlled UI, clipboard, path opening and restart hooks.');
  }

  const resolvedApplicationRoot = path.resolve(applicationRoot);
  const resolvedLocationPath = path.resolve(activeUserDataLocationPath);
  let checkedUpdate = null;
  let updateInstallInFlight = false;
  let migrationInFlight = false;
  const migrationPreflights = new Map();

  const progress = (value) => {
    if (typeof onUpdateProgress === 'function') return onUpdateProgress(value);
    const window = getMainWindow();
    if (window && !window.isDestroyed?.()) window.webContents?.send?.('update:progress', value);
  };

  const ensureQueueIdle = (operation) => {
    if (queueManager.running) throw codedError('QUEUE_RUNNING', `归档任务运行期间不能${operation}。请先暂停或完成当前任务。`);
  };

  async function buildMigrationPreflight(targetDirectory) {
    ensureQueueIdle('迁移用户数据');
    const currentDirectory = normalizePath(queueManager.config?.userDataDirectory, '当前用户数据目录');
    const targetDirectoryResolved = normalizePath(targetDirectory, '目标目录');
    if (path.parse(targetDirectoryResolved).root === targetDirectoryResolved) {
      throw codedError('TARGET_IS_VOLUME_ROOT', '不能把磁盘根目录设为用户数据区。');
    }
    if (pathsOverlap(currentDirectory, targetDirectoryResolved)) {
      throw codedError('SOURCE_TARGET_OVERLAP', '新旧用户数据区不能相同或互相包含。');
    }
    if (pathsOverlap(resolvedApplicationRoot, targetDirectoryResolved)) {
      throw codedError('APPLICATION_TARGET_OVERLAP', '用户数据目标目录不能位于程序目录内，也不能包含程序目录。');
    }
    const repositoryDirectory = queueManager.config?.repositoryDirectory
      ? normalizePath(queueManager.config.repositoryDirectory, '仓库目录')
      : null;
    if (repositoryDirectory && pathsOverlap(repositoryDirectory, targetDirectoryResolved)) {
      throw codedError('WAREHOUSE_TARGET_OVERLAP', '用户数据目标目录不能与当前仓库目录互相包含。');
    }
    if (await pathExists(targetDirectoryResolved, fsImpl)) {
      throw codedError('TARGET_ALREADY_EXISTS', '用户数据迁移只接受尚不存在的目标目录，不能覆盖或合并已有目录。');
    }
    await assertNoLinkedAncestor(targetDirectoryResolved, fsImpl);
    const source = await inspectUserDataState(currentDirectory, { fsImpl });
    const fingerprintPayload = {
      sourceDirectory: comparisonPath(currentDirectory),
      targetDirectory: comparisonPath(targetDirectoryResolved),
      treeFingerprint: source.treeFingerprint,
      repositoryDirectory: repositoryDirectory ? comparisonPath(repositoryDirectory) : '',
      currentVersion: String(app.getVersion()),
      distributionMode: isInstalledDistribution ? 'installed' : 'portable'
    };
    const fingerprint = stateFingerprint(fingerprintPayload);
    const sameVolume = comparisonPath(path.parse(currentDirectory).root) === comparisonPath(path.parse(targetDirectoryResolved).root);
    return {
      currentDirectory,
      targetDirectory: targetDirectoryResolved,
      impact: {
        ...source.impact,
        warehouseRecords: Array.isArray(queueManager.catalog) ? queueManager.catalog.length : 0,
        mode: 'copy-and-switch',
        sameVolume
      },
      recovery: {
        sourceRetained: true,
        targetNeverMerged: true,
        description: '原用户数据目录会保留；启动验证失败时恢复原位置指针，目标目录及迁移记录保留供核对。'
      },
      stateFingerprint: fingerprint,
      requiresAppExit: true,
      sourceTreeFingerprint: source.treeFingerprint
    };
  }

  async function scheduleMigration(preflight) {
    await appStore.saveSettings(queueManager.config);
    await appStore.checkpoint(queueManager.config.repositoryDirectory);
    appStore.closeAll();
    const finalSource = await inspectUserDataState(preflight.currentDirectory, { fsImpl });
    if (await pathExists(preflight.targetDirectory, fsImpl)) {
      throw codedError('TARGET_ALREADY_EXISTS', '目标目录在迁移开始前已经出现；未退出应用，也未复制数据。');
    }

    const runRoot = await fsImpl.mkdtemp(path.join(path.resolve(temporaryDirectory), 'hamster-user-data-migration-'));
    const planPath = path.join(runRoot, 'plan.json');
    const startedFile = path.join(runRoot, 'started.json');
    const cancelledFile = path.join(runRoot, 'cancelled.json');
    const validationFile = path.join(runRoot, 'validation.json');
    const originalLocation = await readOptionalFile(resolvedLocationPath, fsImpl);
    const plan = {
      schemaVersion: 1,
      migrationId: crypto.randomUUID(),
      sourceDirectory: preflight.currentDirectory,
      targetDirectory: preflight.targetDirectory,
      locationFilePath: resolvedLocationPath,
      applicationExecutable: path.resolve(processExecutable),
      applicationRoot: resolvedApplicationRoot,
      targetPid: processId,
      currentVersion: String(app.getVersion()),
      expectedSourceTreeFingerprint: finalSource.treeFingerprint,
      originalLocation,
      runRoot,
      startedFile,
      cancelledFile,
      validationFile,
      createdAt: new Date().toISOString()
    };
    await fsImpl.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    let child;
    try {
      child = spawnImpl(processExecutable, [workerScriptPath], {
        cwd: resolvedApplicationRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HAMSTER_USER_DATA_MIGRATION_PLAN: planPath }
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      if (!await waitForFile(startedFile, { fsImpl })) {
        throw codedError('MIGRATION_WORKER_START_TIMEOUT', '用户数据迁移助手没有确认启动。');
      }
    } catch (error) {
      try { if (child?.exitCode === null) child.kill(); } catch {}
      throw codedError('MIGRATION_WORKER_START_FAILED', `用户数据迁移助手未能启动：${error.message}`);
    }
    child.unref?.();

    try {
      await requestQuitForRestart();
    } catch (error) {
      await fsImpl.writeFile(cancelledFile, `${JSON.stringify({ cancelledAt: new Date().toISOString(), reason: error.message })}\n`, 'utf8').catch(() => {});
      throw error;
    }
    return {
      scheduled: true,
      completed: false,
      restarting: true,
      currentDirectory: preflight.currentDirectory,
      targetDirectory: preflight.targetDirectory,
      runRoot,
      recovery: preflight.recovery
    };
  }

  return {
    app: {
      async showUi({ section } = {}) {
        if (section !== undefined && !UI_SECTIONS.has(section)) throw codedError('INVALID_SECTION', '界面区域无效。');
        return showUi(section ? { section } : {});
      },
      async setView({ section } = {}) {
        if (!UI_SECTIONS.has(section)) throw codedError('INVALID_SECTION', '界面区域无效。');
        return showUi({ section });
      },
      async setTheme({ theme } = {}) {
        if (!UI_THEMES.has(theme)) throw codedError('INVALID_THEME', '主题无效。');
        return showUi({ theme });
      },
      async copyText({ text } = {}) {
        if (typeof text !== 'string' || text.length > 10_000) throw codedError('INVALID_TEXT', '复制内容必须是不超过 10000 字符的文本。');
        await copyText(text);
        return { copied: true, characters: text.length };
      }
    },
    updates: {
      async check({ mode } = {}) {
        if (!['manual', 'automatic'].includes(mode)) throw codedError('INVALID_UPDATE_MODE', '更新检查模式无效。');
        const result = await checkForUpdates({
          currentVersion: app.getVersion(),
          distributionMode: isInstalledDistribution ? 'installed' : 'portable',
          includeHistory: mode === 'manual',
          fetchImpl: net?.fetch,
          timeoutMs: mode === 'automatic' ? 6_000 : 8_000
        });
        if (mode === 'manual') checkedUpdate = structuredClone(result);
        return publicUpdateResult(result);
      },
      async install({ version } = {}) {
        if (updateInstallInFlight) throw codedError('UPDATE_BUSY', '另一项更新操作正在进行。');
        if (!app.isPackaged) throw codedError('PACKAGED_APP_REQUIRED', '只有打包后的 Windows 应用可以执行自动更新。');
        ensureQueueIdle('更新');
        const requestedVersion = String(version || '').trim();
        const release = checkedUpdate;
        if (!release?.updateAvailable || !release.installable || release.latestVersion !== requestedVersion ||
            release.currentVersion !== app.getVersion()) {
          throw codedError('UPDATE_CHECK_REQUIRED', '请重新手动检查更新后再安装。');
        }
        updateInstallInFlight = true;
        try {
          const prepared = await (isInstalledDistribution ? prepareInstalledUpdate : prepareUpdate)({
            applicationRoot: resolvedApplicationRoot,
            userDataDirectory: queueManager.config.userDataDirectory,
            sevenZipPath: resolveApplicationPath(resolvedApplicationRoot, queueManager.config.sevenZipPath),
            currentVersion: release.currentVersion,
            release,
            fetchImpl: net?.fetch,
            onProgress: progress
          });
          const launched = isInstalledDistribution
            ? await launchInstalledUpdate({ prepared })
            : await launchUpdate({ prepared, targetPid: processId });
          await requestQuitForRestart();
          return { ...publicUpdateResult(release), version: requestedVersion, restarting: true, ...launched };
        } finally {
          updateInstallInFlight = false;
        }
      },
      async installPackage({ packagePath } = {}) {
        if (updateInstallInFlight) throw codedError('UPDATE_BUSY', '另一项更新操作正在进行。');
        if (!app.isPackaged) throw codedError('PACKAGED_APP_REQUIRED', '只有打包后的 Windows 应用可以从本地发行包更新。');
        ensureQueueIdle('更新');
        const resolvedPackagePath = normalizePath(packagePath, '更新包');
        if (isInstalledDistribution) {
          if (!/^HamsterArchiver-Setup-v\d+\.\d+\.\d+-win-x64\.exe$/i.test(path.basename(resolvedPackagePath))) {
            throw codedError('INVALID_UPDATE_PACKAGE', '安装版只接受严格命名的 Hamster Archiver Setup EXE。');
          }
        } else if (!/\.zip$/i.test(resolvedPackagePath)) {
          throw codedError('INVALID_UPDATE_PACKAGE', '便携版只接受 Hamster Archiver 发行 ZIP。');
        }
        updateInstallInFlight = true;
        try {
          const prepared = await (isInstalledDistribution ? prepareLocalInstalledUpdate : prepareLocalUpdate)({
            applicationRoot: resolvedApplicationRoot,
            userDataDirectory: queueManager.config.userDataDirectory,
            sevenZipPath: resolveApplicationPath(resolvedApplicationRoot, queueManager.config.sevenZipPath),
            currentVersion: app.getVersion(),
            packagePath: resolvedPackagePath,
            release: checkedUpdate,
            onProgress: progress
          });
          const launched = isInstalledDistribution
            ? await launchInstalledUpdate({ prepared })
            : await launchUpdate({ prepared, targetPid: processId });
          await requestQuitForRestart();
          return { currentVersion: app.getVersion(), version: prepared.version, source: 'package', restarting: true, ...launched };
        } finally {
          updateInstallInFlight = false;
        }
      }
    },
    userData: {
      async preflightMove({ targetDirectory } = {}) {
        const result = await buildMigrationPreflight(targetDirectory);
        migrationPreflights.set(comparisonPath(result.targetDirectory), result);
        return { ...result };
      },
      async move({ targetDirectory, expectedStateFingerprint } = {}) {
        if (migrationInFlight) throw codedError('MIGRATION_BUSY', '用户数据迁移已经在进行。');
        const resolvedTarget = normalizePath(targetDirectory, '目标目录');
        const cached = migrationPreflights.get(comparisonPath(resolvedTarget));
        if (!cached || typeof expectedStateFingerprint !== 'string' || cached.stateFingerprint !== expectedStateFingerprint) {
          throw codedError('MIGRATION_PREFLIGHT_REQUIRED', '迁移预检不存在或状态指纹不匹配，请重新预检。');
        }
        migrationInFlight = true;
        try {
          const current = await buildMigrationPreflight(resolvedTarget);
          if (current.stateFingerprint !== expectedStateFingerprint) {
            throw codedError('STALE_MIGRATION_STATE', '用户数据或目标状态已变化，请重新预检后再迁移。');
          }
          return await scheduleMigration(current);
        } finally {
          migrationInFlight = false;
        }
      }
    },
    paths: {
      async open({ kind, id } = {}) {
        if (!['warehouse', 'source', 'catalog_source', 'similarity_terms'].includes(kind)) {
          throw codedError('INVALID_PATH_KIND', '只能打开受控的应用路径类型。');
        }
        let targetPath;
        if (kind === 'warehouse') targetPath = queueManager.config.repositoryDirectory;
        if (kind === 'source') {
          const job = queueManager.jobs.find((candidate) => candidate.id === id);
          if (!job?.sourcePath) throw codedError('JOB_NOT_FOUND', '没有找到带可用源位置的任务。');
          targetPath = job.sourcePath;
        }
        if (kind === 'catalog_source') {
          const record = queueManager.catalog.find((candidate) => candidate.id === id);
          if (!record) throw codedError('PROJECT_NOT_FOUND', '没有找到指定仓库记录。');
          if (record.sourceDisposition === 'trashed') {
            throw codedError('SOURCE_IN_TRASH', '该记录的源文件位于回收站；请先使用恢复操作。');
          }
          targetPath = record.sourceDisposition === 'moved'
            ? record.movedTo
            : (record.originalSourcePath || record.sourcePath);
          if (!targetPath) throw codedError('SOURCE_PATH_UNAVAILABLE', '该仓库记录没有可打开的源位置。');
        }
        if (kind === 'similarity_terms') targetPath = await queueManager.ensureSimilarityIgnoreTermsFile();
        const openedPath = await openPath(path.resolve(targetPath), { kind, id });
        return { opened: true, kind, ...(id ? { id } : {}), path: openedPath || path.resolve(targetPath) };
      }
    }
  };
}

module.exports = {
  MIGRATION_SKIPPED_ROOT_ENTRIES,
  MIGRATION_WORKER_START_TIMEOUT_MS,
  UI_SECTIONS,
  UI_THEMES,
  comparisonPath,
  createMcpApplicationServices,
  inspectUserDataState,
  pathExists,
  pathsOverlap,
  stateFingerprint,
  waitForFile
};
