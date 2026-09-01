'use strict';

if (!window.archiveApp) {
  document.querySelector('#desktop-required').hidden = false;
  throw new Error('桌面桥接未加载：请运行 HamsterArchiver.exe，不要直接打开网页文件。');
}

// 界面翻译：中文为源语言，英文环境在运行时替换词条；用户数据永不翻译。
const i18n = window.hamsterI18n;
const uiState = window.hamsterUiState;
const tagAutocomplete = window.hamsterTagAutocomplete;
const t = (value) => i18n?.translate(value) ?? value;
i18n?.setLocale(String(navigator.language || 'zh-CN').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN');

const SIMILARITY_STRENGTH_ORDER = ['loose', 'standard', 'strict'];
const SIMILARITY_STRENGTH_LABELS = { loose: '宽松', standard: '标准', strict: '严格' };

const elements = {
  intakeDirectory: document.querySelector('#intake-directory'),
  archiveStagingDirectory: document.querySelector('#archive-staging-directory'),
  archiveOutputDirectory: document.querySelector('#archive-output-directory'),
  moveCompleted: document.querySelector('#move-completed'),
  processedSourceDirectory: document.querySelector('#processed-source-directory'),
  processedSourceDirectoryField: document.querySelector('#processed-source-directory-field'),
  customArchiveName: document.querySelector('#custom-archive-name'),
  archiveFormat: document.querySelector('#archive-format'),
  compressionLevel: document.querySelector('#compression-level'),
  splitVolume: document.querySelector('#split-volume'),
  volumeSize: document.querySelector('#volume-size'),
  volumeUnit: document.querySelector('#volume-unit'),
  volumeSetting: document.querySelector('#volume-setting'),
  volumeHint: document.querySelector('#volume-hint'),
  autoTrash: document.querySelector('#auto-trash-completed'),
  recordBackupLocation: document.querySelector('#record-backup-location'),
  backupLocation: document.querySelector('#backup-location'),
  backupLocationField: document.querySelector('#backup-location-field'),
  password: document.querySelector('#archive-password'),
  recordArchivePassword: document.querySelector('#record-archive-password'),
  thumbnailLimit: document.querySelector('#thumbnail-limit'),
  videoFrameBackup: document.querySelector('#video-frame-backup'),
  videoFrameCount: document.querySelector('#video-frame-count'),
  smallItemFilter: document.querySelector('#small-item-filter'),
  minimumTaskMb: document.querySelector('#minimum-task-mb'),
  similarityReportEnabled: document.querySelector('#similarity-report-enabled'),
  largeFolderSimplification: document.querySelector('#large-folder-simplification'),
  largeFolderFileThreshold: document.querySelector('#large-folder-file-threshold'),
  largeFolderMd5SampleLimit: document.querySelector('#large-folder-md5-sample-limit'),
  skipTinyMd5Files: document.querySelector('#skip-tiny-md5-files'),
  tinyFileMd5ThresholdKb: document.querySelector('#tiny-file-md5-threshold-kb'),
  autoSkipExactDuplicates: document.querySelector('#auto-skip-exact-duplicates'),
  autoSkipExactDuplicateAction: document.querySelector('#auto-skip-exact-duplicate-action'),
  scheduleEnabled: document.querySelector('#schedule-enabled'),
  scheduleStart: document.querySelector('#schedule-start'),
  scheduleEnd: document.querySelector('#schedule-end'),
  similarityEnabled: document.querySelector('#similarity-enabled'),
  similarityStrength: document.querySelector('#similarity-strength'),
  rebuildSimilarity: document.querySelector('#rebuild-similarity'),
  similarityRebuildProgress: document.querySelector('#similarity-rebuild-progress'),
  similarityProgressFill: document.querySelector('#similarity-progress-fill'),
  similarityProgressStatus: document.querySelector('#similarity-progress-status'),
  safetyChip: document.querySelector('#source-safety-chip'),
  safetyChipLabel: document.querySelector('#source-safety-label'),
  updateStatusChip: document.querySelector('#check-for-updates'),
  updateStatusLabel: document.querySelector('#update-status-label'),
  languageToggle: document.querySelector('#language-toggle'),
  languageToggleLabel: document.querySelector('#language-toggle-label'),
  notice: document.querySelector('#notice'),
  taskList: document.querySelector('#task-list'),
  taskListContainer: document.querySelector('#task-list-container'),
  emptyTasks: document.querySelector('#empty-tasks'),
  selectAllTasks: document.querySelector('#select-all-tasks'),
  selectionCount: document.querySelector('#selection-count'),
  removeSelected: document.querySelector('#remove-selected'),
  queueSelectionActions: document.querySelector('#queue-selection-actions'),
  looseSummary: document.querySelector('#loose-summary'),
  logList: document.querySelector('#log-list'),
  catalogList: document.querySelector('#catalog-list'),
  catalogDetail: document.querySelector('#catalog-detail'),
  catalogSearch: document.querySelector('#catalog-search'),
  catalogSuggestions: document.querySelector('#catalog-suggestions'),
  catalogTagFilter: document.querySelector('#catalog-tag-filter'),
  catalogBackupFilter: document.querySelector('#catalog-backup-filter'),
  catalogRatingFilter: document.querySelector('#catalog-rating-filter'),
  catalogSort: document.querySelector('#catalog-sort'),
  catalogListView: document.querySelector('#catalog-list-view'),
  catalogGridView: document.querySelector('#catalog-grid-view'),
  libraryLayout: document.querySelector('#library-layout'),
  warehousePath: document.querySelector('#warehouse-path'),
  userDataPath: document.querySelector('#user-data-path'),
  selectAllCatalog: document.querySelector('#select-all-catalog'),
  catalogSelectionCount: document.querySelector('#catalog-selection-count'),
  catalogSelectionActions: document.querySelector('#catalog-selection-actions'),
  addTagsSelected: document.querySelector('#add-tags-selected'),
  updateBackupSelected: document.querySelector('#update-backup-selected'),
  compressUncompressedSelected: document.querySelector('#compress-uncompressed-selected'),
  undoCatalog: document.querySelector('#undo-catalog'),
  deleteCatalogSelected: document.querySelector('#delete-catalog-selected'),
  manualCatalogDialog: document.querySelector('#manual-catalog-dialog'),
  manualCatalogForm: document.querySelector('#manual-catalog-form'),
  manualCatalogName: document.querySelector('#manual-catalog-name'),
  manualCatalogNotes: document.querySelector('#manual-catalog-notes'),
  manualCatalogTags: document.querySelector('#manual-catalog-tags'),
  manualCatalogSource: document.querySelector('#manual-catalog-source'),
  manualCatalogBackup: document.querySelector('#manual-catalog-backup'),
  manualCatalogImages: document.querySelector('#manual-catalog-images'),
  manualImagePaste: document.querySelector('#manual-image-paste'),
  manualImagePreview: document.querySelector('#manual-image-preview'),
  bulkTagsDialog: document.querySelector('#bulk-tags-dialog'),
  bulkTagsForm: document.querySelector('#bulk-tags-form'),
  bulkTagsInput: document.querySelector('#bulk-tags-input'),
  bulkBackupDialog: document.querySelector('#bulk-backup-dialog'),
  bulkBackupForm: document.querySelector('#bulk-backup-form'),
  bulkBackupInput: document.querySelector('#bulk-backup-input'),
  inventoryOnlyRiskDialog: document.querySelector('#inventory-only-risk-dialog'),
  inventoryOnlyRiskForm: document.querySelector('#inventory-only-risk-form'),
  suppressInventoryOnlyRisk: document.querySelector('#suppress-inventory-only-risk'),
  catalogCompressionRiskDialog: document.querySelector('#catalog-compression-risk-dialog'),
  catalogCompressionRiskForm: document.querySelector('#catalog-compression-risk-form'),
  suppressCatalogCompressionRisk: document.querySelector('#suppress-catalog-compression-risk'),
  deleteCatalogDialog: document.querySelector('#delete-catalog-dialog'),
  deleteCatalogForm: document.querySelector('#delete-catalog-form'),
  deleteCatalogSummary: document.querySelector('#delete-catalog-summary'),
  restoreOriginalSources: document.querySelector('#restore-original-sources'),
  restoreOriginalSourcesHelp: document.querySelector('#restore-original-sources-help'),
  catalogPagination: document.querySelector('#catalog-pagination'),
  catalogPageStatus: document.querySelector('#catalog-page-status'),
  catalogPageSelect: document.querySelector('#catalog-page-select'),
  catalogPagePrev: document.querySelector('#catalog-page-prev'),
  catalogPageNext: document.querySelector('#catalog-page-next'),
  metricInventory: document.querySelector('#metric-inventory'),
  metricTags: document.querySelector('#metric-tags'),
  metricGb: document.querySelector('#metric-gb'),
  metricWeek: document.querySelector('#metric-week'),
  activityGrid: document.querySelector('#activity-grid'),
  activityMonths: document.querySelector('#activity-months'),
  warehouseDiscovery: document.querySelector('#warehouse-discovery'),
  thumbnailLightbox: document.querySelector('#thumbnail-lightbox'),
  queueSimilarityReportDialog: document.querySelector('#queue-similarity-report-dialog'),
  queueSimilarityReportContent: document.querySelector('#queue-similarity-report-content'),
  similarityWhitelistDialog: document.querySelector('#similarity-whitelist-dialog'),
  similarityWhitelistForm: document.querySelector('#similarity-whitelist-form'),
  similarityWhitelistInput: document.querySelector('#similarity-whitelist-input'),
  confirmSimilarityWhitelist: document.querySelector('#confirm-similarity-whitelist'),
  lightboxImage: document.querySelector('#lightbox-image'),
  lightboxTitle: document.querySelector('#lightbox-title'),
  lightboxPath: document.querySelector('#lightbox-path'),
  setThumbnailCover: document.querySelector('#set-thumbnail-cover'),
  deleteThumbnail: document.querySelector('#delete-thumbnail'),
  runningIndicator: document.querySelector('#running-indicator'),
  trashSafetyDialog: document.querySelector('#trash-safety-dialog'),
  trashSafetyMessage: document.querySelector('#trash-safety-message'),
  acknowledgeTrashSafety: document.querySelector('#acknowledge-trash-safety'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmDialogForm: document.querySelector('#confirm-dialog-form'),
  confirmDialogTitle: document.querySelector('#confirm-dialog-title'),
  confirmDialogMessage: document.querySelector('#confirm-dialog-message'),
  acceptConfirmDialog: document.querySelector('#accept-confirm-dialog'),
  cancelConfirmDialog: document.querySelector('#cancel-confirm-dialog'),
  toast: document.querySelector('#toast')
};

const statusLabels = {
  awaiting_confirmation: '等待确认',
  awaiting_duplicate_confirmation: '重复待确认',
  awaiting_anomaly_confirmation: '大小异常待核验',
  awaiting_trash_safety_confirmation: '回收站安全警告',
  queued: '等待压缩',
  inventorying: '生成清单与 MD5',
  compressing: '压缩中',
  verifying: '完整性验证',
  moving: '移入库目录',
  completed: '已完成',
  completed_cleanup_failed: '归档完成/源文件处理失败',
  skipped_duplicate: '已自动跳过',
  failed: '失败',
  cancelled: '已取消'
};

function statusLabel(status) {
  return statusLabels[status] || status;
}

function jobStatusLabel(job) {
  return job?.status === 'queued' && job?.intakeModeSelected === false
    ? '待选入库方式'
    : statusLabel(job?.status);
}

let currentState = null;
let activeCatalogId = null;
let catalogDetailRequest = 0;
let nextScanToken = 0;
let activeScanToken = null;
let similarityWhitelistContext = null;
let currentCatalogResults = [];
let currentCatalogPageRecords = [];
let catalogViewMode = localStorage.getItem('hamster-catalog-view-v2') === 'list' ? 'list' : 'grid';
let currentWarehouseInsights = null;
let warehouseInsightsSignature = '';
let discoveryMode = 'loading';
let currentDiscoveryRecordIds = [];
let lightboxContext = null;
let catalogPage = 1;
const CATALOG_PAGE_SIZE = 24;
const CATALOG_GRID_MIN_CARD = 230;
const CATALOG_GRID_MAX_CARD = 280;
const CATALOG_GRID_IDEAL_CARD = 252;
const CATALOG_GRID_GAP = 16;
const CATALOG_GRID_ROWS_PER_PAGE = 4;
let catalogGridColumns = 4;
let catalogResizeTimer = 0;
let catalogRefreshDirty = false;
let lastCatalogRefreshAt = 0;
let catalogSearchSequence = 0;
let catalogSuggestionSequence = 0;
let catalogStateSignature = '';
let suppressSelectionClickUntil = 0;
let toastTimer;
let updateCheckInFlight = false;
let pendingManualImages = [];
let similarityManageRecordId = null;
let similarityWhitelistPopover = null;
let similarityWhitelistAnchor = null;
let similarityWhitelistWriteInFlight = false;
let activeQueueSimilarityReportJobId = null;
let suspendedQueueSimilarityReport = false;
let queueSimilarityReportRequest = 0;
const thumbnailCache = new Map();
const thumbnailPending = new Map();
const THUMBNAIL_CACHE_LIMIT = 300;
const selectedJobIds = new Set();
const selectedCatalogIds = new Set();

const themeMode = document.querySelector('#theme-mode');
const THEME_VALUES = ['classic', 'day', 'night', 'forest', 'twilight'];
const THEME_ALIASES = Object.freeze({ celadon: 'forest', plum: 'twilight' });
function applyTheme(theme) {
  const migratedTheme = THEME_ALIASES[theme] || theme;
  const nextTheme = THEME_VALUES.includes(migratedTheme) ? migratedTheme : 'day';
  document.body.dataset.theme = nextTheme;
  if (themeMode) themeMode.value = nextTheme;
  localStorage.setItem('hamster-theme', nextTheme);
}
applyTheme(localStorage.getItem('hamster-theme') || 'day');
themeMode?.addEventListener('change', () => applyTheme(themeMode.value));
function updateLanguageToggle(locale = i18n?.getLocale?.() || 'zh-CN') {
  const english = locale === 'en-US';
  if (elements.languageToggleLabel) elements.languageToggleLabel.textContent = english ? '中文' : 'EN';
  if (elements.languageToggle) {
    const label = english ? '切换到中文' : '切换到 English';
    elements.languageToggle.setAttribute('aria-label', t(label));
    elements.languageToggle.title = t(label);
  }
}
elements.languageToggle?.addEventListener('click', () => {
  const nextLocale = i18n?.getLocale?.() === 'en-US' ? 'zh-CN' : 'en-US';
  i18n?.setLocale(nextLocale);
  updateLanguageToggle(nextLocale);
  void saveConfig();
});

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function deriveStagingDirectory(archiveOutputDirectory) {
  const raw = String(archiveOutputDirectory || '').trim();
  if (/^[A-Za-z]:[\\/]$/.test(raw) || raw === '/') return `${raw}-staging`;
  const output = raw.replace(/[\\/]+$/, '');
  return output ? `${output}-staging` : '';
}

function formatRemainingTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '不到 1 分钟';
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}

function queueEstimateText(activeJob, percentage = activeJob.progress || 0) {
  if (!currentState || activeJob.status !== 'compressing') return '';
  const eligible = currentState.jobs.filter((job) =>
    job.status === 'queued' || job.status === 'compressing' || String(job.status || '').startsWith('completed'));
  const completed = eligible.filter((job) => String(job.status || '').startsWith('completed')).length;
  const history = currentState.config?.compressionHistory || [];
  const compressionRates = history
    .map((sample) => Number(sample.bytes) / Number(sample.durationMs))
    .filter((rate) => Number.isFinite(rate) && rate > 0)
    .sort((a, b) => a - b);
  const totalRates = history
    .map((sample) => Number(sample.bytes) / Number(sample.totalDurationMs || sample.durationMs))
    .filter((rate) => Number.isFinite(rate) && rate > 0)
    .sort((a, b) => a - b);
  const postCompressionDurations = history
    .map((sample) => sample.postCompressionDurationMs === undefined
      ? Number(sample.totalDurationMs) - Number(sample.durationMs)
      : Number(sample.postCompressionDurationMs))
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((a, b) => a - b);
  const historicalCompressionRate = compressionRates.length
    ? compressionRates[Math.floor(compressionRates.length / 2)]
    : (20 * 1024 ** 2) / 1000;
  let activeRate = historicalCompressionRate;
  const startedAt = Date.parse(activeJob.compressionStartedAt || '');
  const normalizedProgress = Math.max(0, Math.min(100, Number(percentage) || 0));
  if (Number.isFinite(startedAt) && normalizedProgress >= 2) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= 10_000) {
      const liveRate = (Number(activeJob.totalBytes || 0) * normalizedProgress / 100) / elapsed;
      const boundedLiveRate = Math.max(historicalCompressionRate * 0.25, Math.min(historicalCompressionRate * 4, liveRate));
      activeRate = historicalCompressionRate * 0.55 + boundedLiveRate * 0.45;
    }
  }
  const queuedRate = totalRates.length ? totalRates[Math.floor(totalRates.length / 2)] : historicalCompressionRate;
  const postCompressionMs = postCompressionDurations.length
    ? postCompressionDurations[Math.floor(postCompressionDurations.length / 2)]
    : 30_000;
  const activeRemaining = Number(activeJob.totalBytes || 0) * Math.max(0, 100 - normalizedProgress) / 100;
  const queuedRemaining = eligible
    .filter((job) => job.status === 'queued')
    .reduce((sum, job) => sum + Number(job.totalBytes || 0), 0);
  const remainingMs = activeRemaining / activeRate + postCompressionMs + queuedRemaining / queuedRate;
  return `已完成 ${completed}/${eligible.length} 项 · 预计还需 ${formatRemainingTime(remainingMs)}`;
}

function taskProgressText(job, percentage = job.progress || 0) {
  const base = job.stageText
    ? job.stageText
    : `${jobStatusLabel(job)} · ${Math.round(percentage)}%`;
  const estimate = queueEstimateText(job, percentage);
  return estimate ? `${base} · ${estimate}` : base;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function videoInfoText(file) {
  const info = file?.mediaInfo;
  if (!info) return '';
  return [
    info.durationSeconds ? formatDuration(info.durationSeconds) : null,
    info.width && info.height ? `${info.width}×${info.height}` : null,
    info.codec || null,
    info.container ? String(info.container).split(',')[0] : null
  ].filter(Boolean).join(' · ');
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = t(message);
  elements.toast.classList.toggle('error', isError);
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

let settleConfirmDialog = null;
function closeConfirmDialog(accepted) {
  if (!settleConfirmDialog) return;
  const settle = settleConfirmDialog;
  settleConfirmDialog = null;
  elements.confirmDialog.close();
  settle(Boolean(accepted));
}

function confirmUser(message, options = {}) {
  if (settleConfirmDialog) closeConfirmDialog(false);
  elements.confirmDialog.dataset.tone = options.tone || 'warning';
  elements.confirmDialogTitle.textContent = t(options.title || '请确认操作');
  elements.confirmDialogMessage.textContent = t(message);
  elements.acceptConfirmDialog.textContent = t(options.confirmLabel || '继续');
  elements.acceptConfirmDialog.className = `button ${options.tone === 'danger' ? 'danger' : 'primary'}`;
  elements.confirmDialog.showModal();
  elements.acceptConfirmDialog.focus();
  return new Promise((resolve) => { settleConfirmDialog = resolve; });
}

async function safely(action) {
  try {
    return await action();
  } catch (error) {
    showToast(error.message || String(error), true);
    return null;
  }
}

function setUpdateStatus(state, label = '检查更新') {
  if (!elements.updateStatusChip) return;
  elements.updateStatusChip.dataset.state = state;
  if (elements.updateStatusLabel) elements.updateStatusLabel.textContent = t(label);
}


function setUpdateControlsDisabled(disabled) {
  if (elements.updateStatusChip) elements.updateStatusChip.disabled = disabled;
}

async function runUpdateCheck({ automatic = false } = {}) {
  if (updateCheckInFlight || !elements.updateStatusChip) return null;
  updateCheckInFlight = true;
  setUpdateControlsDisabled(true);
  setUpdateStatus('checking', automatic ? '正在检查…' : '正在检查…');
  try {
    const result = await window.archiveApp.checkForUpdates({ silent: automatic });
    if (result?.updateAvailable) setUpdateStatus('available', '检查更新');
    else setUpdateStatus('current', '检查更新');
    return result;
  } catch (error) {
    setUpdateStatus('failed', '检查更新');
    showToast(`检查更新失败：${error.message || String(error)}`, true);
    return null;
  } finally {
    updateCheckInFlight = false;
    setUpdateControlsDisabled(false);
  }
}


function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    // Keep the source-language text on the node before translating it. This lets
    // a later switch back to Chinese restore dynamically created content too.
    node.textContent = text;
    i18n?.translateDom(node);
  }
  return node;
}

function makeUserText(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.dataset.i18nUserText = 'true';
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeUserOption(label, value) {
  const option = new Option(label, value);
  option.dataset.i18nUserText = 'true';
  return option;
}

function makeStage(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.dataset.i18nStage = 'true';
  node.textContent = text;
  i18n?.translateDom(node);
  return node;
}

function setStageText(node, text) {
  if (!node) return;
  node.dataset.i18nStage = 'true';
  node.textContent = text;
  i18n?.translateDom(node);
}

function catalogTitle(record) {
  return record.title || record.displayName || '未命名归档';
}

function catalogTags(record) {
  const tags = Array.isArray(record?.tags) ? record.tags.filter(Boolean) : [];
  return record?.archiveState === 'uncompressed'
    ? ['未压缩', ...tags.filter((tag) => tag !== '未压缩')]
    : tags.filter((tag) => tag !== '未压缩');
}

function starText(rating) {
  const value = Number(rating) || 0;
  return value > 0 ? `${'★'.repeat(value)}${'☆'.repeat(5 - value)}` : '未评分';
}

function formatCatalogDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return `${String(value).replaceAll('-', '/')}（旧记录，仅日期）`;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('日期未知');
  return date.toLocaleString(i18n?.getLocale?.() === 'en-US' ? 'en-US' : 'zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function formatDecimalGb(bytes) {
  const value = (Number(bytes) || 0) / 1_000_000_000;
  if (value === 0) return '0';
  if (value >= 1000) return value.toLocaleString(i18n?.getLocale?.() === 'en-US' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 0 });
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(1).replace(/\.0$/, '');
}

function activityLevel(entry, maxBytes, maxCount) {
  if (entry.future) return -1;
  if (entry.inventoryCount === 0) return 0;
  // 活跃度以“每天入库项目数”为主：100 项/天才进入最深颜色，避免单个大项目盖过日常整理量。
  const count = Number(entry.inventoryCount) || 0;
  if (count >= 100) return 4;
  if (count >= 30) return 3;
  if (count >= 10) return 2;
  return 1;
}

function renderWarehouseInsights(insights) {
  currentWarehouseInsights = insights;
  elements.metricInventory.textContent = Number(insights.inventoryCount || 0).toLocaleString('zh-CN');
  elements.metricTags.textContent = Number(insights.uniqueTagCount || 0).toLocaleString('zh-CN');
  elements.metricGb.textContent = formatDecimalGb(insights.totalOriginalBytes);
  elements.metricWeek.textContent = insights.activity
    .slice(-7)
    .reduce((sum, entry) => sum + (entry.future ? 0 : Number(entry.inventoryCount || 0)), 0)
    .toLocaleString('zh-CN');

  elements.activityGrid.replaceChildren();
  for (const entry of insights.activity) {
    const cell = make('span', 'activity-cell');
    const level = activityLevel(entry);
    cell.dataset.level = String(level);
    const dateLabel = new Date(`${entry.date}T12:00:00`).toLocaleDateString(i18n?.getLocale?.() === 'en-US' ? 'en-US' : 'zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    });
    cell.title = entry.future
      ? t(`${dateLabel} · 尚未到达`)
      : t(`${dateLabel} · ${entry.inventoryCount} 项库存 · ${formatDecimalGb(entry.originalBytes)} GB`);
    elements.activityGrid.append(cell);
  }

  elements.activityMonths.replaceChildren();
  let previousMonth = null;
  for (let week = 0; week < 16; week += 1) {
    const entry = insights.activity[week * 7];
    const date = new Date(`${entry.date}T12:00:00`);
    const month = date.getMonth();
    const label = make('span', '', month !== previousMonth
      ? (i18n?.getLocale?.() === 'en-US' ? date.toLocaleDateString('en-US', { month: 'short' }) : `${month + 1}月`)
      : '');
    elements.activityMonths.append(label);
    previousMonth = month;
  }
}

async function refreshWarehouseInsights(force = false) {
  const signature = JSON.stringify((currentState?.catalog || []).map((record) => [
    record.id, record.inventoryDate, record.originalBytes, record.tags
  ]));
  if (!force && signature === warehouseInsightsSignature && currentWarehouseInsights) return currentWarehouseInsights;
  const insights = await safely(() => window.archiveApp.getWarehouseInsights());
  if (insights) {
    warehouseInsightsSignature = signature;
    renderWarehouseInsights(insights);
  }
  return insights;
}

function renderDiscovery(title, description, records) {
  currentDiscoveryRecordIds = records.map((record) => record.id);
  elements.warehouseDiscovery.hidden = false;
  elements.warehouseDiscovery.replaceChildren();
  if (records.length === 0) {
    elements.warehouseDiscovery.append(make(
      'p',
      'muted',
      description || (title === '随机漫步' ? '仓库还是空的，添加库存后这里会自动出现推荐。' : '没有找到符合这次回顾条件的库存。')
    ));
    return;
  }
  const list = make('div', 'discovery-list');
  for (const record of records) {
    const button = make('button', 'discovery-hero');
    button.type = 'button';
    button.dataset.discoveryRecord = record.id;
    button.append(make('span', 'discovery-label', title === '随机漫步' ? '随机漫步 · 随机一项库存' : title));
    if (record.coverThumbnailPath) {
      const backdrop = document.createElement('img');
      backdrop.className = 'discovery-hero-image discovery-hero-backdrop';
      backdrop.alt = '';
      backdrop.setAttribute('aria-hidden', 'true');
      const cover = document.createElement('img');
      cover.className = 'discovery-hero-image discovery-hero-foreground';
      cover.alt = `${catalogTitle(record)} 的封面`;
      button.append(backdrop, cover);
      void loadThumbnail(backdrop, record.id, record.coverThumbnailPath);
      void loadThumbnail(cover, record.id, record.coverThumbnailPath);
    } else {
      button.append(make('span', 'discovery-hero-placeholder', '暂无封面'));
    }
    const info = make('span', 'discovery-hero-info');
    info.append(
      makeUserText('strong', '', catalogTitle(record)),
      make('span', '', `${starText(record.rating)} · 入库 ${formatCatalogDate(record.inventoryDate || record.completedAt)}`),
      (record.tags || []).length > 0
        ? makeUserText('small', '', record.tags.join(' · '))
        : make('small', '', '暂无标签')
    );
    button.append(info);
    list.append(button);
  }
  elements.warehouseDiscovery.append(list);
}

async function openDiscoveryRecord(recordId) {
  await loadCatalogDetails(recordId);
  elements.catalogDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function jumpToCatalogRecord(recordId) {
  const libraryButton = document.querySelector('.nav-button[data-page="library-page"]');
  libraryButton?.click();
  await loadCatalogDetails(recordId);
  elements.catalogDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showRandomWalk(shouldScroll = true) {
  const record = await safely(() => window.archiveApp.getRandomCatalogRecord(activeCatalogId));
  discoveryMode = record ? 'random' : 'empty';
  renderDiscovery(
    '随机漫步',
    record ? '从全部库存中为你随机抽取了一项。' : '仓库中暂时没有可以推荐的内容。',
    record ? [record] : []
  );
  if (shouldScroll) elements.warehouseDiscovery.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return record;
}

function readConfig() {
  const archiveVolumeMultiplier = elements.volumeUnit.value === 'gb' ? 1024 ** 3 : 1024 ** 2;
  return {
    language: i18n?.getLocale?.() === 'en-US' ? 'en-US' : 'zh-CN',
    intakeDirectory: elements.intakeDirectory.value.trim(),
    archiveStagingDirectory: elements.archiveStagingDirectory.value.trim(),
    archiveOutputDirectory: elements.archiveOutputDirectory.value.trim(),
    moveCompleted: elements.moveCompleted.checked,
    processedSourceDirectory: elements.processedSourceDirectory.value.trim(),
    archiveNamingMode: document.querySelector('input[name="archive-naming-mode"]:checked')?.value || 'timestamp_random',
    customArchiveName: elements.customArchiveName.value.trim(),
    archiveFormat: elements.archiveFormat.value,
    compressionLevel: Number(elements.compressionLevel.value),
    archiveVolumeEnabled: elements.splitVolume.checked,
    archiveVolumeBytes: Math.round(Number(elements.volumeSize.value) * archiveVolumeMultiplier),
    archivePassword: elements.password.value,
    recordArchivePassword: elements.recordArchivePassword.checked,
    videoFrameBackup: elements.videoFrameBackup.checked,
    videoFrameCount: Number(elements.videoFrameCount.value),
    thumbnailLimit: Number(elements.thumbnailLimit.value),
    smallItemFilter: elements.smallItemFilter.checked,
    minimumTaskBytes: Number(elements.minimumTaskMb.value) * (1024 ** 2),
    similarityReportEnabled: elements.similarityReportEnabled.checked,
    largeFolderSimplification: elements.largeFolderSimplification.checked,
    largeFolderFileThreshold: Number(elements.largeFolderFileThreshold.value),
    largeFolderMd5SampleLimit: Number(elements.largeFolderMd5SampleLimit.value),
    skipTinyMd5Files: elements.skipTinyMd5Files.checked,
    tinyFileMd5ThresholdBytes: Math.round(Number(elements.tinyFileMd5ThresholdKb.value) * 1024),
    autoSkipExactDuplicates: elements.autoSkipExactDuplicates.checked,
    autoSkipExactDuplicateAction: document.querySelector('input[name="auto-skip-exact-duplicate-action"]:checked')?.value || 'keep',
    scheduleEnabled: elements.scheduleEnabled.checked,
    scheduleStart: elements.scheduleStart.value,
    scheduleEnd: elements.scheduleEnd.value,
    similarityEnabled: elements.similarityEnabled.checked,
    similarityStrength: SIMILARITY_STRENGTH_ORDER[Number(elements.similarityStrength.value) - 1] || 'standard',
    autoTrashCompleted: elements.autoTrash.checked,
    recordBackupLocation: elements.recordBackupLocation.checked,
    backupLocation: elements.backupLocation.value.trim()
  };
}

function updateSettingsDigests() {
  const postParts = [];
  if (elements.autoTrash.checked) postParts.push('完成后移入回收站');
  else if (elements.moveCompleted.checked) postParts.push('完成后移动原文件');
  else postParts.push('保留原文件');
  postParts.push(elements.recordBackupLocation.checked
    ? (elements.backupLocation.value.trim() ? `${t('记录备份位置')}「${elements.backupLocation.value.trim()}」` : '记录备份位置')
    : '不记录备份位置');
  document.querySelector('#digest-post').textContent = postParts.map(t).join(' · ');

  const namingMode = document.querySelector('input[name="archive-naming-mode"]:checked')?.value;
  const namingLabels = {
    timestamp_random: '时间戳命名',
    original: '原文件名命名',
    custom_random: elements.customArchiveName.value.trim() ? `自定义「${elements.customArchiveName.value.trim()}」` : '自定义命名'
  };
  document.querySelector('#digest-compression').textContent = [
    elements.archiveFormat.value.toUpperCase(),
    `等级 ${elements.compressionLevel.value}`,
    namingLabels[namingMode] || '时间戳命名',
    elements.splitVolume.checked
      ? `分卷 ${elements.volumeSize.value || 0} ${elements.volumeUnit.value === 'gb' ? 'GB' : 'MB'}`
      : '不主动分卷',
    elements.password.value ? '已设置密码' : '无密码'
  ].map(t).join(' · ');

  const intakeParts = [
    elements.videoFrameBackup.checked ? `视频抽帧 ${elements.videoFrameCount.value || 0} 帧/视频` : '不抽取视频帧',
    `缩略图上限 ${elements.thumbnailLimit.value || 0} 张`,
    elements.smallItemFilter.checked ? `过滤 <${elements.minimumTaskMb.value || 0} MB` : '不过滤小项目'
  ];
  document.querySelector('#digest-intake').textContent = intakeParts.map(t).join(' · ');
  document.querySelector('#digest-more').textContent = elements.scheduleEnabled.checked
    ? `${t('定时运行')} ${elements.scheduleStart.value || '--:--'}–${elements.scheduleEnd.value || '--:--'} · ${t('数据与维护工具')}`
    : [t('定时运行关闭'), t('数据与维护工具')].join(' · ');
}

function updateBackupLocationControl() {
  const enabled = elements.recordBackupLocation.checked;
  elements.backupLocation.required = enabled;
  elements.backupLocationField.classList.toggle('inactive', !enabled);
  updateSettingsDigests();
}

function updateIntakeOptionControls() {
  elements.videoFrameCount.disabled = !elements.videoFrameBackup.checked;
  elements.minimumTaskMb.disabled = !elements.smallItemFilter.checked;
  elements.scheduleStart.disabled = !elements.scheduleEnabled.checked;
  elements.scheduleEnd.disabled = !elements.scheduleEnabled.checked;
  elements.scheduleStart.required = elements.scheduleEnabled.checked;
  elements.scheduleEnd.required = elements.scheduleEnabled.checked;
  updateSettingsDigests();
}

function knownCatalogTags() {
  return [...new Set((currentState?.catalog || [])
    .flatMap((record) => catalogTags(record))
    .filter((tag) => tag && tag !== '未压缩'))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function tagAutocompleteOptions() {
  return {
    getTags: knownCatalogTags,
    label: t('标签自动补全'),
    acceptHint: t('按 Tab 补全')
  };
}

tagAutocomplete?.bindTagAutocomplete(elements.bulkTagsInput, tagAutocompleteOptions());

function updateAutoSkipControls() {
  const enabled = elements.autoSkipExactDuplicates.checked;
  for (const control of elements.autoSkipExactDuplicateAction.querySelectorAll('input[type="radio"]')) {
    control.disabled = !enabled;
  }
  elements.autoSkipExactDuplicateAction.classList.toggle('disabled', !enabled);
}

function updatePerformanceAvoidanceControls() {
  elements.largeFolderFileThreshold.disabled = !elements.largeFolderSimplification.checked;
  elements.largeFolderMd5SampleLimit.disabled = !elements.largeFolderSimplification.checked;
  elements.tinyFileMd5ThresholdKb.disabled = !elements.skipTinyMd5Files.checked;
}

function setConfigControlsLocked(locked) {
  const selector = [
    '.settings-col input',
    '.settings-col select',
    '.settings-col button[data-pick]',
    '#save-settings',
    '#select-user-data',
    '#language-toggle',
    '.queue-settings-popover input',
    '.queue-settings-popover select'
  ].join(',');
  for (const control of document.querySelectorAll(selector)) control.disabled = locked;
  if (locked) return;
  updateBackupLocationControl();
  updateIntakeOptionControls();
  updateAutoSkipControls();
  updatePerformanceAvoidanceControls();
  updateCompletionControls();
  updateNamingControls();
  updateVolumeControls();
}

function updateCompletionControls(changed = '') {
  if (changed === 'move' && elements.moveCompleted.checked) elements.autoTrash.checked = false;
  if (changed === 'trash' && elements.autoTrash.checked) elements.moveCompleted.checked = false;
  elements.processedSourceDirectory.disabled = !elements.moveCompleted.checked;
  elements.processedSourceDirectory.required = elements.moveCompleted.checked;
  elements.processedSourceDirectoryField.classList.toggle('disabled', !elements.moveCompleted.checked);
  renderSafetyChip(elements.autoTrash.checked, elements.moveCompleted.checked);
  updateSettingsDigests();
}

function updateNamingControls() {
  const mode = document.querySelector('input[name="archive-naming-mode"]:checked')?.value;
  elements.customArchiveName.disabled = mode !== 'custom_random';
  elements.customArchiveName.required = mode === 'custom_random';
  updateSettingsDigests();
}

function updateVolumeControls({ unitChanged = false, normalize = true } = {}) {
  const enabled = elements.splitVolume.checked;
  const nextUnit = elements.volumeUnit.value;
  const previousUnit = elements.volumeUnit.dataset.previousUnit || nextUnit;
  let size = Number(elements.volumeSize.value) || (nextUnit === 'gb' ? 10 : 10240);
  if (unitChanged && previousUnit !== nextUnit) {
    size = previousUnit === 'gb' ? size * 1024 : size / 1024;
  }
  if (nextUnit === 'gb') {
    elements.volumeSize.min = '1';
    elements.volumeSize.max = '10';
    elements.volumeSize.step = '0.25';
    if (normalize) size = Math.min(10, Math.max(1, size));
  } else {
    elements.volumeSize.min = '64';
    elements.volumeSize.max = '10240';
    elements.volumeSize.step = '1';
    if (normalize) size = Math.min(10240, Math.max(64, Math.round(size)));
  }
  if (normalize) elements.volumeSize.value = String(size);
  elements.volumeUnit.dataset.previousUnit = nextUnit;
  elements.volumeSize.disabled = !enabled;
  elements.volumeUnit.disabled = !enabled;
  elements.volumeSetting.classList.toggle('enabled', enabled);

  // The safety note below the controls carries the invariant 10 GiB rule;
  // keep the optional example out of the compact prototype card.
  if (elements.volumeHint) elements.volumeHint.textContent = '';
  updateSettingsDigests();
}

function renderConfig(config) {
  i18n?.setLocale(config.language || 'zh-CN');
  updateLanguageToggle(config.language === 'en-US' ? 'en-US' : 'zh-CN');
  elements.intakeDirectory.value = config.intakeDirectory || '';
  elements.archiveOutputDirectory.value = config.archiveOutputDirectory || '';
  elements.archiveStagingDirectory.value = config.archiveStagingDirectory ||
    deriveStagingDirectory(config.archiveOutputDirectory);
  elements.warehousePath.textContent = config.repositoryDirectory ? t(`仓库：${config.repositoryDirectory}`) : '';
  elements.warehousePath.title = config.repositoryDirectory || t('当前仓库位置');
  elements.userDataPath.value = config.userDataDirectory || '';
  elements.userDataPath.title = config.userDataDirectory || '';
  elements.moveCompleted.checked = Boolean(config.moveCompleted);
  elements.processedSourceDirectory.value = config.processedSourceDirectory || '';
  const namingRadio = document.querySelector(`input[name="archive-naming-mode"][value="${config.archiveNamingMode || 'timestamp_random'}"]`);
  if (namingRadio) namingRadio.checked = true;
  elements.customArchiveName.value = config.customArchiveName || '';
  elements.archiveFormat.value = config.archiveFormat || '7z';
  elements.compressionLevel.value = String(config.compressionLevel ?? 1);
  elements.splitVolume.checked = config.archiveVolumeEnabled !== false;
  const archiveVolumeBytes = Number(config.archiveVolumeBytes) || (10 * 1024 ** 3);
  const volumeUsesGb = archiveVolumeBytes % (1024 ** 3) === 0;
  elements.volumeUnit.value = volumeUsesGb ? 'gb' : 'mb';
  elements.volumeUnit.dataset.previousUnit = elements.volumeUnit.value;
  elements.volumeSize.value = String(archiveVolumeBytes / (volumeUsesGb ? 1024 ** 3 : 1024 ** 2));
  elements.password.value = config.archivePassword || '';
  elements.recordArchivePassword.checked = config.recordArchivePassword !== false;
  elements.thumbnailLimit.value = String(config.thumbnailLimit || 30);
  elements.password.type = 'password';
  document.querySelector('#toggle-password').textContent = t('显示');
  elements.videoFrameBackup.checked = config.videoFrameBackup !== false;
  elements.videoFrameCount.value = String(config.videoFrameCount || 3);
  elements.smallItemFilter.checked = config.smallItemFilter !== false;
  elements.minimumTaskMb.value = String(Math.round((config.minimumTaskBytes || (100 * 1024 ** 2)) / (1024 ** 2)));
  elements.similarityReportEnabled.checked = config.similarityReportEnabled !== false;
  elements.largeFolderSimplification.checked = config.largeFolderSimplification === true;
  elements.largeFolderFileThreshold.value = String(config.largeFolderFileThreshold || 500);
  elements.largeFolderMd5SampleLimit.value = String(config.largeFolderMd5SampleLimit || 200);
  elements.skipTinyMd5Files.checked = config.skipTinyMd5Files === true;
  elements.tinyFileMd5ThresholdKb.value = String(Math.round((config.tinyFileMd5ThresholdBytes || (5 * 1024)) / 1024));
  elements.autoSkipExactDuplicates.checked = Boolean(config.autoSkipExactDuplicates);
  const autoSkipAction = config.autoSkipExactDuplicateAction === 'remove' ? 'remove' : 'keep';
  const autoSkipActionRadio = document.querySelector(`input[name="auto-skip-exact-duplicate-action"][value="${autoSkipAction}"]`);
  if (autoSkipActionRadio) autoSkipActionRadio.checked = true;
  elements.scheduleEnabled.checked = Boolean(config.scheduleEnabled);
  elements.scheduleStart.value = config.scheduleStart || '';
  elements.scheduleEnd.value = config.scheduleEnd || '';
  elements.similarityEnabled.checked = config.similarityEnabled !== false;
  const strengthIndex = SIMILARITY_STRENGTH_ORDER.indexOf(config.similarityStrength || 'standard');
  elements.similarityStrength.value = String(strengthIndex >= 0 ? strengthIndex + 1 : 2);
  elements.autoTrash.checked = Boolean(config.autoTrashCompleted);
  elements.recordBackupLocation.checked = Boolean(config.recordBackupLocation);
  elements.backupLocation.value = config.backupLocation || '';
  updateBackupLocationControl();
  updateIntakeOptionControls();
  updateAutoSkipControls();
  updatePerformanceAvoidanceControls();
  updateCompletionControls();
  updateNamingControls();
  updateVolumeControls();
  updateSettingsDigests();
  renderSafetyChip(Boolean(config.autoTrashCompleted), Boolean(config.moveCompleted));
}

function renderSafetyChip(autoTrash, moveCompleted = false) {
  const presentation = uiState.sourceDispositionPresentation(autoTrash, moveCompleted);
  elements.safetyChip.dataset.state = presentation.state;
  elements.safetyChip.classList.toggle('trash-enabled', presentation.state === 'trash');
  elements.safetyChipLabel.textContent = t(presentation.label);
}

function actionButton(label, action, jobId, className = '') {
  const button = make('button', className, label);
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  return button;
}

function updateSelectionControls(jobs) {
  const validIds = new Set(jobs.map((job) => job.id));
  for (const id of [...selectedJobIds]) {
    if (!validIds.has(id)) selectedJobIds.delete(id);
  }
  elements.selectionCount.textContent = t(selectedJobIds.size > 0
    ? `已选择 ${selectedJobIds.size} 项`
    : '未选择任务');
  elements.removeSelected.disabled = selectedJobIds.size === 0;
  elements.queueSelectionActions.hidden = selectedJobIds.size === 0;
  elements.selectAllTasks.checked = jobs.length > 0 && selectedJobIds.size === jobs.length;
  elements.selectAllTasks.indeterminate = selectedJobIds.size > 0 && selectedJobIds.size < jobs.length;
}

function renderJobs(jobs) {
  elements.taskList.replaceChildren();
  elements.emptyTasks.hidden = jobs.length > 0;
  updateSelectionControls(jobs);

  for (const job of jobs) {
    const row = document.createElement('tr');
    row.dataset.jobId = job.id;
    row.classList.toggle('selected', selectedJobIds.has(job.id));

    const selectCell = make('td', 'select-cell');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedJobIds.has(job.id);
    checkbox.dataset.selectJob = job.id;
    checkbox.setAttribute('aria-label', `选择 ${job.displayName}`);
    selectCell.append(checkbox);
    row.append(selectCell);

    const nameCell = make('td', 'task-name');
    const nameLine = make('span', 'task-name-line');
    const copyName = make('button', 'copy-job-name', '复制');
    copyName.type = 'button';
    copyName.dataset.copyJobName = job.displayName;
    copyName.setAttribute('aria-label', `复制任务名 ${job.displayName}`);
    const openName = make('button', 'copy-job-name', '打开');
    openName.type = 'button';
    openName.dataset.openJobSource = job.id;
    openName.setAttribute('aria-label', `打开任务位置 ${job.displayName}`);
    nameLine.append(makeUserText('strong', '', job.displayName));
    if (job.sourceCatalogRecordId) nameLine.append(make('span', 'queue-origin-badge', '库内项目压缩'));
    else if (job.processingMode === 'inventory_only') nameLine.append(make('span', 'queue-origin-badge uncompressed', '未压缩入库'));
    nameLine.append(copyName, openName);
    nameCell.append(nameLine, makeUserText('small', '', job.sourcePath));
    row.append(nameCell);
    row.append(make('td', '', String(job.fileCount)));
    row.append(make('td', '', formatBytes(job.totalBytes)));

    const statusCell = document.createElement('td');
    statusCell.append(make('span', `status ${job.status}`, jobStatusLabel(job)));
    row.append(statusCell);

    const progressCell = document.createElement('td');
    const progress = make('div', 'progress');
    const fill = make('span');
    fill.style.width = `${Math.max(0, Math.min(100, job.progress || 0))}%`;
    progress.append(fill);
    progressCell.append(progress, makeStage('span', 'progress-text', taskProgressText(job)));
    row.append(progressCell);

    const actionCell = make('td', 'row-actions');
    const catalogIds = new Set((currentState?.catalog || []).map((record) => record.id));
    const hasCatalogSimilarity = [
      ...(job.nameDuplicateMatches || []).map((match) => match.archiveId),
      ...(job.similarMatches || []).map((match) => match.id),
      ...(job.exactProjectMatches || []).map((match) => match.id),
      ...(job.exactDuplicateMatches || []).flatMap((match) =>
        (match.previous || []).map((previous) => previous.archiveId))
    ].some((id) => id && catalogIds.has(id));
    if (!job.sourceCatalogRecordId && currentState?.config?.similarityReportEnabled !== false && hasCatalogSimilarity) {
      actionCell.append(actionButton('相似报告', 'similarity-report', job.id, 'ghost'));
    }
    if (job.status === 'awaiting_confirmation' && job.confirmationReasons?.includes('large_task')) {
      const requestedVolumeBytes = Number(job.archiveVolumeBytes);
      const configuredVolumeBytes = job.archiveVolumeEnabled === true &&
        Number.isInteger(requestedVolumeBytes) &&
        requestedVolumeBytes >= 64 * 1024 ** 2 && requestedVolumeBytes <= 10 * 1024 ** 3
        ? requestedVolumeBytes
        : 10 * 1024 ** 3;
      actionCell.append(actionButton(`确认并按 ${formatBytes(configuredVolumeBytes)} 分卷`, 'confirm', job.id, 'confirm'));
    }
    if (uiState?.shouldShowDuplicateConfirmation(job)) {
      actionCell.append(actionButton(
        job.duplicateReviewKind === 'similarity' ? '确认相似并继续' : '确认内容一致并继续',
        'confirm',
        job.id,
        'confirm'
      ));
    }
    if (job.status === 'awaiting_anomaly_confirmation') {
      actionCell.append(
        actionButton('核验后确认入库', 'confirm-anomaly', job.id, 'confirm'),
        actionButton('删除异常成品', 'discard-anomaly', job.id, 'danger-link')
      );
    }
    if (job.status === 'awaiting_trash_safety_confirmation') {
      actionCell.append(actionButton('确认安全警告', 'acknowledge-trash-safety', job.id, 'danger-link'));
    }
    if (['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation', 'inventorying', 'compressing', 'verifying', 'failed'].includes(job.status)) {
      actionCell.append(actionButton('取消', 'cancel', job.id));
    }
    if (['failed', 'cancelled'].includes(job.status)) {
      actionCell.append(actionButton('重试', 'retry', job.id));
    }
    row.append(actionCell);
    elements.taskList.append(row);
  }
}

function renderLogs(logs) {
  elements.logList.replaceChildren();
  if (logs.length === 0) {
    elements.logList.append(make('p', 'muted', '暂无日志'));
    return;
  }
  for (const entry of [...logs].reverse()) {
    const row = make('div', `log-entry ${entry.level}`);
    const time = new Date(entry.at);
    row.append(
      make('time', '', time.toLocaleTimeString('zh-CN', { hour12: false })),
      make('span', '', entry.level.toUpperCase()),
      makeStage('p', '', entry.message)
    );
    elements.logList.append(row);
  }
}

function updateCatalogSelectionControls() {
  const validIds = new Set((currentState?.catalog || []).map((record) => record.id));
  for (const id of [...selectedCatalogIds]) {
    if (!validIds.has(id)) selectedCatalogIds.delete(id);
  }
  const pageIds = currentCatalogPageRecords.map((record) => record.id);
  const selectedResultCount = pageIds.filter((id) => selectedCatalogIds.has(id)).length;
  elements.catalogSelectionCount.textContent = t(`已选 ${selectedCatalogIds.size} 项`);
  elements.addTagsSelected.disabled = selectedCatalogIds.size === 0;
  elements.updateBackupSelected.disabled = selectedCatalogIds.size === 0;
  elements.compressUncompressedSelected.disabled = !(currentState?.catalog || []).some((record) =>
    selectedCatalogIds.has(record.id) && record.archiveState === 'uncompressed');
  elements.deleteCatalogSelected.disabled = selectedCatalogIds.size === 0;
  elements.catalogSelectionActions.hidden = false;
  elements.selectAllCatalog.checked = pageIds.length > 0 && selectedResultCount === pageIds.length;
  elements.selectAllCatalog.indeterminate = selectedResultCount > 0 && selectedResultCount < pageIds.length;
}

function catalogGridLayout() {
  let width = elements.catalogList.clientWidth;
  if (!width) width = Math.max(0, window.innerWidth - 88);
  if (!width) return { columns: catalogGridColumns, cardWidth: CATALOG_GRID_IDEAL_CARD, justify: 'start' };
  const minimumColumns = Math.max(1, Math.ceil((width + CATALOG_GRID_GAP) /
    (CATALOG_GRID_MAX_CARD + CATALOG_GRID_GAP)));
  const maximumColumns = Math.max(1, Math.floor((width + CATALOG_GRID_GAP) /
    (CATALOG_GRID_MIN_CARD + CATALOG_GRID_GAP)));
  let columns;
  if (minimumColumns <= maximumColumns) {
    const idealColumns = Math.round((width + CATALOG_GRID_GAP) /
      (CATALOG_GRID_IDEAL_CARD + CATALOG_GRID_GAP));
    columns = Math.min(Math.max(idealColumns, minimumColumns), maximumColumns);
  } else {
    columns = maximumColumns;
  }
  let cardWidth = (width - ((columns - 1) * CATALOG_GRID_GAP)) / columns;
  let justify = 'start';
  if (cardWidth > CATALOG_GRID_MAX_CARD) {
    cardWidth = CATALOG_GRID_MAX_CARD;
    justify = 'center';
  }
  return { columns, cardWidth, justify };
}

function measureCatalogGridColumns() {
  return catalogViewMode === 'grid' ? catalogGridLayout().columns : 1;
}

function applyCatalogGridLayout() {
  if (catalogViewMode !== 'grid') {
    elements.catalogList.style.removeProperty('grid-template-columns');
    elements.catalogList.style.removeProperty('justify-content');
    return;
  }
  const layout = catalogGridLayout();
  elements.catalogList.style.gridTemplateColumns = `repeat(${layout.columns}, ${layout.cardWidth.toFixed(2)}px)`;
  elements.catalogList.style.justifyContent = layout.justify;
}

function catalogPageSize() {
  if (catalogViewMode !== 'grid') return CATALOG_PAGE_SIZE;
  return Math.max(6, catalogGridColumns * CATALOG_GRID_ROWS_PER_PAGE);
}

function renderCatalog(catalog) {
  currentCatalogResults = catalog;
  if (catalog.length === 0) {
    currentCatalogPageRecords = [];
    updateCatalogSelectionControls();
    elements.catalogPagination.hidden = true;
    elements.catalogList.replaceChildren(make('p', 'muted catalog-empty', '没有符合当前条件的仓库内容'));
    return;
  }
  catalogGridColumns = measureCatalogGridColumns();
  const pageSize = catalogPageSize();
  const ordered = [...catalog];
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  catalogPage = Math.min(Math.max(1, catalogPage), pageCount);
  const visibleRecords = ordered.slice((catalogPage - 1) * pageSize, catalogPage * pageSize);
  currentCatalogPageRecords = visibleRecords;
  updateCatalogSelectionControls();
  elements.catalogPagination.hidden = pageCount <= 1;
  elements.catalogPageStatus.textContent = t(`第 ${catalogPage} / ${pageCount} 页 · 共 ${catalog.length} 项`);
  elements.catalogPagePrev.disabled = catalogPage <= 1;
  elements.catalogPageNext.disabled = catalogPage >= pageCount;
  const pageOptions = Array.from({ length: pageCount }, (_, index) => String(index + 1));
  if ([...elements.catalogPageSelect.options].map((option) => option.value).join(',') !== pageOptions.join(',')) {
    elements.catalogPageSelect.replaceChildren(...pageOptions.map((page) => new Option(page, page)));
  }
  elements.catalogPageSelect.value = String(catalogPage);
  const fragment = document.createDocumentFragment();
  if (catalogViewMode === 'list') {
    const header = make('div', 'catalog-text-header');
    for (const label of ['', '名称', '类型', '文件', '大小 / 状态', '标签', '备份位置', '入库时间', '星级']) {
      header.append(make('span', '', label));
    }
    fragment.append(header);
  }
  for (const record of visibleRecords) {
    if (catalogViewMode === 'list') {
      const row = make('article', `catalog-text-row catalog-entry${activeCatalogId === record.id ? ' active' : ''}${selectedCatalogIds.has(record.id) ? ' selected' : ''}`);
      row.dataset.catalogId = record.id;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'catalog-select';
      checkbox.checked = selectedCatalogIds.has(record.id);
      checkbox.dataset.selectCatalog = record.id;
      checkbox.setAttribute('aria-label', `选择 ${catalogTitle(record)}`);
      const button = make('button', 'catalog-text-open');
      button.type = 'button';
      button.dataset.recordId = record.id;
      const titleCell = make('span', 'catalog-text-title');
      titleCell.append(makeUserText('strong', '', catalogTitle(record)));
      const tagsCell = make('span', 'catalog-text-tags');
      for (const tag of catalogTags(record).slice(0, 3)) {
        tagsCell.append(tag === '未压缩'
          ? make('span', 'uncompressed-tag', tag)
          : makeUserText('span', '', tag));
      }
      if (record.possibleDuplicate) tagsCell.append(make('span', 'duplicate-tag', '可能重复'));
      const type = record.recordType === 'manual' ? '手动' : record.sourceType === 'video' ? '视频' : '文件夹';
      const volumeCount = Array.isArray(record.archiveFiles) ? record.archiveFiles.length : 0;
      const archiveSummary = record.recordType === 'manual'
        ? '仅记录'
        : record.archiveState === 'uncompressed'
          ? '未压缩'
          : `${formatBytes(record.archiveTotalBytes)}${volumeCount > 1 ? ` · ${volumeCount} 卷` : ''}`;
      const backupCell = document.createElement('span');
      backupCell.className = 'catalog-text-backup';
      backupCell.dataset.i18nUserText = 'true';
      backupCell.textContent = record.backupLocation || '—';
      if (record.backupLocation) backupCell.title = record.backupLocation;
      button.append(
        titleCell,
        make('span', 'catalog-text-type', type),
        make('span', 'catalog-text-number', record.recordType === 'manual' ? '—' : String(record.manifestCount || 0)),
        make('span', record.archiveState === 'uncompressed' ? 'catalog-text-status uncompressed' : 'catalog-text-status', archiveSummary),
        tagsCell,
        backupCell,
        make('span', 'catalog-text-date', formatCatalogDate(record.inventoryDate || record.completedAt)),
        make('span', 'catalog-text-rating', starText(record.rating))
      );
      row.append(checkbox, button);
      fragment.append(row);
      continue;
    }
    const card = make('article', `catalog-card${activeCatalogId === record.id ? ' active' : ''}${selectedCatalogIds.has(record.id) ? ' selected' : ''}`);
    card.dataset.catalogId = record.id;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'catalog-select';
    checkbox.checked = selectedCatalogIds.has(record.id);
    checkbox.dataset.selectCatalog = record.id;
    checkbox.setAttribute('aria-label', `选择 ${catalogTitle(record)}`);

    const button = make('button', 'catalog-open');
    button.type = 'button';
    button.dataset.recordId = record.id;
    const cover = make('div', 'catalog-cover');
    if (record.coverThumbnailPath) {
      appendContainedThumbnail(
        cover,
        record.id,
        record.coverThumbnailPath,
        catalogTitle(record),
        'catalog-cover-frame'
      );
    } else {
      cover.append(make('span', 'catalog-cover-placeholder', record.recordType === 'manual' ? '手动库存' : '无预览'));
    }
    const volumeCount = Array.isArray(record.archiveFiles) ? record.archiveFiles.length : 0;
    cover.append(make('span', 'file-count-badge', record.recordType === 'manual'
      ? '仅记录'
      : `${record.manifestCount} 个文件${volumeCount > 1 ? ` · ${volumeCount} 卷` : ''}`));

    const info = make('div', 'catalog-card-info');
    info.append(
      makeUserText('strong', '', catalogTitle(record)),
      make('span', 'catalog-stars', starText(record.rating)),
      make('small', '', record.recordType === 'manual'
        ? '手动库存条目'
        : `${record.directoryCount || 0} 个子目录 · ${record.archiveState === 'uncompressed'
          ? '未压缩'
          : formatBytes(record.archiveTotalBytes)}`),
      make('small', '', `入库 ${formatCatalogDate(record.inventoryDate || record.completedAt)}`)
    );
    const visibleTags = catalogTags(record);
    if (visibleTags.length > 0) {
      const tags = make('div', 'catalog-card-tags');
      for (const tag of visibleTags.slice(0, catalogViewMode === 'grid' ? 4 : 2)) {
        tags.append(tag === '未压缩'
          ? make('span', 'uncompressed-tag', tag)
          : makeUserText('span', '', tag));
      }
      info.append(tags);
    }
    if (record.backupLocation) {
      const backupChip = make('span', 'backup-location-chip');
      backupChip.append(make('span', '', '备份 · '), makeUserText('span', '', record.backupLocation));
      info.append(backupChip);
    }
    if (record.possibleDuplicate) {
      info.append(make('span', 'duplicate-chip', `可能重复${record.similarCount ? ` · ${record.similarCount} 个相似项` : ''}`));
    }
    button.append(cover, info);
    card.append(checkbox, button);
    fragment.append(card);
  }
  elements.catalogList.replaceChildren(fragment);
  requestAnimationFrame(applyCatalogGridLayout);
}

function updateTagFilterOptions(catalog) {
  const selected = elements.catalogTagFilter.value;
  const possibleDuplicateFilter = '__possible_duplicate__';
  const tags = [...new Set(catalog.flatMap((record) => record.tags || []))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  elements.catalogTagFilter.replaceChildren(new Option('全部标签', ''));
  elements.catalogTagFilter.append(new Option('可能重复', possibleDuplicateFilter));
  for (const tag of tags) elements.catalogTagFilter.append(makeUserOption(tag, tag));
  elements.catalogTagFilter.value = selected === possibleDuplicateFilter || tags.includes(selected) ? selected : '';
}

function syncCatalogItemState() {
  for (const item of elements.catalogList.querySelectorAll('[data-catalog-id]')) {
    const recordId = item.dataset.catalogId;
    const selected = selectedCatalogIds.has(recordId);
    item.classList.toggle('active', activeCatalogId === recordId);
    item.classList.toggle('selected', selected);
    const checkbox = item.querySelector('input[data-select-catalog]');
    if (checkbox) checkbox.checked = selected;
  }
  updateCatalogSelectionControls();
}

function updateBackupLocationFilterOptions(catalog) {
  const selected = elements.catalogBackupFilter.value;
  const locations = [...new Set(catalog.map((record) => record.backupLocation).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  elements.catalogBackupFilter.replaceChildren(new Option('全部备份位置', ''));
  for (const location of locations) elements.catalogBackupFilter.append(makeUserOption(location, location));
  elements.catalogBackupFilter.value = locations.includes(selected) ? selected : '';
}

async function refreshCatalog() {
  const requestSequence = ++catalogSearchSequence;
  const ratingValue = elements.catalogRatingFilter.value;
  const records = await safely(() => window.archiveApp.searchCatalog({
    query: elements.catalogSearch.value,
    tag: elements.catalogTagFilter.value,
    backupLocation: elements.catalogBackupFilter.value,
    rating: ratingValue === '' ? null : Number(ratingValue),
    sort: elements.catalogSort.value
  }));
  if (requestSequence !== catalogSearchSequence) return null;
  if (records) {
    renderCatalog(records);
    catalogRefreshDirty = false;
    lastCatalogRefreshAt = Date.now();
  }
  return records;
}

async function refreshCatalogSuggestions() {
  const requestSequence = ++catalogSuggestionSequence;
  const query = elements.catalogSearch.value.trim();
  if (query.length < 2) {
    elements.catalogSuggestions.hidden = true;
    elements.catalogSuggestions.replaceChildren();
    return;
  }
  const suggestions = await safely(() => window.archiveApp.getCatalogSuggestions(query));
  if (requestSequence !== catalogSuggestionSequence) return;
  if (!suggestions || suggestions.length === 0 || elements.catalogSearch.value.trim() !== query) {
    elements.catalogSuggestions.hidden = true;
    return;
  }
  elements.catalogSuggestions.replaceChildren();
  for (const suggestion of suggestions) {
    const button = make('button');
    button.type = 'button';
    button.dataset.suggestionTitle = suggestion.title;
    button.append(
      makeUserText('span', '', suggestion.title),
      make('small', '', suggestion.score >= 0.9 ? '高度匹配' : '相似标题')
    );
    elements.catalogSuggestions.append(button);
  }
  elements.catalogSuggestions.hidden = false;
}

function setCatalogView(mode) {
  catalogViewMode = mode === 'grid' ? 'grid' : 'list';
  localStorage.setItem('hamster-catalog-view-v2', catalogViewMode);
  elements.libraryLayout.classList.toggle('grid-mode', catalogViewMode === 'grid');
  elements.catalogListView.classList.toggle('active', catalogViewMode === 'list');
  elements.catalogGridView.classList.toggle('active', catalogViewMode === 'grid');
  elements.catalogListView.setAttribute('aria-pressed', String(catalogViewMode === 'list'));
  elements.catalogGridView.setAttribute('aria-pressed', String(catalogViewMode === 'grid'));
  catalogPage = 1;
  renderCatalog(currentCatalogResults);
  requestAnimationFrame(applyCatalogGridLayout);
}

function createTree(directories, files, rootName = '') {
  const root = { name: String(rootName || ''), path: '', directories: new Map(), files: [] };
  const ensureDirectory = (directoryPath) => {
    let node = root;
    let currentPath = '';
    for (const part of String(directoryPath || '').replace(/\\/g, '/').split('/').filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!node.directories.has(part)) {
        node.directories.set(part, { name: part, path: currentPath, directories: new Map(), files: [] });
      }
      node = node.directories.get(part);
    }
    return node;
  };

  for (const directoryPath of Array.isArray(directories) ? directories : []) ensureDirectory(directoryPath);
  for (const file of Array.isArray(files) ? files.filter(Boolean) : []) {
    const relativePath = String(file.relativePath || file.name || '未命名文件').replace(/\\/g, '/');
    const parts = relativePath.split('/');
    const fileName = parts.pop();
    const directory = ensureDirectory(parts.join('/'));
    directory.files.push({ ...file, relativePath, name: fileName || file.name });
  }
  return root;
}

function thumbnailCacheKey(recordId, relativePath) {
  return `${String(recordId || '')}::${String(relativePath || '')}`;
}

function cacheThumbnail(key, dataUrl) {
  if (!dataUrl) return;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, dataUrl);
  while (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    thumbnailCache.delete(thumbnailCache.keys().next().value);
  }
}

function invalidateThumbnailCache(recordId, relativePath = null) {
  const prefix = `${String(recordId || '')}::`;
  if (relativePath === null) {
    for (const key of thumbnailCache.keys()) if (key.startsWith(prefix)) thumbnailCache.delete(key);
    for (const key of thumbnailPending.keys()) if (key.startsWith(prefix)) thumbnailPending.delete(key);
    return;
  }
  const key = thumbnailCacheKey(recordId, relativePath);
  thumbnailCache.delete(key);
  thumbnailPending.delete(key);
}

async function loadThumbnail(image, recordId, relativePath) {
  const key = thumbnailCacheKey(recordId, relativePath);
  if (thumbnailCache.has(key)) {
    const dataUrl = thumbnailCache.get(key);
    thumbnailCache.delete(key);
    thumbnailCache.set(key, dataUrl);
    image.src = dataUrl;
    return dataUrl;
  }
  let request = thumbnailPending.get(key);
  if (!request) {
    request = safely(() => window.archiveApp.getThumbnail(recordId, relativePath))
      .then((dataUrl) => {
        cacheThumbnail(key, dataUrl);
        return dataUrl;
      })
      .finally(() => thumbnailPending.delete(key));
    thumbnailPending.set(key, request);
  }
  const dataUrl = await request;
  if (dataUrl) image.src = dataUrl;
  return dataUrl;
}

function appendContainedThumbnail(container, recordId, relativePath, title, frameClass = '') {
  const frame = make('div', `contained-thumbnail-frame${frameClass ? ` ${frameClass}` : ''}`);
  const backdrop = document.createElement('img');
  backdrop.className = 'contained-thumbnail-image contained-thumbnail-backdrop';
  backdrop.alt = '';
  backdrop.setAttribute('aria-hidden', 'true');

  const image = document.createElement('img');
  image.className = 'contained-thumbnail-image contained-thumbnail-foreground';
  image.loading = 'lazy';
  image.alt = title;
  image.dataset.thumbnailRecord = recordId;
  image.dataset.thumbnailPath = relativePath;
  image.dataset.thumbnailTitle = title;
  frame.append(backdrop, image);
  container.append(frame);

  void loadThumbnail(image, recordId, relativePath).then((dataUrl) => {
    if (dataUrl) backdrop.src = dataUrl;
  });
  return image;
}

function thumbnailsForFile(file) {
  if (file.manualThumbnailRef) {
    return [{ ref: file.manualThumbnailRef, thumbnailPath: file.thumbnailPath, label: file.relativePath }];
  }
  if (Array.isArray(file.thumbnails) && file.thumbnails.length > 0) {
    return file.thumbnails.map((thumbnail, index) => ({
      ...thumbnail,
      ref: `${file.relativePath}::frame:${index}`,
      label: thumbnail.type === 'video-frame'
        ? `第 ${index + 1} 帧 · ${Math.round(thumbnail.timeSeconds || 0)} 秒`
        : file.relativePath
    }));
  }
  return file.thumbnailPath ? [{ ref: file.relativePath, thumbnailPath: file.thumbnailPath, label: file.relativePath }] : [];
}

function imageInputFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type || '')) {
      reject(new Error(`“${file.name}”不是支持的 PNG、JPEG、WebP 或 GIF 图片。`));
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      reject(new Error(`“${file.name}”超过 25 MB。`));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve({ name: file.name, dataUrl: reader.result }), { once: true });
    reader.addEventListener('error', () => reject(new Error(`无法读取“${file.name}”。`)), { once: true });
    reader.readAsDataURL(file);
  });
}

async function imageInputsFromFiles(files) {
  const inputs = [];
  for (const file of [...files].slice(0, 100)) inputs.push(await imageInputFromFile(file));
  return inputs;
}

async function addImagesToCatalog(recordId, imageInputs) {
  let updated = null;
  for (const input of imageInputs) {
    updated = await window.archiveApp.addCatalogImage(recordId, input);
  }
  return updated;
}

function renderPendingManualImages() {
  elements.manualImagePreview.replaceChildren();
  for (const [index, input] of pendingManualImages.entries()) {
    const item = make('div', 'pending-image-item');
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.src = input.dataUrl;
    image.alt = input.name;
    const remove = make('button', 'dialog-close', '×');
    remove.type = 'button';
    remove.title = '移除这张图片';
    remove.addEventListener('click', () => {
      pendingManualImages.splice(index, 1);
      renderPendingManualImages();
    });
    item.append(image, makeUserText('span', '', input.name), remove);
    elements.manualImagePreview.append(item);
  }
}

async function appendPendingManualFiles(files) {
  const remaining = Math.max(0, 100 - pendingManualImages.length);
  if (!remaining) throw new Error('单个项目最多添加 100 张图片。');
  const additions = await imageInputsFromFiles([...files].slice(0, remaining));
  pendingManualImages.push(...additions);
  renderPendingManualImages();
}

async function openThumbnailLightbox(recordId, relativePath, title) {
  const dataUrl = await safely(() => window.archiveApp.getThumbnail(recordId, relativePath));
  if (!dataUrl) {
    showToast('缩略图读取失败', true);
    return;
  }
  lightboxContext = { recordId, relativePath, title };
  elements.lightboxImage.src = dataUrl;
  if (title) elements.lightboxTitle.dataset.i18nUserText = 'true';
  else elements.lightboxTitle.removeAttribute('data-i18n-user-text');
  elements.lightboxPath.dataset.i18nUserText = 'true';
  elements.lightboxTitle.textContent = title || t('媒体预览');
  elements.lightboxPath.textContent = relativePath;
  const summary = (currentState?.catalog || []).find((record) => record.id === recordId);
  const isCurrentCover = summary?.coverThumbnailRef === relativePath ||
    (!summary?.coverThumbnailRef && summary?.coverRelativePath === relativePath);
  elements.setThumbnailCover.disabled = isCurrentCover;
  elements.setThumbnailCover.textContent = t(isCurrentCover ? '当前项目封面' : '设为项目封面');
  elements.thumbnailLightbox.showModal();
}

function closeThumbnailLightbox() {
  elements.thumbnailLightbox.close();
  elements.lightboxImage.removeAttribute('src');
  lightboxContext = null;
}

function flattenDirectoryTree(root) {
  const rows = [];
  const visit = (node, depth, parentKey) => {
    const key = `${parentKey}/${node.name}`;
    const count = node.files.length + node.directories.size;
    rows.push({ type: 'directory', depth, name: node.name, relativePath: node.path, count, key, hasChildren: count > 0 });
    for (const child of [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) visit(child, depth + 1, key);
    for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) rows.push({ type: 'file', depth: depth + 1, file });
  };
  if (root.name) {
    visit(root, 0, '');
  } else {
    for (const directory of [...root.directories.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) visit(directory, 0, '');
    for (const file of [...root.files].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) rows.push({ type: 'file', depth: 0, file });
  }
  return rows;
}

function hideSimilarityWhitelistAction() {
  if (!similarityWhitelistPopover) return;
  similarityWhitelistPopover.hidden = true;
  similarityWhitelistPopover.disabled = false;
  similarityWhitelistPopover.removeAttribute('data-term');
  similarityWhitelistAnchor = null;
}

function positionSimilarityWhitelistAction(mark) {
  if (!similarityWhitelistPopover || similarityWhitelistPopover.hidden || !mark?.isConnected) return;
  requestAnimationFrame(() => {
    if (!similarityWhitelistPopover || similarityWhitelistPopover.hidden || mark !== similarityWhitelistAnchor || !mark.isConnected) return;
    const markRect = mark.getBoundingClientRect();
    const buttonRect = similarityWhitelistPopover.getBoundingClientRect();
    const gap = 6;
    const edge = 10;
    const left = Math.min(
      Math.max(edge, window.innerWidth - buttonRect.width - edge),
      Math.max(edge, markRect.left)
    );
    let top = markRect.bottom + gap;
    if (top + buttonRect.height > window.innerHeight - edge) {
      top = Math.max(edge, markRect.top - buttonRect.height - gap);
    }
    similarityWhitelistPopover.style.left = `${left}px`;
    similarityWhitelistPopover.style.top = `${top}px`;
  });
}

function ensureSimilarityWhitelistAction() {
  if (similarityWhitelistPopover) return similarityWhitelistPopover;
  const button = make('button', 'similarity-whitelist-action', '一键加入白名单');
  button.type = 'button';
  button.hidden = true;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (similarityWhitelistWriteInFlight) return;
    const term = button.dataset.term || '';
    const recordId = elements.queueSimilarityReportDialog.open ? null : activeCatalogId;
    const reportJobId = activeQueueSimilarityReportJobId;
    hideSimilarityWhitelistAction();
    if (!term) return;
    similarityWhitelistContext = { recordId, reportJobId };
    elements.similarityWhitelistInput.value = term;
    elements.similarityWhitelistDialog.showModal();
    requestAnimationFrame(() => {
      elements.similarityWhitelistInput.focus();
      elements.similarityWhitelistInput.select();
    });
  });
  document.body.append(button);
  similarityWhitelistPopover = button;
  return button;
}

function closeSimilarityWhitelistDialog() {
  if (elements.similarityWhitelistDialog.open) elements.similarityWhitelistDialog.close();
  similarityWhitelistContext = null;
  elements.similarityWhitelistInput.value = '';
}

function showSimilarityWhitelistAction(mark) {
  const term = mark?.dataset.whitelistTerm || '';
  if (!term) return;
  const button = ensureSimilarityWhitelistAction();
  const host = mark.closest('dialog[open]') || document.body;
  if (button.parentElement !== host) host.append(button);
  similarityWhitelistAnchor = mark;
  button.dataset.term = term;
  button.hidden = false;
  positionSimilarityWhitelistAction(mark);
}

function appendHighlightedName(parent, text, similarRanges = [], { whitelistable = false, exactRanges = [] } = {}) {
  parent.dataset.i18nUserText = 'true';
  const normalizeRanges = (ranges) => (ranges || []).map(([start, end]) => [
    Math.max(0, Math.min(text.length, Number(start) || 0)),
    Math.max(0, Math.min(text.length, Number(end) || 0))
  ]).filter(([start, end]) => end > start);
  const redRanges = normalizeRanges(similarRanges);
  const goldRanges = normalizeRanges(exactRanges);
  const boundaries = [...new Set([0, text.length, ...redRanges.flat(), ...goldRanges.flat()])]
    .sort((left, right) => left - right);
  const overlaps = (ranges, start, end) => ranges.some(([rangeStart, rangeEnd]) => rangeStart < end && rangeEnd > start);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const exact = overlaps(goldRanges, start, end);
    const similar = !exact && overlaps(redRanges, start, end);
    if (!exact && !similar) {
      parent.append(document.createTextNode(text.slice(start, end)));
      continue;
    }
    const mark = document.createElement('mark');
    mark.className = exact ? 'exact-duplicate-mark' : 'similar-name-mark';
    mark.textContent = text.slice(start, end);
    if (similar && whitelistable) {
      mark.classList.add('whitelistable');
      mark.dataset.whitelistTerm = mark.textContent;
      mark.tabIndex = 0;
      mark.setAttribute('role', 'button');
      mark.title = t('点击标记常用词');
      mark.addEventListener('click', (event) => {
        event.stopPropagation();
        showSimilarityWhitelistAction(mark);
      });
      mark.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        showSimilarityWhitelistAction(mark);
      });
    }
    parent.append(mark);
  }
}

function renderVirtualDirectoryTree(root, similarEntryMatches = []) {
  const allRows = flattenDirectoryTree(root);
  if (allRows.length === 0) return make('p', 'muted', '这个归档中没有文件。');
  const collapsed = new Set();
  const similarityMap = new Map((similarEntryMatches || []).map((entry) => [
    `${entry.kind}:${String(entry.relativePath || '').replace(/\\/g, '/')}`,
    entry
  ]));
  for (const row of allRows) {
    if (row.type === 'directory' && row.hasChildren && row.depth >= 2) collapsed.add(row.key);
  }
  const visibleRows = () => {
    const visible = [];
    let skipDepth = null;
    for (const row of allRows) {
      if (skipDepth !== null) {
        if (row.depth > skipDepth) continue;
        skipDepth = null;
      }
      visible.push(row);
      if (row.type === 'directory' && collapsed.has(row.key)) skipDepth = row.depth;
    }
    return visible;
  };
  const viewport = make('div', 'virtual-directory-tree');
  const canvas = make('div', 'virtual-directory-canvas');
  const rowHeight = 48;
  viewport.append(canvas);
  let rows = visibleRows();
  const paint = () => {
    rows = visibleRows();
    canvas.style.height = `${rows.length * rowHeight}px`;
    const maxScrollTop = Math.max(0, rows.length * rowHeight - viewport.clientHeight);
    if (viewport.scrollTop > maxScrollTop) viewport.scrollTop = maxScrollTop;
    const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 6);
    const count = Math.ceil(viewport.clientHeight / rowHeight) + 12;
    const last = Math.min(rows.length, first + count);
    const fragment = document.createDocumentFragment();
    for (let index = first; index < last; index += 1) {
      const item = rows[index];
      const row = make('div', `virtual-tree-row ${item.type}${item.type === 'directory' && item.hasChildren ? ' collapsible' : ''}`);
      const relativePath = item.type === 'directory' ? item.relativePath : item.file.relativePath;
      const similarity = similarityMap.get(`${item.type}:${relativePath}`);
      const whitelistable = Boolean(similarity?.matches?.some((match) =>
        match.reason === '目录名相似' || match.reason === '文件名相似'));
      const hasExactDuplicate = Boolean(similarity?.matches?.some((match) =>
        match.reason === '文件内容完全一致' || match.reason === '目录名完全一致'));
      const hasIdenticalContent = Boolean(similarity?.matches?.some((match) =>
        match.reason === '文件内容完全一致'));
      if (similarity) {
        row.classList.add('similar-entry');
        row.classList.toggle('exact-entry', hasExactDuplicate);
        row.dataset.similarEntry = 'true';
        row.title = similarity.matches.map((match) => `${match.reason}：${match.title} / ${match.relativePath}`).join('\n');
      }
      row.style.top = `${index * rowHeight}px`;
      row.style.paddingLeft = `${12 + item.depth * 18}px`;
      if (item.type === 'directory') {
        const isCollapsed = collapsed.has(item.key);
        row.setAttribute('aria-expanded', item.hasChildren ? String(!isCollapsed) : 'false');
        if (item.hasChildren) {
          row.dataset.treeKey = item.key;
          row.append(make('span', `virtual-tree-icon toggle${isCollapsed ? ' collapsed' : ''}`, isCollapsed ? '▸' : '▾'));
        } else {
          row.append(make('span', 'virtual-tree-icon', '·'));
        }
        const name = make('strong', '');
        appendHighlightedName(name, item.name, similarity?.similarRanges || similarity?.ranges || [], {
          whitelistable,
          exactRanges: similarity?.exactRanges || []
        });
        row.append(name, make('small', '', `${item.count} 项`));
      } else {
        const name = make('span', 'virtual-tree-name');
        appendHighlightedName(name, item.file.name, similarity?.similarRanges || similarity?.ranges || [], {
          whitelistable,
          exactRanges: similarity?.exactRanges || []
        });
        const metadata = make('small', 'virtual-tree-metadata');
        metadata.append(document.createTextNode(`${formatBytes(item.file.size)} · `));
        const md5 = String(item.file.md5 || '无 MD5');
        if (hasIdenticalContent && /^[a-f0-9]{32}$/i.test(md5)) {
          metadata.append(make('mark', 'exact-duplicate-mark exact-content-md5', md5));
        } else {
          metadata.append(document.createTextNode(md5));
        }
        row.append(
          make('span', 'virtual-tree-icon file', (item.file.extension || 'FILE').replace('.', '').slice(0, 4).toUpperCase()),
          name,
          metadata
        );
      }
      fragment.append(row);
    }
    canvas.replaceChildren(fragment);
  };
  viewport.addEventListener('scroll', () => {
    hideSimilarityWhitelistAction();
    paint();
  }, { passive: true });
  viewport.addEventListener('click', (event) => {
    if (event.target.closest('.similar-name-mark.whitelistable')) return;
    const row = event.target.closest('.virtual-tree-row.collapsible');
    if (!row || !viewport.contains(row)) return;
    const key = row.dataset.treeKey;
    if (!key) return;
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    paint();
  });
  viewport.locateFirstSimilarity = () => {
    const target = allRows.find((row) => similarityMap.has(`${row.type}:${row.type === 'directory' ? row.relativePath : row.file.relativePath}`));
    if (!target) return false;
    collapsed.clear();
    rows = visibleRows();
    const index = rows.indexOf(target);
    viewport.scrollTop = Math.max(0, index * rowHeight - rowHeight);
    paint();
    requestAnimationFrame(() => viewport.querySelector('[data-similar-entry="true"]')?.focus?.({ preventScroll: true }));
    return true;
  };
  requestAnimationFrame(paint);
  return viewport;
}

function queueSimilarityEvidenceText(project) {
  return uiState.queueSimilarityEvidenceText(project);
}

function renderQueueSimilarityReport(report) {
  elements.queueSimilarityReportContent.replaceChildren();
  const overview = make('section', 'queue-similarity-overview');
  overview.append(makeUserText('h3', '', report.displayName));
  const location = make('div', 'queue-similarity-location');
  location.append(make('span', '', '位置'), makeUserText('code', '', report.sourcePath));
  const open = make('button', 'button ghost', '打开');
  open.type = 'button';
  open.dataset.reportOpenSource = report.jobId;
  location.append(open);
  overview.append(location);

  const legend = make('div', 'similarity-report-legend');
  legend.append(
    make('span', 'similarity-report-legend-item similar', '红色 · 名称或相似证据'),
    make('span', 'similarity-report-legend-item exact', '金色 · 内容或名称完全一致')
  );
  overview.append(legend);
  if (report.fingerprintPending) {
    overview.append(make('p', 'similarity-report-pending muted', report.reusedFingerprintCount > 0
      ? '其余内容完全一致的文件会在队列生成 MD5 后显示；当前已复用仓库中同一源项目未变化文件的已有 MD5。'
      : '内容完全一致的文件会在队列生成 MD5 后显示；当前报告只显示名称和大小证据。'));
  } else if (report.reusedFingerprintCount > 0) {
    overview.append(make('p', 'similarity-report-pending muted', '已复用仓库中同一源项目的已有 MD5；未重新读取文件内容。'));
  }
  elements.queueSimilarityReportContent.append(overview);

  const directorySection = make('section', 'queue-similarity-directory');
  directorySection.append(make('h3', '', '当前项目目录'));
  const root = createTree(
    report.directories || [],
    report.manifest || [],
    report.sourceType === 'directory' ? report.displayName : ''
  );
  directorySection.append(renderVirtualDirectoryTree(root, report.similarEntryMatches || []));
  elements.queueSimilarityReportContent.append(directorySection);

  const projects = make('section', 'queue-similarity-projects');
  projects.append(make('h3', '', '相似项目'));
  if ((report.similarProjects || []).length === 0) {
    projects.append(make('p', 'muted', '当前没有可跳转的仓库项目。'));
  } else {
    const list = make('div', 'queue-similarity-project-list');
    for (const project of report.similarProjects) {
      const item = make('article', 'queue-similarity-project');
      const copy = make('div', 'queue-similarity-project-copy');
      copy.append(makeUserText('strong', '', project.title), makeStage('small', '', queueSimilarityEvidenceText(project)));
      const jump = make('button', 'button ghost', '跳转到项目');
      jump.type = 'button';
      jump.dataset.reportCatalogRecord = project.id;
      item.append(copy, jump);
      list.append(item);
    }
    projects.append(list);
  }
  elements.queueSimilarityReportContent.append(projects);
}

async function loadQueueSimilarityReport(jobId, { keepOpen = false } = {}) {
  const requestId = ++queueSimilarityReportRequest;
  activeQueueSimilarityReportJobId = jobId;
  elements.queueSimilarityReportContent.replaceChildren(make('p', 'muted', '正在生成相似报告…'));
  if (!elements.queueSimilarityReportDialog.open) elements.queueSimilarityReportDialog.showModal();
  const report = await safely(() => window.archiveApp.getQueueSimilarityReport(jobId));
  if (requestId !== queueSimilarityReportRequest || activeQueueSimilarityReportJobId !== jobId) return;
  if (!report) {
    elements.queueSimilarityReportContent.replaceChildren(make('p', 'muted', '相似报告生成失败，请检查项目位置后重试。'));
    return;
  }
  renderQueueSimilarityReport(report);
  if (keepOpen && !elements.queueSimilarityReportDialog.open) elements.queueSimilarityReportDialog.showModal();
}

function closeQueueSimilarityReport({ preserve = false } = {}) {
  hideSimilarityWhitelistAction();
  if (elements.queueSimilarityReportDialog.open) elements.queueSimilarityReportDialog.close();
  if (!preserve) {
    activeQueueSimilarityReportJobId = null;
    suspendedQueueSimilarityReport = false;
    queueSimilarityReportRequest += 1;
  }
}

function renderCatalogEditor(record) {
  const section = make('section', 'catalog-editor');
  section.append(make('h3', '', '整理信息'));
  const form = make('form', 'catalog-editor-form');

  const titleLabel = make('label', 'editor-field');
  titleLabel.append(make('span', '', '标题'));
  const titleInput = document.createElement('input');
  titleInput.name = 'title';
  titleInput.maxLength = 200;
  titleInput.required = true;
  titleInput.value = catalogTitle(record);
  titleLabel.append(titleInput);

  const tagsLabel = make('label', 'editor-field tag-autocomplete-field');
  tagsLabel.append(make('span', '', '标签'));
  const tagsInput = document.createElement('input');
  tagsInput.name = 'tags';
  tagsInput.value = catalogTags(record).join('，');
  tagsInput.placeholder = '例如：摄影，旅行，待整理（用逗号分隔）';
  tagsLabel.append(tagsInput);
  tagAutocomplete?.bindTagAutocomplete(tagsInput, tagAutocompleteOptions());

  const backupLabel = make('label', 'editor-field');
  backupLabel.append(make('span', '', '备份位置'));
  const backupInput = document.createElement('input');
  backupInput.name = 'backupLocation';
  backupInput.maxLength = 200;
  backupInput.value = record.backupLocation || '';
  backupInput.placeholder = '例如：百度网盘 / 家庭备份盘 A';
  backupLabel.append(backupInput);

  let passwordLabel = null;
  let passwordInput = null;
  let passwordEditing = false;
  if (record.recordType !== 'manual') {
    passwordLabel = make('label', 'editor-field password-editor-field');
    passwordLabel.append(make('span', '', '解压密码'));
    const passwordControl = make('div', 'password-editor-control');
    passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    passwordInput.maxLength = 128;
    passwordInput.autocomplete = 'new-password';
    passwordInput.value = record.archivePassword || '';
    passwordInput.readOnly = true;
    passwordInput.placeholder = record.hasPassword
      ? (record.passwordRecorded ? '' : '压缩包已加密，但密码未记录')
      : '未加密';
    const originalPassword = passwordInput.value;
    const showPassword = make('button', 'mini-copy-button', '显示');
    showPassword.type = 'button';
    showPassword.addEventListener('click', () => {
      const showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      showPassword.textContent = t(showing ? '显示' : '隐藏');
    });
    const editPassword = make('button', 'mini-copy-button', '修改');
    editPassword.type = 'button';
    editPassword.addEventListener('click', () => {
      if (passwordEditing) {
        passwordInput.value = originalPassword;
        passwordInput.readOnly = true;
        passwordInput.type = 'password';
        showPassword.textContent = t('显示');
        editPassword.textContent = t('修改');
        passwordEditing = false;
      } else {
        passwordInput.readOnly = false;
        passwordInput.type = 'text';
        showPassword.textContent = t('隐藏');
        editPassword.textContent = t('取消');
        passwordEditing = true;
        passwordInput.focus();
        passwordInput.select();
      }
    });
    const copyPassword = make('button', 'mini-copy-button', '复制');
    copyPassword.type = 'button';
    copyPassword.disabled = !passwordInput.value;
    copyPassword.addEventListener('click', async () => {
      const copied = await safely(() => window.archiveApp.copyText(passwordInput.value));
      if (copied) showToast('解压密码已复制');
    });
    passwordInput.addEventListener('input', () => { copyPassword.disabled = !passwordInput.value; });
    passwordControl.append(passwordInput, showPassword, editPassword, copyPassword);
    passwordLabel.append(passwordControl);
  }

  const ratingField = make('div', 'editor-field rating-field');
  ratingField.append(make('span', '', '星级'));
  const ratingButtons = make('div', 'rating-buttons');
  let selectedRating = Number(record.rating) || 0;
  const paintRating = () => {
    ratingButtons.querySelectorAll('button').forEach((button) => {
      const value = Number(button.dataset.rating);
      button.classList.toggle('selected', value > 0 && value <= selectedRating);
      button.setAttribute('aria-pressed', String(value === selectedRating));
    });
  };
  const clearRating = make('button', 'clear-rating', '清除');
  clearRating.type = 'button';
  clearRating.dataset.rating = '0';
  ratingButtons.append(clearRating);
  for (let value = 1; value <= 5; value += 1) {
    const button = make('button', 'star-button', '★');
    button.type = 'button';
    button.dataset.rating = String(value);
    button.setAttribute('aria-label', `${value} 星`);
    ratingButtons.append(button);
  }
  ratingButtons.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-rating]');
    if (!button) return;
    selectedRating = Number(button.dataset.rating);
    paintRating();
  });
  paintRating();
  ratingField.append(ratingButtons);

  const notesLabel = make('label', 'editor-field editor-notes');
  notesLabel.append(make('span', '', record.recordType === 'manual' ? '备注（必填）' : '备注'));
  const notesInput = document.createElement('textarea');
  notesInput.name = 'notes';
  notesInput.required = record.recordType === 'manual';
  notesInput.maxLength = 5000;
  notesInput.rows = 4;
  notesInput.placeholder = '记录来源、内容特点、后续处理计划等，支持直接粘贴图片';
  notesInput.value = record.notes || '';
  notesLabel.append(notesInput);

  const imageInput = document.createElement('input');
  imageInput.id = `catalog-image-input-${record.id}`;
  imageInput.className = 'image-file-input';
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
  imageInput.multiple = true;

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    const inputs = await safely(() => imageInputsFromFiles(files));
    if (!inputs) return;
    const updated = await safely(() => addImagesToCatalog(record.id, inputs));
    if (!updated) return;
    renderCatalogDetail(updated);
    const state = await safely(() => window.archiveApp.getState());
    if (state) {
      render(state);
      await refreshCatalog();
    }
    showToast(`已添加 ${inputs.length} 张图片`);
  };

  imageInput.addEventListener('change', () => { void uploadFiles(imageInput.files); });
  notesInput.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  });

  const submit = make('button', 'button primary editor-save', '保存整理信息');
  submit.type = 'submit';
  const formActions = make('div', 'catalog-form-actions');
  const imagePickerButton = make('label', 'button ghost', '添加图片');
  imagePickerButton.htmlFor = imageInput.id;
  formActions.append(imageInput, imagePickerButton, submit);
  form.append(titleLabel, tagsLabel, ratingField, backupLabel);
  if (passwordLabel) form.append(passwordLabel);
  form.append(notesLabel, formActions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const updated = await safely(() => window.archiveApp.updateCatalogMetadata(record.id, {
      title: titleInput.value,
      tags: tagsInput.value,
      rating: selectedRating,
      notes: notesInput.value,
      backupLocation: backupInput.value,
      ...(passwordInput && passwordEditing ? {
        archivePassword: passwordInput.value,
        passwordRecorded: Boolean(passwordInput.value)
      } : {})
    }));
    submit.disabled = false;
    if (!updated) return;
    renderCatalogDetail(updated);
    const state = await safely(() => window.archiveApp.getState());
    if (state) {
      currentState = state;
      updateTagFilterOptions(state.catalog);
      await refreshCatalog();
    }
    showToast('仓库整理信息已保存');
  });

  section.append(form);
  return section;
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value || '')).protocol);
  } catch {
    return false;
  }
}

function sourceLocationPresentation(record) {
  const originalPath = String(record.originalSourcePath || record.sourcePath || '').trim();
  if (record.sourceDisposition === 'missing') {
    return { text: '未发现原文件', value: '', isPath: false, canOpen: false };
  }
  if (record.sourceDisposition === 'trashed') {
    if (record.trashVerified === false) {
      return { text: '已执行移入回收站，但回收站中未找到该文件——回收站可能已满，文件或已被永久删除', value: originalPath, isPath: false, canOpen: false, inTrash: true, warning: true };
    }
    return { text: '源文件已进入回收站', value: originalPath, isPath: false, canOpen: Boolean(originalPath), inTrash: true };
  }
  if (record.sourceDisposition === 'moved') {
    const movedTo = String(record.movedTo || '').trim();
    return { text: movedTo ? `已移动到：${movedTo}` : '源文件已移动', value: movedTo, isPath: false, canOpen: Boolean(movedTo) };
  }
  if (originalPath) return { text: originalPath, value: originalPath, isPath: true, canOpen: true };
  return { text: '未记录', value: '', isPath: false, canOpen: false };
}

function renderSimilarProjects(record) {
  const warning = make('section', 'similar-projects');
  const head = make('div', 'similar-projects-head');
  head.append(make('h3', '', record.possibleDuplicate ? '可能重复 · 相似项目' : '相似项目'));
  const actions = make('div', 'similar-project-actions');
  const locate = make('button', 'button ghost', '定位相似文件');
  locate.type = 'button';
  locate.dataset.locateSimilar = record.id;
  locate.disabled = (record.similarEntryMatches || []).length === 0;
  const recalculate = make('button', 'button ghost', '重新计算');
  recalculate.type = 'button';
  recalculate.dataset.recalculateSimilar = record.id;
  const manage = make('button', 'button ghost', similarityManageRecordId === record.id ? '完成管理' : '管理');
  manage.type = 'button';
  manage.dataset.manageSimilar = record.id;
  actions.append(locate, recalculate, manage);
  head.append(actions);
  warning.append(head);
  if ((record.similarRecords || []).length === 0) {
    warning.classList.add('empty');
    warning.append(make('p', 'muted', '当前没有已关联的相似项目。'));
  } else {
    const links = make('div', 'similar-project-links');
    for (const similar of record.similarRecords) {
      const item = make('span', 'similar-project-item');
      const button = make('button', 'button ghost');
      button.append(
        makeUserText('span', '', similar.title),
        document.createTextNode(` · ${Math.round((similar.score || 0) * 100)}%`)
      );
      button.type = 'button';
      button.dataset.similarRecord = similar.id;
      button.title = (similar.reasons || []).join('；');
      item.append(button);
      if (similarityManageRecordId === record.id) {
        const remove = make('button', 'remove-similar-button', '×');
        remove.type = 'button';
        remove.dataset.removeSimilar = similar.id;
        remove.dataset.recordId = record.id;
        remove.setAttribute('aria-label', `移除与“${similar.title}”的相似关系`);
        item.append(remove);
      }
      links.append(item);
    }
    warning.append(links);
  }
  return warning;
}

function renderCatalogDetail(record) {
  if (!record || record.id !== activeCatalogId) return;
  hideSimilarityWhitelistAction();
  elements.catalogDetail.replaceChildren();
  const heading = make('div', 'archive-heading');
  heading.append(makeUserText('h3', '', catalogTitle(record)));
  if (record.title && record.title !== record.displayName) {
    const originalTitle = make('p', 'original-title');
    originalTitle.append(make('span', '', '原始名称：'), makeUserText('span', '', record.displayName));
    heading.append(originalTitle);
  }
  heading.append(make('p', 'inventory-date', `入库日期：${formatCatalogDate(record.inventoryDate || record.completedAt)}`));
  if (record.recordType === 'manual') {
    heading.append(make('p', '', '手动库存记录 · 未关联压缩包或文件清单'));
  }
  const sourceLocation = sourceLocationPresentation(record);
  {
    const sourceLine = make('p', 'source-location');
    sourceLine.append(document.createTextNode('原文件位置：'));
    if (sourceLocation.isPath && isHttpUrl(sourceLocation.value)) {
      const sourceLink = makeUserText('button', 'inline-link', sourceLocation.text);
      sourceLink.type = 'button';
      sourceLink.dataset.externalUrl = sourceLocation.value;
      sourceLine.append(sourceLink);
    } else {
      sourceLine.append(makeUserText('span', '', sourceLocation.text));
    }
    if (sourceLocation.canOpen && !isHttpUrl(sourceLocation.value)) {
      const openSource = make('button', 'mini-copy-button', '打开');
      openSource.type = 'button';
      openSource.dataset.openSource = record.id;
      openSource.title = sourceLocation.inTrash ? '从回收站复原到原位置' : '打开原文件当前位置';
      sourceLine.append(openSource);
    }
    heading.append(sourceLine);
  }
  if (record.recordType !== 'manual') {
    const archiveFileNames = (record.archiveFiles || []).map((file) => file.name);
    const archiveNames = archiveFileNames.join('、');
    const archiveLine = make('p', 'archive-name-line');
    archiveLine.append(document.createTextNode(record.archiveState === 'uncompressed'
      ? '压缩包：未生成（未压缩）'
      : `压缩包：${archiveNames || record.archiveBaseName || '无'}`));
    if (archiveNames || record.archiveBaseName) {
      const copy = make('button', 'mini-copy-button', '复制');
      copy.type = 'button';
      copy.dataset.copyText = archiveFileNames.length > 0 ? archiveFileNames.join('\n') : record.archiveBaseName;
      archiveLine.append(copy);
    }
    heading.append(archiveLine);
  }
  const stats = make('div', 'archive-stats');
  if (record.recordType === 'manual') {
    stats.append(make('span', '', '手动库存'));
  } else {
    stats.append(
      make('span', '', `${record.fileCount || 0} 个文件`),
      make('span', '', `${record.directories?.length || 0} 个子目录`),
      make('span', '', `原始 ${formatBytes(record.originalBytes)}`),
      make('span', '', record.archiveState === 'uncompressed'
        ? '压缩后 未压缩'
        : `压缩后 ${formatBytes(record.archiveTotalBytes)}`)
    );
  }
  if (record.backupLocation) {
    const backupStat = make('span', 'backup-stat');
    backupStat.append(make('span', '', '备份位置：'), makeUserText('span', '', record.backupLocation));
    stats.append(backupStat);
  }
  heading.append(stats);
  elements.catalogDetail.append(heading);
  elements.catalogDetail.append(renderCatalogEditor(record));
  elements.catalogDetail.append(renderSimilarProjects(record));

  if (record.recordType === 'manual') {
    const note = make('div', 'manual-record-note');
    note.append(
      make('strong', '', '这是手动库存记录'),
      make('p', '', '它只保存名称、备注及整理信息，不代表程序已经生成或验证过压缩包。')
    );
    elements.catalogDetail.append(note);
  }

  const manualImageFiles = (record.manualImages || []).map((image) => ({
    name: image.name || image.relativePath || '手动添加图片',
    relativePath: image.relativePath || image.name || '手动添加图片',
    thumbnailPath: image.thumbnailPath,
    manualThumbnailRef: image.ref
  }));
  const thumbnailFiles = [...(record.manifest || []), ...manualImageFiles]
    .filter((file) => thumbnailsForFile(file).length > 0);
  const thumbnailCount = thumbnailFiles.reduce((sum, file) => sum + thumbnailsForFile(file).length, 0);
  if (thumbnailCount > 0) {
    const mediaSection = make('details', 'media-preview-section');
    mediaSection.open = true;
    mediaSection.append(make('summary', '', `媒体预览 · ${thumbnailCount} 张`));
    const imageGallery = make('div', 'thumbnail-gallery media-image-gallery');
    for (const file of thumbnailFiles) {
      const thumbnails = thumbnailsForFile(file);
      if (thumbnails.length === 1) {
        const thumbnail = thumbnails[0];
        const card = make('div', 'thumbnail-card');
        appendContainedThumbnail(card, record.id, thumbnail.ref, file.name, 'thumbnail-card-frame');
        card.append(make('span', '', thumbnail.label));
        imageGallery.append(card);
        continue;
      }
      const group = make('section', thumbnails.length > 1 ? 'thumbnail-group video-thumbnail-group' : 'thumbnail-group');
      if (thumbnails.length > 1) {
        const groupHead = make('div', 'thumbnail-group-head');
        const details = videoInfoText(file);
        groupHead.append(
          makeUserText('strong', '', file.relativePath),
          make('span', '', `同一视频 · ${thumbnails.length} 帧 · 平均取样${details ? ` · ${details}` : ''}`)
        );
        group.append(groupHead);
      }
      const gallery = make('div', 'thumbnail-gallery');
      for (const thumbnail of thumbnails) {
        const card = make('div', 'thumbnail-card');
        const title = thumbnails.length > 1 ? `${file.name} · ${thumbnail.label}` : file.name;
        appendContainedThumbnail(card, record.id, thumbnail.ref, title, 'thumbnail-card-frame');
        card.append(make('span', '', thumbnail.label));
        gallery.append(card);
      }
      group.append(gallery);
      mediaSection.append(group);
    }
    if (imageGallery.childElementCount > 0) {
      const firstVideoGroup = mediaSection.querySelector('.video-thumbnail-group');
      if (firstVideoGroup) mediaSection.insertBefore(imageGallery, firstVideoGroup);
      else mediaSection.append(imageGallery);
    }
    elements.catalogDetail.append(mediaSection);
  }

  if (record.recordType === 'manual') return;
  const directoryHeading = make('h3', 'directory-structure-heading', '完整目录结构');
  elements.catalogDetail.append(directoryHeading);
  const root = createTree(
    record.directories || [],
    record.manifest || [],
    record.sourceType === 'directory' ? record.displayName : ''
  );
  elements.catalogDetail.append(renderVirtualDirectoryTree(root, record.similarEntryMatches || []));
}

async function loadCatalogDetails(recordId) {
  const requestId = ++catalogDetailRequest;
  activeCatalogId = recordId;
  syncCatalogItemState();
  elements.catalogDetail.setAttribute('aria-busy', 'true');
  if (elements.catalogDetail.querySelector('.empty-library')) {
    elements.catalogDetail.replaceChildren(make('p', 'muted', '正在读取完整目录和缩略图…'));
  }
  const record = await safely(() => window.archiveApp.getCatalogDetails(recordId));
  if (requestId !== catalogDetailRequest || activeCatalogId !== recordId) return;
  elements.catalogDetail.removeAttribute('aria-busy');
  if (record) renderCatalogDetail(record);
}

function renderSummary(state) {
  const jobs = state.jobs;
  const currentJob = jobs.find((job) => job.id === state.currentJobId);
  document.querySelector('#summary-total').textContent = String(jobs.length);
  document.querySelector('#summary-confirm').textContent = String(jobs.filter((job) => [
    'awaiting_confirmation', 'awaiting_duplicate_confirmation', 'awaiting_anomaly_confirmation',
    'awaiting_trash_safety_confirmation'
  ].includes(job.status)).length);
  document.querySelector('#summary-queued').textContent = String(jobs.filter((job) => job.status === 'queued').length);
  document.querySelector('#summary-completed').textContent = String(jobs.filter((job) => job.status.startsWith('completed')).length);
  document.querySelector('#summary-bytes').textContent = formatBytes(jobs.reduce((sum, job) => sum + job.totalBytes, 0));
  elements.runningIndicator.textContent = t(state.paused
    ? '当前任务已暂停'
    : state.pauseAfterCurrent ? '完成本项后暂停'
      : state.scheduleWaiting ? '等待定时时段'
        : state.running ? '队列运行中' : '空闲');
  if (state.safetyHalt) {
    elements.runningIndicator.textContent = t('安全停止：等待确认');
  }
  elements.runningIndicator.classList.toggle('active', state.running);
  document.querySelector('#start-queue').disabled = state.running || !jobs.some((job) =>
    ['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status));
  document.querySelector('#start-inventory-only').disabled = state.running || !jobs.some((job) =>
    !job.sourceCatalogRecordId && ['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status));
  if (state.safetyHalt) document.querySelector('#start-queue').disabled = true;
  if (state.safetyHalt) document.querySelector('#start-inventory-only').disabled = true;
  document.querySelector('#scan-source').disabled = state.running;
  document.querySelector('#add-folder').disabled = state.running;
  document.querySelector('#add-video').disabled = state.running;
  setConfigControlsLocked(state.running);
  document.querySelector('#clear-completed').disabled = !jobs.some((job) => String(job.status).startsWith('completed'));
  document.querySelector('#clear-cancelled').disabled = !jobs.some((job) => job.status === 'cancelled');
  document.querySelector('#clear-queue').disabled = jobs.length === 0;
  document.querySelector('#finish-next').disabled = !jobs.some((job) => job.status === 'queued') && !state.running;
  document.querySelector('#clear-duplicates').disabled = !jobs.some((job) =>
    (job.nameDuplicateMatches || []).length > 0 || (job.similarMatches || []).length > 0);
  document.querySelector('#clear-exact-duplicates').disabled = !jobs.some((job) =>
    (job.exactDuplicateMatches || []).length > 0 || (job.exactProjectMatches || []).length > 0);
  document.querySelector('#confirm-all-duplicates').disabled = !jobs.some((job) =>
    job.status === 'awaiting_duplicate_confirmation' ||
    (job.similarityPreflightBlocking !== false && job.status === 'awaiting_confirmation' && (job.confirmationReasons || []).some((reason) =>
      ['name_match', 'similar_title', 'same_video_size'].includes(reason))));
  elements.undoCatalog.disabled = !state.undoDepth;
  elements.undoCatalog.textContent = t(state.undoDepth ? `撤回：${state.undoLabel}` : '撤回');
  elements.undoCatalog.title = state.undoDepth ? `撤回：${state.undoLabel}` : t('撤回');

  const canPause = state.running && !state.paused && ['inventorying', 'compressing', 'verifying'].includes(currentJob?.status);
  document.querySelector('#pause-queue').hidden = !canPause;
  document.querySelector('#resume-queue').hidden = !state.paused;
  document.querySelector('#cancel-current').hidden = !(state.paused && currentJob);
  renderSafetyChip(Boolean(state.config.autoTrashCompleted), Boolean(state.config.moveCompleted));

  if (state.safetyHalt) {
    elements.autoTrash.checked = false;
    elements.trashSafetyMessage.textContent = t(state.safetyHalt.message);
    if (!elements.trashSafetyDialog.open) elements.trashSafetyDialog.showModal();
  } else if (elements.trashSafetyDialog.open) {
    elements.trashSafetyDialog.close();
  }

  if (state.skippedRootFiles.length > 0) {
    const skipped = uiState.summarizeScanSkips(state.skippedRootFiles);
    const details = [];
    if (skipped.smallItems > 0) details.push(t(`${skipped.smallItems} 个低于 ${skipped.smallItemThresholdMb} MB 的小项目`));
    if (skipped.rootNonVideoFiles > 0) details.push(t(`${skipped.rootNonVideoFiles} 个根目录非视频文件`));
    if (skipped.links > 0) details.push(t(`${skipped.links} 个链接或重解析点`));
    if (skipped.unreadable > 0) details.push(t(`${skipped.unreadable} 个无法读取的项目`));
    if (skipped.other > 0) details.push(t(`${skipped.other} 个不支持的项目`));
    elements.looseSummary.hidden = false;
    elements.looseSummary.textContent = `${t('扫描未入队')} ${skipped.total} ${t('项')}${t('：')}${details.join(t('，'))}${t('。')} ${t('这些内容不会移动。')}`;
  } else {
    elements.looseSummary.hidden = true;
  }
}

function render(state, includeConfig = false) {
  const mergedState = currentState
    ? { ...currentState, ...state, catalog: state.catalog || currentState.catalog }
    : state;
  currentState = mergedState;
  state = mergedState;
  if (includeConfig) renderConfig(state.config);
  renderSummary(state);
  renderJobs(state.jobs);
  renderLogs(state.logs);
  updateCatalogSelectionControls();
  void refreshWarehouseInsights();
  if ((discoveryMode === 'loading' || discoveryMode === 'empty') && state.catalog.length > 0) {
    void showRandomWalk(false);
  } else if (discoveryMode === 'random' && currentDiscoveryRecordIds.some((id) =>
    !state.catalog.some((record) => record.id === id))) {
    void showRandomWalk(false);
  }
  const nextCatalogSignature = JSON.stringify(state.catalog.map((record) => [
    record.id, record.metadataUpdatedAt, record.completedAt, record.coverThumbnailPath,
    record.backupLocation, record.rating, record.tags
  ]));
  if (nextCatalogSignature !== catalogStateSignature) {
    catalogStateSignature = nextCatalogSignature;
    catalogRefreshDirty = true;
    updateTagFilterOptions(state.catalog);
    updateBackupLocationFilterOptions(state.catalog);
      if (currentCatalogResults.length === 0 && state.catalog.length > 0) void refreshCatalog();
  }
  i18n?.translateDom(document.body);
}

async function saveConfig() {
  if (currentState?.running) {
    renderConfig(currentState.config);
    setConfigControlsLocked(true);
    showToast('队列运行期间不能修改设置', true);
    return null;
  }
  const state = await safely(() => window.archiveApp.saveConfig(readConfig()));
  if (state) {
    render(state, true);
    showToast('设置已保存');
  } else if (currentState?.config) {
    renderConfig(currentState.config);
    setConfigControlsLocked(Boolean(currentState.running));
  }
  return state;
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-button').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.app-page').forEach((page) => { page.hidden = page.id !== button.dataset.page; });
    if (button.dataset.page === 'library-page' && currentState) {
      if (catalogRefreshDirty || Date.now() - lastCatalogRefreshAt > 10_000) void refreshCatalog();
      requestAnimationFrame(applyCatalogGridLayout);
    }
    if (button.dataset.page === 'workspace-page' && suspendedQueueSimilarityReport && activeQueueSimilarityReportJobId) {
      suspendedQueueSimilarityReport = false;
      requestAnimationFrame(() => {
        if (!elements.queueSimilarityReportDialog.open) elements.queueSimilarityReportDialog.showModal();
      });
    }
  });
});
document.querySelectorAll('.action-menu').forEach((menu) => {
  menu.addEventListener('click', (event) => {
    if (event.target.closest('button')) menu.removeAttribute('open');
  });
});
document.addEventListener('pointerdown', (event) => {
  for (const menu of document.querySelectorAll('.action-menu[open]')) {
    if (!menu.contains(event.target)) menu.removeAttribute('open');
  }
  if (similarityWhitelistPopover &&
      !similarityWhitelistPopover.contains(event.target) &&
      !event.target.closest('.similar-name-mark.whitelistable')) {
    hideSimilarityWhitelistAction();
  }
});

setInterval(() => {
  const libraryVisible = !document.querySelector('#library-page').hidden;
  if (libraryVisible && catalogRefreshDirty && Date.now() - lastCatalogRefreshAt >= 10_000) {
    void refreshCatalog();
  }
}, 2_000);

document.querySelectorAll('[data-pick]').forEach((button) => {
  button.addEventListener('click', async () => {
    const input = document.querySelector(`#${button.dataset.pick}`);
    const previousValue = input.value.trim();
    const previousDerivedStaging = input === elements.archiveOutputDirectory
      ? deriveStagingDirectory(previousValue)
      : '';
    const selected = await safely(() => window.archiveApp.chooseDirectory(input.value.trim()));
    if (!selected) return;
    input.value = selected;
    if (input === elements.archiveOutputDirectory &&
        (!elements.archiveStagingDirectory.value.trim() ||
          elements.archiveStagingDirectory.value.trim() === previousDerivedStaging)) {
      elements.archiveStagingDirectory.value = deriveStagingDirectory(selected);
    }
    await saveConfig();
  });
});

document.querySelector('.settings-col').addEventListener('input', updateSettingsDigests);
document.querySelector('.settings-col').addEventListener('change', updateSettingsDigests);
document.querySelector('#save-settings').addEventListener('click', saveConfig);
window.archiveApp.onUpdateProgress((progress) => {
  if (!elements.updateStatusChip || progress?.stage === 'prepared') return;
  elements.updateStatusChip.dataset.state = 'checking';
  if (progress.stage === 'copying') elements.updateStatusLabel.textContent = t('正在读取更新包…');
  else if (progress.stage === 'verifying') elements.updateStatusLabel.textContent = t('正在校验更新…');
  else if (progress.stage === 'downloading') {
    elements.updateStatusLabel.textContent = t(progress.totalBytes
      ? `下载更新 ${progress.percentage}%`
      : '正在下载更新…');
  }
});
elements.updateStatusChip?.addEventListener('click', async () => {
  const result = await runUpdateCheck();
  if (result?.launchFailed) showToast(t('自动更新未能启动，程序仍停留在当前版本'));
  else if (result?.staged) showToast('更新包已校验，等待重新启动');
  else if (result?.checkFailed && result.action !== 'manual') showToast('暂时无法获取最新版本', true);
  else if (result?.action === 'manual' && result.cancelled) return;
  else if (result) showToast(result.updateAvailable ? `发现新版本 ${result.latestVersion}` : '当前已是最新版本');
});
const usageGuideDialog = document.querySelector('#usage-guide-dialog');
document.querySelector('#open-usage-guide').addEventListener('click', () => usageGuideDialog.showModal());
document.querySelector('#close-usage-guide').addEventListener('click', () => usageGuideDialog.close());
document.querySelector('#confirm-usage-guide').addEventListener('click', () => usageGuideDialog.close());
elements.confirmDialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  closeConfirmDialog(true);
});
elements.cancelConfirmDialog.addEventListener('click', () => closeConfirmDialog(false));
elements.confirmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeConfirmDialog(false);
});
elements.confirmDialog.addEventListener('click', (event) => {
  if (event.target === elements.confirmDialog) closeConfirmDialog(false);
});
for (const selector of ['#close-similarity-whitelist', '#cancel-similarity-whitelist']) {
  document.querySelector(selector).addEventListener('click', closeSimilarityWhitelistDialog);
}
elements.similarityWhitelistDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeSimilarityWhitelistDialog();
});
elements.similarityWhitelistDialog.addEventListener('click', (event) => {
  if (event.target === elements.similarityWhitelistDialog) closeSimilarityWhitelistDialog();
});
elements.similarityWhitelistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (similarityWhitelistWriteInFlight) return;
  const term = elements.similarityWhitelistInput.value.trim();
  if (!term) return;
  const context = similarityWhitelistContext;
  similarityWhitelistWriteInFlight = true;
  elements.confirmSimilarityWhitelist.disabled = true;
  try {
    const result = await safely(() => window.archiveApp.addSimilarityIgnoreTerm(term));
    if (!result) return;
    closeSimilarityWhitelistDialog();
    if (context?.recordId && activeCatalogId === context.recordId) await loadCatalogDetails(context.recordId);
    if (context?.reportJobId && activeQueueSimilarityReportJobId === context.reportJobId) {
      await loadQueueSimilarityReport(context.reportJobId, { keepOpen: true });
    }
    showToast(result.added
      ? `“${result.term}”已加入相似度白名单；已有关系不会自动重算`
      : `“${result.term}”已在相似度白名单中`);
  } finally {
    similarityWhitelistWriteInFlight = false;
    elements.confirmSimilarityWhitelist.disabled = false;
  }
});
elements.recordBackupLocation.addEventListener('change', () => {
  updateBackupLocationControl();
  if (elements.recordBackupLocation.checked) elements.backupLocation.focus();
});
[...document.querySelectorAll('input[name="archive-naming-mode"]')].forEach((control) => {
  control.addEventListener('change', updateNamingControls);
});
elements.moveCompleted.addEventListener('change', async () => {
  updateCompletionControls('move');
  await saveConfig();
});
[elements.videoFrameBackup, elements.smallItemFilter, elements.scheduleEnabled].forEach((control) => {
  control.addEventListener('change', updateIntakeOptionControls);
});
elements.similarityReportEnabled.addEventListener('change', () => { void saveConfig(); });
elements.largeFolderSimplification.addEventListener('change', () => {
  updatePerformanceAvoidanceControls();
  void saveConfig();
});
elements.largeFolderFileThreshold.addEventListener('change', () => { void saveConfig(); });
elements.largeFolderMd5SampleLimit.addEventListener('change', () => { void saveConfig(); });
elements.skipTinyMd5Files.addEventListener('change', () => {
  updatePerformanceAvoidanceControls();
  void saveConfig();
});
elements.tinyFileMd5ThresholdKb.addEventListener('change', () => { void saveConfig(); });
elements.autoSkipExactDuplicates.addEventListener('change', () => {
  updateAutoSkipControls();
  void saveConfig();
});
for (const control of elements.autoSkipExactDuplicateAction.querySelectorAll('input[type="radio"]')) {
  control.addEventListener('change', () => { void saveConfig(); });
}
elements.smallItemFilter.addEventListener('change', () => { void saveConfig(); });
elements.minimumTaskMb.addEventListener('change', () => { void saveConfig(); });
elements.autoTrash.addEventListener('change', async () => {
  if (elements.autoTrash.checked) {
    const accepted = await confirmUser('启用后，每个任务只有在验证并入库成功后，才会把对应源文件夹或视频移入 Windows 回收站。是否启用？', { title: '启用回收站自动处理', confirmLabel: '确认启用' });
    if (!accepted) {
      elements.autoTrash.checked = false;
      return;
    }
  }
  updateCompletionControls('trash');
  await saveConfig();
});

document.querySelector('#toggle-password').addEventListener('click', () => {
  const showing = elements.password.type === 'text';
  elements.password.type = showing ? 'password' : 'text';
  document.querySelector('#toggle-password').textContent = t(showing ? '显示' : '隐藏');
});
elements.password.addEventListener('change', () => { void saveConfig(); });
elements.recordArchivePassword.addEventListener('change', () => { void saveConfig(); });
elements.thumbnailLimit.addEventListener('change', () => { void saveConfig(); });
elements.archiveFormat.addEventListener('change', () => { void saveConfig(); });
elements.compressionLevel.addEventListener('change', () => { void saveConfig(); });
elements.splitVolume.addEventListener('change', () => {
  updateVolumeControls();
  void saveConfig();
});
elements.volumeSize.addEventListener('change', () => {
  updateVolumeControls();
  void saveConfig();
});
elements.volumeSize.addEventListener('input', () => updateVolumeControls({ normalize: false }));
elements.volumeUnit.addEventListener('change', () => {
  updateVolumeControls({ unitChanged: true });
  void saveConfig();
});
document.querySelector('#select-user-data').addEventListener('click', async () => {
  const saved = await saveConfig();
  if (!saved) return;
  await safely(() => window.archiveApp.changeUserDataLocation());
});

document.querySelector('#scan-source').addEventListener('click', async () => {
  if (!elements.intakeDirectory.value.trim()) {
    const selected = await safely(() => window.archiveApp.chooseDirectory(''));
    if (!selected) return;
    elements.intakeDirectory.value = selected;
  }
  const saved = await saveConfig();
  if (!saved) return;
  elements.notice.textContent = t('正在扫描下一级目录，请稍候…');
  elements.notice.hidden = false;
  const scanToken = String(++nextScanToken);
  activeScanToken = scanToken;
  const state = await safely(() => window.archiveApp.scanSource(elements.intakeDirectory.value.trim(), scanToken));
  if (activeScanToken === scanToken) {
    activeScanToken = null;
    elements.notice.hidden = true;
  }
  if (state) render(state);
});

async function addSingle(kind) {
  const saved = await saveConfig();
  if (!saved) return;
  const selected = await safely(() => window.archiveApp.chooseSingle(kind));
  if (!selected) return;
  const state = await safely(() => window.archiveApp.addSingle(selected));
  if (state) render(state);
}

document.querySelector('#add-folder').addEventListener('click', () => addSingle('directory'));
document.querySelector('#add-video').addEventListener('click', () => addSingle('video'));

const dropZone = document.querySelector('#drop-zone');
document.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  event.preventDefault();
  dropZone.classList.add('drag-active');
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) dropZone.classList.remove('drag-active');
});
async function addPathsToQueue(paths, sourceLabel) {
  const uniquePaths = [...new Set((paths || []).map((value) => String(value).trim()).filter(Boolean))];
  if (uniquePaths.length === 0) return;
  const saved = await saveConfig();
  if (!saved) return;
  let added = 0;
  for (const sourcePath of uniquePaths) {
    const state = await safely(() => window.archiveApp.addSingle(sourcePath));
    if (state) {
      added += 1;
      render(state);
    }
  }
  showToast(
    added > 0
      ? `已通过${sourceLabel}加入 ${added} 个任务`
      : `没有可加入的文件夹或视频（${sourceLabel}）`,
    added === 0
  );
}

document.addEventListener('drop', async (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  dropZone.classList.remove('drag-active');
  const paths = [...new Set([...event.dataTransfer.files]
    .map((file) => window.archiveApp.getDroppedPath(file))
    .filter(Boolean))];
  await addPathsToQueue(paths, '拖放');
});

document.addEventListener('paste', async (event) => {
  const target = event.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const filePaths = [...(event.clipboardData?.files || [])]
    .map((file) => window.archiveApp.getDroppedPath(file))
    .filter(Boolean);
  let textPaths = [];
  if (filePaths.length === 0) {
    const text = event.clipboardData?.getData('text') || '';
    textPaths = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  const paths = [...new Set([...filePaths, ...textPaths])];
  if (paths.length === 0) return;
  event.preventDefault();
  dropZone.classList.remove('drag-active');
  await addPathsToQueue(paths, '粘贴');
});

document.querySelector('#start-queue').addEventListener('click', async () => {
  const state = await safely(() => window.archiveApp.startQueue());
  if (state) render(state);
});

async function beginInventoryOnlyQueue() {
  const state = await safely(() => window.archiveApp.startInventoryOnlyQueue());
  if (state) render(state);
}

document.querySelector('#start-inventory-only').addEventListener('click', () => {
  if (currentState?.config?.suppressInventoryOnlyRisk) {
    void beginInventoryOnlyQueue();
    return;
  }
  elements.suppressInventoryOnlyRisk.checked = false;
  elements.inventoryOnlyRiskDialog.showModal();
});
for (const selector of ['#close-inventory-only-risk', '#cancel-inventory-only-risk']) {
  document.querySelector(selector).addEventListener('click', () => elements.inventoryOnlyRiskDialog.close());
}
elements.inventoryOnlyRiskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (elements.suppressInventoryOnlyRisk.checked) {
    const state = await safely(() => window.archiveApp.saveConfig({
      ...readConfig(),
      suppressInventoryOnlyRisk: true
    }));
    if (!state) return;
    render(state, true);
  }
  elements.inventoryOnlyRiskDialog.close();
  await beginInventoryOnlyQueue();
});
document.querySelector('#finish-next').addEventListener('click', async () => {
  const state = await safely(() => window.archiveApp.finishNextAndPause());
  if (state) render(state);
});
document.querySelector('#pause-queue').addEventListener('click', async () => {
  const state = await safely(() => window.archiveApp.pauseQueue());
  if (state) render(state);
});
document.querySelector('#resume-queue').addEventListener('click', async () => {
  const state = await safely(() => window.archiveApp.resumeQueue());
  if (state) render(state);
});
document.querySelector('#cancel-current').addEventListener('click', async () => {
  const jobId = currentState?.currentJobId;
  if (!jobId) return;
  const state = await safely(() => window.archiveApp.cancelTask(jobId));
  if (state) render(state);
});
elements.acknowledgeTrashSafety.addEventListener('click', async () => {
  const haltId = currentState?.safetyHalt?.id;
  if (!haltId) return;
  const state = await safely(() => window.archiveApp.acknowledgeTrashSafety(haltId));
  if (state) {
    render(state, true);
    showToast('安全警告已确认；队列保持停止，自动移入回收站已关闭', true);
  }
});
elements.trashSafetyDialog.addEventListener('cancel', (event) => event.preventDefault());

elements.selectAllTasks.addEventListener('change', () => {
  selectedJobIds.clear();
  if (elements.selectAllTasks.checked) {
    for (const job of currentState?.jobs || []) selectedJobIds.add(job.id);
  }
  renderJobs(currentState?.jobs || []);
});

elements.taskList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-select-job]');
  if (!checkbox) return;
  if (checkbox.checked) selectedJobIds.add(checkbox.dataset.selectJob);
  else selectedJobIds.delete(checkbox.dataset.selectJob);
  renderJobs(currentState?.jobs || []);
});

elements.taskList.addEventListener('click', async (event) => {
  if (Date.now() < suppressSelectionClickUntil) return;
  const copyName = event.target.closest('button[data-copy-job-name]');
  if (copyName) {
    const copied = await safely(() => window.archiveApp.copyText(copyName.dataset.copyJobName));
    if (copied) showToast('任务名称已复制');
    return;
  }
  const openJob = event.target.closest('button[data-open-job-source]');
  if (openJob) {
    const opened = await safely(() => window.archiveApp.openTaskSource(openJob.dataset.openJobSource));
    if (opened) showToast('已打开任务所在位置');
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (button) {
    const { action, jobId } = button.dataset;
    let state;
    if (action === 'similarity-report') {
      await loadQueueSimilarityReport(jobId);
      return;
    }
    if (action === 'confirm') state = await safely(() => window.archiveApp.confirmTask(jobId));
    if (action === 'confirm-anomaly') {
      if (!await confirmUser('完整性测试已经通过，但压缩前后体积比例超出安全阈值。请先人工核对日志和源项目；确认仍要入库吗？', { title: '确认体积异常', confirmLabel: '确认入库' })) return;
      state = await safely(() => window.archiveApp.confirmAnomaly(jobId));
    }
    if (action === 'discard-anomaly') {
      if (!await confirmUser('删除这次异常任务生成的压缩文件和缩略图？源文件会完整保留在原位置，且不会加入仓库。', { tone: 'danger', title: '删除异常成品', confirmLabel: '删除成品' })) return;
      state = await safely(() => window.archiveApp.discardAnomaly(jobId));
    }
    if (action === 'acknowledge-trash-safety') {
      state = await safely(() => window.archiveApp.acknowledgeTrashSafety(jobId));
    }
    if (action === 'cancel') state = await safely(() => window.archiveApp.cancelTask(jobId));
    if (action === 'retry') state = await safely(() => window.archiveApp.retryTask(jobId));
    if (state) render(state);
    return;
  }
  if (event.target.closest('input')) return;
  const row = event.target.closest('tr[data-job-id]');
  if (!row) return;
  if (!event.ctrlKey && !event.metaKey) selectedJobIds.clear();
  if (selectedJobIds.has(row.dataset.jobId)) selectedJobIds.delete(row.dataset.jobId);
  else selectedJobIds.add(row.dataset.jobId);
  renderJobs(currentState?.jobs || []);
});

for (const selector of ['#close-queue-similarity-report', '#done-queue-similarity-report']) {
  document.querySelector(selector).addEventListener('click', () => closeQueueSimilarityReport());
}
elements.queueSimilarityReportDialog.addEventListener('cancel', () => closeQueueSimilarityReport());
elements.queueSimilarityReportContent.addEventListener('click', async (event) => {
  const openSource = event.target.closest('button[data-report-open-source]');
  if (openSource) {
    const opened = await safely(() => window.archiveApp.openTaskSource(openSource.dataset.reportOpenSource));
    if (opened) showToast('已打开任务所在位置');
    return;
  }
  const jump = event.target.closest('button[data-report-catalog-record]');
  if (!jump) return;
  suspendedQueueSimilarityReport = true;
  closeQueueSimilarityReport({ preserve: true });
  await jumpToCatalogRecord(jump.dataset.reportCatalogRecord);
});

elements.removeSelected.addEventListener('click', async () => {
  if (selectedJobIds.size === 0) return;
  if (!await confirmUser(`从任务列表移除所选 ${selectedJobIds.size} 项？已入库档案和源文件不会删除。`)) return;
  const state = await safely(() => window.archiveApp.removeJobs([...selectedJobIds]));
  if (state) {
    selectedJobIds.clear();
    render(state);
  }
});

document.querySelector('#clear-queue').addEventListener('click', async () => {
  if (!await confirmUser('清空整个任务列表？如果当前正在运行，会停止当前任务并阻止后续任务启动。已入库档案和源文件不会删除。', { tone: 'danger', title: '清空任务列表', confirmLabel: '确认清空' })) return;
  const state = await safely(() => window.archiveApp.clearQueue());
  if (state) {
    selectedJobIds.clear();
    render(state);
  }
});

document.querySelector('#clear-completed').addEventListener('click', async () => {
  const completedCount = (currentState?.jobs || []).filter((job) => String(job.status).startsWith('completed')).length;
  if (completedCount === 0) return;
  const result = await safely(() => window.archiveApp.clearCompletedJobs());
  if (!result) return;
  selectedJobIds.clear();
  render(result.state);
  showToast(`已清除 ${result.removedCount} 个已完成任务`);
});

document.querySelector('#clear-cancelled').addEventListener('click', async () => {
  const cancelledCount = (currentState?.jobs || []).filter((job) => job.status === 'cancelled').length;
  if (cancelledCount === 0) return;
  const result = await safely(() => window.archiveApp.clearCancelledJobs());
  if (!result) return;
  selectedJobIds.clear();
  render(result.state);
  showToast(`已清除 ${result.removedCount} 个已取消任务`);
});

document.querySelector('#clear-duplicates').addEventListener('click', async () => {
  if (!await confirmUser('从任务列表清除所有名称或标题可能重复的项目？已入库档案和源文件不会删除。')) return;
  const result = await safely(() => window.archiveApp.clearPotentialDuplicates());
  if (!result) return;
  selectedJobIds.clear();
  render(result.state);
  showToast(result.removedCount > 0 ? `已清除 ${result.removedCount} 个可能重复的任务` : '没有发现可清除的重复任务');
});

document.querySelector('#clear-exact-duplicates').addEventListener('click', async () => {
  if (!await confirmUser('从任务列表清除所有完全重复项（项目完全重复或含内容完全一致的文件）？已入库档案和源文件不会删除。')) return;
  const result = await safely(() => window.archiveApp.clearExactDuplicates());
  if (!result) return;
  selectedJobIds.clear();
  render(result.state);
  showToast(result.removedCount > 0 ? `已清除 ${result.removedCount} 个完全重复任务` : '没有发现可清除的完全重复任务');
});

document.querySelector('#confirm-all-duplicates').addEventListener('click', async () => {
  if (!await confirmUser('同意任务列表中全部名称重复、标题相似或视频大小相同的风险，并让它们进入等待压缩状态？', { title: '批量确认重复风险', confirmLabel: '确认并继续' })) return;
  const result = await safely(() => window.archiveApp.confirmAllDuplicates());
  if (!result) return;
  render(result.state);
  showToast(result.confirmedCount > 0 ? `已确认 ${result.confirmedCount} 个重复或相似任务` : '没有等待确认的重复任务');
});

elements.catalogList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-select-catalog]');
  if (!checkbox) return;
  if (checkbox.checked) selectedCatalogIds.add(checkbox.dataset.selectCatalog);
  else selectedCatalogIds.delete(checkbox.dataset.selectCatalog);
  checkbox.closest('.catalog-card, .catalog-entry')?.classList.toggle('selected', checkbox.checked);
  updateCatalogSelectionControls();
});

elements.catalogList.addEventListener('click', async (event) => {
  if (Date.now() < suppressSelectionClickUntil) return;
  const button = event.target.closest('button[data-record-id]');
  if (!button) return;
  if (event.ctrlKey || event.metaKey) {
    if (selectedCatalogIds.has(button.dataset.recordId)) selectedCatalogIds.delete(button.dataset.recordId);
    else selectedCatalogIds.add(button.dataset.recordId);
    syncCatalogItemState();
    return;
  }
  await loadCatalogDetails(button.dataset.recordId);
  if (catalogViewMode === 'grid') {
    elements.catalogDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

let searchTimer;
function runCatalogSearchNow() {
  clearTimeout(searchTimer);
  catalogPage = 1;
  void refreshCatalog();
  void refreshCatalogSuggestions();
}
elements.catalogSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  catalogPage = 1;
  searchTimer = setTimeout(runCatalogSearchNow, 280);
});
elements.catalogSearch.addEventListener('search', runCatalogSearchNow);

elements.catalogSuggestions.addEventListener('mousedown', (event) => {
  const button = event.target.closest('button[data-suggestion-title]');
  if (!button) return;
  event.preventDefault();
  elements.catalogSearch.value = button.dataset.suggestionTitle;
  elements.catalogSuggestions.hidden = true;
  catalogPage = 1;
  void refreshCatalog();
});
elements.catalogSearch.addEventListener('blur', () => {
  setTimeout(() => { elements.catalogSuggestions.hidden = true; }, 150);
});

for (const filter of [elements.catalogTagFilter, elements.catalogBackupFilter, elements.catalogRatingFilter, elements.catalogSort]) {
  filter.addEventListener('change', () => { catalogPage = 1; void refreshCatalog(); });
}
elements.catalogListView.addEventListener('click', () => setCatalogView('list'));
elements.catalogGridView.addEventListener('click', () => setCatalogView('grid'));
window.addEventListener('resize', () => {
  hideSimilarityWhitelistAction();
  if (catalogViewMode !== 'grid') return;
  clearTimeout(catalogResizeTimer);
  catalogResizeTimer = setTimeout(() => {
    const nextColumns = measureCatalogGridColumns();
    if (nextColumns !== catalogGridColumns) {
      catalogGridColumns = nextColumns;
      renderCatalog(currentCatalogResults);
    } else applyCatalogGridLayout();
  }, 150);
});
if ('ResizeObserver' in window) {
  const catalogResizeObserver = new ResizeObserver(() => {
    if (catalogViewMode !== 'grid' || elements.libraryLayout.hidden) return;
    clearTimeout(catalogResizeTimer);
    catalogResizeTimer = setTimeout(() => {
      const nextColumns = measureCatalogGridColumns();
      if (nextColumns !== catalogGridColumns) {
        catalogGridColumns = nextColumns;
        renderCatalog(currentCatalogResults);
      } else applyCatalogGridLayout();
    }, 80);
  });
  catalogResizeObserver.observe(elements.catalogList);
}
document.querySelector('#refresh-catalog').addEventListener('click', async () => {
  await refreshCatalog();
  await refreshWarehouseInsights(true);
  showToast('仓库已刷新');
});
document.querySelector('#set-warehouse-location').addEventListener('click', async () => {
  const result = await safely(() => window.archiveApp.changeWarehouseLocation());
  if (!result) return;
  selectedCatalogIds.clear();
  activeCatalogId = null;
  catalogDetailRequest += 1;
  catalogStateSignature = '';
  render(result.state, true);
  await refreshCatalog();
  await refreshWarehouseInsights(true);
  showToast(result.copied ? '仓库已复制并切换；原位置仍保留' : '已切换仓库位置');
});
document.querySelector('#open-warehouse').addEventListener('click', () => {
  void safely(() => window.archiveApp.openWarehouse());
});
document.querySelector('#export-warehouse').addEventListener('click', async () => {
  const result = await safely(() => window.archiveApp.exportWarehouse());
  if (result) showToast(`仓库压缩包已导出：${result.path}`);
});
document.querySelector('#import-warehouse').addEventListener('click', async () => {
  if (!await confirmUser('选择外部仓库压缩包（.zip）后，会把其中的仓库记录、缩略图和解压密码记录一并并入当前仓库。相同 ID 的记录会跳过；外部压缩包实体不会被移动或删除。是否继续？', { title: '并入外部仓库', confirmLabel: '选择并导入' })) return;
  const result = await safely(() => window.archiveApp.importWarehouse());
  if (!result) return;
  render(result.state);
  await refreshCatalog();
  await refreshWarehouseInsights(true);
  showToast(result.importedCount > 0
    ? `已并入 ${result.importedCount} 条记录，跳过 ${result.skippedCount} 条已存在记录`
    : `没有可并入的新记录，已跳过 ${result.skippedCount} 条`);
});
document.querySelector('#open-similarity-ignore-terms').addEventListener('click', async () => {
  const result = await safely(() => window.archiveApp.openSimilarityIgnoreTerms());
  if (result) showToast(`已打开相似度排除词表（当前 ${result.count} 个词）`);
});
function updateSimilarityProgress(progress) {
  if (!progress) return;
  const presentation = uiState.similarityProgressPresentation(progress);
  elements.similarityProgressFill.style.width = `${presentation.percent}%`;
  elements.similarityProgressStatus.textContent = t(presentation.label);
  return presentation;
}

document.querySelector('#reload-similarity-ignore-terms').addEventListener('click', async () => {
  const result = await safely(() => window.archiveApp.reloadSimilarityIgnoreTerms());
  if (!result) return;
  if (result.state) render(result.state, true);
  await refreshCatalog();
  showToast(`已重新载入 ${result.count} 个排除词，并更新相似项目关系`);
});
elements.similarityEnabled.addEventListener('change', async () => {
  const enabling = elements.similarityEnabled.checked;
  const message = enabling
    ? '开启相似度计算后，新入库项目会自动与老入库项目对比计算相似度。'
    : '关闭相似度计算，不会清空旧有相似度关系，新入库项目不再计算相似度。';
  if (!await confirmUser(message, { title: enabling ? '开启相似度计算' : '关闭相似度计算', confirmLabel: '确认切换' })) {
    elements.similarityEnabled.checked = !enabling;
    return;
  }
  const state = await safely(() => window.archiveApp.saveConfig(readConfig()));
  if (!state) {
    elements.similarityEnabled.checked = !enabling;
    return;
  }
  render(state, true);
  showToast(t(enabling ? '相似度计算已开启' : '相似度计算已关闭'));
});
elements.similarityStrength.addEventListener('change', async () => {
  const state = await safely(() => window.archiveApp.saveConfig(readConfig()));
  if (!state) return;
  render(state, true);
  const strength = SIMILARITY_STRENGTH_ORDER[Number(elements.similarityStrength.value) - 1] || 'standard';
  showToast(t(`相似度强度已切换为“${SIMILARITY_STRENGTH_LABELS[strength] || strength}”；已有关系不会自动重算`));
});
elements.rebuildSimilarity.addEventListener('click', async () => {
  if (!await confirmUser('计算量较大，可能出现卡顿。确定要重算整个仓库的相似关系吗？', { title: '全局重算相似关系', confirmLabel: '开始重算' })) return;
  elements.rebuildSimilarity.disabled = true;
  elements.similarityRebuildProgress.hidden = false;
  updateSimilarityProgress({ active: true, completed: 0, total: 0, elapsedMs: 0 });
  const state = await safely(() => window.archiveApp.rebuildAllSimilarity());
  elements.rebuildSimilarity.disabled = false;
  if (!state) {
    elements.similarityRebuildProgress.hidden = true;
    return;
  }
  render(state, true);
  await refreshCatalog();
  showToast(t('相似关系已全部重算'));
});
let similarityProgressHideTimer = null;
window.archiveApp.onSimilarityRebuildProgress((progress) => {
  if (similarityProgressHideTimer) {
    clearTimeout(similarityProgressHideTimer);
    similarityProgressHideTimer = null;
  }
  elements.similarityRebuildProgress.hidden = false;
  const presentation = updateSimilarityProgress(progress);
  if (presentation?.complete) {
    similarityProgressHideTimer = setTimeout(() => {
      elements.similarityRebuildProgress.hidden = true;
      similarityProgressHideTimer = null;
    }, 2500);
  }
});
elements.catalogPagePrev.addEventListener('click', () => {
  if (catalogPage <= 1) return;
  catalogPage -= 1;
  renderCatalog(currentCatalogResults);
  elements.catalogList.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.catalogPageNext.addEventListener('click', () => {
  catalogPage += 1;
  renderCatalog(currentCatalogResults);
  elements.catalogList.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.catalogPageSelect.addEventListener('change', () => {
  catalogPage = Math.max(1, Number(elements.catalogPageSelect.value) || 1);
  renderCatalog(currentCatalogResults);
  elements.catalogList.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.defaultPrevented ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (document.querySelector('#library-page')?.hidden || document.querySelector('dialog[open]')) return;
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const target = event.key === 'ArrowLeft' ? elements.catalogPagePrev : elements.catalogPageNext;
  if (elements.catalogPagination.hidden || target.disabled) return;
  event.preventDefault();
  target.click();
});

document.addEventListener('click', (event) => {
  const image = event.target.closest('img[data-thumbnail-record][data-thumbnail-path]');
  if (!image) return;
  event.preventDefault();
  event.stopPropagation();
  void openThumbnailLightbox(
    image.dataset.thumbnailRecord,
    image.dataset.thumbnailPath,
    image.dataset.thumbnailTitle || image.alt
  );
}, true);

document.querySelector('#close-thumbnail-lightbox').addEventListener('click', closeThumbnailLightbox);
elements.thumbnailLightbox.addEventListener('click', (event) => {
  if (event.target === elements.thumbnailLightbox) closeThumbnailLightbox();
});
elements.thumbnailLightbox.addEventListener('close', () => {
  elements.lightboxImage.removeAttribute('src');
  lightboxContext = null;
});
elements.setThumbnailCover.addEventListener('click', async () => {
  if (!lightboxContext) return;
  const context = { ...lightboxContext };
  const updated = await safely(() => window.archiveApp.setCatalogCover(context.recordId, context.relativePath));
  if (!updated) return;
  const state = await safely(() => window.archiveApp.getState());
  if (state) {
    render(state);
    await refreshCatalog();
  }
  if (activeCatalogId === updated.id) renderCatalogDetail(updated);
  elements.setThumbnailCover.disabled = true;
  elements.setThumbnailCover.textContent = t('当前项目封面');
  showToast('项目封面已更新');
});

elements.deleteThumbnail.addEventListener('click', async () => {
  if (!lightboxContext) return;
  const context = { ...lightboxContext };
  if (!await confirmUser('确定删除这张图片？删除后可以通过仓库顶部的“撤回”恢复。', { tone: 'danger', title: '删除项目图片', confirmLabel: '删除图片' })) return;
  const updated = await safely(() => window.archiveApp.deleteCatalogImage(context.recordId, context.relativePath));
  if (!updated) return;
  invalidateThumbnailCache(context.recordId, context.relativePath);
  closeThumbnailLightbox();
  const state = await safely(() => window.archiveApp.getState());
  if (state) {
    render(state);
    await refreshCatalog();
  }
  if (activeCatalogId === updated.id) renderCatalogDetail(updated);
  showToast('图片已删除，可在“撤回”中恢复');
});

document.querySelector('#random-walk').addEventListener('click', async () => {
  await showRandomWalk(true);
});

elements.warehouseDiscovery.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-discovery-record]');
  if (button) void openDiscoveryRecord(button.dataset.discoveryRecord);
});

elements.catalogDetail.addEventListener('click', (event) => {
  const openSource = event.target.closest('button[data-open-source]');
  if (openSource) {
    void safely(() => window.archiveApp.openCatalogSource(openSource.dataset.openSource)).then(async (result) => {
      if (!result) return;
      if (result.status === 'trashed') {
        if (!await confirmUser('该原文件在 Windows 回收站中。要将文件从回收站移出到原位置吗？', { title: '复原原文件', confirmLabel: '复原到原位置' })) return;
        const restored = await safely(() => window.archiveApp.restoreCatalogSource(openSource.dataset.openSource));
        if (!restored) return;
        renderCatalogDetail(restored.record);
        const state = await safely(() => window.archiveApp.getState());
        if (state) render(state);
        await refreshCatalog(true);
        showToast('原文件已复原，并已打开原位置');
      } else {
        showToast('已打开原文件当前位置');
      }
    });
    return;
  }
  const external = event.target.closest('button[data-external-url]');
  if (external) {
    void safely(() => window.archiveApp.openExternal(external.dataset.externalUrl));
    return;
  }
  const passwordToggle = event.target.closest('button[data-password-toggle]');
  if (passwordToggle) {
    const value = passwordToggle.parentElement.querySelector('.archive-password-value');
    const showing = passwordToggle.dataset.passwordShowing === 'true';
    passwordToggle.dataset.passwordShowing = String(!showing);
    value.textContent = showing ? '****' : passwordToggle.dataset.passwordToggle;
    passwordToggle.textContent = t(showing ? '显示' : '隐藏');
    return;
  }
  const copy = event.target.closest('button[data-copy-text]');
  if (copy) {
    void safely(() => window.archiveApp.copyText(copy.dataset.copyText)).then((copied) => {
      if (copied) showToast(copy.dataset.copyKind === 'password' ? '解压密码已复制' : '压缩包名称已复制');
    });
    return;
  }
  const removeSimilar = event.target.closest('button[data-remove-similar]');
  if (removeSimilar) {
    const recordId = removeSimilar.dataset.recordId;
    const similarId = removeSimilar.dataset.removeSimilar;
    void safely(() => window.archiveApp.removeCatalogSimilarity(recordId, similarId)).then(async (updated) => {
      if (!updated) return;
      renderCatalogDetail(updated);
      const state = await safely(() => window.archiveApp.getState());
      if (state) render(state);
      await refreshCatalog();
      showToast('已双向移除相似关系');
    });
    return;
  }
  const locateSimilar = event.target.closest('button[data-locate-similar]');
  if (locateSimilar) {
    const tree = elements.catalogDetail.querySelector('.virtual-directory-tree');
    if (!tree?.locateFirstSimilarity?.()) showToast('目录结构中没有可定位的相似文件或文件夹');
    else {
      elements.catalogDetail.querySelector('.directory-structure-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => tree.locateFirstSimilarity(), 320);
    }
    return;
  }
  const recalculateSimilar = event.target.closest('button[data-recalculate-similar]');
  if (recalculateSimilar) {
    recalculateSimilar.disabled = true;
    void safely(() => window.archiveApp.recalculateCatalogSimilarity(recalculateSimilar.dataset.recalculateSimilar)).then(async (updated) => {
      if (!updated) return;
      renderCatalogDetail(updated);
      const state = await safely(() => window.archiveApp.getState());
      if (state) render(state);
      await refreshCatalog();
      showToast('相似关系已重新计算');
    });
    return;
  }
  const manageSimilar = event.target.closest('button[data-manage-similar]');
  if (manageSimilar) {
    similarityManageRecordId = similarityManageRecordId === manageSimilar.dataset.manageSimilar
      ? null
      : manageSimilar.dataset.manageSimilar;
    void loadCatalogDetails(manageSimilar.dataset.manageSimilar);
    return;
  }
  const button = event.target.closest('button[data-similar-record]');
  if (!button) return;
  void loadCatalogDetails(button.dataset.similarRecord).then(() => {
    elements.catalogDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.addEventListener('click', (event) => {
  const external = event.target.closest('button[data-external-url]');
  if (!external || elements.catalogDetail.contains(external)) return;
  void safely(() => window.archiveApp.openExternal(external.dataset.externalUrl));
});

elements.selectAllCatalog.addEventListener('change', () => {
  for (const record of currentCatalogPageRecords) {
    if (elements.selectAllCatalog.checked) selectedCatalogIds.add(record.id);
    else selectedCatalogIds.delete(record.id);
  }
  syncCatalogItemState();
});

function closeBulkTagsDialog() {
  elements.bulkTagsDialog.close();
  elements.bulkTagsForm.reset();
}

function closeBulkBackupDialog() {
  elements.bulkBackupDialog.close();
  elements.bulkBackupForm.reset();
}

elements.addTagsSelected.addEventListener('click', () => {
  if (selectedCatalogIds.size === 0) return;
  elements.bulkTagsDialog.showModal();
  elements.bulkTagsInput.focus();
});
document.querySelector('#close-bulk-tags').addEventListener('click', closeBulkTagsDialog);
document.querySelector('#cancel-bulk-tags').addEventListener('click', closeBulkTagsDialog);
elements.bulkTagsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedCount = selectedCatalogIds.size;
  const state = await safely(() => window.archiveApp.addTagsToCatalogRecords([...selectedCatalogIds], elements.bulkTagsInput.value));
  if (!state) return;
  closeBulkTagsDialog();
  render(state);
  await refreshCatalog();
  showToast(`已为 ${selectedCount} 项追加标签`);
});

elements.updateBackupSelected.addEventListener('click', () => {
  if (selectedCatalogIds.size === 0) return;
  elements.bulkBackupDialog.showModal();
  elements.bulkBackupInput.focus();
});

async function queueSelectedUncompressedRecords() {
  const result = await safely(() => window.archiveApp.queueCatalogRecordsForCompression([...selectedCatalogIds]));
  if (!result) return;
  render(result.state);
  if (result.failedCount > 0) {
    const firstReason = result.failures?.[0]?.reason ? `：${result.failures[0].reason}` : '';
    showToast(`${result.failedCount} 个项目未能加入队列${firstReason}；${result.queuedCount} 个已加入队列`, true);
  } else if (result.queuedCount > 0) {
    showToast(`已将 ${result.queuedCount} 个库内未压缩项目送入队列`);
  } else {
    showToast('所选内容中没有可加入队列的未压缩项目', true);
  }
}

elements.compressUncompressedSelected.addEventListener('click', () => {
  if (currentState?.config?.suppressCatalogCompressionRisk) {
    void queueSelectedUncompressedRecords();
    return;
  }
  elements.suppressCatalogCompressionRisk.checked = false;
  elements.catalogCompressionRiskDialog.showModal();
});
for (const selector of ['#close-catalog-compression-risk', '#cancel-catalog-compression-risk']) {
  document.querySelector(selector).addEventListener('click', () => elements.catalogCompressionRiskDialog.close());
}
elements.catalogCompressionRiskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (elements.suppressCatalogCompressionRisk.checked) {
    const state = await safely(() => window.archiveApp.saveConfig({
      ...readConfig(),
      suppressCatalogCompressionRisk: true
    }));
    if (!state) return;
    render(state, true);
  }
  elements.catalogCompressionRiskDialog.close();
  await queueSelectedUncompressedRecords();
});
document.querySelector('#close-bulk-backup').addEventListener('click', closeBulkBackupDialog);
document.querySelector('#cancel-bulk-backup').addEventListener('click', closeBulkBackupDialog);
elements.bulkBackupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selectedCount = selectedCatalogIds.size;
  const state = await safely(() => window.archiveApp.updateBackupLocationForCatalogRecords(
    [...selectedCatalogIds], elements.bulkBackupInput.value
  ));
  if (!state) return;
  closeBulkBackupDialog();
  render(state);
  await refreshCatalog();
  showToast(`已修改 ${selectedCount} 项的备份位置`);
});

elements.undoCatalog.addEventListener('click', async () => {
  const state = await safely(() => window.archiveApp.undoCatalogAction());
  if (!state) return;
  render(state);
  await refreshCatalog();
  if (activeCatalogId && state.catalog.some((record) => record.id === activeCatalogId)) {
    await loadCatalogDetails(activeCatalogId);
  }
  showToast('已撤回最近一次仓库操作');
});

function closeDeleteCatalogDialog() {
  elements.deleteCatalogDialog.close();
  elements.deleteCatalogForm.reset();
}

elements.deleteCatalogSelected.addEventListener('click', () => {
  const selectedRecords = (currentState?.catalog || []).filter((record) => selectedCatalogIds.has(record.id));
  if (selectedRecords.length === 0) return;
  const archiveCount = selectedRecords.filter((record) => record.recordType !== 'manual' && (record.archiveFiles || []).length > 0).length;
  const uncompressedCount = selectedRecords.filter((record) => record.recordType !== 'manual' && (record.archiveFiles || []).length === 0).length;
  const manualCount = selectedRecords.length - archiveCount - uncompressedCount;
  const parts = [];
  if (archiveCount > 0) parts.push(`${archiveCount} 个普通归档的压缩包将移入 Windows 回收站`);
  if (uncompressedCount > 0) parts.push(`${uncompressedCount} 个未压缩库存只删除仓库记录，原文件保持不变`);
  if (manualCount > 0) parts.push(`${manualCount} 条手动库存记录将被移除`);
  elements.deleteCatalogSummary.textContent = t(`所选 ${selectedRecords.length} 项：${parts.join('；')}。只有必要操作全部成功后，对应仓库记录才会删除。`);
  const restorableCount = selectedRecords.filter((record) => ['moved', 'trashed'].includes(record.sourceDisposition)).length;
  elements.restoreOriginalSources.disabled = restorableCount === 0;
  elements.restoreOriginalSources.closest('.restore-source-option').classList.toggle('disabled', restorableCount === 0);
  elements.restoreOriginalSourcesHelp.textContent = t(restorableCount > 0
    ? `其中 ${restorableCount} 项记录为已移动或已进入回收站；复原失败时会保留对应仓库记录和压缩包。`
    : '所选项目没有可以尝试复原的原文件记录。');
  elements.deleteCatalogDialog.showModal();
});

document.querySelector('#close-delete-catalog').addEventListener('click', closeDeleteCatalogDialog);
document.querySelector('#cancel-delete-catalog').addEventListener('click', closeDeleteCatalogDialog);
elements.deleteCatalogDialog.addEventListener('click', (event) => {
  if (event.target === elements.deleteCatalogDialog) closeDeleteCatalogDialog();
});
elements.deleteCatalogForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await safely(() => window.archiveApp.deleteCatalogRecords([...selectedCatalogIds], {
    restoreOriginalSources: elements.restoreOriginalSources.checked
  }));
  if (!result) return;
  closeDeleteCatalogDialog();
  for (const id of result.deletedIds) selectedCatalogIds.delete(id);
  if (activeCatalogId && result.deletedIds.includes(activeCatalogId)) {
    activeCatalogId = null;
    catalogDetailRequest += 1;
    elements.catalogDetail.replaceChildren(make('div', 'empty-library', '所选仓库内容已删除。'));
  }
  render(result.state);
  await refreshCatalog();
  if (result.failures.length > 0) {
    showToast(`已删除 ${result.deletedIds.length} 项；${result.failures.length} 项失败：${result.failures[0].message}`, true);
  } else {
    showToast(`已删除 ${result.deletedIds.length} 项`);
  }
});

function closeManualCatalogDialog() {
  elements.manualCatalogDialog.close();
  elements.manualCatalogForm.reset();
  pendingManualImages = [];
  renderPendingManualImages();
}

document.querySelector('#add-manual-catalog').addEventListener('click', () => {
  elements.manualCatalogDialog.showModal();
  elements.manualCatalogName.focus();
});
document.querySelector('#close-manual-dialog').addEventListener('click', closeManualCatalogDialog);
document.querySelector('#cancel-manual-dialog').addEventListener('click', closeManualCatalogDialog);
elements.manualCatalogDialog.addEventListener('click', (event) => {
  if (event.target === elements.manualCatalogDialog) closeManualCatalogDialog();
});
elements.manualCatalogImages.addEventListener('change', () => {
  void safely(() => appendPendingManualFiles(elements.manualCatalogImages.files));
});
elements.manualImagePaste.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith('image/'));
  if (files.length === 0) return;
  event.preventDefault();
  void safely(() => appendPendingManualFiles(files));
});
elements.manualCatalogForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const images = [...pendingManualImages];
  const record = await safely(() => window.archiveApp.addManualCatalogRecord({
    name: elements.manualCatalogName.value,
    notes: elements.manualCatalogNotes.value,
    tags: elements.manualCatalogTags.value,
    sourcePath: elements.manualCatalogSource.value,
    backupLocation: elements.manualCatalogBackup.value
  }));
  if (!record) return;
  let updatedRecord = record;
  if (images.length > 0) {
    updatedRecord = await safely(() => addImagesToCatalog(record.id, images)) || record;
  }
  closeManualCatalogDialog();
  const state = await safely(() => window.archiveApp.getState());
  if (state) {
    render(state);
    await refreshCatalog();
    await loadCatalogDetails(updatedRecord.id);
  }
  showToast(images.length > 0 ? `手动库存已添加，并保存 ${images.length} 张图片` : '手动库存已添加');
});

function enableMarqueeSelection(container, itemSelector, idFromItem, selection, finishRender) {
  container.addEventListener('pointerdown', (event) => {
    const blockedControl = container === elements.catalogList
      ? event.target.closest('input, a, select, textarea')
      : event.target.closest('input, button, img, a, select, textarea');
    if (event.button !== 0 || blockedControl) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialSelection = new Set((event.ctrlKey || event.metaKey) ? selection : []);
    let active = false;
    let marquee = null;

    const move = (moveEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      if (!active) {
        active = true;
        marquee = make('div', 'selection-marquee');
        document.body.append(marquee);
        document.body.classList.add('marquee-selecting');
      }
      const left = Math.min(startX, moveEvent.clientX);
      const top = Math.min(startY, moveEvent.clientY);
      const right = Math.max(startX, moveEvent.clientX);
      const bottom = Math.max(startY, moveEvent.clientY);
      Object.assign(marquee.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      selection.clear();
      for (const id of initialSelection) selection.add(id);
      for (const item of container.querySelectorAll(itemSelector)) {
        const rect = item.getBoundingClientRect();
        const hit = rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
        const id = idFromItem(item);
        if (hit) selection.add(id);
        item.classList.toggle('selected', selection.has(id));
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = selection.has(id);
      }
      if (container === elements.taskListContainer) updateSelectionControls(currentState?.jobs || []);
      else updateCatalogSelectionControls();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      marquee?.remove();
      document.body.classList.remove('marquee-selecting');
      if (active) {
        suppressSelectionClickUntil = Date.now() + 250;
        finishRender();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  });
}

enableMarqueeSelection(
  elements.taskListContainer,
  'tr[data-job-id]',
  (item) => item.dataset.jobId,
  selectedJobIds,
  () => renderJobs(currentState?.jobs || [])
);
enableMarqueeSelection(
  elements.catalogList,
  '.catalog-card[data-catalog-id]',
  (item) => item.dataset.catalogId,
  selectedCatalogIds,
  syncCatalogItemState
);

window.archiveApp.onStateChanged((state) => render(state));
window.archiveApp.onTaskProgress((progress) => {
  if (!currentState) return;
  const job = currentState.jobs.find((candidate) => candidate.id === progress.jobId);
  if (!job) return;
  if (!uiState.shouldApplyTaskProgress(job, progress)) return;
  job.status = progress.stage;
  job.stageText = progress.stageText || job.stageText;
  job.progress = progress.percentage;
  const row = elements.taskList.querySelector(`tr[data-job-id="${CSS.escape(progress.jobId)}"]`);
  if (row) {
    const status = row.querySelector('.status');
    const fill = row.querySelector('.progress span');
    const progressText = row.querySelector('.progress-text');
    if (status) {
      status.className = `status-pill ${progress.stage}`;
      status.textContent = t(statusLabels[progress.stage] || progress.stage);
    }
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, progress.percentage))}%`;
    if (progressText) setStageText(progressText, taskProgressText(job, progress.percentage));
  }
});
window.archiveApp.onCatalogChanged((catalog) => {
  if (!currentState) return;
  currentState.catalog = catalog;
  catalogRefreshDirty = true;
  updateCatalogSelectionControls();
  void refreshWarehouseInsights();
  const libraryVisible = !document.querySelector('#library-page').hidden;
  if (libraryVisible) void refreshCatalog();
});
window.archiveApp.onScanProgress((progress) => {
  if (!activeScanToken || String(progress.scanToken || '') !== activeScanToken) return;
  elements.notice.hidden = false;
  elements.notice.textContent = t(`正在统计 ${progress.displayName}（${progress.index + 1}/${progress.total}）…`);
});

setCatalogView(catalogViewMode);
document.querySelector('.post-processing-group')?.setAttribute('open', '');
safely(async () => {
  const state = await window.archiveApp.getState();
  render(state, true);
});
// Check silently after the first render so a slow or unavailable network never
// delays opening the workbench. The checker itself aborts after a short timeout.
window.setTimeout(() => { void runUpdateCheck({ automatic: true }); }, 250);
