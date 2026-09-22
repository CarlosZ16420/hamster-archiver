'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, shell, Tray } = require('electron');
const { AppStore, writeJsonAtomic } = require('./core/store');
const { QueueManager } = require('./core/queue-manager');
const {
  makeArchiveStagingDirectory,
  makeDefaultConfig,
  normalizeForComparison,
  normalizePortableProgramPath,
  PORTABLE_FFMPEG_PATH,
  PORTABLE_SEVEN_ZIP_PATH,
  rebasePortableUserDataPaths,
  resolveApplicationPath
} = require('./core/paths');
const {
  makeUserDataLayout,
  resolveUserDataRoot,
  resolveUserDataRootFromLocationFile,
  userDataLocationPath
} = require('./core/storage-paths');
const { prepareUserDataTarget } = require('./core/storage-migration');
const { IMAGE_EXTENSIONS, LARGE_TASK_BYTES, isVideoFile } = require('./core/constants');
const { createThumbnails: generateThumbnails } = require('./core/thumbnail-service');
const { checkForUpdates } = require('./core/update-checker');
const {
  prepareUpdate,
  prepareLocalUpdate,
  prepareInstalledUpdate,
  prepareLocalInstalledUpdate,
  launchUpdate,
  launchInstalledUpdate,
  cleanupSuccessfulUpdateRuns,
  consumeUpdateFailure,
  readUpdateSuccessNotice,
  manualUpdateInstructions
} = require('./core/update-manager');
const { formatReleaseNotes } = require('./core/release-notes');
const { findTrashItems, isTrashItemPresent, restoreTrashItem } = require('./core/recycle-bin');
const { verifyReleaseManifestAtStartup } = require('./core/startup-integrity');
const { resolveDevelopmentUserDataRoot } = require('./core/development-paths');
const { isValidMcpDiagnosticFile, isValidMcpReadyFile, takeDesktopLaunchRequest } = require('./core/mcp-launch');
const rendererI18n = require('./renderer/i18n');

// Let Windows choose the nearest native-size frame from the multi-resolution
// ICO. Passing the 1024px PNG here makes the title-bar icon downsample at
// runtime and produces a visibly soft 16px glyph.
const appIconPath = path.join(__dirname, '..', 'assets', 'app-icon.ico');
const releasesUrl = 'https://github.com/CarlosZ16420/hamster-archiver/releases';
const packageMetadata = require('../package.json');
const distributionMode = packageMetadata.distributionMode === 'installed' ? 'installed' : 'portable';
const isInstalledDistribution = app.isPackaged && distributionMode === 'installed';

let mainWindow;
let startupWindow;
let queueManager;
let appStore;
let allowWindowClose = false;
let closePromptOpen = false;
let shutdownInProgress = false;
let shutdownLogInProgress = false;
let shutdownLogComplete = false;
let scheduleTimer = null;
let mcpServer = null;
let mcpServerStarting = null;
let mcpApplicationServices = null;
let integrationManager = null;
let startedAsMcpBackground = false;
let mcpUiWasShown = false;
let exitAfterMcpIdle = false;
let mcpIdleTimer = null;
let mcpEverConnected = false;
let mcpTray = null;
let mcpExitWhenIdleRequested = false;
let mcpShutdownInProgress = false;
let mcpShutdownComplete = false;
let applicationReady = false;
let pendingWindowShow = false;
let startupUsesEnglish = false;
// Include Electron bootstrap and top-level module loading in startup diagnostics.
const startupStartedAt = Date.now() - (process.uptime() * 1000);
let resolveApplicationInitialized;
const applicationInitialized = new Promise((resolve) => { resolveApplicationInitialized = resolve; });
let lastCatalogPushSignature = '';
const isSmokeTest = process.env.HAMSTER_SMOKE_TEST === '1';
const isStartupIntegrityTest = process.env.HAMSTER_STARTUP_INTEGRITY_TEST === '1';
if (isSmokeTest) {
  // Electron may outlive the test runner's captured output pipe for a few milliseconds.
  // A closed diagnostic pipe must not surface as a main-process JavaScript error dialog.
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', (error) => {
      if (error?.code !== 'EPIPE') process.exitCode = 1;
    });
  }
}
const projectRoot = path.resolve(__dirname, '..');
const defaultElectronUserDataRoot = app.getPath('userData');
const applicationRoot = isSmokeTest && process.env.HAMSTER_SMOKE_USER_DATA_DIR
  ? path.join(path.resolve(process.env.HAMSTER_SMOKE_USER_DATA_DIR), 'portable-root')
  : app.isPackaged ? path.dirname(app.getPath('exe')) : projectRoot;
const activeUserDataLocationPath = isSmokeTest || !isInstalledDistribution
  ? userDataLocationPath(applicationRoot)
  : userDataLocationPath(defaultElectronUserDataRoot);
const configuredUserDataRoot = isSmokeTest
  ? resolveUserDataRoot(applicationRoot)
  : isStartupIntegrityTest && process.env.HAMSTER_SMOKE_USER_DATA_DIR
    ? path.resolve(process.env.HAMSTER_SMOKE_USER_DATA_DIR)
  : app.isPackaged
    ? (isInstalledDistribution
        ? resolveUserDataRootFromLocationFile(activeUserDataLocationPath, defaultElectronUserDataRoot)
        : resolveUserDataRoot(applicationRoot))
    : resolveDevelopmentUserDataRoot(projectRoot);
const electronRuntimeDirectory = (isSmokeTest || isStartupIntegrityTest) && process.env.HAMSTER_SMOKE_USER_DATA_DIR
  ? path.resolve(process.env.HAMSTER_SMOKE_USER_DATA_DIR)
  : path.join(configuredUserDataRoot, 'electron');
app.setPath('userData', electronRuntimeDirectory);
const hasSingleInstanceLock = isSmokeTest || app.requestSingleInstanceLock();
const startupDesktopMcpRequest = hasSingleInstanceLock && !isSmokeTest
  ? takeDesktopLaunchRequest({ applicationExecutable: process.execPath })
  : null;
const startupRequestsMcp = Boolean(startupDesktopMcpRequest) || process.argv.includes('--enable-mcp') || process.env.HAMSTER_MCP_ENABLED === '1';
if (isSmokeTest) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
app.setAppUserModelId('com.carlosz.hamsterarchiver');

function usesEnglishUi() {
  if (queueManager?.config?.language) return queueManager.config.language === 'en-US';
  return defaultInterfaceLanguage() === 'en-US';
}

function defaultInterfaceLanguage() {
  return String(app.getLocale?.() || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function nativeText(value, english = usesEnglishUi()) {
  if (!english || typeof value !== 'string') return value;
  const previousLocale = rendererI18n.getLocale();
  rendererI18n.setLocale('en-US');
  try {
    return value.split(/(\r?\n)/).map((part) => /^\r?\n$/.test(part)
      ? part
      : rendererI18n.translateStage(part)).join('');
  } finally {
    rendererI18n.setLocale(previousLocale);
  }
}

async function appendRuntimeLog(level, message, jobId = null) {
  if (queueManager) {
    await queueManager.log(level, message, jobId);
    return;
  }
  const store = appStore || new AppStore(makeUserDataLayout(applicationRoot, null, configuredUserDataRoot));
  await store.appendLog('', {
    at: new Date().toISOString(),
    level,
    message,
    jobId
  });
  await store.flushLogs?.();
}

async function runLoggedAction(label, operation) {
  try {
    return await operation();
  } catch (error) {
    await appendRuntimeLog('error', `${label}失败：${error.message}`).catch(() => {});
    throw error;
  }
}

function logStartupTiming(stage, details = {}) {
  console.log(`HAMSTER_STARTUP_TIMING ${JSON.stringify({
    stage,
    elapsedMs: Math.round(Date.now() - startupStartedAt),
    ...details
  })}`);
}

function catalogPushSignature(catalog) {
  return JSON.stringify((catalog || []).map((record) => [
    record.id, record.metadataUpdatedAt, record.completedAt, record.coverThumbnailPath,
    record.backupLocation, record.rating, record.tags, record.possibleDuplicate, record.similarCount,
    record.sourceDisposition, record.movedTo
  ]));
}

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  const desktopRequest = takeDesktopLaunchRequest({ applicationExecutable: process.execPath });
  const effectiveArgs = desktopRequest
    ? ['--enable-mcp', '--background', `--mcp-ready-file=${desktopRequest.readyFile}`, `--mcp-diagnostic-file=${desktopRequest.diagnosticFile}`, ...(desktopRequest.showUi ? ['--show-ui'] : [])]
    : argv;
  if (effectiveArgs.includes('--enable-mcp')) {
    void enableMcpForArguments(effectiveArgs).catch(async (error) => {
      await writeMcpStartupDiagnostic(effectiveArgs, error, 'mcp-enable');
      console.error(`MCP_START_FAILED ${error.stack || error.message}`);
    });
    if (!effectiveArgs.includes('--show-ui')) return;
  }
  showMainWindow();
});

function argumentValue(argv, name) {
  const prefix = `${name}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function validatedMcpReadyFile(argv) {
  const value = argumentValue(argv, '--mcp-ready-file');
  return isValidMcpReadyFile(value) ? path.resolve(value) : null;
}

function validatedMcpDiagnosticFile(argv) {
  const value = argumentValue(argv, '--mcp-diagnostic-file');
  return isValidMcpDiagnosticFile(value) ? path.resolve(value) : null;
}

async function writeMcpReadyFile(argv) {
  const readyFile = validatedMcpReadyFile(argv);
  if (!readyFile || !mcpServer) return;
  await writeJsonAtomic(readyFile, {
    schemaVersion: 2,
    connectionFile: mcpServer.connectionFile,
    instanceId: mcpServer.instanceId,
    startedAt: mcpServer.startedAt
  });
}

async function writeMcpStartupDiagnostic(argv, error, stage = 'startup') {
  const diagnosticFile = validatedMcpDiagnosticFile(argv);
  if (!diagnosticFile) return;
  await writeJsonAtomic(diagnosticFile, {
    schemaVersion: 1,
    code: error?.code || 'STARTUP_FAILED',
    stage,
    message: String(error?.message || error || 'Hamster Archiver failed to start.'),
    at: new Date().toISOString()
  }).catch(() => {});
}

function showMainWindow() {
  mcpUiWasShown = true;
  exitAfterMcpIdle = false;
  clearMcpIdleTimer();
  if (!applicationReady) {
    pendingWindowShow = true;
    if (startupWindow && !startupWindow.isDestroyed()) {
      startupWindow.show();
      startupWindow.focus();
    }
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function readStartupPreferences() {
  try {
    const saved = JSON.parse(await fs.readFile(path.join(configuredUserDataRoot, 'config', 'settings.json'), 'utf8'));
    return {
      language: saved?.language === 'en-US' ? 'en-US' : 'zh-CN',
      theme: 'day'
    };
  } catch {
    return {
      language: defaultInterfaceLanguage(),
      theme: 'day'
    };
  }
}

async function createStartupWindow() {
  const preferences = await readStartupPreferences();
  startupUsesEnglish = preferences.language === 'en-US';
  startupWindow = new BrowserWindow({
    show: !isStartupIntegrityTest,
    width: 460,
    height: 280,
    resizable: false,
    maximizable: false,
    minimizable: true,
    title: preferences.language === 'en-US' ? 'Starting Hamster Archiver' : '正在启动 Hamster Archiver',
    icon: appIconPath,
    backgroundColor: ['night', 'twilight'].includes(preferences.theme) ? '#17191f' : '#f7f7f8',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  startupWindow.removeMenu();
  logStartupTiming('startup-window-created');
  startupWindow.once('ready-to-show', () => {
    if (!isStartupIntegrityTest) startupWindow?.show();
    logStartupTiming('startup-window-ready');
  });
  await startupWindow.loadFile(path.join(__dirname, 'renderer', 'startup.html'), {
    query: { language: preferences.language, theme: preferences.theme }
  });
}

function updateStartupWindow(stage, detail = '', percentage = null) {
  if (!startupWindow || startupWindow.isDestroyed()) return;
  void startupWindow.webContents.executeJavaScript(
    `window.setStartupStatus?.(${JSON.stringify(stage)}, ${JSON.stringify(detail)}, ${JSON.stringify(percentage)})`
  ).catch(() => {});
}

function showStartupError(error) {
  if (!startupWindow || startupWindow.isDestroyed()) return false;
  const repair = startupUsesEnglish
    ? 'Reinstall or restore the application files, then try again.'
    : '请重新安装或恢复程序文件后再试。';
  updateStartupWindow('error', `${nativeText(error.message, startupUsesEnglish)}\n${repair}`);
  startupWindow.show();
  startupWindow.focus();
  return true;
}

function clearMcpIdleTimer() {
  if (mcpIdleTimer) clearTimeout(mcpIdleTimer);
  mcpIdleTimer = null;
}

function hasActiveMcpWork() {
  return (queueManager?.jobs || []).some((job) => job.mcpRequestId && ![
    'failed', 'cancelled', 'skipped_duplicate'
  ].includes(job.status) && !String(job.status || '').startsWith('completed'));
}

function scheduleMcpIdleExit(delayMs) {
  if (!startedAsMcpBackground || mcpUiWasShown || mcpIdleTimer) return;
  mcpIdleTimer = setTimeout(() => {
    mcpIdleTimer = null;
    if (!mcpServer || mcpServer.sessionCount !== 0 || mcpUiWasShown) return;
    if (hasActiveMcpWork() || queueManager?.running) {
      exitAfterMcpIdle = true;
      return;
    }
    app.quit();
  }, delayMs);
  mcpIdleTimer.unref?.();
}

function handleMcpSessionCountChanged(count) {
  if (!startedAsMcpBackground || mcpUiWasShown) return;
  if (count > 0) {
    mcpEverConnected = true;
    exitAfterMcpIdle = false;
    clearMcpIdleTimer();
    updateMcpTray();
    return;
  }
  if (hasActiveMcpWork() || queueManager?.running) exitAfterMcpIdle = true;
  else scheduleMcpIdleExit(mcpEverConnected ? 60_000 : 30_000);
  updateMcpTray();
}

function mcpTrayStatusText() {
  const english = usesEnglishUi();
  const jobs = (queueManager?.jobs || []).filter((job) => job.mcpRequestId);
  const active = jobs.filter((job) => !['failed', 'cancelled', 'skipped_duplicate'].includes(job.status) && !String(job.status || '').startsWith('completed')).length;
  const waiting = jobs.filter((job) => String(job.status || '').startsWith('awaiting_')).length;
  if (waiting) return english ? `${waiting} AI task(s) need review` : `${waiting} 个 AI 任务等待处理`;
  if (active) return english ? `${active} AI task(s) running` : `${active} 个 AI 任务进行中`;
  if (mcpServer?.sessionCount) return english ? 'AI connected' : 'AI 已连接';
  return english ? 'Waiting for AI connection' : '等待 AI 连接';
}

function updateMcpTray() {
  if (!mcpTray) return;
  const english = usesEnglishUi();
  const status = mcpTrayStatusText();
  mcpTray.setToolTip(`Hamster Archiver · ${status}`);
  mcpTray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: english ? 'Open AI tasks' : '查看 AI 任务', click: () => { void controlMainWindow({ section: 'workbench' }); } },
    { label: english ? 'Exit after current work' : '当前工作结束后退出', click: () => {
      mcpExitWhenIdleRequested = true;
      if (!hasActiveMcpWork() && !queueManager?.running) {
        allowWindowClose = true;
        app.quit();
      }
    } }
  ]));
}

function createMcpTray() {
  if (mcpTray || !startedAsMcpBackground || isSmokeTest) return;
  try {
    mcpTray = new Tray(appIconPath);
    mcpTray.on('click', () => { void controlMainWindow({ section: 'workbench' }); });
    updateMcpTray();
  } catch (error) {
    console.warn(`MCP_TRAY_WARNING ${error.message}`);
    mcpTray = null;
  }
}

async function enableMcpForArguments(argv) {
  await applicationInitialized;
  if (!mcpApplicationServices) {
    const { createMcpApplicationServices } = require('./core/mcp-application-services');
    mcpApplicationServices = createMcpApplicationServices({
      app,
      net,
      queueManager,
      appStore,
      applicationRoot,
      activeUserDataLocationPath,
      isInstalledDistribution,
      getMainWindow: () => mainWindow,
      showUi: controlMainWindow,
      copyText: async (value) => clipboard.writeText(value),
      openPath: (targetPath) => openItemLocation(targetPath, '应用位置'),
      requestQuitForRestart: async () => {
        allowWindowClose = true;
        const timer = setTimeout(() => app.quit(), 150);
        timer.unref?.();
      },
      onUpdateProgress: (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', progress);
      }
    });
  }
  if (!mcpServerStarting) {
    mcpServerStarting = require('./core/mcp-server')
      .startMcpServer(queueManager, queueManager.config.userDataDirectory, app.getVersion(), {
        services: mcpApplicationServices,
        onSessionCountChanged: handleMcpSessionCountChanged,
        getRuntimeStatus: () => ({
          pid: process.pid,
          background: startedAsMcpBackground,
          windowCount: BrowserWindow.getAllWindows().length,
          hasVisibleWindow: BrowserWindow.getAllWindows().some((window) => window.isVisible())
        })
      })
      .then((server) => { mcpServer = server; return server; })
      .catch((error) => { mcpServerStarting = null; throw error; });
  }
  await mcpServerStarting;
  createMcpTray();
  await writeMcpReadyFile(argv);
  handleMcpSessionCountChanged(mcpServer.sessionCount);
}

async function waitForWindowReady(browserWindow) {
  if (browserWindow.webContents.getURL() && !browserWindow.webContents.isLoadingMainFrame()) return;
  await new Promise((resolve, reject) => {
    const loaded = () => { cleanup(); resolve(); };
    const failed = (_event, code, description) => { cleanup(); reject(new Error(`界面加载失败 (${code})：${description}`)); };
    const closed = () => { cleanup(); reject(new Error('界面在加载完成前已关闭。')); };
    const cleanup = () => {
      browserWindow.webContents.removeListener('did-finish-load', loaded);
      browserWindow.webContents.removeListener('did-fail-load', failed);
      browserWindow.removeListener('closed', closed);
    };
    browserWindow.webContents.once('did-finish-load', loaded);
    browserWindow.webContents.once('did-fail-load', failed);
    browserWindow.once('closed', closed);
  });
}

async function controlMainWindow({ section, theme } = {}) {
  showMainWindow();
  const browserWindow = mainWindow;
  await waitForWindowReady(browserWindow);
  const page = section === 'catalog' ? 'library-page' : section ? 'workbench-page' : '';
  await browserWindow.webContents.executeJavaScript(`(() => {
    const page = ${JSON.stringify(page)};
    const section = ${JSON.stringify(section || '')};
    const theme = ${JSON.stringify(theme || '')};
    if (page) document.querySelector('.nav-button[data-page="' + page + '"]')?.click();
    if (section === 'settings') document.querySelector('.settings-col')?.scrollIntoView({ block: 'start' });
    if (theme) {
      const picker = document.querySelector('#theme-mode');
      if (picker) {
        picker.value = theme;
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  })()`);
  return {
    shown: true,
    ...(section ? { section } : {}),
    ...(theme ? { theme } : {})
  };
}

async function createThumbnails(job, manifest, config, options = {}) {
  return generateThumbnails(job, manifest, config, options, nativeImage);
}

async function storeCatalogImage(recordId, input, repositoryDirectory) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(recordId || ''))) {
    throw new Error('仓库记录标识无效。');
  }
  const dataUrl = String(input?.dataUrl || '');
  if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(dataUrl)) {
    throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。');
  }
  if (dataUrl.length > 36_000_000) throw new Error('单张图片不能超过约 25 MB。');
  let image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error('图片内容无效或无法读取。');
  const size = image.getSize();
  const longestSide = Math.max(size.width, size.height);
  if (longestSide > 1600) {
    const scale = 1600 / longestSide;
    image = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    });
  }
  const imageId = crypto.randomUUID();
  const thumbnailDir = path.join(repositoryDirectory, 'thumbnails', `manual-${recordId}`);
  await fs.mkdir(thumbnailDir, { recursive: true });
  const thumbnailPath = path.join(thumbnailDir, `${imageId}.png`);
  const data = image.toPNG();
  await fs.writeFile(thumbnailPath, data);
  const originalName = String(input?.name || '').trim().slice(0, 200) || '手动添加图片';
  return {
    id: imageId,
    ref: `manual-image:${imageId}`,
    relativePath: originalName,
    name: originalName,
    thumbnailPath,
    size: data.length,
    mimeType: 'image/png',
    addedAt: new Date().toISOString()
  };
}

async function pathExists(targetPath) {
  try { await fs.access(targetPath); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function openItemLocation(targetPath, label = '文件位置') {
  const resolvedPath = path.resolve(String(targetPath || '').trim());
  let stats;
  try {
    stats = await fs.stat(resolvedPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label}已经不存在。`);
    throw error;
  }
  if (stats.isDirectory()) {
    const message = await shell.openPath(resolvedPath);
    if (message) throw new Error(`无法打开${label}：${message}`);
  } else {
    shell.showItemInFolder(resolvedPath);
  }
  return resolvedPath;
}

async function showUpdateFailureDialog({ error, releaseUrl = releasesUrl, runRoot = '' }) {
  const english = queueManager?.config?.language === 'en-US';
  const buttons = [english ? 'Open Releases' : '打开发布页'];
  if (runRoot) buttons.push(english ? 'Open diagnostics' : '打开诊断目录');
  buttons.push(english ? 'Stay on this version' : '留在当前版本');
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: english ? 'Automatic update did not finish' : '自动更新未完成',
    message: english
      ? 'Program files were not replaced. The current version remains usable.'
      : '程序文件没有被替换，当前版本仍可继续使用。',
    detail: english
      ? `Reason: ${nativeText(error || 'The updater returned no usable result.', true)}\n\nManual update:\n${manualUpdateInstructions('en-US', isInstalledDistribution ? 'installed' : 'portable')}`
      : `失败原因：${error || '更新助手没有返回可用结果。'}\n\n手动更新方法：\n${manualUpdateInstructions('zh-CN', isInstalledDistribution ? 'installed' : 'portable')}`,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true
  });
  if (response.response === 0) await shell.openExternal(releaseUrl);
  else if (runRoot && response.response === 1) {
    await fs.mkdir(runRoot, { recursive: true });
    const openError = await shell.openPath(runRoot);
    if (openError) dialog.showErrorBox(english ? 'Could not open diagnostics' : '无法打开诊断目录', openError);
  }
}

async function ensureArchiveOutputDirectoryBeforeStart() {
  const configuredPath = String(queueManager?.config?.archiveOutputDirectory || '').trim();
  if (!configuredPath) return true;
  const resolvedPath = path.resolve(configuredPath);
  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) throw new Error('压缩包存储位置不是文件夹。');
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const english = usesEnglishUi();
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: english ? 'Archive folder is missing' : '压缩包存储位置不存在',
    message: english
      ? 'The configured archive folder no longer exists.'
      : '已设置的压缩包存储位置已经不存在。',
    detail: english
      ? `${resolvedPath}\n\nCreate this folder, or choose another existing location before archiving.`
      : `${resolvedPath}\n\n请先创建该文件夹，或重新选择一个现有位置，再开始压缩入库。`,
    buttons: english
      ? ['Create folder', 'Choose another folder', 'Cancel']
      : ['创建该文件夹', '重新选择', '取消'],
    defaultId: 1,
    cancelId: 2,
    noLink: true
  });
  if (response.response === 2) return false;
  if (response.response === 0) {
    await fs.mkdir(resolvedPath, { recursive: true });
    return true;
  }

  const selected = await dialog.showOpenDialog(mainWindow, {
    title: english ? 'Choose an archive folder' : '重新选择压缩包存储位置',
    defaultPath: path.dirname(resolvedPath),
    properties: ['openDirectory', 'createDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) return false;
  const nextOutputDirectory = selected.filePaths[0];
  const previousDerivedStaging = makeArchiveStagingDirectory(configuredPath);
  const currentStaging = String(queueManager.config.archiveStagingDirectory || '').trim();
  const nextStaging = !currentStaging ||
      normalizeForComparison(currentStaging) === normalizeForComparison(previousDerivedStaging)
    ? makeArchiveStagingDirectory(nextOutputDirectory)
    : currentStaging;
  await queueManager.updateConfig({
    ...queueManager.config,
    archiveOutputDirectory: nextOutputDirectory,
    archiveStagingDirectory: nextStaging
  });
  return true;
}

function appendReleaseNotes(detail, releaseNotes, english) {
  return `${detail}\n\n${formatReleaseNotes(releaseNotes, english ? 'en-US' : 'zh-CN')}`;
}

async function showUpdateSuccessDialog(notice) {
  const english = queueManager?.config?.language === 'en-US';
  const versionDetail = notice.fromVersion
    ? (english
        ? `Previous version: ${notice.fromVersion}\nCurrent version: ${notice.toVersion}`
        : `原版本：${notice.fromVersion}\n当前版本：${notice.toVersion}`)
    : (english ? `Current version: ${notice.toVersion}` : `当前版本：${notice.toVersion}`);
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: english ? 'Update complete' : '更新完成',
    message: english
      ? `Hamster Archiver ${notice.toVersion} is ready.`
      : `Hamster Archiver 已更新至 ${notice.toVersion}。`,
    detail: appendReleaseNotes(versionDetail, notice.releaseNotes, english),
    buttons: [english ? 'Continue' : '开始使用'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
}


async function promptAndLaunchPreparedUpdate({
  prepared,
  version,
  releaseUrl = releasesUrl
}) {
  const english = queueManager?.config?.language === 'en-US';
  const restart = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: english ? 'Update package ready' : '更新包已准备好',
    message: english
      ? `Hamster Archiver ${version} has been verified.`
      : `Hamster Archiver ${version} 已校验完成。`,
    detail: appendReleaseNotes(english
      ? 'Restart now to replace the program files and launch the new version. User data, the Warehouse, and archive packages will not be overwritten.'
      : '点击“立即重启”后，程序会退出、替换程序文件并自动启动新版本。用户数据、仓库和压缩包不会被覆盖。', prepared.releaseNotes, english),
    buttons: [english ? 'Restart now' : '立即重启', english ? 'Later' : '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (restart.response !== 0) {
    await queueManager?.log('info', `更新包 ${version} 已校验；用户选择稍后重启。`);
    return { staged: true };
  }
  try {
    await launchUpdate({ prepared, targetPid: process.pid });
  } catch (error) {
    console.error(`UPDATE_LAUNCH_FAILED ${error.stack || error.message}`);
    await queueManager?.log('error', `启动更新助手失败：${error.message}`);
    await showUpdateFailureDialog({ error: error.message, releaseUrl, runRoot: prepared.runRoot });
    return { staged: true, launchFailed: true, error: error.message };
  }
  await queueManager?.log('warning', `更新包 ${version} 已校验，应用将重启并执行更新。`);
  allowWindowClose = true;
  app.quit();
  return { restarting: true };
}

async function promptAndLaunchPreparedInstaller({ prepared, version, releaseUrl = releasesUrl }) {
  const english = queueManager?.config?.language === 'en-US';
  const response = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: english ? 'Installer ready' : '安装程序已准备好',
    message: english
      ? `Hamster Archiver ${version} is ready to install.`
      : `Hamster Archiver ${version} 已准备好安装。`,
    detail: appendReleaseNotes(english
      ? 'Start the installer to upgrade the existing per-user installation. The stable app identity lets the installer find and replace the existing installation instead of creating a second copy. User data is preserved.'
      : '启动安装程序后会升级现有的当前用户安装。稳定的应用标识会让安装程序找到并替换已有安装，不会另建一份副本；用户数据会保留。', prepared.releaseNotes, english),
    buttons: [english ? 'Start installer' : '启动安装程序', english ? 'Later' : '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (response.response !== 0) {
    await queueManager?.log('info', `安装程序 ${version} 已校验；用户选择稍后安装。`);
    return { staged: true };
  }
  try {
    await launchInstalledUpdate({ prepared });
  } catch (error) {
    console.error(`INSTALLER_UPDATE_LAUNCH_FAILED ${error.stack || error.message}`);
    await queueManager?.log('error', `启动安装程序失败：${error.message}`);
    await showUpdateFailureDialog({ error: error.message, releaseUrl, runRoot: prepared.runRoot });
    return { staged: true, launchFailed: true, error: error.message };
  }
  await queueManager?.log('warning', `安装程序 ${version} 已校验，应用将退出并启动安装。`);
  allowWindowClose = true;
  app.quit();
  return { restarting: true, installerStarted: true };
}

async function runLocalPackageUpdate(release = null) {
  const english = queueManager?.config?.language === 'en-US';
  if (!app.isPackaged || isSmokeTest) {
    throw new Error(english
      ? 'Only a packaged Windows app can update from a local release package.'
      : '只有打包后的 Windows 应用可以从本地发行包更新。');
  }
  if (queueManager.running) {
    throw new Error(english
      ? 'Updates are unavailable while the archive queue is running. Pause or finish the current task first.'
      : '归档任务运行期间不能更新，请先暂停或完成当前任务。');
  }
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: isInstalledDistribution
      ? (english ? 'Choose a newer Hamster Archiver installer' : '选择新版 Hamster Archiver 安装程序')
      : (english ? 'Choose a new Hamster Archiver release ZIP' : '选择新版 Hamster Archiver 压缩包'),
    defaultPath: isInstalledDistribution ? app.getPath('downloads') : applicationRoot,
    properties: ['openFile'],
    filters: [{
      name: isInstalledDistribution
        ? (english ? 'Hamster Archiver installer' : 'Hamster Archiver 安装程序')
        : (english ? 'Hamster Archiver release ZIP' : 'Hamster Archiver 发行压缩包'),
      extensions: [isInstalledDistribution ? 'exe' : 'zip']
    }]
  });
  if (selection.canceled || selection.filePaths.length === 0) return { cancelled: true, action: 'manual' };
  const onProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', progress);
  };
  const prepared = isInstalledDistribution
    ? await prepareLocalInstalledUpdate({
        userDataDirectory: queueManager.config.userDataDirectory,
        currentVersion: app.getVersion(),
        packagePath: selection.filePaths[0],
        release,
        onProgress
      })
    : await prepareLocalUpdate({
        applicationRoot,
        userDataDirectory: queueManager.config.userDataDirectory,
        sevenZipPath: resolveApplicationPath(applicationRoot, queueManager.config.sevenZipPath),
        currentVersion: app.getVersion(),
        packagePath: selection.filePaths[0],
        onProgress
      });
  const updateState = isInstalledDistribution
    ? await promptAndLaunchPreparedInstaller({ prepared, version: prepared.version, releaseUrl: release?.releaseUrl })
    : await promptAndLaunchPreparedUpdate({ prepared, version: prepared.version, releaseUrl: release?.releaseUrl });
  return { currentVersion: app.getVersion(), version: prepared.version, action: 'manual', ...updateState };
}

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || '';
  if (!senderUrl.startsWith('file://')) {
    throw new Error('已拒绝非本地界面的请求。');
  }
}

async function inspectSmokeVisualColorStates(browserWindow) {
  const fixtureId = 'hamster-smoke-visual-fixture';
  const themes = ['classic', 'day', 'night', 'forest', 'twilight'];
  const fixtureState = await browserWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('#${fixtureId}')?.remove();
    const fixture = document.createElement('div');
    fixture.id = '${fixtureId}';
    fixture.style.cssText = 'position:fixed;z-index:2147483647;left:8px;top:8px;width:1100px;height:220px;overflow:hidden;opacity:.001;pointer-events:auto;';
    const makeCatalogRow = (id, className) => {
      const row = document.createElement('article');
      row.id = id;
      row.className = className;
      row.style.position = 'relative';
      return row;
    };
    const activeRow = makeCatalogRow('smoke-active-row', 'catalog-text-row active');
    const selectedRow = makeCatalogRow('smoke-selected-row', 'catalog-text-row selected');
    const hoverRow = makeCatalogRow('smoke-hover-row', 'catalog-text-row');
    const ordinaryDirectory = document.createElement('div');
    ordinaryDirectory.id = 'smoke-directory-row';
    ordinaryDirectory.className = 'virtual-tree-row directory collapsible';
    ordinaryDirectory.style.cssText = 'position:relative;left:auto;right:auto;top:auto;width:100%;';
    const directoryIcon = document.createElement('span');
    directoryIcon.id = 'smoke-directory-icon';
    directoryIcon.className = 'virtual-tree-icon toggle';
    directoryIcon.textContent = '▾';
    const directoryName = document.createElement('strong');
    directoryName.className = 'virtual-tree-name';
    directoryName.textContent = 'ordinary-directory';
    ordinaryDirectory.append(directoryIcon, directoryName);
    const probe = document.createElement('div');
    probe.id = 'smoke-color-probe';
    fixture.append(activeRow, selectedRow, hoverRow, ordinaryDirectory, probe);
    document.body.append(fixture);
    return {
      originalTheme: document.body.dataset.theme || 'day'
    };
  })()`);
  const results = [];
  const devTools = browserWindow.webContents.debugger;
  const attachedHere = !devTools.isAttached();
  let hoverNodeId;
  let directoryNodeId;
  try {
    if (attachedHere) devTools.attach('1.3');
    await devTools.sendCommand('DOM.enable');
    await devTools.sendCommand('CSS.enable');
    const { root } = await devTools.sendCommand('DOM.getDocument');
    ({ nodeId: hoverNodeId } = await devTools.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#smoke-hover-row'
    }));
    ({ nodeId: directoryNodeId } = await devTools.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#smoke-directory-row'
    }));
    if (!hoverNodeId || !directoryNodeId) throw new Error('烟雾测试无法定位颜色状态验收节点。');
    for (const theme of themes) {
      await browserWindow.webContents.executeJavaScript(`document.body.dataset.theme = ${JSON.stringify(theme)}`);
      await devTools.sendCommand('CSS.forcePseudoState', { nodeId: directoryNodeId, forcedPseudoClasses: [] });
      await devTools.sendCommand('CSS.forcePseudoState', { nodeId: hoverNodeId, forcedPseudoClasses: ['hover'] });
      const state = await browserWindow.webContents.executeJavaScript(`(() => {
        const probe = document.querySelector('#smoke-color-probe');
        const resolveBackground = (name) => {
          probe.style.backgroundColor = 'var(' + name + ')';
          return getComputedStyle(probe).backgroundColor;
        };
        const resolveColor = (name) => {
          probe.style.color = 'var(' + name + ')';
          return getComputedStyle(probe).color;
        };
        const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
        return {
          activeBackground: styleOf('#smoke-active-row').backgroundColor,
          selectedBackground: styleOf('#smoke-selected-row').backgroundColor,
          hoverBackground: styleOf('#smoke-hover-row').backgroundColor,
          directoryBackground: styleOf('#smoke-directory-row').backgroundColor,
          directoryColor: styleOf('#smoke-directory-row').color,
          directoryIconColor: styleOf('#smoke-directory-icon').color,
          directoryIconBackground: styleOf('#smoke-directory-icon').backgroundColor,
          okBackground: resolveBackground('--ok-bg'),
          panelBackground: resolveBackground('--panel'),
          neutralHoverBackground: resolveBackground('--neutral-bg'),
          accentHoverBackground: resolveBackground('--accent-soft'),
          dangerBackground: resolveBackground('--danger-bg'),
          directoryIconBackgroundExpected: resolveBackground('--panel-tint'),
          inkColor: resolveColor('--ink'),
          mutedColor: resolveColor('--muted'),
          accentColor: resolveColor('--accent-dark'),
          dangerColor: resolveColor('--danger-fg')
        };
      })()`);
      await devTools.sendCommand('CSS.forcePseudoState', { nodeId: hoverNodeId, forcedPseudoClasses: [] });
      await devTools.sendCommand('CSS.forcePseudoState', { nodeId: directoryNodeId, forcedPseudoClasses: ['hover'] });
      state.directoryHoverBackground = await browserWindow.webContents.executeJavaScript(
        `getComputedStyle(document.querySelector('#smoke-directory-row')).backgroundColor`
      );
      await devTools.sendCommand('CSS.forcePseudoState', { nodeId: directoryNodeId, forcedPseudoClasses: [] });
      results.push({ theme, ...state });
    }
  } finally {
    if (devTools.isAttached()) {
      if (hoverNodeId) {
        await devTools.sendCommand('CSS.forcePseudoState', { nodeId: hoverNodeId, forcedPseudoClasses: [] }).catch(() => {});
      }
      if (directoryNodeId) {
        await devTools.sendCommand('CSS.forcePseudoState', { nodeId: directoryNodeId, forcedPseudoClasses: [] }).catch(() => {});
      }
      if (attachedHere) devTools.detach();
    }
    await browserWindow.webContents.executeJavaScript(`(() => {
      document.body.dataset.theme = ${JSON.stringify(fixtureState.originalTheme)};
      document.querySelector('#${fixtureId}')?.remove();
    })()`);
  }
  return {
    valid: results.every((result) => result.activeBackground === result.okBackground &&
      result.selectedBackground === result.okBackground &&
      result.hoverBackground === result.neutralHoverBackground &&
      result.hoverBackground !== result.accentHoverBackground &&
      result.hoverBackground !== result.dangerBackground &&
      result.directoryBackground === result.panelBackground &&
      result.directoryHoverBackground === result.neutralHoverBackground &&
      result.directoryColor === result.inkColor &&
      result.directoryColor !== result.accentColor &&
      result.directoryColor !== result.dangerColor &&
      result.directoryIconColor === result.mutedColor &&
      result.directoryIconColor !== result.accentColor &&
      result.directoryIconColor !== result.dangerColor &&
      result.directoryIconBackground === result.directoryIconBackgroundExpected),
    results
  };
}

async function writeSmokeResult(ok, stage, details = null) {
  const target = String(process.env.HAMSTER_SMOKE_RESULT_FILE || '').trim();
  if (!target) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify({
    ok,
    stage,
    version: app.getVersion(),
    completedAt: new Date().toISOString(),
    ...(details ? { details } : {})
  }), 'utf8');
}

function createWindow() {
  const replacesStartupWindow = Boolean(startupWindow && !startupWindow.isDestroyed());
  mainWindow = new BrowserWindow({
    show: !replacesStartupWindow && (process.env.HAMSTER_SMOKE_TEST !== '1' || process.env.HAMSTER_SMOKE_SHOW === '1'),
    width: isSmokeTest && Number(process.env.HAMSTER_SMOKE_WINDOW_WIDTH) > 0
      ? Number(process.env.HAMSTER_SMOKE_WINDOW_WIDTH)
      : 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: usesEnglishUi() ? 'Hamster Archiver' : '仓鼠症大结局',
    icon: appIconPath,
    backgroundColor: '#f7f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`PRELOAD_ERROR ${preloadPath}: ${error.stack || error.message}`);
    void appendRuntimeLog('error', `界面预加载失败：${error.message}`).catch(() => {});
  });
  if (replacesStartupWindow) {
    mainWindow.once('ready-to-show', () => {
      if (startupWindow && !startupWindow.isDestroyed()) startupWindow.close();
      startupWindow = null;
      if (!isStartupIntegrityTest) {
        mainWindow?.show();
        mainWindow?.focus();
      }
      logStartupTiming('main-window-ready');
    });
  } else {
    mainWindow.once('ready-to-show', () => logStartupTiming('main-window-ready'));
  }
  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', async (event) => {
    if (mcpTray && !allowWindowClose) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (allowWindowClose) return;
    const catalogOperationPending = Boolean(queueManager?.hasPendingCatalogOperations?.());
    if (!queueManager?.running && catalogOperationPending) {
      event.preventDefault();
      if (shutdownInProgress) return;
      shutdownInProgress = true;
      mainWindow.hide();
      await queueManager.waitForCatalogOperations();
      allowWindowClose = true;
      mainWindow.close();
      return;
    }
    if (!queueManager?.running) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    const paused = Boolean(queueManager.paused);
    const english = queueManager?.config?.language === 'en-US';
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: english ? 'Archive tasks are still running' : '归档任务仍在运行',
      message: paused
        ? (english ? 'The current task is paused. Exiting now will cancel it without modifying source files.' : '当前任务已暂停。现在退出会取消当前任务，源文件不会被修改。')
        : (english ? 'Exiting now will stop the entire archive queue. Source files will not be modified.' : '现在退出会停止整个归档队列。源文件不会被修改。'),
      detail: paused
        ? (english ? 'You can retry the cancelled task next time. Tasks that have not started remain in the list. Choose “Keep running” to return.' : '当前任务下次打开后可从“已取消”状态重试；尚未开始的任务会保留在列表中。选择“继续运行”可返回应用。')
        : (english ? 'The current compression will be cancelled safely. Tasks that have not started remain in the list. If verified output is being moved, its catalog record is completed before exit.' : '当前压缩会安全取消，尚未开始的任务会保留在列表中，下次打开可继续。若正在移动已验证成品，程序会先完成入库记录再退出。'),
      buttons: english ? ['Keep running', 'Stop queue and exit'] : ['继续运行', '停止队列并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    closePromptOpen = false;
    if (result.response === 1) {
      await Promise.all([
        queueManager.stopForShutdown(),
        queueManager.waitForCatalogOperations()
      ]);
      allowWindowClose = true;
      mainWindow.close();
    }
  });

  if (process.env.HAMSTER_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      const bridgeStatus = await mainWindow.webContents.executeJavaScript(`(() => {
        const required = [
          'getState', 'chooseDirectory', 'chooseProgram', 'changeWarehouseLocation', 'openWarehouse', 'exportWarehouse', 'importWarehouse', 'checkForUpdates', 'logToast', 'installUpdatePackage', 'changeUserDataLocation', 'openExternal', 'copyText', 'chooseSingle', 'saveConfig', 'scanSource',
          'addSingle', 'openTaskSource', 'getQueueSimilarityReport', 'getSourceChangeReport', 'resolveSourceChange', 'getDroppedPath', 'confirmTask', 'confirmAnomaly', 'acknowledgeTrashSafety', 'cancelTask', 'retryTask', 'startQueue', 'startInventoryOnlyQueue',
          'discardAnomaly', 'pauseQueue', 'resumeQueue', 'removeJobs', 'clearCompletedJobs', 'clearCancelledJobs', 'clearQueue', 'clearPotentialDuplicates', 'clearExactDuplicates', 'confirmAllDuplicates', 'finishNextAndPause', 'searchCatalog',
          'getCatalogSuggestions', 'openSimilarityIgnoreTerms', 'reloadSimilarityIgnoreTerms', 'addSimilarityIgnoreTerm', 'rebuildAllSimilarity', 'onSimilarityRebuildProgress',
          'getWarehouseInsights', 'getRandomCatalogRecord',
          'getCatalogDetails', 'openCatalogSource', 'restoreCatalogSource', 'updateCatalogMetadata', 'updateCatalogSourcePath', 'recalculateCatalogSimilarity', 'removeCatalogSimilarity', 'addManualCatalogRecord', 'addCatalogImage',
          'setCatalogCover', 'addTagsToCatalogRecords', 'updateBackupLocationForCatalogRecords', 'queueCatalogRecordsForCompression', 'queueCatalogRecordsForRefresh', 'undoCatalogAction', 'deleteCatalogRecords', 'getThumbnail',
          'onStateChanged', 'onTaskProgress', 'onCatalogChanged', 'onScanProgress', 'onUpdateProgress'
        ];
        return {
          exists: typeof window.archiveApp === 'object',
          missing: required.filter((name) => typeof window.archiveApp?.[name] !== 'function')
        };
      })()`);
      if (!bridgeStatus.exists || bridgeStatus.missing.length > 0) {
        console.error(`HAMSTER_BRIDGE_TEST_FAILED ${JSON.stringify(bridgeStatus)}`);
        await writeSmokeResult(false, 'bridge', bridgeStatus);
        app.exitCode = 1;
        app.quit();
        return;
      }
      const ipcStatus = await mainWindow.webContents.executeJavaScript(`window.archiveApp.getState().then((state) => ({
        hasConfig: Boolean(state?.config),
        hasJobs: Array.isArray(state?.jobs),
        hasCatalog: Array.isArray(state?.catalog),
        archiveVolumeEnabled: state?.config?.archiveVolumeEnabled === true,
        archiveVolumeBytes: Number(state?.config?.archiveVolumeBytes)
      }))`);
      if (process.env.HAMSTER_SMOKE_MODE === 'minimal') {
        if (!ipcStatus.hasConfig || !ipcStatus.hasJobs || !ipcStatus.hasCatalog) {
          await writeSmokeResult(false, 'ipc', { bridgeStatus, ipcStatus });
          app.exitCode = 1;
        } else {
          await writeSmokeResult(true, 'complete', { bridgeStatus, ipcStatus });
          console.log(`HAMSTER_SMOKE_TEST_OK ${JSON.stringify({ bridgeStatus, ipcStatus })}`);
        }
        app.quit();
        return;
      }
      const expectedSourceState = ['trash', 'move', 'keep'].includes(process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION)
        ? process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION
        : 'keep';
      const expectedSourceLabels = usesEnglishUi()
        ? { trash: 'Move to Recycle Bin', move: 'Move Originals', keep: 'Keep Originals' }
        : { trash: '归档后移入回收站', move: '归档后移动原文件', keep: '归档后不移动原文件' };
      const uiStatus = await mainWindow.webContents.executeJavaScript(`({
        hasVolumeControls: Boolean(document.querySelector('#split-volume') && document.querySelector('#volume-size') && document.querySelector('#volume-unit')),
        hasNoVolumeExample: !document.querySelector('#volume-hint') || !document.querySelector('#volume-hint')?.textContent,
        compressionDigest: document.querySelector('#digest-compression')?.textContent || '',
        sourceSafetyState: document.querySelector('#source-safety-chip')?.dataset.state || '',
        sourceSafetyText: document.querySelector('#source-safety-label')?.textContent || '',
        sourceDispositionStates: [
          window.hamsterUiState?.sourceDispositionPresentation(true, false),
          window.hamsterUiState?.sourceDispositionPresentation(false, true),
          window.hamsterUiState?.sourceDispositionPresentation(false, false)
        ]
      })`);
      uiStatus.visualColorStates = await inspectSmokeVisualColorStates(mainWindow);
      if (!ipcStatus.hasConfig || !ipcStatus.hasJobs || !ipcStatus.hasCatalog ||
          !ipcStatus.archiveVolumeEnabled || ipcStatus.archiveVolumeBytes !== LARGE_TASK_BYTES ||
          !uiStatus.hasVolumeControls || !uiStatus.hasNoVolumeExample || !uiStatus.compressionDigest.includes('10 GB') ||
          !uiStatus.visualColorStates?.valid ||
          uiStatus.sourceSafetyState !== expectedSourceState ||
          uiStatus.sourceSafetyText !== expectedSourceLabels[expectedSourceState] ||
          JSON.stringify(uiStatus.sourceDispositionStates) !== JSON.stringify([
            { state: 'trash', label: '归档后移入回收站' },
            { state: 'move', label: '归档后移动原文件' },
            { state: 'keep', label: '归档后不移动原文件' }
          ])) {
        console.error(`HAMSTER_IPC_TEST_FAILED ${JSON.stringify({ ipcStatus, uiStatus })}`);
        await writeSmokeResult(false, 'ipc-ui', { ipcStatus, uiStatus });
        app.exitCode = 1;
        app.quit();
        return;
      }
      if (process.env.HAMSTER_VIDEO_FRAME_TEST_PATH) {
        const videoPath = path.resolve(process.env.HAMSTER_VIDEO_FRAME_TEST_PATH);
        const stats = await fs.stat(videoPath);
        const frameManifest = await createThumbnails({
          id: 'video-frame-smoke',
          sourcePath: videoPath,
          sourceType: 'video'
        }, [{
          relativePath: path.basename(videoPath),
          name: path.basename(videoPath),
          extension: path.extname(videoPath).toLowerCase(),
          size: stats.size
        }], {
          ...queueManager.config,
          archiveOutputDirectory: process.env.HAMSTER_SMOKE_LIBRARY_DIR,
          videoFrameBackup: true,
          videoFrameCount: 6
        });
        const frames = frameManifest[0].thumbnails || [];
        const frameStatus = {
          count: frames.length,
          grouped: frames.every((frame) => frame.videoGroup === path.basename(videoPath)),
          increasing: frames.every((frame, index) => index === 0 || frame.timeSeconds > frames[index - 1].timeSeconds),
          filesExist: (await Promise.all(frames.map(async (frame) => {
            try { await fs.access(frame.thumbnailPath); return true; } catch { return false; }
          }))).every(Boolean)
        };
        console.log(`HAMSTER_VIDEO_FRAME_TEST ${JSON.stringify(frameStatus)}`);
        if (frameStatus.count !== 6 || !frameStatus.grouped || !frameStatus.increasing || !frameStatus.filesExist) {
          console.error('HAMSTER_VIDEO_FRAME_TEST_FAILED');
          await writeSmokeResult(false, 'video-frame', frameStatus);
          app.exitCode = 1;
          app.quit();
          return;
        }
      }
      if (process.env.HAMSTER_SMOKE_PAGE === 'library') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-page="library-page"]').click()`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (process.env.HAMSTER_SMOKE_EMPTY_LIBRARY === '1') {
          const emptyLibraryStatus = await mainWindow.webContents.executeJavaScript(`(() => {
            document.body.dataset.theme = 'day';
            document.querySelector('#close-onboarding')?.click();
            const placeholder = document.querySelector('.discovery-hero-empty');
            const nav = document.querySelector('.top-nav')?.getBoundingClientRect();
            const actions = document.querySelector('.app-bar-actions')?.getBoundingClientRect();
            const separated = nav && actions && (
              nav.right <= actions.left || nav.left >= actions.right ||
              nav.bottom <= actions.top || nav.top >= actions.bottom
            );
            return {
              inventory: document.querySelector('#metric-inventory')?.textContent,
              cells: document.querySelectorAll('.activity-cell').length,
              emptyCardVisible: Boolean(placeholder),
              hasNoCoverWords: placeholder?.textContent.includes('暂无封面') || placeholder?.textContent.includes('No cover'),
              stillLoading: document.querySelector('#warehouse-discovery')?.textContent.includes('正在从仓库中挑选') ||
                document.querySelector('#warehouse-discovery')?.textContent.includes('Choosing a random warehouse item'),
              usesForestGradient: getComputedStyle(placeholder).backgroundImage.includes('rgb(36, 74, 58)'),
              navCentered: Boolean(nav) && Math.abs(nav.left + (nav.width / 2) - (document.documentElement.clientWidth / 2)) < 2,
              headerControlsSeparate: Boolean(separated)
            };
          })()`);
          if (process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            const image = await mainWindow.webContents.capturePage();
            await fs.mkdir(path.dirname(process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT), { recursive: true });
            await fs.writeFile(process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT, image.toPNG());
          }
          console.log(`HAMSTER_EMPTY_LIBRARY_TEST ${JSON.stringify(emptyLibraryStatus)}`);
          if (emptyLibraryStatus.inventory !== '0' || emptyLibraryStatus.cells !== 140 || !emptyLibraryStatus.emptyCardVisible ||
              emptyLibraryStatus.hasNoCoverWords || emptyLibraryStatus.stillLoading || !emptyLibraryStatus.usesForestGradient ||
              !emptyLibraryStatus.navCentered || !emptyLibraryStatus.headerControlsSeparate) {
            console.error('HAMSTER_EMPTY_LIBRARY_TEST_FAILED');
            await writeSmokeResult(false, 'empty-library', emptyLibraryStatus);
            app.exitCode = 1;
          } else {
            await writeSmokeResult(true, 'complete', { bridgeStatus, ipcStatus, uiStatus });
            console.log(`HAMSTER_SMOKE_TEST_OK ${JSON.stringify({ bridgeStatus, ipcStatus, uiStatus })}`);
          }
          app.quit();
          return;
        }
        const activityStatus = await mainWindow.webContents.executeJavaScript(`(() => {
          const scroll = document.querySelector('.activity-scroll');
          const nav = document.querySelector('.top-nav').getBoundingClientRect();
          const actions = document.querySelector('.app-bar-actions').getBoundingClientRect();
          const cells = [...document.querySelectorAll('.activity-cell')];
          const activeCells = [...document.querySelectorAll('.activity-cell[data-activity-count]')]
            .filter((cell) => Number(cell.dataset.activityCount) > 0);
          const firstCellRect = cells[0]?.getBoundingClientRect();
          const nextColumnRect = cells[7]?.getBoundingClientRect();
          const status = {
            cells: cells.length,
            inventory: document.querySelector('#metric-inventory')?.textContent,
            tags: document.querySelector('#metric-tags')?.textContent,
            gb: document.querySelector('#metric-gb')?.textContent,
            normalWidthFits: scroll.scrollWidth <= scroll.clientWidth,
            overflowX: getComputedStyle(scroll).overflowX,
            fixedColumnGap: Math.round((nextColumnRect?.left || 0) - (firstCellRect?.right || 0)),
            subtitleRemoved: !document.querySelector('.activity-panel-head > div > strong + span'),
            latestActivityVisible: Number(activeCells.at(-1)?.dataset.activityCount) > 0,
            navCentered: Math.abs(nav.left + (nav.width / 2) - (document.documentElement.clientWidth / 2)) < 2,
            headerControlsSeparate: nav.right <= actions.left || nav.left >= actions.right || nav.bottom <= actions.top || nav.top >= actions.bottom
          };
          scroll.style.width = '260px';
          return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            status.narrowWidthScrolls = scroll.scrollWidth > scroll.clientWidth;
            status.narrowDefaultsToLatest = Math.abs(scroll.scrollLeft - (scroll.scrollWidth - scroll.clientWidth)) <= 2;
            scroll.style.removeProperty('width');
            resolve(status);
          })));
        })()`);
        const statisticsStatus = await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector('#open-inventory-statistics')?.click();
          const dialog = document.querySelector('#warehouse-statistics-dialog');
          const content = document.querySelector('#warehouse-statistics-content');
          const status = {
            open: Boolean(dialog?.open),
            monthCards: document.querySelectorAll('.statistics-month-card').length,
            verticallyScrollable: content?.scrollHeight > content?.clientHeight
          };
          document.querySelector('#close-warehouse-statistics')?.click();
          return status;
        })()`);
        const defaultRandomCount = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('[data-discovery-record]').length`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#random-walk')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const randomWalkCount = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('[data-discovery-record]').length`);
        const manualDialogStatus = await mainWindow.webContents.executeJavaScript(`(() => {
          document.querySelector('#add-manual-catalog')?.click();
          const dialog = document.querySelector('#manual-catalog-dialog');
          const status = {
            open: Boolean(dialog?.open),
            nameRequired: Boolean(document.querySelector('#manual-catalog-name')?.required),
            notesRequired: Boolean(document.querySelector('#manual-catalog-notes')?.required)
          };
          document.querySelector('#cancel-manual-dialog')?.click();
          return status;
        })()`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#catalog-grid-view')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT) {
          await mainWindow.webContents.executeJavaScript('window.scrollTo(0, 0)');
          await new Promise((resolve) => setTimeout(resolve, 250));
          const overviewImage = await mainWindow.webContents.capturePage();
          await fs.mkdir(path.dirname(process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT), { recursive: true });
          await fs.writeFile(process.env.HAMSTER_SMOKE_OVERVIEW_SCREENSHOT, overviewImage.toPNG());
        }
        if (process.env.HAMSTER_SMOKE_GRID_SCREENSHOT) {
          await mainWindow.webContents.executeJavaScript(`(() => {
            if (${process.env.HAMSTER_README_DEMO === '1'}) {
              const warehousePath = document.querySelector('#warehouse-path');
              if (warehousePath) {
        warehousePath.textContent = '仓库：D:\\\\HamsterArchiver\\\\userdata\\\\warehouse';
        warehousePath.title = 'D:\\\\HamsterArchiver\\\\userdata\\\\warehouse';
              }
            }
            const overview = document.querySelector('.warehouse-overview');
            if (overview) overview.style.display = 'none';
            const layout = document.querySelector('.library-title') || document.querySelector('#library-layout');
            if (!layout) return;
            document.documentElement.style.scrollBehavior = 'auto';
            window.scrollTo(0, Math.max(0, layout.getBoundingClientRect().top + window.scrollY - 18));
          })()`);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const readyCoverCount = await mainWindow.webContents.executeJavaScript(`
              [...document.querySelectorAll('.catalog-cover .contained-thumbnail-foreground')]
                .filter((image) => image.complete && image.naturalWidth > 0).length
            `);
            if (readyCoverCount >= 8) break;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          await mainWindow.webContents.executeJavaScript(`Promise.all(
            [...document.querySelectorAll('.catalog-cover .contained-thumbnail-foreground')]
              .map((image) => image.decode().catch(() => null))
          )`);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const gridImage = await mainWindow.webContents.capturePage();
          await fs.mkdir(path.dirname(process.env.HAMSTER_SMOKE_GRID_SCREENSHOT), { recursive: true });
          await fs.writeFile(process.env.HAMSTER_SMOKE_GRID_SCREENSHOT, gridImage.toPNG());
        }
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.catalog-cover .contained-thumbnail-foreground')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const cardLightboxStatus = await mainWindow.webContents.executeJavaScript(`({
          open: Boolean(document.querySelector('#thumbnail-lightbox')?.open),
          hasImage: Boolean(document.querySelector('#lightbox-image')?.src),
          hasCoverButton: Boolean(document.querySelector('#set-thumbnail-cover'))
        })`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#close-thumbnail-lightbox')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 180));
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.catalog-open')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.thumbnail-gallery img')[1]?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const detailLightboxOpen = await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector('#thumbnail-lightbox')?.open)`);
        const selectedCoverPath = await mainWindow.webContents.executeJavaScript(`document.querySelector('#lightbox-path')?.textContent`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#set-thumbnail-cover')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 600));
        const coverState = await mainWindow.webContents.executeJavaScript(`window.archiveApp.getState().then((state) => {
          const record = state.catalog.find((item) => item.id === activeCatalogId);
          return { coverRelativePath: record?.coverRelativePath, coverThumbnailRef: record?.coverThumbnailRef, coverThumbnailPath: record?.coverThumbnailPath };
        })`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#close-thumbnail-lightbox')?.click()`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#catalog-list-view')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        const listViewStatus = await mainWindow.webContents.executeJavaScript(`(() => {
          const list = document.querySelector('#catalog-list');
          const detail = document.querySelector('#catalog-detail');
          return {
            rows: document.querySelectorAll('.catalog-text-row').length,
            covers: document.querySelectorAll('.catalog-text-row .catalog-cover').length,
            detailBelowList: Boolean(list && detail && detail.getBoundingClientRect().top >= list.getBoundingClientRect().bottom)
          };
        })()`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.catalog-text-open')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 300));
        listViewStatus.detailLoaded = await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector('#catalog-detail .archive-heading'))`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('#catalog-grid-view')?.click()`);
        await mainWindow.webContents.executeJavaScript(`document.querySelector('.catalog-open')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const libraryStatus = await mainWindow.webContents.executeJavaScript(`({
          hasHeading: Boolean(document.querySelector('.archive-heading')),
          hasTree: Boolean(document.querySelector('.virtual-directory-tree')),
          hasEditor: Boolean(document.querySelector('.catalog-editor-form')),
          hasGridMode: document.querySelector('#library-layout')?.classList.contains('grid-mode'),
          coverImages: document.querySelectorAll('.catalog-cover img[src]').length,
          hasContainedCover: Boolean(
            document.querySelector('.catalog-cover .contained-thumbnail-backdrop[src]') &&
            document.querySelector('.catalog-cover .contained-thumbnail-foreground[src]') &&
            getComputedStyle(document.querySelector('.catalog-cover .contained-thumbnail-foreground')).objectFit === 'contain' &&
            document.querySelector('.catalog-cover .catalog-cover-frame')?.getBoundingClientRect().width > 0 &&
            document.querySelector('.catalog-cover .catalog-cover-frame')?.getBoundingClientRect().height > 0
          ),
          hasFileBadge: Boolean(document.querySelector('.file-count-badge')),
          hasCatalogCheckbox: Boolean(document.querySelector('.catalog-select')),
          hasBulkToolbar: Boolean(document.querySelector('.warehouse-bulkbar')),
          hasNoBulkDisabledHint: !document.querySelector('#catalog-selection-hint'),
          paginationAfterCards: document.querySelector('#catalog-list')?.nextElementSibling?.id === 'catalog-pagination' &&
            document.querySelector('#catalog-pagination')?.nextElementSibling?.id === 'catalog-detail',
          overviewMatchesPrototype: document.querySelector('.warehouse-overview-head')?.parentElement?.classList.contains('warehouse-summary') &&
            !document.querySelector('.warehouse-overview')?.innerText.includes('仓库活跃度') &&
            document.querySelectorAll('.warehouse-metrics > .warehouse-metric').length === 4,
          hasInventoryDate: document.querySelector('#catalog-detail')?.innerText.includes('入库时间'),
          hasBackupFilter: document.querySelectorAll('#catalog-backup-filter option').length >=
            (${process.env.HAMSTER_SMOKE_REAL_CATALOG === '1' || Boolean(process.env.HAMSTER_SMOKE_IMPORT_DIRECTORY) ? 1 : 2}),
          hasBackupSetting: Boolean(document.querySelector('#record-backup-location') && document.querySelector('#backup-location')),
          hasNewControls: Boolean(document.querySelector('#finish-next') && document.querySelector('#clear-duplicates') &&
            document.querySelector('#clear-completed') && document.querySelector('#open-usage-guide') &&
            document.querySelector('#check-for-updates') && document.querySelector('#export-warehouse') &&
            document.querySelector('#import-warehouse') &&
            document.querySelector('#refresh-catalog') && document.querySelector('#update-backup-selected') &&
            document.querySelector('#undo-catalog') && document.querySelector('#bulk-tags-dialog') &&
            document.querySelector('#set-warehouse-location') && document.querySelector('#open-warehouse')),
          hasNoTreeBulkButtons: !document.querySelector('#expand-library-tree') && !document.querySelector('#collapse-library-tree'),
          hasNoDailyReview: !document.querySelector('#daily-review'),
          stagingCanBeSelected: Boolean(!document.querySelector('#archive-staging-directory[readonly]') &&
            document.querySelector('[data-pick="archive-staging-directory"]')),
          hasCollapsibleMedia: Boolean(document.querySelector('details.media-preview-section')),
          passwordHidden: document.querySelector('#archive-password')?.type === 'password',
          inlineBulkTagRemoved: !document.querySelector('#bulk-catalog-tags'),
          bulkPasswordRemoved: !document.querySelector('#update-password-selected') && !document.querySelector('#bulk-password-dialog'),
          passwordEditorReadOnly: Boolean(document.querySelector('.password-editor-control input[readonly]')),
          paginationVisible: !document.querySelector('#catalog-pagination')?.hidden,
          paginationText: document.querySelector('#catalog-page-status')?.textContent,
          hasBackupText: document.querySelector('#catalog-detail')?.innerText.includes('百度网盘'),
          dotArtCount: document.querySelectorAll('[data-dot-art], .dot-art').length,
          thumbnailImages: document.querySelectorAll('.thumbnail-card img[src]').length,
          hasContainedDetailImage: Boolean(
            document.querySelector('.thumbnail-card .contained-thumbnail-backdrop[src]') &&
            document.querySelector('.thumbnail-card .contained-thumbnail-foreground[src]') &&
            getComputedStyle(document.querySelector('.thumbnail-card .contained-thumbnail-foreground')).objectFit === 'contain'
          ),
          virtualTreeRows: document.querySelectorAll('.virtual-tree-row').length,
          virtualTreeCanvasHeight: Number.parseInt(document.querySelector('.virtual-directory-canvas')?.style.height || '0', 10),
          detailText: document.querySelector('#catalog-detail')?.innerText.slice(0, 120)
        })`);
        console.log(`HAMSTER_LIBRARY_TEST ${JSON.stringify({ ...libraryStatus, listViewStatus, manualDialogStatus, activityStatus, statisticsStatus, defaultRandomCount, randomWalkCount, cardLightboxStatus, detailLightboxOpen, selectedCoverPath, coverState })}`);
        if (!libraryStatus.hasHeading || !libraryStatus.hasTree || !libraryStatus.hasEditor ||
            !libraryStatus.hasGridMode || libraryStatus.coverImages < 1 || !libraryStatus.hasContainedCover ||
            !libraryStatus.hasFileBadge ||
            !libraryStatus.hasCatalogCheckbox || !libraryStatus.hasBulkToolbar || !libraryStatus.hasNoBulkDisabledHint ||
            !libraryStatus.paginationAfterCards || !libraryStatus.overviewMatchesPrototype || !libraryStatus.hasInventoryDate ||
            !libraryStatus.hasBackupFilter || !libraryStatus.hasBackupSetting ||
            (!process.env.HAMSTER_SMOKE_IMPORT_DIRECTORY && process.env.HAMSTER_SMOKE_REAL_CATALOG !== '1' && !libraryStatus.hasBackupText) ||
            !libraryStatus.hasNewControls || !libraryStatus.passwordHidden || !libraryStatus.inlineBulkTagRemoved ||
            !libraryStatus.bulkPasswordRemoved || !libraryStatus.passwordEditorReadOnly ||
            !libraryStatus.hasNoTreeBulkButtons || !libraryStatus.hasNoDailyReview ||
            !libraryStatus.stagingCanBeSelected || !libraryStatus.hasCollapsibleMedia ||
            (Number(process.env.HAMSTER_SMOKE_CATALOG_COUNT || 0) > 24 && !libraryStatus.paginationVisible) ||
            !manualDialogStatus.open || !manualDialogStatus.nameRequired || manualDialogStatus.notesRequired ||
            activityStatus.cells !== 140 || Number(activityStatus.inventory) < 2 ||
            !activityStatus.normalWidthFits || !activityStatus.narrowWidthScrolls || activityStatus.overflowX !== 'auto' ||
            !activityStatus.narrowDefaultsToLatest || activityStatus.fixedColumnGap !== 5 || !activityStatus.subtitleRemoved ||
            !activityStatus.latestActivityVisible || !activityStatus.navCentered || !activityStatus.headerControlsSeparate ||
            !statisticsStatus.open || statisticsStatus.monthCards < 1 || !statisticsStatus.verticallyScrollable ||
            defaultRandomCount !== 1 || randomWalkCount !== 1 ||
            !cardLightboxStatus.open || !cardLightboxStatus.hasImage || !cardLightboxStatus.hasCoverButton ||
            !detailLightboxOpen || !selectedCoverPath || coverState.coverThumbnailRef !== selectedCoverPath ||
            coverState.coverThumbnailPath !== selectedCoverPath ||
            listViewStatus.rows < 1 || listViewStatus.covers !== 0 || !listViewStatus.detailBelowList || !listViewStatus.detailLoaded ||
            libraryStatus.dotArtCount !== 0 || libraryStatus.thumbnailImages < 1 ||
            !libraryStatus.hasContainedDetailImage || libraryStatus.virtualTreeCanvasHeight < 1) {
          console.error('HAMSTER_LIBRARY_TEST_FAILED');
          await writeSmokeResult(false, 'library', { libraryStatus, listViewStatus });
          app.exitCode = 1;
          app.quit();
          return;
        }
      }
      if (process.env.HAMSTER_SCREENSHOT_PATH) {
        if (process.env.HAMSTER_README_DEMO === '1') {
          await mainWindow.webContents.executeJavaScript(`(() => {
            const intakePath = document.querySelector('#intake-directory');
            if (intakePath) intakePath.value = 'D:\\\\HamsterArchiver\\\\incoming';
            for (const row of document.querySelectorAll('#task-list tr')) {
              const name = row.querySelector('.task-name strong')?.textContent || 'project';
              const sourcePath = row.querySelector('.task-name small');
            if (sourcePath) sourcePath.textContent = 'D:\\\\HamsterArchiver\\\\incoming\\\\' + name;
            }
          })()`);
        }
        if (process.env.HAMSTER_SMOKE_ADVANCED === '1') {
          await mainWindow.webContents.executeJavaScript(`
            const advanced = document.querySelector('details.advanced');
            if (advanced) {
              advanced.open = true;
              advanced.scrollIntoView({ block: 'start' });
            }
            if (${process.env.HAMSTER_README_DEMO === '1'}) {
              const userDataPath = document.querySelector('#user-data-path');
            if (userDataPath) userDataPath.value = 'D:\\\\HamsterArchiver\\\\userdata';
            }
          `);
        }
        if (process.env.HAMSTER_SCREENSHOT_TOP === '1') {
          await mainWindow.webContents.executeJavaScript(`
            document.querySelectorAll('dialog[open]').forEach((dialogElement) => dialogElement.close());
            window.scrollTo(0, 0);
          `);
        }
        if (process.env.HAMSTER_SMOKE_SCREENSHOT_SELECTOR) {
          await mainWindow.webContents.executeJavaScript(`(() => {
            const target = document.querySelector(${JSON.stringify(process.env.HAMSTER_SMOKE_SCREENSHOT_SELECTOR)});
            if (!target) return;
            document.documentElement.style.scrollBehavior = 'auto';
            window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - 18));
          })()`);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        const image = await mainWindow.webContents.capturePage();
        await fs.mkdir(path.dirname(process.env.HAMSTER_SCREENSHOT_PATH), { recursive: true });
        await fs.writeFile(process.env.HAMSTER_SCREENSHOT_PATH, image.toPNG());
      }
      await writeSmokeResult(true, 'complete', { bridgeStatus, ipcStatus, uiStatus });
      console.log(`HAMSTER_SMOKE_TEST_OK ${JSON.stringify({ bridgeStatus, ipcStatus, uiStatus })}`);
      app.quit();
    });
  }
}

function registerIpc() {
  const waitForCatalog = () => queueManager.waitForCatalogReady();
  ipcMain.handle('state:get', (event) => {
    assertTrustedSender(event);
    return queueManager.getState();
  });

  ipcMain.handle('dialog:choose-directory', async (event, initialPath) => {
    assertTrustedSender(event);
    const english = usesEnglishUi();
    const configuredPath = String(initialPath || '').trim();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: english ? 'Choose a folder' : '选择文件夹',
      ...(configuredPath ? { defaultPath: path.resolve(configuredPath) } : {}),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:choose-program', async (event, initialPath) => {
    assertTrustedSender(event);
    const english = queueManager?.config?.language === 'en-US';
    const configuredPath = String(initialPath || '').trim();
    const resolvedPath = configuredPath ? resolveApplicationPath(applicationRoot, configuredPath) : '';
    const defaultPath = resolvedPath && path.extname(resolvedPath)
      ? resolvedPath
      : (resolvedPath || undefined);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: english ? 'Choose the 7-Zip program' : '选择 7-Zip 程序',
      ...(defaultPath ? { defaultPath: path.resolve(defaultPath) } : {}),
      properties: ['openFile'],
      filters: [{ name: english ? '7-Zip program' : '7-Zip 程序', extensions: ['exe'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('warehouse:change-location', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const english = queueManager?.config?.language === 'en-US';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: english ? 'Choose a Warehouse folder' : '选择仓库位置',
      defaultPath: queueManager.config.repositoryDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    return runLoggedAction('切换仓库位置', () => queueManager.changeWarehouseDirectory(result.filePaths[0]));
  });

  ipcMain.handle('warehouse:open', async (event) => {
    assertTrustedSender(event);
    await fs.mkdir(queueManager.config.repositoryDirectory, { recursive: true });
    const message = await shell.openPath(queueManager.config.repositoryDirectory);
    if (message) throw new Error(`无法打开仓库：${message}`);
    return true;
  });

  ipcMain.handle('warehouse:export', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const english = queueManager?.config?.language === 'en-US';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultPath = path.join(
      queueManager.config.repositoryDirectory,
      `hamster-warehouse-export-${stamp}.zip`
    );
    const result = await dialog.showSaveDialog(mainWindow, {
      title: english ? 'Export Warehouse as an archive' : '导出仓库为压缩包',
      defaultPath,
      filters: [{ name: english ? 'Warehouse archive' : '仓库压缩包', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return runLoggedAction('导出仓库', () => queueManager.exportWarehouseToFile(result.filePath));
  });

  ipcMain.handle('warehouse:import', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const english = queueManager?.config?.language === 'en-US';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: english ? 'Choose an external Warehouse archive' : '选择外来仓库压缩包',
      defaultPath: queueManager.config.repositoryDirectory,
      properties: ['openFile'],
      filters: [{ name: english ? 'Warehouse archive' : '仓库压缩包', extensions: ['zip'] }]
    });
    if (result.canceled) return null;
    return runLoggedAction('并入外部仓库', () => queueManager.importWarehouseFromArchiveOrDirectory(result.filePaths[0]));
  });

  let checkedUpdate = null;
  let updateInstallInFlight = false;
  ipcMain.handle('app:log-toast', async (event, message, level = 'info') => {
    assertTrustedSender(event);
    const normalizedMessage = String(message || '').trim().slice(0, 2_000);
    if (!normalizedMessage) return false;
    await queueManager.log(level === 'error' ? 'error' : 'info', `界面提示：${normalizedMessage}`);
    return true;
  });
  ipcMain.handle('app:check-for-updates', async (event, options = {}) => {
    assertTrustedSender(event);
    const check = () => checkForUpdates({
      currentVersion: app.getVersion(),
      distributionMode: isInstalledDistribution ? 'installed' : 'portable',
      includeHistory: options?.silent !== true,
      stableBranch: 'main',
      fetchImpl: net.fetch,
      timeoutMs: options?.silent === true ? 6_000 : 8_000
    });
    const result = options?.silent === true
      ? await check()
      : await runLoggedAction('检查更新', check);
    if (options?.silent !== true) checkedUpdate = result;
    if (options?.silent !== true) {
      await queueManager.log('info', result.updateAvailable
        ? `检查更新完成：发现版本 ${result.latestVersion}。`
        : `检查更新完成：当前已是最新版本 ${result.currentVersion}。`);
    }
    return result;
  });

  ipcMain.handle('app:install-checked-update', async (event, version) => {
    assertTrustedSender(event);
    const english = queueManager?.config?.language === 'en-US';
    const result = checkedUpdate;
    if (updateInstallInFlight || !result?.updateAvailable || !result.installable || result.latestVersion !== version) {
      throw new Error(english ? 'Please check for updates again.' : '请重新检查更新。');
    }
    if (queueManager.running) {
      throw new Error(english
        ? 'Updates are unavailable while the archive queue is running. Pause or finish the current task first.'
        : '归档任务运行期间不能更新，请先暂停或完成当前任务。');
    }
    updateInstallInFlight = true;
    try {
      const prepared = await (isInstalledDistribution ? prepareInstalledUpdate : prepareUpdate)({
        applicationRoot,
        userDataDirectory: queueManager.config.userDataDirectory,
        sevenZipPath: resolveApplicationPath(applicationRoot, queueManager.config.sevenZipPath),
        currentVersion: result.currentVersion,
        release: result,
        fetchImpl: net.fetch,
        onProgress: (progress) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', progress);
        }
      });
      const updateState = await (isInstalledDistribution ? promptAndLaunchPreparedInstaller : promptAndLaunchPreparedUpdate)({
        prepared, version: result.latestVersion, releaseUrl: result.releaseUrl
      });
      return { ...result, ...updateState };
    } catch (error) {
      await appendRuntimeLog('error', `准备版本 ${version} 更新失败：${error.message}`).catch(() => {});
      throw error;
    } finally {
      updateInstallInFlight = false;
    }
  });

  ipcMain.handle('app:update-from-package', async (event) => {
    assertTrustedSender(event);
    if (updateInstallInFlight) throw new Error(queueManager?.config?.language === 'en-US' ? 'Please check for updates again.' : '请重新检查更新。');
    updateInstallInFlight = true;
    try {
      return await runLocalPackageUpdate(checkedUpdate);
    } catch (error) {
      await appendRuntimeLog('error', `准备本地更新包失败：${error.message}`).catch(() => {});
      throw error;
    } finally {
      updateInstallInFlight = false;
    }
  });

  ipcMain.handle('user-data:change-location', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const english = queueManager?.config?.language === 'en-US';
    if (queueManager.running) {
      throw new Error(english
        ? 'The user data area cannot be changed while the queue is running.'
        : '队列运行期间不能修改用户数据区。');
    }
    const currentRoot = path.resolve(queueManager.config.userDataDirectory);
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: english ? 'Choose user data area' : '选择用户数据区',
      defaultPath: currentRoot,
      properties: ['openDirectory', 'createDirectory']
    });
    if (selected.canceled) return null;
    const targetRoot = path.resolve(selected.filePaths[0]);
    if (normalizeForComparison(targetRoot) === normalizeForComparison(currentRoot)) {
      return { path: currentRoot, mode: 'current', restarting: false };
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: english ? 'Change user data area' : '切换用户数据区',
      message: english
        ? 'The app must restart to use the new user data area.'
        : '应用需要重启后才能切换用户数据区。',
      detail: english
        ? [
            `Current location: ${currentRoot}`,
            `New location: ${targetRoot}`,
            '',
            'If the new location is empty, settings, the warehouse database, thumbnails, logs and processed files are copied there. The old directory is retained.',
            'If the new location already contains Hamster Archiver user data, that data is used as-is and is not merged with the current warehouse.'
          ].join('\n')
        : [
            `当前位置：${currentRoot}`,
            `新位置：${targetRoot}`,
            '',
            '如果新位置是空目录，设置、仓库数据库、缩略图、日志和已处理文件会复制过去；旧目录不会删除。',
            '如果新位置已经包含 Hamster Archiver 用户数据，将直接使用其中的数据，不会与当前仓库合并。'
          ].join('\n'),
      buttons: english ? ['Copy or switch and restart', 'Cancel'] : ['复制或切换并重启', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return null;
    await queueManager.log('warning', `开始切换用户数据区：${currentRoot} → ${targetRoot}。`);
    try {
      await appStore.saveSettings(queueManager.config);
      await appStore.checkpoint(queueManager.config.repositoryDirectory);
      appStore.closeAll();
      const prepared = await prepareUserDataTarget(currentRoot, targetRoot);
      await fs.mkdir(path.dirname(activeUserDataLocationPath), { recursive: true });
      await writeJsonAtomic(activeUserDataLocationPath, {
        version: 1,
        userDataDirectory: prepared.target,
        savedAt: new Date().toISOString()
      });
      const migrationMode = prepared.mode === 'copied'
        ? '复制当前数据'
        : prepared.mode === 'existing'
          ? '切换到已有数据'
          : '保持当前位置';
      const targetStore = new AppStore(makeUserDataLayout(applicationRoot, null, prepared.target));
      await targetStore.appendLog('', {
        at: new Date().toISOString(),
        level: 'warning',
        message: `用户数据区切换完成：${currentRoot} → ${prepared.target}；方式：${migrationMode}。`,
        jobId: null
      }).catch(async (error) => {
        await queueManager.log('error', `用户数据区已切换，但新位置的运行日志写入失败：${error.message}`);
      });
      await targetStore.flushLogs();
      app.relaunch();
      allowWindowClose = true;
      app.quit();
      return { path: prepared.target, mode: prepared.mode, restarting: true };
    } catch (error) {
      await queueManager.log('error', `切换用户数据区失败：${error.message}`).catch(() => {});
      throw error;
    }
  });

  ipcMain.handle('integrations:status', async (event) => {
    assertTrustedSender(event);
    return integrationManager.status();
  });

  ipcMain.handle('integrations:install', async (event, adapterId, options = {}) => {
    assertTrustedSender(event);
    return runLoggedAction('启用 AI 助手接入', async () => {
      const result = await integrationManager.install(String(adapterId || ''), options || {});
      await queueManager.log('info', `已启用实验接入：${adapterId}。`);
      return result;
    });
  });

  ipcMain.handle('integrations:uninstall', async (event, adapterId) => {
    assertTrustedSender(event);
    return runLoggedAction('关闭 AI 助手接入', async () => {
      const result = await integrationManager.uninstall(String(adapterId || ''));
      await queueManager.log('info', `已关闭实验接入：${adapterId}；仓库和用户资料未更改。`);
      return result;
    });
  });

  ipcMain.handle('integrations:repair', async (event, adapterId, options = {}) => {
    assertTrustedSender(event);
    return runLoggedAction('修复 AI 助手接入', async () => {
      const result = await integrationManager.repair(String(adapterId || ''), options || {});
      await queueManager.log('info', `已修复实验接入：${adapterId}。`);
      return result;
    });
  });

  ipcMain.handle('similarity:open-ignore-terms', async (event) => {
    assertTrustedSender(event);
    const filePath = await queueManager.ensureSimilarityIgnoreTermsFile();
    const message = await shell.openPath(filePath);
    if (message) throw new Error(`无法打开相似度排除词表：${message}`);
    return { path: filePath, count: queueManager.similarityIgnoreTerms.length };
  });

  ipcMain.handle('similarity:reload-ignore-terms', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('重新载入相似度排除词', () => queueManager.reloadSimilarityIgnoreTerms());
  });

  ipcMain.handle('similarity:add-ignore-term', async (event, term) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('新增相似度排除词', () => queueManager.addSimilarityIgnoreTerm(term));
  });

  ipcMain.handle('similarity:rebuild-all', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('全局重算相似关系', () => queueManager.recalculateAllSimilarity());
  });

  ipcMain.handle('system:open-external', async (event, value) => {
    assertTrustedSender(event);
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开 HTTP 或 HTTPS 链接。');
    await shell.openExternal(url.href);
    return true;
  });

  ipcMain.handle('system:copy-text', (event, value) => {
    assertTrustedSender(event);
    const content = String(value || '');
    if (content.length > 10_000) throw new Error('复制内容过长。');
    clipboard.writeText(content);
    return true;
  });

  ipcMain.handle('dialog:choose-single', async (event, kind) => {
    assertTrustedSender(event);
    const english = queueManager?.config?.language === 'en-US';
    const options = kind === 'video'
      ? {
          title: english ? 'Choose a video' : '选择视频',
          properties: ['openFile'],
          filters: [{
            name: english ? 'Video files' : '视频文件',
            extensions: ['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'rm', 'rmvb', 'ts', 'vob', 'webm', 'wmv']
          }]
        }
      : {
          title: english ? 'Choose a folder' : '选择文件夹',
          properties: ['openDirectory']
        };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('config:save', async (event, config) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('保存设置', () => queueManager.updateConfig(config));
  });

  ipcMain.handle('source:scan', async (event, intakeDirectory, scanToken) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('扫描待处理目录', () => queueManager.scanSource(intakeDirectory, scanToken));
  });

  ipcMain.handle('task:add-single', async (event, sourcePath) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.addSingle(sourcePath);
  });

  ipcMain.handle('task:open-source', async (event, jobId) => {
    assertTrustedSender(event);
    const job = queueManager.jobs.find((candidate) => candidate.id === jobId);
    if (!job?.sourcePath) throw new Error('这个任务没有可打开的原文件位置。');
    await openItemLocation(job.sourcePath, '任务位置');
    return true;
  });

  ipcMain.handle('task:similarity-report', async (event, jobId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getQueueSimilarityReport(jobId);
  });

  ipcMain.handle('task:source-change-report', async (event, jobId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getSourceChangeReport(jobId);
  });

  ipcMain.handle('task:resolve-source-change', async (event, jobId, action) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.resolveSourceChange(jobId, action);
  });

  ipcMain.handle('task:confirm', async (event, jobId, options) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.confirmJob(jobId, { updateBackupLocation: options?.updateBackupLocation });
  });

  ipcMain.handle('task:confirm-anomaly', async (event, jobId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.confirmAnomaly(jobId);
  });
  ipcMain.handle('task:discard-anomaly', async (event, jobId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.discardAnomalousArchive(jobId);
  });

  ipcMain.handle('task:acknowledge-trash-safety', async (event, jobId) => {
    assertTrustedSender(event);
    return queueManager.acknowledgeTrashSafetyHalt(jobId);
  });

  ipcMain.handle('task:cancel', async (event, jobId) => {
    assertTrustedSender(event);
    return queueManager.cancelJob(jobId);
  });

  ipcMain.handle('task:retry', async (event, jobId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.retryJob(jobId);
  });

  ipcMain.handle('queue:start', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    if (!await ensureArchiveOutputDirectoryBeforeStart()) return queueManager.getState();
    return queueManager.startArchiveQueue();
  });

  ipcMain.handle('queue:start-inventory-only', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.startInventoryOnlyQueue();
  });

  ipcMain.handle('queue:pause', async (event) => {
    assertTrustedSender(event);
    return queueManager.pauseCurrent();
  });

  ipcMain.handle('queue:resume', async (event) => {
    assertTrustedSender(event);
    return queueManager.resumeCurrent();
  });

  ipcMain.handle('queue:remove-jobs', async (event, jobIds) => {
    assertTrustedSender(event);
    return queueManager.removeJobs(jobIds);
  });

  ipcMain.handle('queue:clear', async (event) => {
    assertTrustedSender(event);
    return queueManager.clearQueue();
  });

  ipcMain.handle('queue:clear-completed', async (event) => {
    assertTrustedSender(event);
    return queueManager.clearCompletedJobs();
  });
  ipcMain.handle('queue:clear-cancelled', async (event) => {
    assertTrustedSender(event);
    return queueManager.clearCancelledJobs();
  });

  ipcMain.handle('queue:clear-duplicates', async (event) => {
    assertTrustedSender(event);
    return queueManager.removePotentialDuplicateJobs();
  });
  ipcMain.handle('queue:clear-exact-duplicates', async (event) => {
    assertTrustedSender(event);
    return queueManager.removeExactDuplicateJobs();
  });
  ipcMain.handle('queue:confirm-all-duplicates', async (event) => {
    assertTrustedSender(event);
    return queueManager.confirmAllDuplicateJobs();
  });

  ipcMain.handle('queue:finish-next', (event) => {
    assertTrustedSender(event);
    void queueManager.finishNextAndPause();
    return queueManager.getState();
  });

  ipcMain.handle('catalog:search', async (event, query) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.searchCatalog(query);
  });
  ipcMain.handle('catalog:suggestions', async (event, query) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getCatalogSuggestions(query);
  });

  ipcMain.handle('catalog:insights', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getWarehouseInsights();
  });

  ipcMain.handle('catalog:random', async (event, excludeId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getRandomCatalogRecord(excludeId);
  });

  ipcMain.handle('catalog:details', async (event, recordId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.getCatalogDetails(recordId);
  });

  ipcMain.handle('catalog:open-source', async (event, recordId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const record = queueManager.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    const originalPath = String(record.originalSourcePath || '').trim();
    if (record.sourceDisposition === 'trashed') {
      if (!originalPath) throw new Error('没有记录原文件位置，无法从回收站复原。');
      return { status: 'trashed', path: originalPath };
    }
    const currentPath = record.sourceDisposition === 'moved'
      ? String(record.movedTo || '').trim()
      : originalPath;
    if (!currentPath) throw new Error('没有记录可打开的原文件当前位置。');
    const openedPath = await openItemLocation(currentPath, '原文件位置');
    return { status: 'opened', path: openedPath };
  });

  ipcMain.handle('catalog:restore-source', async (event, recordId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const result = await runLoggedAction('复原原文件', () => queueManager.restoreCatalogSource(recordId));
    await openItemLocation(result.path, '复原后的原文件位置');
    return result;
  });

  ipcMain.handle('catalog:update-metadata', async (event, recordId, metadata) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.updateCatalogMetadata(recordId, metadata);
  });

  ipcMain.handle('catalog:update-source-path', async (event, recordId, sourcePath, sourceType) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.updateCatalogSourcePath(recordId, sourcePath, sourceType);
  });

  ipcMain.handle('catalog:recalculate-similarity', async (event, recordId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.recalculateCatalogSimilarity(recordId);
  });

  ipcMain.handle('catalog:remove-similarity', async (event, recordId, similarId) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.removeCatalogSimilarity(recordId, similarId);
  });

  ipcMain.handle('catalog:set-cover', async (event, recordId, relativePath) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.setCatalogCover(recordId, relativePath);
  });

  ipcMain.handle('catalog:delete-thumbnail', async (event, recordId, thumbnailRef) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.deleteCatalogThumbnail(recordId, thumbnailRef);
  });

  ipcMain.handle('catalog:add-manual', async (event, input) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.addManualCatalogRecord(input);
  });

  ipcMain.handle('catalog:add-image', async (event, recordId, input) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.addCatalogImage(recordId, input);
  });

  ipcMain.handle('catalog:add-tags', async (event, recordIds, tags) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.addTagsToCatalogRecords(recordIds, tags);
  });

  ipcMain.handle('catalog:update-backup-location', async (event, recordIds, location) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.updateBackupLocationForCatalogRecords(recordIds, location);
  });

  ipcMain.handle('catalog:queue-compression', async (event, recordIds, options) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.queueCatalogRecordsForCompression(recordIds, options);
  });

  ipcMain.handle('catalog:queue-refresh', async (event, recordIds) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.queueCatalogRecordsForRefresh(recordIds);
  });


  ipcMain.handle('catalog:undo', async (event) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return runLoggedAction('撤回仓库操作', () => queueManager.undoCatalogAction());
  });

  ipcMain.handle('catalog:delete', async (event, recordIds, options) => {
    assertTrustedSender(event);
    await waitForCatalog();
    return queueManager.deleteCatalogRecords(recordIds, options);
  });

  ipcMain.handle('catalog:thumbnail', async (event, recordId, relativePath) => {
    assertTrustedSender(event);
    await waitForCatalog();
    const thumbnailPath = queueManager.getThumbnailPath(recordId, relativePath);
    if (!thumbnailPath) return null;
    const data = await fs.readFile(thumbnailPath);
    const mimeType = /\.jpe?g$/i.test(thumbnailPath) ? 'image/jpeg'
      : /\.webp$/i.test(thumbnailPath) ? 'image/webp'
        : 'image/png';
    return `data:${mimeType};base64,${data.toString('base64')}`;
  });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  const workspaceRoot = applicationRoot;
  logStartupTiming('electron-ready');
  const startupMcpArgs = startupDesktopMcpRequest
    ? ['--enable-mcp', '--background', `--mcp-ready-file=${startupDesktopMcpRequest.readyFile}`, `--mcp-diagnostic-file=${startupDesktopMcpRequest.diagnosticFile}`, ...(startupDesktopMcpRequest.showUi ? ['--show-ui'] : [])]
    : process.argv;
  const mcpRequested = !isSmokeTest && (startupMcpArgs.includes('--enable-mcp') || process.env.HAMSTER_MCP_ENABLED === '1');
  startedAsMcpBackground = mcpRequested && startupMcpArgs.includes('--background') && !startupMcpArgs.includes('--show-ui');
  if (app.isPackaged && !isSmokeTest) {
    if (!startedAsMcpBackground) await createStartupWindow();
    updateStartupWindow('verify-cache');
    const integrityResult = await verifyReleaseManifestAtStartup({
      applicationRoot: workspaceRoot,
      cachePath: path.join(configuredUserDataRoot, 'cache', 'release-integrity-v1.json'),
      onProgress: ({ processedBytes, totalBytes }) => {
        const percentage = totalBytes > 0 ? Math.round((processedBytes / totalBytes) * 100) : 100;
        updateStartupWindow('verify-files', '', percentage);
      },
      forceFullVerification: process.argv.includes('--verify-integrity')
    });
    logStartupTiming('integrity-ready', { cacheHit: integrityResult.cacheHit });
    if (!integrityResult.cacheWritten && integrityResult.cacheWriteError) {
      console.warn(`STARTUP_INTEGRITY_CACHE_WARNING ${integrityResult.cacheWriteError.message}`);
    }
    updateStartupWindow('load-data');
  }
  const userDataLayout = makeUserDataLayout(workspaceRoot, null, configuredUserDataRoot);
  const store = new AppStore(userDataLayout);
  appStore = store;
  const defaultConfig = makeDefaultConfig(workspaceRoot, userDataLayout);
  defaultConfig.language = defaultInterfaceLanguage();
  const config = rebasePortableUserDataPaths(
    await store.loadSettings(defaultConfig),
    userDataLayout
  );
  delete config.ffprobePath;
  config.sevenZipPath = normalizePortableProgramPath(config.sevenZipPath, workspaceRoot, PORTABLE_SEVEN_ZIP_PATH);
  config.ffmpegPath = normalizePortableProgramPath(config.ffmpegPath, workspaceRoot, PORTABLE_FFMPEG_PATH);
  if (!(await pathExists(resolveApplicationPath(workspaceRoot, config.sevenZipPath)))) {
    config.sevenZipPath = PORTABLE_SEVEN_ZIP_PATH;
  }
  if (!(await pathExists(resolveApplicationPath(workspaceRoot, config.ffmpegPath)))) {
    config.ffmpegPath = PORTABLE_FFMPEG_PATH;
  }
  if (process.env.HAMSTER_SMOKE_LIBRARY_DIR) {
    config.archiveOutputDirectory = process.env.HAMSTER_SMOKE_LIBRARY_DIR;
    config.repositoryDirectory = process.env.HAMSTER_SMOKE_WAREHOUSE_DIR || path.join(process.env.HAMSTER_SMOKE_LIBRARY_DIR, 'saves');
  }
  if (isSmokeTest && ['trash', 'move', 'keep'].includes(process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION)) {
    config.autoTrashCompleted = process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION === 'trash';
    config.moveCompleted = process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION === 'move';
  }
  if (!config.archiveStagingDirectory) {
    config.archiveStagingDirectory = makeArchiveStagingDirectory(config.archiveOutputDirectory);
  }
  for (const directory of [config.repositoryDirectory].filter(Boolean)) {
    await fs.mkdir(directory, { recursive: true });
  }
  await store.saveSettings(config);
  queueManager = new QueueManager(store, config, {
    createThumbnails,
    storeCatalogImage,
    trashItem: (targetPath) => shell.trashItem(targetPath),
    findTrashItems,
    isTrashItemPresent,
    restoreTrashItem,
    resolveProgramPath: (configuredPath) => resolveApplicationPath(workspaceRoot, configuredPath)
  });
  const deferCatalog = !isSmokeTest && !isStartupIntegrityTest && !startedAsMcpBackground;
  await queueManager.initialize({ deferCatalog });
  await queueManager.log('info', `应用已启动：版本 ${app.getVersion()}。`, null, false);
  logStartupTiming(deferCatalog ? 'startup-data-ready' : 'warehouse-ready');
  const pendingUpdateSuccess = await readUpdateSuccessNotice({
    userDataDirectory: userDataLayout.root,
    noticeFile: process.env.HAMSTER_UPDATE_NOTICE_FILE,
    currentVersion: app.getVersion()
  }).catch((error) => {
    console.warn(`UPDATE_SUCCESS_READ_WARNING ${error.message}`);
    return null;
  });
  const pendingUpdateFailure = await consumeUpdateFailure(userDataLayout.root).catch((error) => {
    console.warn(`UPDATE_FAILURE_READ_WARNING ${error.message}`);
    return null;
  });
  if (isSmokeTest && process.env.HAMSTER_SMOKE_IMPORT_DIRECTORY) {
    const importDirectory = path.resolve(process.env.HAMSTER_SMOKE_IMPORT_DIRECTORY);
    const smokeToolRoot = process.env.HAMSTER_SMOKE_TOOL_ROOT
      ? path.resolve(process.env.HAMSTER_SMOKE_TOOL_ROOT)
      : null;
    if (!process.env.HAMSTER_SMOKE_LIBRARY_DIR) {
      throw new Error('真实项目入库验收必须指定隔离的成品目录。');
    }
    await queueManager.updateConfig({
      intakeDirectory: importDirectory,
      archiveOutputDirectory: path.resolve(process.env.HAMSTER_SMOKE_LIBRARY_DIR),
      ...(smokeToolRoot ? {
        sevenZipPath: path.join(smokeToolRoot, PORTABLE_SEVEN_ZIP_PATH),
        ffmpegPath: path.join(smokeToolRoot, PORTABLE_FFMPEG_PATH)
      } : {}),
      archivePassword: '',
      archiveNamingMode: 'original',
      videoFrameBackup: true,
      videoFrameCount: 6,
      thumbnailLimit: 100,
      smallItemFilter: false,
      minimumTaskBytes: 0,
      scheduleEnabled: false,
      moveCompleted: false,
      autoTrashCompleted: false,
      recordBackupLocation: false,
      backupLocation: ''
    });
    await queueManager.scanSource(importDirectory);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await queueManager.confirmAllDuplicateJobs();
      await queueManager.startArchiveQueue();
      if (queueManager.running) await new Promise((resolve) => queueManager.once('idle', resolve));
      const pendingDuplicate = queueManager.jobs.some((job) => [
        'awaiting_confirmation', 'awaiting_duplicate_confirmation'
      ].includes(job.status));
      if (!pendingDuplicate) break;
    }
    for (const job of queueManager.jobs.filter((candidate) => candidate.status === 'awaiting_anomaly_confirmation')) {
      await queueManager.confirmAnomaly(job.id);
    }
    const incomplete = queueManager.jobs.filter((job) => !String(job.status).startsWith('completed'));
    if (incomplete.length > 0 || queueManager.catalog.length === 0) {
      throw new Error(`真实项目入库验收未完成：${incomplete.map((job) => `${job.displayName}:${job.status}`).join('，')}`);
    }
    console.log(`HAMSTER_IMPORT_TEST_OK ${JSON.stringify({ jobs: queueManager.jobs.length, catalog: queueManager.catalog.length })}`);
  }
  scheduleTimer = setInterval(() => {
    void queueManager.handleScheduleTick().catch((error) => {
      console.error('SCHEDULE_ERROR', error);
      void queueManager.log('error', `定时运行检查失败：${error.message}`);
    });
  }, 15_000);
  scheduleTimer.unref?.();
  if (process.env.HAMSTER_TRASH_TEST_DIR) {
    const trashTestDir = path.resolve(process.env.HAMSTER_TRASH_TEST_DIR);
    if (!path.basename(trashTestDir).startsWith('hamster-trash-smoke-')) {
      throw new Error('回收站测试目录名称不符合安全规则。');
    }
    await fs.mkdir(trashTestDir, { recursive: false });
    await fs.writeFile(path.join(trashTestDir, 'temporary-test-file.txt'), 'temporary recycle bin test', 'utf8');
    await shell.trashItem(trashTestDir);
    try {
      await fs.access(trashTestDir);
      throw new Error('回收站测试失败：临时目录仍然存在。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (process.env.HAMSTER_RESTORE_TEST === '1') {
      if (!(await isTrashItemPresent(trashTestDir))) throw new Error('回收站复原测试失败：没有找到刚移入回收站的目录。');
      const batchTrashMatches = await findTrashItems([trashTestDir]);
      if (!batchTrashMatches.some((item) => path.resolve(item).toLowerCase() === trashTestDir.toLowerCase())) {
        throw new Error('回收站批量核验测试失败：没有找到刚移入回收站的目录。');
      }
      if (!(await restoreTrashItem(trashTestDir))) throw new Error('回收站复原测试失败：系统未执行复原。');
      await fs.access(path.join(trashTestDir, 'temporary-test-file.txt'));
      await fs.rm(trashTestDir, { recursive: true, force: true });
      console.log('HAMSTER_RESTORE_TEST_OK');
    }
    console.log('HAMSTER_TRASH_TEST_OK');
  }
  if (process.env.HAMSTER_SMOKE_FIXTURE_IMAGE) {
    const fixtureImages = String(process.env.HAMSTER_SMOKE_FIXTURE_IMAGES || process.env.HAMSTER_SMOKE_FIXTURE_IMAGE)
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
    const fixtureImage = fixtureImages[0];
    const fixtureJob = {
      id: 'smoke-fixture',
      sourcePath: path.dirname(fixtureImage),
      sourceType: 'directory'
    };
    const fixtureEntries = [];
    for (let index = 0; index < fixtureImages.length; index += 1) {
      const currentPath = fixtureImages[index];
      const imageStats = await fs.stat(currentPath);
      fixtureEntries.push({
        relativePath: path.basename(currentPath),
        name: path.basename(currentPath),
        extension: path.extname(currentPath).toLowerCase(),
        size: imageStats.size,
        md5: `fixture-image-md5-${index}`
      });
    }
    const fixtureManifest = await createThumbnails(fixtureJob, fixtureEntries, config);
    fixtureManifest.push({
      relativePath: '相册/子目录/示例视频.mp4',
      name: '示例视频.mp4',
      extension: '.mp4',
      size: 734003200,
      md5: 'fixture-video-md5',
      mediaType: 'video'
    });
    queueManager.catalog = [{
      id: 'smoke-record',
      jobId: 'smoke-job',
      sourcePath: 'E:\\示例来源\\旅行相册',
      displayName: '旅行相册（界面测试）',
      title: '北海道冬季旅行',
      tags: ['摄影', '旅行'],
      rating: 5,
      notes: '用于验证仓库整理信息、标签和星级显示。',
      backupLocation: '百度网盘',
      coverRelativePath: null,
      sourceType: 'directory',
      recordType: 'archive',
      fileCount: fixtureManifest.length,
      originalBytes: fixtureManifest.reduce((sum, file) => sum + file.size, 0),
      archiveBaseName: 'arc_20260815T010000Z_smoketest.7z',
      archiveDirectory: config.archiveOutputDirectory,
      archiveFiles: [{ name: 'arc_20260815T010000Z_smoketest.7z', size: 700000000 }],
      archiveTotalBytes: 700000000,
      manifest: fixtureManifest,
      directories: ['相册', '相册/子目录', '空目录'],
      passwordScheme: 'fixed-v1',
      sourceDisposition: 'kept',
      verifiedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      inventoryDate: new Date().toISOString()
    }];
    const reviewInventoryDate = new Date();
    reviewInventoryDate.setFullYear(reviewInventoryDate.getFullYear() - 1);
    queueManager.catalog.push({
      ...queueManager.catalog[0],
      id: 'smoke-review-record',
      jobId: 'smoke-review-job',
      title: '去年今日的旅行记忆',
      displayName: '去年今日的旅行记忆',
      archiveDirectory: config.archiveOutputDirectory,
      archiveBaseName: 'arc_smoke_review.7z',
      archiveFiles: [{ name: 'arc_smoke_review.7z', size: 700000000 }],
      manifest: fixtureManifest.map((file) => ({ ...file })),
      completedAt: reviewInventoryDate.toISOString(),
      inventoryDate: reviewInventoryDate.toISOString()
    });
    const requestedCatalogCount = Math.max(2, Number(process.env.HAMSTER_SMOKE_CATALOG_COUNT) || 2);
    for (let index = 2; index < requestedCatalogCount; index += 1) {
      queueManager.catalog.unshift({
        ...queueManager.catalog[0],
        id: `smoke-extra-record-${index}`,
        jobId: `smoke-extra-job-${index}`,
        title: `分页测试库存 ${String(index + 1).padStart(2, '0')}`,
        displayName: `分页测试库存 ${String(index + 1).padStart(2, '0')}`,
        archiveDirectory: config.archiveOutputDirectory,
        archiveBaseName: `arc_smoke_extra_${index}.7z`,
        archiveFiles: [{ name: `arc_smoke_extra_${index}.7z`, size: 1_000_000 }],
        manifest: fixtureManifest.map((file) => ({ ...file })),
        completedAt: new Date(Date.now() - (index * 86_400_000)).toISOString(),
        inventoryDate: new Date(Date.now() - (index * 86_400_000)).toISOString()
      });
    }
  }
  if (process.env.HAMSTER_README_DEMO === '1') {
    Object.assign(queueManager.config, {
      archiveOutputDirectory: 'D:\\HamsterArchiver\\packed',
      archiveStagingDirectory: 'D:\\HamsterArchiver\\packed-staging',
      processedSourceDirectory: 'D:\\HamsterArchiver\\userdata\\processed'
    });
  }
  registerIpc();
  applicationReady = true;
  if (!startedAsMcpBackground) createWindow();
  else if (pendingWindowShow) createWindow();
  if (pendingUpdateSuccess && !isSmokeTest && !startedAsMcpBackground) {
    setImmediate(() => {
      void showUpdateSuccessDialog(pendingUpdateSuccess)
        .catch((error) => console.error(`UPDATE_SUCCESS_DIALOG_WARNING ${error.message}`))
        .finally(() => fs.rm(pendingUpdateSuccess.runRoot, { recursive: true, force: true })
          .catch((error) => console.warn(`UPDATE_SUCCESS_CLEANUP_WARNING ${error.message}`)));
    });
  }
  if (pendingUpdateFailure && !isSmokeTest && !startedAsMcpBackground) {
    setImmediate(() => {
      void showUpdateFailureDialog({
        error: pendingUpdateFailure.error,
        runRoot: pendingUpdateFailure.runRoot
      }).catch((error) => console.error(`UPDATE_FAILURE_DIALOG_WARNING ${error.message}`));
    });
  }

  lastCatalogPushSignature = catalogPushSignature(queueManager.getState().catalog);
  queueManager.on('state', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { catalog, ...queueState } = state;
      mainWindow.webContents.send('state:changed', queueState);
      const catalogSignature = catalogPushSignature(catalog);
      if (catalogSignature !== lastCatalogPushSignature) {
        lastCatalogPushSignature = catalogSignature;
        mainWindow.webContents.send('catalog:changed', catalog);
      }
    }
    updateMcpTray();
    if (mcpExitWhenIdleRequested && !queueManager.running && !hasActiveMcpWork()) {
      allowWindowClose = true;
      app.quit();
      return;
    }
    if (exitAfterMcpIdle && !queueManager.running && !hasActiveMcpWork() && mcpServer?.sessionCount === 0 && !mcpUiWasShown) {
      scheduleMcpIdleExit(60_000);
    }
  });
  queueManager.on('progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:progress', progress);
  });
  queueManager.on('scan-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', progress);
    }
  });
  queueManager.on('similarity-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('similarity:rebuild-progress', progress);
    }
  });
  queueManager.on('automation-error', (error) => {
    console.error('MCP_QUEUE_ERROR', error.message);
    void queueManager.log('error', `AI 任务处理失败：${error.message}`);
    const { getApplicationTaskService } = require('./core/application-task-service');
    void getApplicationTaskService(queueManager).recordAsyncError(error);
  });
  const { IntegrationManager } = require('./core/integration-manager');
  integrationManager = new IntegrationManager({
    applicationRoot: workspaceRoot,
    userDataRoot: userDataLayout.root,
    packagedWithIdentity: process.windowsStore === true
  });
  if (deferCatalog) {
    setImmediate(() => {
      void queueManager.initializeCatalog({ background: true })
        .then(() => logStartupTiming('warehouse-ready', { records: queueManager.catalog.length }))
        .catch((error) => {
          console.error(`WAREHOUSE_BACKGROUND_LOAD_FAILED ${error.stack || error.message}`);
          void queueManager.log('error', `仓库后台加载失败：${error.message}`);
        });
    });
  }
  setImmediate(() => {
    void (async () => {
      if (mainWindow && !mainWindow.isDestroyed()) await waitForWindowReady(mainWindow);
      await cleanupSuccessfulUpdateRuns(userDataLayout.root);
    })().catch((error) => console.warn(`UPDATE_CLEANUP_WARNING ${error.message}`));
  });
  resolveApplicationInitialized();
  if (mcpRequested) await enableMcpForArguments(startupMcpArgs);

  if (process.env.HAMSTER_UPDATE_VALIDATION_FILE) {
    await fs.writeFile(process.env.HAMSTER_UPDATE_VALIDATION_FILE, JSON.stringify({
      version: app.getVersion(),
      validatedAt: new Date().toISOString()
    }), 'utf8');
  }

  if (isStartupIntegrityTest) {
    await waitForWindowReady(mainWindow);
    console.log('HAMSTER_STARTUP_INTEGRITY_TEST_OK');
    allowWindowClose = true;
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showMainWindow();
  });
}).catch(async (error) => {
  const failedArgs = startupDesktopMcpRequest
    ? [`--mcp-diagnostic-file=${startupDesktopMcpRequest.diagnosticFile}`]
    : process.argv;
  await writeMcpStartupDiagnostic(failedArgs, error);
  await appendRuntimeLog('error', `应用启动失败：${error.message}`).catch(() => {});
  if (process.env.HAMSTER_SMOKE_TEST === '1' || startupRequestsMcp) console.error(`HAMSTER_STARTUP_FAILED ${error.stack || error.message}`);
  else if (!showStartupError(error)) {
    const english = usesEnglishUi();
    dialog.showErrorBox(
      english ? 'Application failed to start' : '程序启动失败',
      nativeText(error.message, english)
    );
  }
  if (!startupWindow || startupWindow.isDestroyed()) app.quit();
});

app.on('window-all-closed', () => {
  if (mcpTray && !allowWindowClose) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  clearMcpIdleTimer();
  if (scheduleTimer) clearInterval(scheduleTimer);
  if ((queueManager?.running || queueManager?.hasPendingCatalogOperations?.()) && !allowWindowClose) {
    event.preventDefault();
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    void Promise.all([
      queueManager.stopForShutdown(),
      queueManager.waitForCatalogOperations()
    ])
      .catch((error) => console.error(`QUEUE_SHUTDOWN_FAILED ${error.stack || error.message}`))
      .finally(() => {
        appStore?.closeAll();
        allowWindowClose = true;
        app.quit();
    });
    return;
  }
  if (mcpServer && !mcpShutdownComplete) {
    event.preventDefault();
    if (mcpShutdownInProgress) return;
    mcpShutdownInProgress = true;
    const server = mcpServer;
    void server.close()
      .catch((error) => console.warn(`MCP_SHUTDOWN_WARNING ${error.message}`))
      .finally(() => {
        if (mcpServer === server) mcpServer = null;
        mcpServerStarting = null;
        mcpShutdownComplete = true;
        mcpShutdownInProgress = false;
        app.quit();
    });
    return;
  }
  if (queueManager && !shutdownLogComplete) {
    event.preventDefault();
    if (shutdownLogInProgress) return;
    shutdownLogInProgress = true;
    void queueManager.log('info', '应用正在正常退出。', null, false)
      .then(() => queueManager.waitForLogWrites())
      .catch((error) => console.error(`APP_LOG_FLUSH_FAILED ${error.stack || error.message}`))
      .finally(() => {
        shutdownLogComplete = true;
        shutdownLogInProgress = false;
        app.quit();
      });
    return;
  }
  appStore?.closeAll();
});
