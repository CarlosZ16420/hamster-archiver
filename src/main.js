'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, shell } = require('electron');
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
  userDataLocationPath
} = require('./core/storage-paths');
const { prepareUserDataTarget } = require('./core/storage-migration');
const { IMAGE_EXTENSIONS, LARGE_TASK_BYTES, isVideoFile } = require('./core/constants');
const { extractVideoFrames } = require('./core/media-service');
const { checkForUpdates } = require('./core/update-checker');
const {
  prepareUpdate,
  launchUpdate,
  cleanupSuccessfulUpdateRuns,
  consumeUpdateFailure,
  manualUpdateInstructions
} = require('./core/update-manager');
const { findTrashItems, isTrashItemPresent, restoreTrashItem } = require('./core/recycle-bin');
const { readAndVerifyReleaseManifest } = require('./core/tool-integrity');

const appIconPath = path.join(__dirname, '..', 'assets', 'app-icon.png');
const releasesUrl = 'https://github.com/CarlosZ16420/hamster-archiver/releases';

let mainWindow;
let queueManager;
let appStore;
let allowWindowClose = false;
let closePromptOpen = false;
let scheduleTimer = null;
let lastCatalogPushSignature = '';
const isSmokeTest = process.env.HAMSTER_SMOKE_TEST === '1';
if (isSmokeTest) {
  // Electron may outlive the test runner's captured output pipe for a few milliseconds.
  // A closed diagnostic pipe must not surface as a main-process JavaScript error dialog.
  for (const stream of [process.stdout, process.stderr]) {
    stream?.on?.('error', (error) => {
      if (error?.code !== 'EPIPE') process.exitCode = 1;
    });
  }
}
const applicationRoot = isSmokeTest && process.env.HAMSTER_SMOKE_USER_DATA_DIR
  ? path.join(path.resolve(process.env.HAMSTER_SMOKE_USER_DATA_DIR), 'portable-root')
  : app.isPackaged ? path.dirname(app.getPath('exe')) : path.resolve(__dirname, '..');
const configuredUserDataRoot = resolveUserDataRoot(applicationRoot);
const electronRuntimeDirectory = isSmokeTest && process.env.HAMSTER_SMOKE_USER_DATA_DIR
  ? path.resolve(process.env.HAMSTER_SMOKE_USER_DATA_DIR)
  : path.join(configuredUserDataRoot, 'electron');
app.setPath('userData', electronRuntimeDirectory);
if (isSmokeTest) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
const hasSingleInstanceLock = isSmokeTest || app.requestSingleInstanceLock();
app.setAppUserModelId('com.carlosz.hamsterarchiver');

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

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function createThumbnails(job, manifest, config, options = {}) {
  const thumbnailDir = path.join(config.repositoryDirectory, 'thumbnails', job.id);
  await fs.mkdir(thumbnailDir, { recursive: true });
  const candidates = manifest.filter((file) => IMAGE_EXTENSIONS.has(file.extension) || isVideoFile(file.name));
  const limit = Math.max(1, Math.min(500, Number(config.thumbnailLimit) || 100));
  let outputIndex = 0;

  for (const file of candidates) {
    if (outputIndex >= limit) break;
    const sourcePath = job.sourceType === 'video'
      ? job.sourcePath
      : path.join(job.sourcePath, ...file.relativePath.split('/'));
    try {
      if (isVideoFile(file.name) && config.videoFrameBackup) {
        const frameCount = Math.min(Number(config.videoFrameCount) || 6, limit - outputIndex);
        let extracted = { frames: [], mediaInfo: null };
        try {
          extracted = await extractVideoFrames(
            sourcePath,
            thumbnailDir,
            outputIndex,
            frameCount,
            config,
            options
          );
        } catch (error) {
          if (options.signal?.aborted) throw error;
          options.onLog?.(`FFmpeg 视频抽帧失败，改用系统缩略图：${path.basename(sourcePath)} · ${error.message}`);
        }
        file.thumbnails = [];
        file.mediaInfo = extracted.mediaInfo;
        for (const frame of extracted.frames) {
          file.thumbnails.push({
            ...frame,
            videoGroup: file.relativePath
          });
          outputIndex += 1;
        }
        if (file.thumbnails.length > 0) {
          file.thumbnailPath = file.thumbnails[0].thumbnailPath;
          continue;
        }
      }
      const thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, { width: 360, height: 240 });
      if (thumbnail.isEmpty()) continue;
      const thumbnailPath = path.join(thumbnailDir, `${String(outputIndex + 1).padStart(3, '0')}.png`);
      await fs.writeFile(thumbnailPath, thumbnail.toPNG());
      file.thumbnailPath = thumbnailPath;
      file.thumbnails = [{ thumbnailPath, type: 'image', frameIndex: null }];
      outputIndex += 1;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      options.onLog?.(`已跳过无法生成预览的媒体：${path.basename(sourcePath)} · ${error.message}`);
    }
  }
  return manifest;
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
      ? `Reason: ${error || 'The updater returned no usable result.'}\n\nManual update:\n${manualUpdateInstructions('en-US')}`
      : `失败原因：${error || '更新助手没有返回可用结果。'}\n\n手动更新方法：\n${manualUpdateInstructions()}`,
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

function assertTrustedSender(event) {
  const senderUrl = event.senderFrame?.url || '';
  if (!senderUrl.startsWith('file://')) {
    throw new Error('已拒绝非本地界面的请求。');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: process.env.HAMSTER_SMOKE_TEST !== '1' || process.env.HAMSTER_SMOKE_SHOW === '1',
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: '仓鼠症大结局',
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
  });
  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', async (event) => {
    if (!queueManager?.running || allowWindowClose) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    const paused = Boolean(queueManager.paused);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '归档任务仍在运行',
      message: paused
        ? '当前任务已暂停。现在退出会取消当前任务，源文件不会被修改。'
        : '现在退出会停止整个归档队列。源文件不会被修改。',
      detail: paused
        ? '当前任务下次打开后可从“已取消”状态重试；尚未开始的任务会保留在列表中。选择“继续运行”可返回应用。'
        : '当前压缩会安全取消，尚未开始的任务会保留在列表中，下次打开可继续。若正在移动已验证成品，程序会先完成入库记录再退出。',
      buttons: ['继续运行', '停止队列并退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    closePromptOpen = false;
    if (result.response === 1) {
      await queueManager.stopForShutdown();
      allowWindowClose = true;
      mainWindow.close();
    }
  });

  if (process.env.HAMSTER_SMOKE_TEST === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      const bridgeStatus = await mainWindow.webContents.executeJavaScript(`(() => {
        const required = [
          'getState', 'chooseDirectory', 'chooseProgram', 'changeWarehouseLocation', 'openWarehouse', 'exportWarehouse', 'importWarehouse', 'checkForUpdates', 'changeUserDataLocation', 'openExternal', 'copyText', 'chooseSingle', 'saveConfig', 'scanSource',
          'addSingle', 'openTaskSource', 'getDroppedPath', 'confirmTask', 'confirmAnomaly', 'acknowledgeTrashSafety', 'cancelTask', 'retryTask', 'startQueue', 'startInventoryOnlyQueue',
    'discardAnomaly', 'pauseQueue', 'resumeQueue', 'removeJobs', 'clearCompletedJobs', 'clearCancelledJobs', 'clearQueue', 'clearPotentialDuplicates', 'clearExactDuplicates', 'confirmAllDuplicates', 'finishNextAndPause', 'searchCatalog',
          'getCatalogSuggestions', 'openSimilarityIgnoreTerms', 'reloadSimilarityIgnoreTerms',
          'getWarehouseInsights', 'getRandomCatalogRecord',
          'getCatalogDetails', 'openCatalogSource', 'restoreCatalogSource', 'updateCatalogMetadata', 'recalculateCatalogSimilarity', 'removeCatalogSimilarity', 'addManualCatalogRecord', 'addCatalogImage',
          'setCatalogCover', 'addTagsToCatalogRecords', 'updateBackupLocationForCatalogRecords', 'queueCatalogRecordsForCompression', 'undoCatalogAction', 'deleteCatalogRecords', 'getThumbnail',
          'onStateChanged', 'onTaskProgress', 'onCatalogChanged', 'onScanProgress', 'onUpdateProgress'
        ];
        return {
          exists: typeof window.archiveApp === 'object',
          missing: required.filter((name) => typeof window.archiveApp?.[name] !== 'function')
        };
      })()`);
      if (!bridgeStatus.exists || bridgeStatus.missing.length > 0) {
        console.error(`HAMSTER_BRIDGE_TEST_FAILED ${JSON.stringify(bridgeStatus)}`);
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
      const expectedSourceState = ['trash', 'move', 'keep'].includes(process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION)
        ? process.env.HAMSTER_SMOKE_SOURCE_DISPOSITION
        : 'move';
      const expectedSourceLabels = {
        trash: '归档后移入回收站',
        move: '归档后移动原文件',
        keep: '归档后不移动原文件'
      };
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
      if (!ipcStatus.hasConfig || !ipcStatus.hasJobs || !ipcStatus.hasCatalog ||
          !ipcStatus.archiveVolumeEnabled || ipcStatus.archiveVolumeBytes !== LARGE_TASK_BYTES ||
          !uiStatus.hasVolumeControls || !uiStatus.hasNoVolumeExample || !uiStatus.compressionDigest.includes('10 GB') ||
          uiStatus.sourceSafetyState !== expectedSourceState ||
          uiStatus.sourceSafetyText !== expectedSourceLabels[expectedSourceState] ||
          JSON.stringify(uiStatus.sourceDispositionStates) !== JSON.stringify([
            { state: 'trash', label: '归档后移入回收站' },
            { state: 'move', label: '归档后移动原文件' },
            { state: 'keep', label: '归档后不移动原文件' }
          ])) {
        console.error(`HAMSTER_IPC_TEST_FAILED ${JSON.stringify({ ipcStatus, uiStatus })}`);
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
          app.exitCode = 1;
          app.quit();
          return;
        }
      }
      if (process.env.HAMSTER_SMOKE_PAGE === 'library') {
        await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-page="library-page"]').click()`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const activityStatus = await mainWindow.webContents.executeJavaScript(`({
          cells: document.querySelectorAll('.activity-cell').length,
          inventory: document.querySelector('#metric-inventory')?.textContent,
          tags: document.querySelector('#metric-tags')?.textContent,
          gb: document.querySelector('#metric-gb')?.textContent
        })`);
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
            document.querySelectorAll('.warehouse-metrics > div').length === 4,
          hasInventoryDate: document.querySelector('#catalog-detail')?.innerText.includes('入库日期'),
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
        console.log(`HAMSTER_LIBRARY_TEST ${JSON.stringify({ ...libraryStatus, listViewStatus, manualDialogStatus, activityStatus, defaultRandomCount, randomWalkCount, cardLightboxStatus, detailLightboxOpen, selectedCoverPath, coverState })}`);
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
            !manualDialogStatus.open || !manualDialogStatus.nameRequired || !manualDialogStatus.notesRequired ||
            activityStatus.cells !== 112 || Number(activityStatus.inventory) < 2 ||
            defaultRandomCount !== 1 || randomWalkCount !== 1 ||
            !cardLightboxStatus.open || !cardLightboxStatus.hasImage || !cardLightboxStatus.hasCoverButton ||
            !detailLightboxOpen || !selectedCoverPath || coverState.coverThumbnailRef !== selectedCoverPath ||
            coverState.coverThumbnailPath !== selectedCoverPath ||
            listViewStatus.rows < 1 || listViewStatus.covers !== 0 || !listViewStatus.detailBelowList || !listViewStatus.detailLoaded ||
            libraryStatus.dotArtCount !== 0 || libraryStatus.thumbnailImages < 1 ||
            !libraryStatus.hasContainedDetailImage || libraryStatus.virtualTreeCanvasHeight < 1) {
          console.error('HAMSTER_LIBRARY_TEST_FAILED');
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
      console.log(`HAMSTER_SMOKE_TEST_OK ${JSON.stringify({ bridgeStatus, ipcStatus, uiStatus })}`);
      app.quit();
    });
  }
}

function registerIpc() {
  ipcMain.handle('state:get', (event) => {
    assertTrustedSender(event);
    return queueManager.getState();
  });

  ipcMain.handle('dialog:choose-directory', async (event, initialPath) => {
    assertTrustedSender(event);
    const configuredPath = String(initialPath || '').trim();
    const result = await dialog.showOpenDialog(mainWindow, {
      ...(configuredPath ? { defaultPath: path.resolve(configuredPath) } : {}),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:choose-program', async (event, initialPath) => {
    assertTrustedSender(event);
    const configuredPath = String(initialPath || '').trim();
    const resolvedPath = configuredPath ? resolveApplicationPath(applicationRoot, configuredPath) : '';
    const defaultPath = resolvedPath && path.extname(resolvedPath)
      ? resolvedPath
      : (resolvedPath || undefined);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 7-Zip 程序',
      ...(defaultPath ? { defaultPath: path.resolve(defaultPath) } : {}),
      properties: ['openFile'],
      filters: [{ name: '7-Zip 程序', extensions: ['exe'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('warehouse:change-location', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择仓库位置（saves）',
      defaultPath: queueManager.config.repositoryDirectory,
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    return queueManager.changeWarehouseDirectory(result.filePaths[0]);
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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultPath = path.join(
      queueManager.config.repositoryDirectory,
      `hamster-warehouse-export-${stamp}.zip`
    );
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出仓库为压缩包',
      defaultPath,
      filters: [{ name: '仓库压缩包', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePath) return null;
    return queueManager.exportWarehouseToFile(result.filePath);
  });

  ipcMain.handle('warehouse:import', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择外来仓库压缩包',
      defaultPath: queueManager.config.repositoryDirectory,
      properties: ['openFile'],
      filters: [{ name: '仓库压缩包', extensions: ['zip'] }]
    });
    if (result.canceled) return null;
    return queueManager.importWarehouseFromArchiveOrDirectory(result.filePaths[0]);
  });

  ipcMain.handle('app:check-for-updates', async (event, options = {}) => {
    assertTrustedSender(event);
    const result = await checkForUpdates({
      currentVersion: app.getVersion(),
      fetchImpl: net.fetch,
      timeoutMs: options?.silent === true ? 6_000 : 8_000
    });
    if (options?.silent === true) return result;
    if (!result.updateAvailable) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '检查更新',
        message: `当前已是最新版本（${result.currentVersion}）`,
        detail: result.latestVersion ? `GitHub 最新版本：${result.latestVersion}` : 'GitHub 暂无正式发行版。',
        buttons: ['知道了']
      });
      return result;
    }
    if (!result.installable) {
      const response = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '发现新版本',
        message: `可以更新到 ${result.latestVersion}`,
        detail: '当前 Release 没有可识别的 Windows 便携包，将打开 GitHub 页面供你手动下载。',
        buttons: ['打开发布页', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (response.response === 0) await shell.openExternal(result.releaseUrl);
      return result;
    }
    if (queueManager.running) throw new Error('归档任务运行期间不能更新，请先暂停或完成当前任务。');
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `可以更新到 ${result.latestVersion}`,
      detail: `当前版本：${result.currentVersion}\n更新包大小：${Math.max(1, Math.round((result.asset.size || 0) / (1024 * 1024)))} MB\n程序会自动下载、校验并重启；userdata 不会被覆盖。`,
      buttons: ['下载并重启更新', '打开发布页', '稍后'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (response.response === 1) {
      await shell.openExternal(result.releaseUrl);
      return result;
    }
    if (response.response !== 0) return result;
    const prepared = await prepareUpdate({
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
    const restart = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新包已准备好',
      message: `Hamster Archiver ${result.latestVersion} 已下载并校验完成。`,
      detail: '点击“立即重启”后，程序会退出、替换程序文件并自动启动新版本。userdata、仓库和压缩包不会被覆盖。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (restart.response !== 0) return { ...result, staged: true };
    try {
      await launchUpdate({ prepared, targetPid: process.pid });
    } catch (error) {
      console.error(`UPDATE_LAUNCH_FAILED ${error.stack || error.message}`);
      await showUpdateFailureDialog({ error: error.message, releaseUrl: result.releaseUrl, runRoot: prepared.runRoot });
      return { ...result, staged: true, launchFailed: true, error: error.message };
    }
    allowWindowClose = true;
    app.quit();
    return result;
  });

  ipcMain.handle('user-data:change-location', async (event) => {
    assertTrustedSender(event);
    if (queueManager.running) throw new Error('队列运行期间不能修改用户数据区。');
    const currentRoot = path.resolve(queueManager.config.userDataDirectory);
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择用户数据区',
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
      title: '切换用户数据区',
      message: '应用需要重启后才能切换用户数据区。',
      detail: [
        `当前位置：${currentRoot}`,
        `新位置：${targetRoot}`,
        '',
        '如果新位置是空目录，设置、仓库数据库、缩略图、日志和已处理文件会复制过去；旧目录不会删除。',
        '如果新位置已经包含 Hamster Archiver 用户数据，将直接使用其中的数据，不会与当前仓库合并。'
      ].join('\n'),
      buttons: ['复制或切换并重启', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return null;

    await appStore.saveSettings(queueManager.config);
    await appStore.checkpoint(queueManager.config.repositoryDirectory);
    appStore.closeAll();
    const prepared = await prepareUserDataTarget(currentRoot, targetRoot);
    await writeJsonAtomic(userDataLocationPath(applicationRoot), {
      version: 1,
      userDataDirectory: prepared.target,
      savedAt: new Date().toISOString()
    });
    app.relaunch();
    allowWindowClose = true;
    app.quit();
    return { path: prepared.target, mode: prepared.mode, restarting: true };
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
    return queueManager.reloadSimilarityIgnoreTerms();
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
    const options = kind === 'video'
      ? {
          properties: ['openFile'],
          filters: [{
            name: '视频文件',
            extensions: ['3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'mts', 'rm', 'rmvb', 'ts', 'vob', 'webm', 'wmv']
          }]
        }
      : { properties: ['openDirectory'] };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('config:save', async (event, config) => {
    assertTrustedSender(event);
    return queueManager.updateConfig(config);
  });

  ipcMain.handle('source:scan', async (event, intakeDirectory) => {
    assertTrustedSender(event);
    return queueManager.scanSource(intakeDirectory);
  });

  ipcMain.handle('task:add-single', async (event, sourcePath) => {
    assertTrustedSender(event);
    return queueManager.addSingle(sourcePath);
  });

  ipcMain.handle('task:open-source', async (event, jobId) => {
    assertTrustedSender(event);
    const job = queueManager.jobs.find((candidate) => candidate.id === jobId);
    if (!job?.sourcePath) throw new Error('这个任务没有可打开的原文件位置。');
    await openItemLocation(job.sourcePath, '任务位置');
    return true;
  });

  ipcMain.handle('task:confirm', async (event, jobId) => {
    assertTrustedSender(event);
    return queueManager.confirmJob(jobId);
  });

  ipcMain.handle('task:confirm-anomaly', async (event, jobId) => {
    assertTrustedSender(event);
    return queueManager.confirmAnomaly(jobId);
  });
  ipcMain.handle('task:discard-anomaly', async (event, jobId) => {
    assertTrustedSender(event);
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
    return queueManager.retryJob(jobId);
  });

  ipcMain.handle('queue:start', (event) => {
    assertTrustedSender(event);
    void queueManager.startQueue();
    return queueManager.getState();
  });

  ipcMain.handle('queue:start-inventory-only', async (event) => {
    assertTrustedSender(event);
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

  ipcMain.handle('catalog:search', (event, query) => {
    assertTrustedSender(event);
    return queueManager.searchCatalog(query);
  });
  ipcMain.handle('catalog:suggestions', (event, query) => {
    assertTrustedSender(event);
    return queueManager.getCatalogSuggestions(query);
  });

  ipcMain.handle('catalog:insights', (event) => {
    assertTrustedSender(event);
    return queueManager.getWarehouseInsights();
  });

  ipcMain.handle('catalog:random', (event, excludeId) => {
    assertTrustedSender(event);
    return queueManager.getRandomCatalogRecord(excludeId);
  });

  ipcMain.handle('catalog:details', (event, recordId) => {
    assertTrustedSender(event);
    return queueManager.getCatalogDetails(recordId);
  });

  ipcMain.handle('catalog:open-source', async (event, recordId) => {
    assertTrustedSender(event);
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
    const result = await queueManager.restoreCatalogSource(recordId);
    await openItemLocation(result.path, '复原后的原文件位置');
    return result;
  });

  ipcMain.handle('catalog:update-metadata', async (event, recordId, metadata) => {
    assertTrustedSender(event);
    return queueManager.updateCatalogMetadata(recordId, metadata);
  });

  ipcMain.handle('catalog:recalculate-similarity', async (event, recordId) => {
    assertTrustedSender(event);
    return queueManager.recalculateCatalogSimilarity(recordId);
  });

  ipcMain.handle('catalog:remove-similarity', async (event, recordId, similarId) => {
    assertTrustedSender(event);
    return queueManager.removeCatalogSimilarity(recordId, similarId);
  });

  ipcMain.handle('catalog:set-cover', async (event, recordId, relativePath) => {
    assertTrustedSender(event);
    return queueManager.setCatalogCover(recordId, relativePath);
  });

  ipcMain.handle('catalog:delete-thumbnail', async (event, recordId, thumbnailRef) => {
    assertTrustedSender(event);
    return queueManager.deleteCatalogThumbnail(recordId, thumbnailRef);
  });

  ipcMain.handle('catalog:add-manual', async (event, input) => {
    assertTrustedSender(event);
    return queueManager.addManualCatalogRecord(input);
  });

  ipcMain.handle('catalog:add-image', async (event, recordId, input) => {
    assertTrustedSender(event);
    return queueManager.addCatalogImage(recordId, input);
  });

  ipcMain.handle('catalog:add-tags', async (event, recordIds, tags) => {
    assertTrustedSender(event);
    return queueManager.addTagsToCatalogRecords(recordIds, tags);
  });

  ipcMain.handle('catalog:update-backup-location', async (event, recordIds, location) => {
    assertTrustedSender(event);
    return queueManager.updateBackupLocationForCatalogRecords(recordIds, location);
  });

  ipcMain.handle('catalog:queue-compression', async (event, recordIds) => {
    assertTrustedSender(event);
    return queueManager.queueCatalogRecordsForCompression(recordIds);
  });


  ipcMain.handle('catalog:undo', async (event) => {
    assertTrustedSender(event);
    return queueManager.undoCatalogAction();
  });

  ipcMain.handle('catalog:delete', async (event, recordIds, options) => {
    assertTrustedSender(event);
    return queueManager.deleteCatalogRecords(recordIds, options);
  });

  ipcMain.handle('catalog:thumbnail', async (event, recordId, relativePath) => {
    assertTrustedSender(event);
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
  if (app.isPackaged && !isSmokeTest) await readAndVerifyReleaseManifest(workspaceRoot);
  const userDataLayout = makeUserDataLayout(workspaceRoot, null, configuredUserDataRoot);
  const store = new AppStore(userDataLayout);
  appStore = store;
  const config = rebasePortableUserDataPaths(
    await store.loadSettings(makeDefaultConfig(workspaceRoot, userDataLayout)),
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
  await queueManager.initialize();
  const pendingUpdateFailure = await consumeUpdateFailure(userDataLayout.root).catch((error) => {
    console.warn(`UPDATE_FAILURE_READ_WARNING ${error.message}`);
    return null;
  });
  await cleanupSuccessfulUpdateRuns(userDataLayout.root).catch((error) => {
    console.warn(`UPDATE_CLEANUP_WARNING ${error.message}`);
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
      await queueManager.startQueue();
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
    void queueManager.handleScheduleTick().catch((error) => console.error('SCHEDULE_ERROR', error));
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
  createWindow();
  if (pendingUpdateFailure && !isSmokeTest) {
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
  });
  queueManager.on('progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:progress', progress);
  });
  queueManager.on('scan-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan:progress', progress);
    }
  });

  if (process.env.HAMSTER_UPDATE_VALIDATION_FILE) {
    await fs.writeFile(process.env.HAMSTER_UPDATE_VALIDATION_FILE, JSON.stringify({
      version: app.getVersion(),
      validatedAt: new Date().toISOString()
    }), 'utf8');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  if (process.env.HAMSTER_SMOKE_TEST === '1') console.error(`HAMSTER_STARTUP_FAILED ${error.stack || error.message}`);
  else dialog.showErrorBox('程序启动失败', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (scheduleTimer) clearInterval(scheduleTimer);
  appStore?.closeAll();
});
