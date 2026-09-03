'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const {
  ARCHIVE_PASSWORD,
  LARGE_TASK_BYTES,
  MAX_ARCHIVE_VOLUME_BYTES,
  MIB,
  MIN_ARCHIVE_VOLUME_BYTES,
  RUNNING_STATUSES,
  isVideoFile
} = require('./constants');
const {
  createConfiguredArchiveName,
  isPathInside,
  makeArchiveStagingDirectory,
  normalizeForComparison,
  validatePathLayout,
  validateSourceSelection,
  validateWindowsFileStem
} = require('./paths');
const { inspectPath, scanIntakeDirectory } = require('./scanner');
const {
  DEFAULT_LARGE_FOLDER_FILE_THRESHOLD,
  DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES,
  MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  MAX_TINY_FILE_MD5_THRESHOLD_BYTES,
  MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  MIN_TINY_FILE_MD5_THRESHOLD_BYTES,
  buildManifest,
  completeManifestMd5,
  collectDirectories,
  collectFiles,
  verifyManifestMd5AgainstCompleteCandidates,
  verifyManifestMd5AgainstReference,
  validateManifestUnchanged
} = require('./manifest');
const { CancelledError, recoverPublishedArchiveFiles, runArchiveJob } = require('./archive-engine');
const {
  DEFAULT_SIMILARITY_IGNORE_TERMS,
  DEFAULT_SIMILARITY_STRENGTH,
  STRENGTH_PRESETS,
  SIMILARITY_STRENGTHS,
  createManifestReviewFingerprint,
  createProjectFingerprint,
  createSimilarityScorer,
  documentTerms,
  findExactProjectMatches,
  findExactProjectShapeMatches,
  findSimilarProjects,
  findSimilarEntryMatches,
  fuzzyTextScore,
  normalizeName,
  normalizeSimilarityStrength,
  parseSimilarityIgnoreTerms,
  setTermStatistics,
  similarityCandidateKeys
} = require('./duplicate-check');
const { PauseController } = require('./process-controller');
const {
  normalizeThumbnailReferences,
  resolveThumbnailReference
} = require('./warehouse-paths');

const SIMILARITY_VERSION = 6;
const execFileAsync = promisify(execFile);
const DUPLICATE_CONFIRMATION_REASONS = new Set(['name_match', 'similar_title', 'same_video_size']);

function isDuplicateCandidateJob(job) {
  const status = String(job?.status || '');
  return Boolean(status) && status !== 'cancelled' && status !== 'failed' &&
    !status.startsWith('completed');
}

function normalizeCatalogMetadata(record) {
  record = record && typeof record === 'object' ? record : {};
  const inventoryDate = record.inventoryDate || record.completedAt || record.verifiedAt || new Date().toISOString();
  const normalizedTags = Array.isArray(record.tags)
    ? [...new Set(record.tags.map((tag) => String(tag).trim()).filter(Boolean))]
    : [];
  const isUncompressed = record.archiveState === 'uncompressed' ||
    (normalizedTags.includes('未压缩') && String(record.archiveFormat || '') === 'none');
  const archiveState = record.recordType === 'manual'
    ? 'manual'
    : isUncompressed ? 'uncompressed' : 'compressed';
  const tags = archiveState === 'uncompressed'
    ? ['未压缩', ...normalizedTags.filter((tag) => tag !== '未压缩')]
    : normalizedTags;
  const archivePassword = typeof record.archivePassword === 'string'
    ? record.archivePassword
    : '';
  const passwordRecorded = record.recordType !== 'manual' && (typeof record.passwordRecorded === 'boolean'
    ? record.passwordRecorded
    : Boolean(archivePassword));
  return {
    ...record,
    title: typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : record.displayName,
    tags,
    archiveState,
    rating: Number.isInteger(record.rating) && record.rating >= 0 && record.rating <= 5
      ? record.rating
      : 0,
    notes: typeof record.notes === 'string' ? record.notes : '',
    backupLocation: typeof record.backupLocation === 'string' ? record.backupLocation.trim() : '',
    sourcePath: typeof record.sourcePath === 'string' ? record.sourcePath.trim() : '',
    displayName: typeof record.displayName === 'string' ? record.displayName : '',
    manifest: Array.isArray(record.manifest) ? record.manifest.filter((item) => item && typeof item === 'object') : [],
    directories: Array.isArray(record.directories) ? record.directories.map(String).filter(Boolean) : [],
    archiveFiles: Array.isArray(record.archiveFiles) ? record.archiveFiles.filter((item) => item && typeof item === 'object') : [],
    coverRelativePath: typeof record.coverRelativePath === 'string' ? record.coverRelativePath : null,
    coverThumbnailRef: typeof record.coverThumbnailRef === 'string'
      ? record.coverThumbnailRef
      : (typeof record.coverRelativePath === 'string' ? record.coverRelativePath : null),
    manualImages: Array.isArray(record.manualImages)
      ? record.manualImages.filter((item) => item && typeof item.ref === 'string' && typeof item.thumbnailPath === 'string')
      : [],
    similarRecords: Array.isArray(record.similarRecords)
      ? record.similarRecords.filter((item) => item && typeof item.id === 'string').slice(0, 20)
      : [],
    dismissedSimilarRecordIds: Array.isArray(record.dismissedSimilarRecordIds)
      ? [...new Set(record.dismissedSimilarRecordIds.map(String).filter(Boolean))].slice(-200)
      : [],
    originalSourcePath: typeof record.originalSourcePath === 'string' ? record.originalSourcePath.trim() : '',
    inventoryDate,
    archivePassword,
    hasPassword: Boolean(archivePassword || record.hasPassword),
    passwordRecorded,
    recordType: record.recordType === 'manual' ? 'manual' : 'archive'
  };
}

function getOriginalSourcePath(record) {
  return typeof record?.originalSourcePath === 'string' ? record.originalSourcePath.trim() : '';
}

function hasDuplicateConfirmationReason(job) {
  return (job?.confirmationReasons || []).some((reason) => DUPLICATE_CONFIRMATION_REASONS.has(reason));
}

function hasPendingAutomaticDuplicateCheck(job) {
  return !job?.exactDuplicateOverrideAt && (
    job?.automaticDuplicateCheckPending === true ||
    (job?.stageText === '等待内容完全一致核验' && hasDuplicateConfirmationReason(job))
  );
}

function hasSelectedIntakeMode(job) {
  return Boolean(job?.sourceCatalogRecordId) || job?.intakeModeSelected !== false;
}

function isRunnableQueuedJob(job) {
  return job?.status === 'queued' && hasSelectedIntakeMode(job);
}

function hasCompleteMd5Manifest(manifest) {
  return Array.isArray(manifest) && manifest.length > 0 &&
    manifest.every((file) => /^[a-f0-9]{32}$/i.test(String(file?.md5 || '')));
}

function manifestCompatibleWithKnownMd5(referenceManifest, candidateManifest) {
  if (!Array.isArray(referenceManifest) || !Array.isArray(candidateManifest) ||
      referenceManifest.length !== candidateManifest.length) return false;
  const candidates = new Map(candidateManifest.map((file) => [
    String(file?.relativePath || file?.name || '').replace(/\\/g, '/')
      .normalize('NFKC').toLocaleLowerCase('zh-CN'), file
  ]));
  return referenceManifest.every((file) => {
    const key = String(file?.relativePath || file?.name || '').replace(/\\/g, '/')
      .normalize('NFKC').toLocaleLowerCase('zh-CN');
    const candidate = candidates.get(key);
    if (!candidate || Number(candidate.size) !== Number(file.size)) return false;
    const leftMd5 = String(file?.md5 || '').toLocaleLowerCase('en-US');
    const rightMd5 = String(candidate?.md5 || '').toLocaleLowerCase('en-US');
    return !/^[a-f0-9]{32}$/.test(leftMd5) || !/^[a-f0-9]{32}$/.test(rightMd5) || leftMd5 === rightMd5;
  });
}

function manifestsHaveSameStableMetadata(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const rightFiles = new Map(right.map((file) => [
    String(file.relativePath || '').replace(/\\/g, '/').toLocaleLowerCase('en-US'), file
  ]));
  return left.every((file) => {
    const key = String(file.relativePath || '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
    const candidate = rightFiles.get(key);
    return candidate && fingerprintMetadataMatches(file, candidate);
  });
}

function manifestModifiedAtMs(file) {
  const numeric = Number(file?.modifiedAtMs);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(String(file?.modifiedAt || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function fingerprintMetadataMatches(current, cached) {
  if (Number(current?.size) !== Number(cached?.size)) return false;
  const currentModifiedAt = manifestModifiedAtMs(current);
  const cachedModifiedAt = manifestModifiedAtMs(cached);
  return Number.isFinite(currentModifiedAt) && Number.isFinite(cachedModifiedAt) &&
    Math.abs(currentModifiedAt - cachedModifiedAt) < 1;
}

function similarityIsDismissed(record, candidate) {
  return (record.dismissedSimilarRecordIds || []).includes(candidate.id) ||
    (candidate.dismissedSimilarRecordIds || []).includes(record.id);
}

function refreshPossibleDuplicate(record) {
  // 入库确认时的名称/精确重复原因是历史审计信息，不代表当前仓库仍存在对应项目。
  // “可能重复”标签只反映当前有效且未被用户排除的相似关系。
  record.possibleDuplicate = Array.isArray(record.similarRecords) && record.similarRecords.length > 0;
  return record.possibleDuplicate;
}

function normalizeTagsInput(input) {
  const rawTags = Array.isArray(input) ? input : String(input ?? '').split(/[，,]/);
  const tags = [...new Set(rawTags.map((tag) => String(tag).trim()).filter(Boolean))];
  if (tags.length > 30) throw new Error('每条归档最多设置 30 个标签。');
  if (tags.some((tag) => tag.length > 30)) throw new Error('单个标签不能超过 30 个字符。');
  if (tags.some((tag) => !/^[\p{L}\p{N}][\p{L}\p{N} _·-]*$/u.test(tag))) {
    throw new Error('标签只能使用文字、数字、空格、短横线、下划线或间隔号，并且必须以文字或数字开头。');
  }
  return tags;
}

function thumbnailEntries(file) {
  if (Array.isArray(file?.thumbnails) && file.thumbnails.length > 0) {
    return file.thumbnails.map((thumbnail, index) => ({
      ...thumbnail,
      ref: `${file.relativePath}::frame:${index}`,
      relativePath: file.relativePath,
      frameIndex: thumbnail.frameIndex ?? index
    }));
  }
  return file?.thumbnailPath
    ? [{ ref: file.relativePath, relativePath: file.relativePath, thumbnailPath: file.thumbnailPath, frameIndex: null }]
    : [];
}

function recordThumbnailEntries(record) {
  return [
    ...(record.manifest || []).flatMap(thumbnailEntries),
    ...(record.manualImages || []).map((image, index) => ({
      ...image,
      ref: image.ref,
      relativePath: image.relativePath || image.name || `手动图片 ${index + 1}`,
      frameIndex: null,
      type: 'manual-image'
    }))
  ];
}

function assessArchiveSize(originalBytes, archiveBytes) {
  if (!(originalBytes > 0) || !(archiveBytes > 0)) {
    return { abnormal: true, ratio: 0, reason: '压缩包或原始文件大小无效' };
  }
  const ratio = archiveBytes / originalBytes;
  if (ratio > 1.05) return { abnormal: true, ratio, reason: '压缩包比原始内容大超过 5%' };
  if (ratio < 0.01) return { abnormal: true, ratio, reason: '压缩后体积不足原始内容的 1%' };
  return { abnormal: false, ratio, reason: '' };
}

async function runInventoryOnlyJob(job, config, hooks = {}, signal) {
  const onStage = hooks.onStage || (async () => {});
  const onProgress = hooks.onProgress || (() => {});
  const onLog = hooks.onLog || (() => {});
  const pauseController = hooks.pauseController;
  await onStage('inventorying', '正在生成未压缩入库清单与 MD5');
  const manifest = hooks.preparedManifest || await buildManifest(job.sourcePath, job.sourceType, {
    signal,
    pauseController,
    largeFolderSimplification: job.largeFolderSimplification ?? config.largeFolderSimplification,
    largeFolderFileThreshold: job.largeFolderFileThreshold ?? config.largeFolderFileThreshold,
    largeFolderMd5SampleLimit: job.largeFolderMd5SampleLimit ?? config.largeFolderMd5SampleLimit,
    skipTinyMd5Files: job.skipTinyMd5Files ?? config.skipTinyMd5Files,
    tinyFileMd5ThresholdBytes: job.tinyFileMd5ThresholdBytes ?? config.tinyFileMd5ThresholdBytes,
    onPlan: hooks.onInventoryPlan,
    onProgress: (progress) => {
      onProgress(progress.percent);
      if (progress.currentFile) hooks.onInventoryProgress?.(progress);
    },
    onSkippedFile: (item) => {
      onLog(`未压缩入库已跳过无法读取的${item.type === 'directory' ? '目录' : '文件'}：${item.path}（${item.code}）`);
      hooks.onSkippedFile?.(item);
    }
  });
  if (hooks.preparedManifest) {
    await validateManifestUnchanged(job.sourcePath, job.sourceType, manifest, signal, pauseController);
  }
  if (manifest.length === 0) throw new Error('没有可安全读取并入库的文件。');
  const directories = await collectDirectories(job.sourcePath, job.sourceType, {
    signal,
    pauseController,
    onSkippedFile: (item) => {
      onLog(`未压缩清单已跳过：${item.path}（${item.code}）`);
      hooks.onSkippedFile?.(item);
    }
  });
  await hooks.onManifestReady?.(manifest);
  return {
    archiveFiles: [],
    archiveTotalBytes: 0,
    manifest,
    directories,
    skippedFiles: manifest.skippedFiles || job.skippedFiles || [],
    passwordScheme: 'none',
    hasPassword: false,
    verifiedAt: new Date().toISOString()
  };
}

function validateCatalogMetadata(record, metadata = {}) {
  const title = String(metadata.title ?? record.title ?? record.displayName).trim();
  if (!title) throw new Error('标题不能为空。');
  if (title.length > 200) throw new Error('标题不能超过 200 个字符。');

  const inputTags = normalizeTagsInput(metadata.tags ?? record.tags);
  const tags = record.archiveState === 'uncompressed'
    ? ['未压缩', ...inputTags.filter((tag) => tag !== '未压缩')]
    : inputTags;

  const rating = Number(metadata.rating ?? record.rating ?? 0);
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw new Error('星级必须是 0 到 5 的整数。');
  }

  const notes = String(metadata.notes ?? record.notes ?? '');
  if (notes.length > 5000) throw new Error('备注不能超过 5000 个字符。');
  if (record.recordType === 'manual' && !notes.trim()) throw new Error('手动库存的备注不能为空。');
  const backupLocation = String(metadata.backupLocation ?? record.backupLocation ?? '').trim();
  if (backupLocation.length > 200) throw new Error('备份位置不能超过 200 个字符。');
  const requestedPassword = String(metadata.archivePassword ?? record.archivePassword ?? '');
  if (requestedPassword.length > 128 || /[\u0000-\u001f\u007f]/.test(requestedPassword)) {
    throw new Error('解压密码最多 128 个字符，且不能包含换行或控制字符。');
  }
  const passwordRecorded = record.recordType !== 'manual' && Boolean(
    metadata.passwordRecorded ?? record.passwordRecorded
  );
  const archivePassword = passwordRecorded ? requestedPassword : '';
  const hasPassword = passwordRecorded ? Boolean(archivePassword) : Boolean(record.hasPassword);
  return { title, tags, rating, notes, backupLocation, archivePassword, passwordRecorded, hasPassword };
}

function assertOwnedChildPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isPathInside(resolvedRoot, resolvedCandidate) ||
      normalizeForComparison(resolvedRoot) === normalizeForComparison(resolvedCandidate)) {
    throw new Error('删除目标不在允许的仓库子目录内。');
  }
  return resolvedCandidate;
}

function assertSafePathSegment(value, label) {
  const segment = String(value || '');
  if (!segment || segment === '.' || segment === '..' || path.basename(segment) !== segment || /[\\/]/.test(segment)) {
    throw new Error(`${label}包含无效路径，已拒绝删除。`);
  }
  return segment;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function quarantineAndTrashArchiveFiles(record, stagingDirectory, trashItem, pathExists) {
  if (!trashItem) throw new Error('Windows 回收站服务不可用。');
  if (!record.archiveDirectory) throw new Error('归档记录缺少压缩包目录，已拒绝删除。');
  const archiveDirectory = path.resolve(String(record.archiveDirectory));
  const archivePaths = [];
  for (const archiveFile of record.archiveFiles || []) {
    const fileName = assertSafePathSegment(archiveFile.name, '归档文件');
    const archivePath = assertOwnedChildPath(archiveDirectory, path.join(archiveDirectory, fileName));
    if (await pathExists(archivePath)) archivePaths.push(archivePath);
  }
  if (archivePaths.length === 0) return;
  const configuredStaging = String(stagingDirectory || '').trim();
  if (!configuredStaging) throw new Error('压缩暂存目录未配置，无法安全删除多卷压缩包。');
  const stagingRoot = path.resolve(configuredStaging);
  if (path.parse(stagingRoot).root.toLocaleLowerCase() !== path.parse(archiveDirectory).root.toLocaleLowerCase()) {
    throw new Error('压缩暂存目录与成品不在同一磁盘，无法保证多卷压缩包原子删除。');
  }
  await fs.mkdir(stagingRoot, { recursive: true });
  const quarantineDirectory = path.join(stagingRoot, 'delete-quarantine', `${record.id}-${crypto.randomUUID()}`);
  await fs.mkdir(quarantineDirectory, { recursive: true });
  const moved = [];
  try {
    for (const archivePath of archivePaths) {
      const quarantinedPath = path.join(quarantineDirectory, path.basename(archivePath));
      await fs.rename(archivePath, quarantinedPath);
      moved.push({ archivePath, quarantinedPath });
    }
    await trashItem(quarantineDirectory);
  } catch (error) {
    for (const item of moved.reverse()) {
      try {
        if (await pathExists(item.quarantinedPath)) await fs.rename(item.quarantinedPath, item.archivePath);
      } catch { /* 隔离目录保留，便于人工恢复。 */ }
    }
    try { await fs.rm(quarantineDirectory, { recursive: false }); } catch {}
    throw new Error(`多卷压缩包删除未完成，已回滚：${error.message}`);
  }
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function searchGrams(value) {
  const compact = String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (!compact) return [];
  const grams = new Set();
  for (const character of compact) grams.add(`char:${character}`);
  for (let index = 0; index < compact.length - 1; index += 1) {
    grams.add(`gram:${compact.slice(index, index + 2)}`);
  }
  return [...grams];
}

function catalogSearchText(record) {
  return [
    record.title, record.displayName, ...(record.tags || []), record.notes,
    record.backupLocation, record.sourcePath, record.archiveBaseName,
    ...(record.manifest || []).map((file) => file.relativePath)
  ].filter(Boolean).join('\n').toLocaleLowerCase('zh-CN');
}

function relocateOwnedPaths(value, oldRoot, newRoot) {
  if (typeof value === 'string' && normalizeForComparison(value).startsWith(`${normalizeForComparison(oldRoot)}${path.sep}`)) {
    return path.join(newRoot, path.relative(oldRoot, value));
  }
  if (Array.isArray(value)) return value.map((item) => relocateOwnedPaths(item, oldRoot, newRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocateOwnedPaths(item, oldRoot, newRoot)]));
  }
  return value;
}



class QueueManager extends EventEmitter {
  constructor(store, config, services = {}) {
    super();
    const normalizedConfig = { ...config };
    for (const [oldKey, newKey] of Object.entries({
      sourceDir: 'intakeDirectory',
      stagingDir: 'archiveStagingDirectory',
      libraryDir: 'archiveOutputDirectory',
      warehouseDir: 'repositoryDirectory',
      completedDir: 'processedSourceDirectory'
    })) {
      if (normalizedConfig[newKey] === undefined && normalizedConfig[oldKey] !== undefined) {
        normalizedConfig[newKey] = normalizedConfig[oldKey];
      }
      delete normalizedConfig[oldKey];
    }
    this.store = store;
    this.config = {
      language: 'zh-CN',
      archivePassword: ARCHIVE_PASSWORD,
      archiveNamingMode: 'timestamp_random',
      customArchiveName: '',
      videoFrameBackup: true,
      videoFrameCount: 3,
      thumbnailLimit: 30,
      archiveFormat: '7z',
      compressionLevel: 1,
      archiveVolumeEnabled: true,
      archiveVolumeBytes: LARGE_TASK_BYTES,
      smallItemFilter: true,
      minimumTaskBytes: 100 * MIB,
      largeFolderSimplification: true,
      largeFolderFileThreshold: DEFAULT_LARGE_FOLDER_FILE_THRESHOLD,
      largeFolderMd5SampleLimit: DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
      skipTinyMd5Files: true,
      tinyFileMd5ThresholdBytes: DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES,
      autoSkipExactDuplicates: true,
      autoSkipExactDuplicateAction: 'keep',
      similarityReportEnabled: true,
      scheduleEnabled: false,
      scheduleStart: '',
      scheduleEnd: '',
      moveCompleted: false,
      processedSourceDirectory: '',
      recordArchivePassword: true,
      suppressInventoryOnlyRisk: false,
      suppressCatalogCompressionRisk: false,
      suppressSimilarityWhitelistHint: false,
      compressionHistory: [],
      ...normalizedConfig
    };
    this.config.autoSkipExactDuplicates = this.config.autoSkipExactDuplicates === true;
    this.config.autoSkipExactDuplicateAction = this.config.autoSkipExactDuplicateAction === 'remove' ? 'remove' : 'keep';
    this.config.similarityReportEnabled = this.config.similarityReportEnabled !== false;
    this.config.largeFolderSimplification = this.config.largeFolderSimplification === true;
    this.config.largeFolderFileThreshold = Number.isInteger(Number(this.config.largeFolderFileThreshold))
      ? Number(this.config.largeFolderFileThreshold)
      : DEFAULT_LARGE_FOLDER_FILE_THRESHOLD;
    this.config.largeFolderMd5SampleLimit = Number.isInteger(Number(this.config.largeFolderMd5SampleLimit)) &&
        Number(this.config.largeFolderMd5SampleLimit) >= MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT &&
        Number(this.config.largeFolderMd5SampleLimit) <= MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT
      ? Number(this.config.largeFolderMd5SampleLimit)
      : DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT;
    this.config.skipTinyMd5Files = this.config.skipTinyMd5Files === true;
    this.config.tinyFileMd5ThresholdBytes = Number.isInteger(Number(this.config.tinyFileMd5ThresholdBytes)) &&
        Number(this.config.tinyFileMd5ThresholdBytes) >= MIN_TINY_FILE_MD5_THRESHOLD_BYTES &&
        Number(this.config.tinyFileMd5ThresholdBytes) <= MAX_TINY_FILE_MD5_THRESHOLD_BYTES
      ? Number(this.config.tinyFileMd5ThresholdBytes)
      : DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES;
    if (!this.config.repositoryDirectory) {
      this.config.repositoryDirectory = path.join(
        path.dirname(this.config.archiveOutputDirectory || process.cwd()),
        'saves'
      );
    }
    if (this.config.autoTrashCompleted) this.config.moveCompleted = false;
    this.jobs = [];
    this.catalog = [];
    this.logs = [];
    this.skippedRootFiles = [];
    this.running = false;
    this.abortController = null;
    this.pauseController = null;
    this.paused = false;
    this.stopRequested = false;
    this.pauseAfterCurrent = false;
    this.scheduleWaiting = false;
    this.schedulePaused = false;
    this.undoStack = [];
    this.similarityIgnoreTerms = [];
    this.similarityIgnoreTermsWritePromise = Promise.resolve();
    this.similarityStrength = DEFAULT_SIMILARITY_STRENGTH;
    this.similarityRebuildPromise = null;
    this.similarityMaintenanceTask = null;
    this.termStatisticsDirty = true;
    this.progressEmissionTimer = null;
    this.pendingProgress = null;
    this.randomWalkBag = [];
    this.catalogThumbnailSummaryCache = new WeakMap();
    this.safetyHalt = this.config.pendingTrashSafetyHalt && typeof this.config.pendingTrashSafetyHalt === 'object'
      ? { ...this.config.pendingTrashSafetyHalt }
      : null;
    this.services = services;
  }

  async initialize() {
    // A short-lived development build treated missing historical recycle-bin items as a
    // queue safety incident. Historical records can disappear because the user emptied
    // the recycle bin, so only a failure verified during the current task may halt work.
    if (this.safetyHalt?.type === 'trash_retention_audit') {
      this.safetyHalt = null;
      delete this.config.pendingTrashSafetyHalt;
      await this.store.saveSettings(this.config);
    }
    if (this.config.archiveStagingDirectory) await fs.mkdir(this.config.archiveStagingDirectory, { recursive: true });
    if (this.config.moveCompleted && this.config.processedSourceDirectory) {
      await fs.mkdir(this.config.processedSourceDirectory, { recursive: true });
    }
    await this.reloadSimilarityIgnoreTerms({ rebuild: false });
    this.similarityStrength = normalizeSimilarityStrength(this.config.similarityStrength);
    this.jobs = await this.store.loadJobs(this.config.repositoryDirectory);
    const loadedCatalog = await this.store.loadCatalog(this.config.repositoryDirectory);
    const migratedRepositoryFrom = String(this.config.migratedRepositoryFrom || '').trim();
    const shouldRelocateMigratedPaths = migratedRepositoryFrom &&
      normalizeForComparison(migratedRepositoryFrom) !== normalizeForComparison(this.config.repositoryDirectory);
    if (shouldRelocateMigratedPaths) {
      this.jobs = relocateOwnedPaths(this.jobs, migratedRepositoryFrom, this.config.repositoryDirectory);
    }
    const jobThumbnailNormalization = normalizeThumbnailReferences(
      this.jobs,
      this.config.repositoryDirectory
    );
    const relocatedCatalog = shouldRelocateMigratedPaths
      ? relocateOwnedPaths(loadedCatalog, migratedRepositoryFrom, this.config.repositoryDirectory)
      : loadedCatalog;
    this.catalog = relocatedCatalog.map(normalizeCatalogMetadata);
    normalizeThumbnailReferences(this.catalog, this.config.repositoryDirectory);
    this.markTermStatisticsDirty();
    // 每次启动只做哈希对比；数据库升级后可在不重写 JSON 的情况下补齐持久化候选索引。
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    const similarityUpgradeNeeded = this.catalog.some((record) => record.similarityVersion !== this.similarityVersionStamp());
    if (this.catalog.some((record, index) =>
      record.title !== relocatedCatalog[index].title ||
      record.rating !== relocatedCatalog[index].rating ||
      record.notes !== relocatedCatalog[index].notes ||
      record.backupLocation !== relocatedCatalog[index].backupLocation ||
      record.coverRelativePath !== relocatedCatalog[index].coverRelativePath ||
      record.inventoryDate !== relocatedCatalog[index].inventoryDate ||
      record.recordType !== relocatedCatalog[index].recordType ||
      record.archivePassword !== relocatedCatalog[index].archivePassword ||
      record.passwordRecorded !== relocatedCatalog[index].passwordRecorded ||
      record.originalSourcePath !== relocatedCatalog[index].originalSourcePath ||
      !Array.isArray(relocatedCatalog[index].dismissedSimilarRecordIds) ||
      !Array.isArray(relocatedCatalog[index].tags) ||
      shouldRelocateMigratedPaths)) {
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    }
    if (similarityUpgradeNeeded && this.isSimilarityEnabled()) {
      // 相似引擎升级或强度变化后的全量重建放到后台分片执行，不阻塞窗口创建；
      // 暴露任务句柄便于测试与需要一致状态的调用方等待。关闭相似度计算时跳过，
      // 旧关系原样保留，用户可随时通过“全局重算”补齐。
      const task = this.rebuildAndPersistSimilarityRelations(
        `相似度引擎已更新（强度：${STRENGTH_PRESETS[this.similarityStrength].label}），正在后台重建相似项目关系…`
      );
      this.similarityMaintenanceTask = task;
      task.catch((error) => {
        console.error('SIMILARITY_REBUILD_ERROR', error);
      });
    }
    if (shouldRelocateMigratedPaths || jobThumbnailNormalization.changed > 0) {
      await this.persistJobs();
    }
    if (shouldRelocateMigratedPaths) {
      delete this.config.migratedRepositoryFrom;
      await this.store.saveSettings(this.config);
    }
    let recovered = false;
    this.jobs = this.jobs.map((job) => {
      if (!RUNNING_STATUSES.has(job.status)) return job;
      recovered = true;
      return {
        ...job,
        status: 'failed',
        progress: 0,
        stageText: '程序上次运行时被中断，可重新扫描或重试。',
        errorCode: 'INTERRUPTED'
      };
    });
    if (recovered) await this.persistJobs();
    const pendingTrashSafetyJob = this.jobs.find((job) => job.status === 'awaiting_trash_safety_confirmation');
    if (!this.safetyHalt && pendingTrashSafetyJob) {
      this.safetyHalt = {
        id: crypto.randomUUID(),
        type: 'trash_retention',
        jobId: pendingTrashSafetyJob.id,
        message: pendingTrashSafetyJob.errorMessage || '回收站没有保留原文件，队列已停止。',
        sourceStillExists: Boolean(pendingTrashSafetyJob.sourceStillExists),
        detectedAt: pendingTrashSafetyJob.safetyHaltAt || pendingTrashSafetyJob.completedAt || new Date().toISOString()
      };
      this.config.pendingTrashSafetyHalt = { ...this.safetyHalt };
      await this.store.saveSettings(this.config);
    }
    if (this.safetyHalt && this.config.autoTrashCompleted) {
      this.config.autoTrashCompleted = false;
      await this.store.saveSettings(this.config);
    }
    this.emitState();
  }

  getState() {
    return {
      config: { ...this.config },
      jobs: this.jobs.map(({ pendingCatalogRecord, archivePassword, ...job }) => ({
        ...job,
        hasPassword: Boolean(archivePassword || job.hasPassword)
      })),
      catalog: this.catalog.map((record) => this.summarizeCatalogRecord(record)),
      skippedRootFiles: this.skippedRootFiles.map((item) => ({ ...item })),
      logs: this.logs.slice(-300),
      running: this.running,
      paused: this.paused,
      pauseAfterCurrent: this.pauseAfterCurrent,
      scheduleWaiting: this.scheduleWaiting,
      safetyHalt: this.safetyHalt ? { ...this.safetyHalt } : null,
      undoDepth: this.undoStack.length,
      undoLabel: this.undoStack.at(-1)?.label || '',
      currentJobId: this.jobs.find((job) => RUNNING_STATUSES.has(job.status))?.id || null
    };
  }

  async ensureSimilarityIgnoreTermsFile() {
    const filePath = String(this.config.similarityIgnoreTermsPath || '').trim();
    if (!filePath) throw new Error('相似度排除词表位置未配置。');
    try {
      await fs.access(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const header = [
        '# 相似度排除词表（每行一个词）',
        '# 保存后回到软件，点击“重新载入词表”。',
        ''
      ];
      await fs.writeFile(filePath, [...header, ...DEFAULT_SIMILARITY_IGNORE_TERMS, ''].join('\r\n'), 'utf8');
    }
    return filePath;
  }

  async addSimilarityIgnoreTerm(input) {
    const rawTerm = String(input ?? '').normalize('NFKC');
    if (/[\u0000-\u001f\u007f]/u.test(rawTerm)) {
      throw new Error('要加入白名单的词语不能包含换行或控制字符。');
    }

    const term = rawTerm.trim();
    if (!term) throw new Error('要加入白名单的词语不能为空。');
    if (term.length > 200) throw new Error('要加入白名单的词语不能超过 200 个字符。');
    if (!/[\p{L}\p{N}]/u.test(term)) {
      throw new Error('要加入白名单的词语至少包含一个文字或数字。');
    }

    const operation = this.similarityIgnoreTermsWritePromise.then(async () => {
      const ignoreTermsPath = await this.ensureSimilarityIgnoreTermsFile();
      const content = await fs.readFile(ignoreTermsPath, 'utf8');
      const terms = parseSimilarityIgnoreTerms(content);
      const normalizedTerm = term.toLocaleLowerCase('zh-CN');
      const alreadyExists = terms.some(
        (item) => item.normalize('NFKC').toLocaleLowerCase('zh-CN') === normalizedTerm
      );
      if (alreadyExists) {
        this.similarityIgnoreTerms = terms;
        return { added: false, term, count: terms.length, path: ignoreTermsPath };
      }

      const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
      const separator = content && !content.endsWith('\n') && !content.endsWith('\r') ? lineEnding : '';
      const appended = `${separator}${term}${lineEnding}`;
      await fs.appendFile(ignoreTermsPath, appended, 'utf8');
      this.similarityIgnoreTerms = parseSimilarityIgnoreTerms(`${content}${appended}`);
      this.markTermStatisticsDirty();
      return {
        added: true,
        term,
        count: this.similarityIgnoreTerms.length,
        path: ignoreTermsPath
      };
    });

    this.similarityIgnoreTermsWritePromise = operation.catch(() => undefined);
    return operation;
  }

  async reloadSimilarityIgnoreTerms({ rebuild = true } = {}) {
    if (!this.config.similarityIgnoreTermsPath) {
      this.similarityIgnoreTerms = parseSimilarityIgnoreTerms(DEFAULT_SIMILARITY_IGNORE_TERMS);
      return { path: '', count: this.similarityIgnoreTerms.length, state: this.getState() };
    }
    const filePath = await this.ensureSimilarityIgnoreTermsFile();
    this.similarityIgnoreTerms = parseSimilarityIgnoreTerms(await fs.readFile(filePath, 'utf8'));
    if (rebuild && Array.isArray(this.catalog)) {
      this.markTermStatisticsDirty();
      await this.rebuildAllSimilarityRelations();
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
      this.emitState();
    }
    return { path: filePath, count: this.similarityIgnoreTerms.length, state: this.getState() };
  }

  similarityVersionStamp() {
    return `${SIMILARITY_VERSION}:${this.similarityStrength}`;
  }

  // 相似度计算开关：关闭时保留既有关系，只是不再对新内容计算。
  isSimilarityEnabled() {
    return this.config.similarityEnabled !== false;
  }

  markTermStatisticsDirty() {
    this.termStatisticsDirty = true;
  }

  // IDF 语料来自当前目录的标题与头部视频名；词元解析在打分器内有缓存，全量重算很便宜。
  refreshTermStatistics() {
    const frequencies = new Map();
    for (const record of this.catalog) {
      for (const token of documentTerms(record, this.similarityIgnoreTerms)) {
        frequencies.set(token, (frequencies.get(token) || 0) + 1);
      }
    }
    setTermStatistics(frequencies, this.catalog.length);
    this.termStatisticsDirty = false;
    return { frequencies, total: this.catalog.length };
  }

  ensureTermStatistics() {
    if (this.termStatisticsDirty) this.refreshTermStatistics();
  }

  async rebuildAndPersistSimilarityRelations(message) {
    // 先同步启动重建（让 similarityRebuildPromise 立即可等待），日志和持久化随后跟进。
    const rebuild = this.rebuildAllSimilarityRelations();
    try {
      await rebuild;
    } catch (error) {
      if (message) await this.log('error', `相似项目关系重建失败：${error.message}`);
      throw error;
    }
    if (message) await this.log('info', message);
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    this.emitState();
  }

  // 同一时间只允许一次全量重建；重算期间的新请求等待在途重建完成后再继续。
  async rebuildAllSimilarityRelations(options = {}) {
    if (this.similarityRebuildPromise) return this.similarityRebuildPromise;
    const task = this.performSimilarityRebuild(options);
    this.similarityRebuildPromise = task.finally(() => {
      this.similarityRebuildPromise = null;
    });
    return this.similarityRebuildPromise;
  }

  // “全局重算”入口：不管自动开关状态，按当前强度重算每一条仓库记录。
  async recalculateAllSimilarity() {
    if (this.running) throw new Error('队列运行期间不能重算相似度。');
    await this.log('info', '开始全局重算仓库相似关系…');
    await this.rebuildAllSimilarityRelations();
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    this.emitState();
    await this.log('info', '已按当前设置完成全局重算。');
    return this.getState();
  }

  async performSimilarityRebuild({ reportProgress = true } = {}) {
    const statistics = this.refreshTermStatistics();
    const scorer = createSimilarityScorer(this.similarityIgnoreTerms, statistics);
    const stamp = this.similarityVersionStamp();
    // 使用稳定快照和按 ID 查找，避免重建让出事件循环时目录增删导致索引错位。
    const snapshot = [...this.catalog];
    const total = snapshot.length;
    const startedAt = Date.now();
    const emitProgress = (completed, active) => {
      if (!reportProgress) return;
      this.emit('similarity-progress', {
        active,
        completed,
        total,
        elapsedMs: Date.now() - startedAt
      });
    };
    emitProgress(0, true);
    for (const record of snapshot) {
      record.similarRecords = [];
      record.similarityVersion = stamp;
      refreshPossibleDuplicate(record);
    }
    const catalogOrder = new Map(snapshot.map((record, index) => [record.id, index]));
    const catalogById = new Map(snapshot.map((record) => [record.id, record]));
    const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
    for (let index = 0; index < snapshot.length; index += 1) {
      const record = snapshot[index];
      // 重建期间目录可能被增删（后台任务与用户操作并发），跳过失效位置。
      if (!record) continue;
      const candidates = this.getSimilarityCandidates(record)
        .filter((candidate) => catalogById.get(candidate.id) === candidate &&
          (catalogOrder.get(candidate.id) ?? -1) > index);
      const matches = findSimilarProjects(record, candidates, this.similarityIgnoreTerms, this.similarityStrength, scorer)
        .filter((match) => {
          const candidate = catalogById.get(match.id);
          return candidate && !similarityIsDismissed(record, candidate);
        });
      for (const match of matches) {
        const candidate = catalogById.get(match.id);
        if (!candidate) continue;
        record.similarRecords.push(match);
        candidate.similarRecords.push({
          id: record.id,
          title: record.title || record.displayName,
          score: match.score,
          reasons: match.reasons
        });
      }
      // 分片让出事件循环，避免大仓库重建时冻结主进程；同时汇报进度。
      if ((index & 31) === 31) {
        emitProgress(index + 1, true);
        await yieldToEventLoop();
      }
    }
    const validIds = new Set(this.catalog.map((record) => record.id));
    for (const record of this.catalog) {
      record.similarRecords = (record.similarRecords || [])
        .filter((match) => validIds.has(match.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      refreshPossibleDuplicate(record);
    }
    emitProgress(total, false);
  }

  getSimilarityCandidates(subject) {
    const keys = [...new Set([
      ...similarityCandidateKeys(subject, []),
      ...similarityCandidateKeys(subject, this.similarityIgnoreTerms)
    ])];
    const queriedIds = this.store.findCatalogIdsBySimilarityKeys
      ? this.store.findCatalogIdsBySimilarityKeys(this.config.repositoryDirectory, keys, 500)
      : this.catalog.filter((record) => {
          const candidateKeys = new Set(similarityCandidateKeys(record, this.similarityIgnoreTerms));
          return keys.some((key) => candidateKeys.has(key));
        }).map((record) => record.id);
    const ids = new Set(queriedIds);
    ids.delete(subject.id);
    ids.delete(subject.jobId);
    return this.catalog.filter((record) => ids.has(record.id));
  }

  findIndexedExactFileMatches(manifest, excludedRecordId = '', limit = 100) {
    if (this.store.findExactFileMatches) {
      return this.store.findExactFileMatches(this.config.repositoryDirectory, manifest, limit)
        .map((match) => ({
          ...match,
          previous: (match.previous || []).filter((item) => item.archiveId !== excludedRecordId)
        }))
        .filter((match) => match.previous.length > 0);
    }
    const matches = [];
    for (const file of manifest || []) {
      const md5 = String(file.md5 || '').trim().toLocaleLowerCase('en-US');
      if (!/^[a-f0-9]{32}$/.test(md5)) continue;
      const previous = this.catalog.filter((record) => record.id !== excludedRecordId).flatMap((record) => (record.manifest || [])
        .filter((candidate) => /^[a-f0-9]{32}$/i.test(String(candidate.md5 || '')) &&
          String(candidate.md5).toLowerCase() === md5 && Number(candidate.size) === Number(file.size))
        .slice(0, 5)
        .map((candidate) => ({ archiveId: record.id, archiveName: record.archiveBaseName, archivedTask: record.displayName, relativePath: candidate.relativePath })));
      if (previous.length > 0) matches.push({ sourceRelativePath: file.relativePath, md5, size: file.size, previous });
      if (matches.length >= limit) break;
    }
    return matches;
  }

  findIndexedProjectCandidates(manifest, kind = 'shape', excludedRecordId = '') {
    const fingerprint = createProjectFingerprint(manifest);
    if (!fingerprint.valid) return [];
    const storeMethod = kind === 'content'
      ? this.store.findCatalogIdsByProjectContent
      : this.store.findCatalogIdsByProjectShape;
    if (typeof storeMethod === 'function') {
      const ids = new Set(storeMethod.call(
        this.store,
        this.config.repositoryDirectory,
        fingerprint,
        kind === 'content' ? 20 : undefined
      ));
      ids.delete(excludedRecordId);
      return this.catalog.filter((record) => ids.has(record.id));
    }
    const matches = kind === 'content'
      ? findExactProjectMatches(manifest, this.catalog, excludedRecordId)
      : findExactProjectShapeMatches(manifest, this.catalog, excludedRecordId);
    const ids = new Set(matches.map((match) => match.id));
    return this.catalog.filter((record) => ids.has(record.id));
  }

  rememberCatalogAction(label, recordIds, fields = []) {
    const entries = [...new Set(recordIds || [])].map((id) => {
      const record = this.catalog.find((candidate) => candidate.id === id);
      if (!record) return { id, existed: false, values: {} };
      const values = {};
      for (const field of fields) values[field] = structuredClone(record[field]);
      return { id, existed: true, values };
    });
    const affectsSimilarity = fields.some((field) => [
      'title', 'displayName', 'manifest', 'directories', 'similarRecords',
      'dismissedSimilarRecordIds', 'possibleDuplicate'
    ].includes(field));
    this.pushUndoAction({ label, entries, affectsSimilarity });
  }

  pushUndoAction(action) {
    const willDropOldest = this.undoStack.length >= 10;
    this.undoStack.push(action);
    this.undoStack = this.undoStack.slice(-10);
    if (willDropOldest) {
      void this.log('warning', '仓库撤销记录已达到上限 10 条；最早的一条记录已被移出。');
    }
  }

  async saveCatalogRecords(records) {
    if (this.store.saveCatalogRecords) {
      return this.store.saveCatalogRecords(this.config.repositoryDirectory, records, this.catalog);
    }
    return this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
  }

  async undoCatalogAction() {
    const action = this.undoStack.pop();
    if (!action) throw new Error('没有可以撤回的仓库操作。');

    if (action.kind === 'delete-thumbnail') {
      const backup = action.backup;
      const record = this.catalog.find((candidate) => candidate.id === backup.recordId);
      if (!record) throw new Error('原始仓库记录不存在，无法撤回。');
      if (backup.trashPath) {
        try {
          await fs.rename(backup.trashPath, backup.thumbnailPath);
        } catch (error) {
          await this.log('warning', `撤回图片时恢复文件失败：${error.message}`, record.id);
        }
      }
      if (backup.kind === 'manual' && backup.manualImage) {
        record.manualImages = [...(record.manualImages || []), backup.manualImage];
      } else if (backup.kind === 'manifest' && Number.isInteger(backup.fileIndex) && record.manifest?.[backup.fileIndex]) {
        record.manifest[backup.fileIndex] = structuredClone(backup.fileSnapshot);
      }
      record.coverRelativePath = backup.coverRelativePath;
      record.coverThumbnailRef = backup.coverThumbnailRef;
      record.metadataUpdatedAt = backup.metadataUpdatedAt || new Date().toISOString();
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
      await this.log('warning', `已撤回：${action.label}。`, record.id);
      this.emitState();
      return this.getState();
    }

    for (const entry of action.entries) {
      if (!entry.existed) {
        this.catalog = this.catalog.filter((record) => record.id !== entry.id);
        this.markTermStatisticsDirty();
        continue;
      }
      const record = this.catalog.find((candidate) => candidate.id === entry.id);
      if (!record) continue;
      for (const [field, value] of Object.entries(entry.values)) {
        if (value === undefined) delete record[field];
        else record[field] = structuredClone(value);
      }
    }
    const removedRecord = action.entries.some((entry) => !entry.existed);
    if (action.affectsSimilarity || removedRecord) {
      const validIds = new Set(this.catalog.map((record) => record.id));
      for (const record of this.catalog) {
        record.similarRecords = (record.similarRecords || []).filter((item) => validIds.has(item.id));
      }
      for (const entry of action.entries) {
        const record = this.catalog.find((candidate) => candidate.id === entry.id);
        if (record) this.refreshSimilarityForRecord(record);
      }
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    } else {
      const restored = action.entries
        .map((entry) => this.catalog.find((candidate) => candidate.id === entry.id))
        .filter(Boolean);
      await this.saveCatalogRecords(restored);
    }
    await this.log('warning', `已撤回：${action.label}。`);
    return this.getState();
  }

  summarizeCatalogRecord(record) {
    const { manifest, directories, archivePassword, ...summary } = record;
    const cacheKey = [
      record.metadataUpdatedAt || '',
      record.coverThumbnailRef || '',
      record.coverRelativePath || '',
      manifest,
      record.manualImages
    ];
    let thumbnailSummary = this.catalogThumbnailSummaryCache.get(record);
    if (!thumbnailSummary || cacheKey.some((value, index) => thumbnailSummary.cacheKey[index] !== value)) {
      const thumbnails = recordThumbnailEntries(record);
      const preferredThumbnail = thumbnails.find((thumbnail) => thumbnail.ref === record.coverThumbnailRef) ||
        thumbnails.find((thumbnail) => thumbnail.relativePath === record.coverRelativePath);
      const firstThumbnail = preferredThumbnail || thumbnails[0];
      thumbnailSummary = {
        cacheKey,
        thumbnailCount: thumbnails.length,
        coverThumbnailPath: firstThumbnail?.ref || null
      };
      this.catalogThumbnailSummaryCache.set(record, thumbnailSummary);
    }
    return {
      ...summary,
      manifestCount: manifest?.length || record.fileCount || 0,
      directoryCount: directories?.length || 0,
      thumbnailCount: thumbnailSummary.thumbnailCount,
      coverThumbnailPath: thumbnailSummary.coverThumbnailPath,
      similarCount: record.similarRecords?.length || 0,
      possibleDuplicate: Boolean(record.possibleDuplicate || record.similarRecords?.length)
    };
  }

  searchCatalog(criteria = '') {
    const filters = typeof criteria === 'string' ? { query: criteria } : (criteria || {});
    const needle = String(filters.query || '').trim().toLowerCase();
    const tagFilter = String(filters.tag || '').trim().toLowerCase();
    const possibleDuplicateFilter = tagFilter === '__possible_duplicate__';
    const backupLocationFilter = String(filters.backupLocation || '').trim().toLowerCase();
    const hasRatingFilter = filters.rating !== undefined && filters.rating !== null && filters.rating !== '';
    const ratingFilter = hasRatingFilter ? Number(filters.rating) : null;
    const sortMode = String(filters.sort || 'inventory_desc');
    let queryCandidateIds = null;
    if (needle) {
      const exactMd5Ids = /^[a-f0-9]{32}$/i.test(needle) && this.store.findCatalogIdsByMd5
        ? this.store.findCatalogIdsByMd5(this.config.repositoryDirectory, needle, 2000)
        : [];
      if (exactMd5Ids.length > 0) {
        queryCandidateIds = new Set(exactMd5Ids);
      } else {
        const grams = searchGrams(needle);
        const ids = this.store.findCatalogIdsBySearchTerms
          ? this.store.findCatalogIdsBySearchTerms(this.config.repositoryDirectory, grams, 2000)
          : this.catalog.filter((record) => grams.some((gram) => searchGrams(catalogSearchText(record)).includes(gram))).map((record) => record.id);
        queryCandidateIds = new Set(ids);
      }
    }
    const candidateCatalog = queryCandidateIds
      ? this.catalog.filter((record) => queryCandidateIds.has(record.id))
      : this.catalog;
    const results = candidateCatalog
      .filter((record) => {
        if (possibleDuplicateFilter && !(record.similarRecords?.length > 0)) return false;
        if (tagFilter && !possibleDuplicateFilter &&
            !(record.tags || []).some((tag) => tag.toLowerCase() === tagFilter)) return false;
        if (backupLocationFilter && (record.backupLocation || '').toLowerCase() !== backupLocationFilter) return false;
        if (hasRatingFilter && record.rating !== ratingFilter) return false;
        if (!needle) return true;
        const recordText = catalogSearchText(record);
        if (recordText.includes(needle)) return true;
        const titleScore = Math.max(
          fuzzyTextScore(needle, record.title || ''),
          fuzzyTextScore(needle, record.displayName || '')
        );
        if (titleScore >= 0.45) return true;
        return (record.manifest || []).some((file) =>
          file.relativePath.toLowerCase().includes(needle) || file.md5?.toLowerCase() === needle
        );
      })
      .map((record) => {
        const summary = this.summarizeCatalogRecord(record);
        if (!needle) return { ...summary, searchScore: 0 };
        const recordText = catalogSearchText(record);
        const title = String(record.title || record.displayName || '').toLocaleLowerCase('zh-CN');
        let searchScore = Math.max(
          fuzzyTextScore(needle, record.title || ''),
          fuzzyTextScore(needle, record.displayName || '')
        );
        if (title === needle) searchScore = 1.2;
        else if (title.startsWith(needle)) searchScore = Math.max(searchScore, 1.1);
        else if (title.includes(needle)) searchScore = Math.max(searchScore, 1.05);
        else if (recordText.includes(needle)) searchScore = Math.max(searchScore, 0.86);
        const matchedFiles = (record.manifest || [])
          .filter((file) => file.relativePath.toLowerCase().includes(needle) || file.md5?.toLowerCase() === needle)
          .slice(0, 20)
          .map((file) => ({ relativePath: file.relativePath, size: file.size, md5: file.md5 }));
        return { ...summary, matchedFiles, searchScore };
      });

    const dateValue = (record) => {
      const value = Date.parse(record.inventoryDate || record.completedAt || record.verifiedAt || '');
      return Number.isFinite(value) ? value : 0;
    };
    const nameCompare = (a, b) => String(a.displayName || a.title || '')
      .localeCompare(String(b.displayName || b.title || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
    const secondaryCompare = sortMode === 'inventory_asc'
      ? (a, b) => dateValue(a) - dateValue(b)
      : sortMode === 'name_asc'
        ? nameCompare
        : sortMode === 'name_desc'
          ? (a, b) => nameCompare(b, a)
          : (a, b) => dateValue(b) - dateValue(a);
    results.sort((a, b) => needle
      ? (b.searchScore - a.searchScore || secondaryCompare(a, b))
      : secondaryCompare(a, b));
    return results;
  }

  getCatalogSuggestions(query, limit = 8) {
    const needle = String(query || '').trim();
    if (needle.length < 2) return [];
    const grams = searchGrams(needle);
    const ids = new Set(this.store.findCatalogIdsBySearchTerms
      ? this.store.findCatalogIdsBySearchTerms(this.config.repositoryDirectory, grams, 200)
      : this.catalog.filter((record) => grams.some((gram) => searchGrams(catalogSearchText(record)).includes(gram))).map((record) => record.id));
    return this.catalog
      .filter((record) => ids.has(record.id))
      .map((record) => ({
        id: record.id,
        title: record.title || record.displayName,
        score: fuzzyTextScore(needle, record.title || record.displayName || '')
      }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
  }

  getWarehouseInsights(now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mondayIndex = (today.getDay() + 6) % 7;
    const activityStart = new Date(today);
    activityStart.setDate(today.getDate() - mondayIndex - (15 * 7));

    const byDate = new Map();
    for (const record of this.catalog) {
      const key = localDateKey(record.inventoryDate || record.completedAt || record.verifiedAt);
      if (!key) continue;
      const current = byDate.get(key) || { inventoryCount: 0, originalBytes: 0 };
      current.inventoryCount += 1;
      current.originalBytes += Number(record.originalBytes) || 0;
      byDate.set(key, current);
    }

    const activity = [];
    for (let offset = 0; offset < 16 * 7; offset += 1) {
      const date = new Date(activityStart);
      date.setDate(activityStart.getDate() + offset);
      const key = localDateKey(date);
      const entry = byDate.get(key) || { inventoryCount: 0, originalBytes: 0 };
      activity.push({
        date: key,
        inventoryCount: entry.inventoryCount,
        originalBytes: entry.originalBytes,
        future: date > today
      });
    }

    const uniqueTags = new Set(
      this.catalog.flatMap((record) => (record.tags || []).map((tag) => tag.trim().toLowerCase())).filter(Boolean)
    );
    return {
      inventoryCount: this.catalog.length,
      uniqueTagCount: uniqueTags.size,
      totalOriginalBytes: this.catalog.reduce((sum, record) => sum + (Number(record.originalBytes) || 0), 0),
      activity
    };
  }

  getRandomCatalogRecord(excludeId = null) {
    if (this.catalog.length === 0) return null;
    const validIds = new Set(this.catalog.map((record) => record.id));
    this.randomWalkBag = this.randomWalkBag.filter((id) => validIds.has(id) && id !== excludeId);
    if (this.randomWalkBag.length === 0) {
      this.randomWalkBag = this.catalog.map((record) => record.id).filter((id) => id !== excludeId);
      for (let index = this.randomWalkBag.length - 1; index > 0; index -= 1) {
        const target = crypto.randomInt(index + 1);
        [this.randomWalkBag[index], this.randomWalkBag[target]] = [this.randomWalkBag[target], this.randomWalkBag[index]];
      }
    }
    const recordId = this.randomWalkBag.pop();
    const record = this.catalog.find((candidate) => candidate.id === recordId) || this.catalog[0];
    return this.summarizeCatalogRecord(record);
  }

  refreshSimilarityForRecord(record) {
    record.similarityVersion = this.similarityVersionStamp();
    if (!this.isSimilarityEnabled()) {
      if (!Array.isArray(record.similarRecords)) record.similarRecords = [];
      return;
    }
    this.refreshTermStatistics();
    const stamp = this.similarityVersionStamp();
    for (const candidate of this.catalog) {
      candidate.similarRecords = (candidate.similarRecords || []).filter((item) => item.id !== record.id);
      refreshPossibleDuplicate(candidate);
    }
    const matches = findSimilarProjects(record, this.getSimilarityCandidates(record), this.similarityIgnoreTerms, this.similarityStrength)
      .filter((match) => {
        const candidate = this.catalog.find((item) => item.id === match.id);
        return candidate && !similarityIsDismissed(record, candidate);
      });
    record.similarRecords = matches;
    record.similarityVersion = stamp;
    refreshPossibleDuplicate(record);
    for (const match of matches) {
      const candidate = this.catalog.find((item) => item.id === match.id);
      if (!candidate) continue;
      const reciprocal = {
        id: record.id,
        title: record.title || record.displayName,
        score: match.score,
        reasons: match.reasons
      };
      candidate.similarRecords = [
        ...(candidate.similarRecords || []).filter((item) => item.id !== record.id),
        reciprocal
      ].sort((a, b) => b.score - a.score).slice(0, 20);
      refreshPossibleDuplicate(candidate);
      candidate.similarityVersion = stamp;
    }
  }

  async recalculateCatalogSimilarity(recordId) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    this.refreshSimilarityForRecord(record);
    record.metadataUpdatedAt = new Date().toISOString();
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已重新计算“${record.title}”的相似项目，并同步更新对应关系。`);
    return this.getCatalogDetails(recordId);
  }

  async removeCatalogSimilarity(recordId, similarId) {
    if (recordId === similarId) throw new Error('不能移除项目与自身的关系。');
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    const similar = this.catalog.find((candidate) => candidate.id === similarId);
    if (!record || !similar) throw new Error('相似项目不存在，请刷新后重试。');
    this.rememberCatalogAction(`移除“${record.title}”与“${similar.title}”的相似关系`, [record.id, similar.id], [
      'similarRecords', 'dismissedSimilarRecordIds', 'possibleDuplicate', 'metadataUpdatedAt'
    ]);
    record.similarRecords = (record.similarRecords || []).filter((item) => item.id !== similar.id);
    similar.similarRecords = (similar.similarRecords || []).filter((item) => item.id !== record.id);
    record.dismissedSimilarRecordIds = [...new Set([...(record.dismissedSimilarRecordIds || []), similar.id])].slice(-200);
    similar.dismissedSimilarRecordIds = [...new Set([...(similar.dismissedSimilarRecordIds || []), record.id])].slice(-200);
    refreshPossibleDuplicate(record);
    refreshPossibleDuplicate(similar);
    const updatedAt = new Date().toISOString();
    record.metadataUpdatedAt = updatedAt;
    similar.metadataUpdatedAt = updatedAt;
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已双向移除“${record.title}”与“${similar.title}”的相似关系。`);
    return this.getCatalogDetails(recordId);
  }

  async updateCatalogMetadata(recordId, metadata) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定归档记录。');
    const validated = validateCatalogMetadata(record, metadata);
    const titleChanged = validated.title !== record.title;
    this.rememberCatalogAction(`修改“${record.title}”的整理信息`, [recordId], [
      'title', 'tags', 'rating', 'notes', 'backupLocation', 'archivePassword',
      'passwordRecorded', 'hasPassword', 'metadataUpdatedAt'
    ]);
    Object.assign(record, validated, {
      metadataUpdatedAt: new Date().toISOString()
    });
    if (titleChanged) this.refreshSimilarityForRecord(record);
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已更新仓库条目“${record.title}”的整理信息。`);
    return this.getCatalogDetails(recordId);
  }

  async setCatalogCover(recordId, thumbnailRef) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    const thumbnail = recordThumbnailEntries(record)
      .find((candidate) => candidate.ref === thumbnailRef);
    if (!thumbnail) throw new Error('这张缩略图不存在，不能设为封面。');
    this.getThumbnailPath(recordId, thumbnailRef);
    this.rememberCatalogAction(`修改“${record.title}”的封面`, [recordId], [
      'coverRelativePath', 'coverThumbnailRef', 'metadataUpdatedAt'
    ]);
    record.coverRelativePath = thumbnail.relativePath;
    record.coverThumbnailRef = thumbnail.ref;
    record.metadataUpdatedAt = new Date().toISOString();
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已更新仓库条目“${record.title}”的封面。`);
    return this.getCatalogDetails(recordId);
  }

  async deleteCatalogThumbnail(recordId, thumbnailRef) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    const thumbnail = recordThumbnailEntries(record)
      .find((candidate) => candidate.ref === thumbnailRef);
    if (!thumbnail) throw new Error('这张图片不存在或已被删除。');
    const thumbnailPath = this.getThumbnailPath(recordId, thumbnailRef);
    const isManual = String(thumbnailRef).startsWith('manual-image:');
    const backup = {
      recordId,
      thumbnailRef,
      kind: isManual ? 'manual' : 'manifest',
      thumbnailPath,
      trashPath: null,
      coverRelativePath: record.coverRelativePath,
      coverThumbnailRef: record.coverThumbnailRef,
      metadataUpdatedAt: record.metadataUpdatedAt
    };

    if (thumbnailPath) {
      try {
        await fs.access(thumbnailPath);
        const trashDir = path.join(this.config.repositoryDirectory, 'thumbnails', '.trash', recordId);
        await fs.mkdir(trashDir, { recursive: true });
        const trashPath = path.join(trashDir, `${path.basename(thumbnailPath)}.${crypto.randomUUID()}`);
        await fs.rename(thumbnailPath, trashPath);
        backup.trashPath = trashPath;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    if (isManual) {
      const imageIndex = (record.manualImages || []).findIndex((image) => image.ref === thumbnailRef);
      if (imageIndex >= 0) {
        backup.manualImage = structuredClone(record.manualImages[imageIndex]);
        record.manualImages.splice(imageIndex, 1);
      }
    } else {
      for (let fileIndex = 0; fileIndex < (record.manifest || []).length; fileIndex += 1) {
        const file = record.manifest[fileIndex];
        const entries = thumbnailEntries(file);
        const thumbIndex = entries.findIndex((entry) => entry.ref === thumbnailRef);
        if (thumbIndex < 0) continue;
        backup.fileIndex = fileIndex;
        backup.thumbIndex = thumbIndex;
        backup.fileSnapshot = structuredClone(file);
        if (Array.isArray(file.thumbnails) && file.thumbnails.length > 0) {
          file.thumbnails.splice(thumbIndex, 1);
        }
        if (file.thumbnailPath && file.thumbnailPath === thumbnail.thumbnailPath) {
          file.thumbnailPath = file.thumbnails?.[0]?.thumbnailPath || null;
        }
        break;
      }
    }

    if (record.coverThumbnailRef === thumbnailRef ||
        (!record.coverThumbnailRef && record.coverRelativePath === thumbnail.relativePath)) {
      const remaining = recordThumbnailEntries(record);
      if (remaining.length > 0) {
        record.coverThumbnailRef = remaining[0].ref;
        record.coverRelativePath = remaining[0].relativePath;
      } else {
        record.coverThumbnailRef = null;
        record.coverRelativePath = null;
      }
    }
    record.metadataUpdatedAt = new Date().toISOString();
    this.pushUndoAction({
      label: `删除“${record.title}”的图片`,
      kind: 'delete-thumbnail',
      backup
    });
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('warning', `已删除图片：${thumbnail.relativePath}`, recordId);
    this.emitState();
    return this.getCatalogDetails(recordId);
  }

  async addManualCatalogRecord(input = {}) {
    const title = String(input.title ?? input.name ?? '').trim();
    const notes = String(input.notes ?? '').trim();
    const tags = normalizeTagsInput(input.tags ?? []);
    const sourcePath = String(input.sourcePath ?? input.originalLocation ?? '').trim();
    const backupLocation = String(input.backupLocation ?? '').trim();
    if (!title) throw new Error('名称不能为空。');
    if (!notes) throw new Error('备注不能为空。');
    if (title.length > 200) throw new Error('名称不能超过 200 个字符。');
    if (notes.length > 5000) throw new Error('备注不能超过 5000 个字符。');
    if (sourcePath.length > 2000 || /[\u0000-\u001f\u007f]/.test(sourcePath)) {
      throw new Error('原始位置不能超过 2000 个字符，也不能包含换行或控制字符。');
    }
    if (backupLocation.length > 200 || /[\u0000-\u001f\u007f]/.test(backupLocation)) {
      throw new Error('备份位置不能超过 200 个字符，也不能包含换行或控制字符。');
    }
    const inventoryDate = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      jobId: null,
      recordType: 'manual',
      sourcePath,
      originalSourcePath: sourcePath,
      displayName: title,
      title,
      tags,
      rating: 0,
      notes,
      backupLocation,
      coverRelativePath: null,
      coverThumbnailRef: null,
      manualImages: [],
      similarRecords: [],
      dismissedSimilarRecordIds: [],
      duplicateEvidence: false,
      possibleDuplicate: false,
      sourceType: 'manual',
      fileCount: 0,
      originalBytes: 0,
      archiveBaseName: '',
      archiveFiles: [],
      archiveTotalBytes: 0,
      archivePassword: '',
      hasPassword: false,
      passwordRecorded: false,
      manifest: [],
      directories: [],
      sourceDisposition: 'manual_record',
      inventoryDate,
      completedAt: inventoryDate
    };
    this.rememberCatalogAction(`新增手动库存“${title}”`, [record.id]);
    this.catalog.push(record);
    this.refreshSimilarityForRecord(record);
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已手动新增库存“${title}”。`);
    return this.getCatalogDetails(record.id);
  }

  async addCatalogImage(recordId, input = {}) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    if (!this.services.storeCatalogImage) throw new Error('当前程序无法保存所选图片。');
    if ((record.manualImages || []).length >= 100) throw new Error('单个项目最多手动添加 100 张图片。');
    const stored = await this.services.storeCatalogImage(recordId, input, this.config.repositoryDirectory);
    normalizeThumbnailReferences(stored, this.config.repositoryDirectory, { strict: true });
    this.rememberCatalogAction(`为“${record.title}”添加图片`, [recordId], [
      'manualImages', 'coverRelativePath', 'coverThumbnailRef', 'metadataUpdatedAt'
    ]);
    record.manualImages = [...(record.manualImages || []), stored];
    if (!record.coverThumbnailRef) {
      record.coverThumbnailRef = stored.ref;
      record.coverRelativePath = stored.relativePath;
    }
    record.metadataUpdatedAt = new Date().toISOString();
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.log('info', `已为仓库条目“${record.title}”添加图片。`);
    return this.getCatalogDetails(recordId);
  }

  async addTagsToCatalogRecords(recordIds, inputTags) {
    const ids = new Set(recordIds || []);
    if (ids.size === 0) throw new Error('请先选择仓库内容。');
    const newTags = normalizeTagsInput(inputTags);
    if (newTags.length === 0) throw new Error('请输入要追加的标签。');
    const records = this.catalog.filter((record) => ids.has(record.id));
    if (records.length !== ids.size) throw new Error('部分仓库记录不存在，请刷新后重试。');
    for (const record of records) {
      const tags = [...new Set([...(record.tags || []), ...newTags])];
      if (tags.length > 30) throw new Error(`“${record.title}”追加后会超过 30 个标签。`);
    }
    this.rememberCatalogAction(`为 ${records.length} 项追加标签`, records.map((record) => record.id), [
      'tags', 'metadataUpdatedAt'
    ]);
    const updatedAt = new Date().toISOString();
    for (const record of records) {
      record.tags = [...new Set([...(record.tags || []), ...newTags])];
      record.metadataUpdatedAt = updatedAt;
    }
    await this.saveCatalogRecords(records);
    await this.log('info', `已为 ${records.length} 条仓库内容追加标签：${newTags.join('、')}。`);
    return this.getState();
  }

  async updateBackupLocationForCatalogRecords(recordIds, inputLocation) {
    const ids = new Set(recordIds || []);
    if (ids.size === 0) throw new Error('请先选择仓库内容。');
    const backupLocation = String(inputLocation ?? '').trim();
    if (!backupLocation) throw new Error('备份位置不能为空。');
    if (backupLocation.length > 200 || /[\u0000-\u001f\u007f]/.test(backupLocation)) {
      throw new Error('备份位置不能超过 200 个字符，也不能包含换行或控制字符。');
    }
    const records = this.catalog.filter((record) => ids.has(record.id));
    if (records.length !== ids.size) throw new Error('部分仓库记录不存在，请刷新后重试。');
    this.rememberCatalogAction(`批量修改 ${records.length} 项备份位置`, records.map((record) => record.id), [
      'backupLocation', 'metadataUpdatedAt'
    ]);
    const updatedAt = new Date().toISOString();
    for (const record of records) {
      record.backupLocation = backupLocation;
      record.metadataUpdatedAt = updatedAt;
    }
    await this.saveCatalogRecords(records);
    await this.log('info', `已把 ${records.length} 条仓库内容的备份位置修改为：${backupLocation}。`);
    return this.getState();
  }

  async restoreOriginalSourceForRecord(record, pathExists) {
    if (!['moved', 'trashed'].includes(record.sourceDisposition)) return false;
    const originalPath = getOriginalSourcePath(record);
    if (!originalPath) throw new Error('没有记录原文件位置，无法自动复原。');
    if (await pathExists(originalPath)) throw new Error(`原文件位置已存在同名内容，已停止复原：${originalPath}`);

    if (record.sourceDisposition === 'trashed') {
      if (!this.services.restoreTrashItem) throw new Error('当前系统不支持自动从回收站复原。');
      const restored = await this.services.restoreTrashItem(originalPath);
      if (!restored || !(await pathExists(originalPath))) {
        throw new Error('没有在 Windows 回收站中找到对应原文件，或系统未能完成复原。');
      }
    } else {
      const movedPath = String(record.movedTo || '').trim();
      if (!movedPath || !(await pathExists(movedPath))) throw new Error('记录的移动目标中已找不到原文件。');
      await fs.mkdir(path.dirname(originalPath), { recursive: true });
      try {
        await fs.rename(movedPath, originalPath);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        const incomingPath = `${originalPath}.restoring-${record.id}`;
        try {
          if (record.sourceType === 'directory') {
            await fs.cp(movedPath, incomingPath, { recursive: true, errorOnExist: true, force: false });
            const restored = await inspectPath(incomingPath, 'directory');
            if (restored.fileCount !== Number(record.fileCount) || restored.totalBytes !== Number(record.originalBytes)) {
              throw new Error('跨磁盘复原校验失败，文件数量或大小不一致。');
            }
          } else {
            await fs.copyFile(movedPath, incomingPath, fsConstants.COPYFILE_EXCL);
            const restored = await fs.stat(incomingPath);
            if (restored.size !== Number(record.originalBytes)) throw new Error('跨磁盘复原校验失败，文件大小不一致。');
          }
          await fs.rename(incomingPath, originalPath);
          await fs.rm(movedPath, { recursive: record.sourceType === 'directory', force: false });
        } catch (copyError) {
          await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {});
          throw copyError;
        }
      }
    }

    record.sourceDisposition = 'kept';
    record.movedTo = '';
    record.sourceLocationCheckedAt = new Date().toISOString();
    record.metadataUpdatedAt = new Date().toISOString();
    await this.log('warning', `已把原文件复原到：${originalPath}`, record.jobId, false);
    return true;
  }

  async restoreCatalogSource(recordId) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定仓库记录。');
    const pathExists = this.services.pathExists || (async (targetPath) => {
      try { await fs.access(targetPath); return true; } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });
    const restored = await this.restoreOriginalSourceForRecord(record, pathExists);
    if (!restored) throw new Error('当前原文件不在可复原状态。');
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    this.emitState();
    return { record: this.getCatalogDetails(recordId), path: getOriginalSourcePath(record) };
  }

  async deleteCatalogRecords(recordIds, options = {}) {
    const ids = [...new Set(recordIds || [])];
    if (ids.length === 0) throw new Error('请先选择要删除的仓库内容。');
    const deletedIds = [];
    const failures = [];
    const thumbnailRoot = path.join(this.config.repositoryDirectory, 'thumbnails');
    const pathExists = this.services.pathExists || (async (targetPath) => {
      try { await fs.access(targetPath); return true; } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    });

    for (const recordId of ids) {
      const record = this.catalog.find((candidate) => candidate.id === recordId);
      if (!record) {
        failures.push({ id: recordId, title: '未知条目', message: '仓库记录不存在。' });
        continue;
      }
      try {
        if (options?.restoreOriginalSources && ['moved', 'trashed'].includes(record.sourceDisposition)) {
          await this.restoreOriginalSourceForRecord(record, pathExists);
          await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
        }
        if (record.recordType !== 'manual' && !record.importedFrom && (record.archiveFiles || []).length > 0) {
          await quarantineAndTrashArchiveFiles(
            record,
            this.config.archiveStagingDirectory,
            this.services.trashItem,
            pathExists
          );
        }
        const thumbnailFolders = [
          record.jobId,
          (record.manualImages || []).length > 0 ? `manual-${record.id}` : null
        ].filter(Boolean);
        for (const thumbnailFolder of thumbnailFolders) {
          const safeFolder = assertSafePathSegment(thumbnailFolder, '缩略图目录');
          const thumbnailPath = assertOwnedChildPath(thumbnailRoot, path.join(thumbnailRoot, safeFolder));
          if (await pathExists(thumbnailPath)) {
            try {
              if (this.services.trashItem) await this.services.trashItem(thumbnailPath);
            } catch (error) {
              await this.log('warning', `归档已删除，但缩略图清理失败：${error.message}`, record.jobId);
            }
          }
        }
        this.catalog = this.catalog.filter((candidate) => candidate.id !== recordId);
        await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
        deletedIds.push(recordId);
        await this.log(
          'warning',
          record.recordType === 'manual'
            ? `已删除手动库存“${record.title}”。`
            : record.importedFrom
              ? `已删除外部仓库记录“${record.title}”；外部压缩包保留在原位置。`
            : (record.archiveFiles || []).length > 0
              ? `已删除仓库内容“${record.title}”；对应归档已移入 Windows 回收站。`
              : `已删除未压缩仓库内容“${record.title}”；原文件保持不变。`
        );
      } catch (error) {
        failures.push({ id: recordId, title: record.title, message: error.message });
      }
    }
    if (deletedIds.length > 0) {
      const deletedSet = new Set(deletedIds);
      this.undoStack = this.undoStack.filter((action) =>
        !(action.entries || []).some((entry) => deletedSet.has(entry.id))
      );
      const validIds = new Set(this.catalog.map((record) => record.id));
      for (const record of this.catalog) {
        record.similarRecords = (record.similarRecords || []).filter((item) => validIds.has(item.id));
        refreshPossibleDuplicate(record);
      }
      this.markTermStatisticsDirty();
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    }
    this.emitState();
    return { state: this.getState(), deletedIds, failures };
  }

  getCatalogDetails(recordId) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定归档记录。');
    const similarIds = new Set((record.similarRecords || []).map((item) => item.id));
    const similarCandidates = this.catalog.filter((candidate) => similarIds.has(candidate.id));
    const indexedExactFileMatches = this.findIndexedExactFileMatches(
      record.manifest,
      record.id,
      Math.min(5000, Math.max(100, record.manifest?.length || 0))
    );
    return {
      ...record,
      similarEntryMatches: findSimilarEntryMatches(record, similarCandidates, this.similarityIgnoreTerms, {
        exactFileMatches: indexedExactFileMatches
      })
    };
  }

  async getQueueSimilarityReport(jobId) {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('没有找到指定队列项目。');
    if (this.config.similarityReportEnabled === false) throw new Error('队列相似报告已关闭。');

    let manifest = await this.store.loadPendingManifest(this.config.repositoryDirectory, job.id);
    const completedRecord = this.catalog.find((record) => record.jobId === job.id);
    let fingerprintPending = false;
    let reusedFingerprintCount = 0;
    if (!Array.isArray(manifest)) {
      if (Array.isArray(completedRecord?.manifest)) {
        manifest = completedRecord.manifest;
      } else {
        const files = await collectFiles(job.sourcePath, job.sourceType);
        manifest = files.map(({ absolutePath: _absolutePath, ...file }) => {
          return { ...file };
        });
        // The performance safeguard may intentionally skip tiny or unsampled MD5
        // values in the ordinary manifest. That must never make the report claim
        // content verification is complete: project-duplicate verification uses
        // its own full candidate pass when needed.
        fingerprintPending = manifest.some((file) => !/^[a-f0-9]{32}$/i.test(String(file.md5 || '')));
      }
    }
    const directories = Array.isArray(completedRecord?.directories)
      ? completedRecord.directories
      : await collectDirectories(job.sourcePath, job.sourceType);
    const subject = { ...job, manifest, directories };
    const linkedIds = new Set([
      ...(job.nameDuplicateMatches || []).map((match) => match.archiveId),
      ...(job.similarMatches || []).map((match) => match.id),
      ...(job.exactProjectMatches || []).map((match) => match.id),
      ...(job.exactDuplicateMatches || []).flatMap((match) =>
        (match.previous || []).map((previous) => previous.archiveId))
    ].filter(Boolean));
    const linkedCandidates = this.catalog.filter((record) => linkedIds.has(record.id));
    const subjectCatalogRecordId = job.sourceCatalogRecordId || completedRecord?.id;
    const indexedExactFileMatches = this.findIndexedExactFileMatches(
      manifest,
      subjectCatalogRecordId,
      Math.min(5000, Math.max(100, manifest.length))
    );
    const similarEntryMatches = findSimilarEntryMatches(subject, linkedCandidates, this.similarityIgnoreTerms, {
      exactFileMatches: indexedExactFileMatches
    });

    const evidenceByRecord = new Map();
    const ensureEvidence = (recordId) => {
      const record = this.catalog.find((candidate) => candidate.id === recordId);
      if (!record) return null;
      if (!evidenceByRecord.has(recordId)) {
        evidenceByRecord.set(recordId, {
          id: record.id,
          title: record.title || record.displayName || '',
          reasons: new Set(),
          exactFiles: new Set(),
          exactDirectories: new Set(),
          similarFiles: new Set(),
          similarDirectories: new Set(),
          score: 0
        });
      }
      return evidenceByRecord.get(recordId);
    };
    for (const match of job.nameDuplicateMatches || []) {
      const evidence = ensureEvidence(match.archiveId);
      evidence?.reasons.add('项目名称完全一致');
    }
    for (const match of job.similarMatches || []) {
      const evidence = ensureEvidence(match.id);
      if (!evidence) continue;
      evidence.score = Math.max(evidence.score, Number(match.score) || 0);
      for (const reason of match.reasons || []) evidence.reasons.add(reason);
    }
    for (const match of job.exactProjectMatches || []) {
      ensureEvidence(match.id)?.reasons.add('项目完全重复');
    }
    const indexedExactProjectCandidates = this.findIndexedProjectCandidates(
      manifest,
      'content',
      subjectCatalogRecordId
    );
    for (const match of findExactProjectMatches(manifest, indexedExactProjectCandidates, subjectCatalogRecordId)) {
      ensureEvidence(match.id)?.reasons.add('项目完全重复');
    }
    for (const entry of similarEntryMatches) {
      for (const match of entry.matches || []) {
        const evidence = ensureEvidence(match.recordId);
        if (!evidence) continue;
        evidence.reasons.add(match.reason);
        if (match.reason === '文件内容完全一致') evidence.exactFiles.add(entry.relativePath);
        else if (match.reason === '目录名完全一致') evidence.exactDirectories.add(entry.relativePath);
        else if (entry.kind === 'file') evidence.similarFiles.add(entry.relativePath);
        else evidence.similarDirectories.add(entry.relativePath);
      }
    }

    const similarProjects = [...evidenceByRecord.values()].map((evidence) => {
      if (evidence.reasons.has('项目名称完全一致')) {
        evidence.reasons.delete('标题相似');
        evidence.reasons.delete('标题一致');
      }
      return {
        id: evidence.id,
        title: evidence.title,
        score: evidence.score,
        exactFileCount: evidence.exactFiles.size,
        exactDirectoryCount: evidence.exactDirectories.size,
        similarFileCount: evidence.similarFiles.size,
        similarDirectoryCount: evidence.similarDirectories.size,
        reasons: [...evidence.reasons]
      };
    }).sort((left, right) =>
      right.exactFileCount - left.exactFileCount || right.score - left.score || left.title.localeCompare(right.title, 'zh-CN'));

    return {
      jobId: job.id,
      displayName: job.displayName,
      sourcePath: job.sourcePath,
      sourceType: job.sourceType,
      manifest,
      directories,
      fingerprintPending,
      reusedFingerprintCount,
      similarEntryMatches,
      similarProjects
    };
  }

  getThumbnailPath(recordId, thumbnailRef) {
    const record = this.catalog.find((candidate) => candidate.id === recordId);
    if (!record) throw new Error('没有找到指定归档记录。');
    const thumbnail = recordThumbnailEntries(record)
      .find((candidate) => candidate.ref === thumbnailRef);
    if (!thumbnail?.thumbnailPath) return null;
    return resolveThumbnailReference(this.config.repositoryDirectory, thumbnail.thumbnailPath);
  }

  emitState() {
    this.emit('state', this.getState());
  }

  emitProgressThrottled(job, delayMs = 250) {
    this.pendingProgress = {
      jobId: job.id,
      stage: job.status,
      percentage: Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)))
    };
    if (this.progressEmissionTimer) return;
    this.progressEmissionTimer = setTimeout(() => {
      this.progressEmissionTimer = null;
      const progress = this.pendingProgress;
      this.pendingProgress = null;
      if (progress) this.emit('progress', progress);
    }, delayMs);
    this.progressEmissionTimer.unref?.();
  }

  discardPendingProgress(jobId) {
    if (this.pendingProgress?.jobId !== jobId) return;
    this.pendingProgress = null;
    if (this.progressEmissionTimer) {
      clearTimeout(this.progressEmissionTimer);
      this.progressEmissionTimer = null;
    }
  }

  resolveProgramPath(configuredPath) {
    if (!configuredPath) return '';
    return this.services.resolveProgramPath
      ? this.services.resolveProgramPath(configuredPath)
      : path.resolve(configuredPath);
  }

  compressionBytesPerMs() {
    const samples = (this.config.compressionHistory || [])
      .map((sample) => Number(sample.bytes) / Number(sample.durationMs))
      .filter((rate) => Number.isFinite(rate) && rate > 0)
      .sort((a, b) => a - b);
    return samples.length > 0 ? samples[Math.floor(samples.length / 2)] : (20 * MIB) / 1000;
  }

  async rememberCompressionSample(bytes, durationMs, totalDurationMs = durationMs, postCompressionDurationMs = 0) {
    if (!(bytes > 0) || !(durationMs > 0)) return;
    this.config.compressionHistory = [...(this.config.compressionHistory || []), {
      bytes: Math.round(bytes),
      durationMs: Math.round(durationMs),
      totalDurationMs: Math.max(Math.round(durationMs), Math.round(totalDurationMs)),
      postCompressionDurationMs: Math.max(0, Math.round(postCompressionDurationMs)),
      recordedAt: new Date().toISOString()
    }].slice(-30);
    await this.store.saveSettings(this.config);
  }

  async updateConfig(config) {
    if (this.running) throw new Error('队列运行期间不能修改设置。');
    const backupLocation = String(config.backupLocation ?? this.config.backupLocation ?? '').trim();
    if (backupLocation.length > 200) throw new Error('备份位置不能超过 200 个字符。');
    if (config.recordBackupLocation && !backupLocation) {
      throw new Error('勾选“记录备份位置”后，请填写备份位置。');
    }
    const archivePassword = String(config.archivePassword ?? this.config.archivePassword ?? ARCHIVE_PASSWORD);
    if (archivePassword.length > 128 || /[\u0000-\u001f\u007f]/.test(archivePassword)) {
      throw new Error('解压密码最多 128 个字符，且不能包含换行或控制字符。留空表示不设置密码。');
    }
    const videoFrameCount = Number(config.videoFrameCount ?? this.config.videoFrameCount ?? 3);
    if (!Number.isInteger(videoFrameCount) || videoFrameCount < 1 || videoFrameCount > 20) {
      throw new Error('每个视频的缩略帧数必须是 1—20 的整数。');
    }
    const thumbnailLimit = Number(config.thumbnailLimit ?? this.config.thumbnailLimit ?? 30);
    if (!Number.isInteger(thumbnailLimit) || thumbnailLimit < 1 || thumbnailLimit > 500) {
      throw new Error('单个项目的缩略图上限必须是 1—500 的整数。');
    }
    const archiveFormat = String(config.archiveFormat ?? this.config.archiveFormat ?? '7z').toLowerCase();
    if (!['7z', 'zip'].includes(archiveFormat)) throw new Error('压缩格式只能选择 7z 或 ZIP。');
    const compressionLevel = Number(config.compressionLevel ?? this.config.compressionLevel ?? 1);
    if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
      throw new Error('压缩率等级必须是 0—9 的整数。');
    }
    const archiveVolumeEnabled = Object.prototype.hasOwnProperty.call(config, 'archiveVolumeEnabled')
      ? config.archiveVolumeEnabled === true
      : this.config.archiveVolumeEnabled !== false;
    const archiveVolumeBytes = Number(config.archiveVolumeBytes ?? this.config.archiveVolumeBytes ?? LARGE_TASK_BYTES);
    if (!Number.isInteger(archiveVolumeBytes) ||
        archiveVolumeBytes < MIN_ARCHIVE_VOLUME_BYTES || archiveVolumeBytes > MAX_ARCHIVE_VOLUME_BYTES) {
      throw new Error('单卷大小必须是 64 MiB—10 GiB 之间的整数。');
    }
    const smallItemFilter = Object.prototype.hasOwnProperty.call(config, 'smallItemFilter')
      ? config.smallItemFilter === true
      : this.config.smallItemFilter === true;
    const autoSkipExactDuplicates = Object.prototype.hasOwnProperty.call(config, 'autoSkipExactDuplicates')
      ? config.autoSkipExactDuplicates === true
      : this.config.autoSkipExactDuplicates === true;
    const similarityReportEnabled = Object.prototype.hasOwnProperty.call(config, 'similarityReportEnabled')
      ? config.similarityReportEnabled !== false
      : this.config.similarityReportEnabled !== false;
    const largeFolderSimplification = Object.prototype.hasOwnProperty.call(config, 'largeFolderSimplification')
      ? config.largeFolderSimplification === true
      : this.config.largeFolderSimplification === true;
    const largeFolderFileThreshold = Number(
      config.largeFolderFileThreshold ?? this.config.largeFolderFileThreshold ?? DEFAULT_LARGE_FOLDER_FILE_THRESHOLD
    );
    if (!Number.isInteger(largeFolderFileThreshold) || largeFolderFileThreshold < 1 || largeFolderFileThreshold > 100000) {
      throw new Error('超大文件夹阈值必须是 1—100000 的整数。');
    }
    const largeFolderMd5SampleLimit = Number(
      config.largeFolderMd5SampleLimit ?? this.config.largeFolderMd5SampleLimit ?? DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT
    );
    if (!Number.isInteger(largeFolderMd5SampleLimit) ||
        largeFolderMd5SampleLimit < MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT ||
        largeFolderMd5SampleLimit > MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT) {
      throw new Error('代表文件数量必须是 1—100000 的整数。');
    }
    const skipTinyMd5Files = Object.prototype.hasOwnProperty.call(config, 'skipTinyMd5Files')
      ? config.skipTinyMd5Files === true
      : this.config.skipTinyMd5Files === true;
    const tinyFileMd5ThresholdBytes = Number(
      config.tinyFileMd5ThresholdBytes ?? this.config.tinyFileMd5ThresholdBytes ?? DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES
    );
    if (!Number.isInteger(tinyFileMd5ThresholdBytes) ||
        tinyFileMd5ThresholdBytes < MIN_TINY_FILE_MD5_THRESHOLD_BYTES ||
        tinyFileMd5ThresholdBytes > MAX_TINY_FILE_MD5_THRESHOLD_BYTES) {
      throw new Error('极小文件阈值必须是 1 KB—1 GB 之间的整数。');
    }
    const autoSkipExactDuplicateActionRaw = String(
      config.autoSkipExactDuplicateAction ?? this.config.autoSkipExactDuplicateAction ?? 'keep'
    );
    if (!['keep', 'remove'].includes(autoSkipExactDuplicateActionRaw)) {
      throw new Error('请选择有效的自动跳过后处理方式。');
    }
    const minimumTaskBytes = Number(config.minimumTaskBytes ?? this.config.minimumTaskBytes ?? (100 * MIB));
    if (smallItemFilter && (!Number.isFinite(minimumTaskBytes) || minimumTaskBytes < MIB || minimumTaskBytes > 100 * 1024 * MIB)) {
      throw new Error('小文件过滤阈值必须在 1 MB—100 GB 之间。');
    }
    const scheduleStart = String(config.scheduleStart ?? this.config.scheduleStart ?? '');
    const scheduleEnd = String(config.scheduleEnd ?? this.config.scheduleEnd ?? '');
    const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (config.scheduleEnabled && (!validTime(scheduleStart) || !validTime(scheduleEnd) || scheduleStart === scheduleEnd)) {
      throw new Error('定时运行需要填写不同的开始和结束时间。');
    }
    const archiveNamingMode = String(config.archiveNamingMode ?? this.config.archiveNamingMode ?? 'timestamp_random');
    if (!['timestamp_random', 'original', 'custom_random'].includes(archiveNamingMode)) {
      throw new Error('请选择有效的压缩包命名方式。');
    }
    const customArchiveName = String(config.customArchiveName ?? this.config.customArchiveName ?? '').trim();
    if (archiveNamingMode === 'custom_random') validateWindowsFileStem(customArchiveName, '自定义名称');
    const similarityStrengthRaw = String(
      config.similarityStrength ?? this.config.similarityStrength ?? DEFAULT_SIMILARITY_STRENGTH
    );
    if (similarityStrengthRaw && !SIMILARITY_STRENGTHS.includes(similarityStrengthRaw)) {
      throw new Error('请选择有效的相似度强度。');
    }
    const similarityStrength = normalizeSimilarityStrength(similarityStrengthRaw);
    const strengthChanged = similarityStrength !== this.similarityStrength;
    const similarityEnabled = config.similarityEnabled === undefined
      ? this.isSimilarityEnabled()
      : Boolean(config.similarityEnabled);
    const moveCompleted = Boolean(config.moveCompleted);
    const autoTrashCompleted = Boolean(config.autoTrashCompleted);
    if (moveCompleted && autoTrashCompleted) throw new Error('归档后移动与移入回收站不能同时启用。');
    if (this.safetyHalt && autoTrashCompleted) {
      throw new Error('请先确认回收站安全警告，再决定是否重新启用自动移入回收站。');
    }
    const processedSourceDirectory = String(
      config.processedSourceDirectory ?? this.config.processedSourceDirectory ?? ''
    ).trim();
    if (moveCompleted && !processedSourceDirectory) throw new Error('请填写归档后移动位置。');
    const previousRepositoryDirectory = this.config.repositoryDirectory;
    const previousArchiveOutputDirectory = String(this.config.archiveOutputDirectory || '').trim();
    const archiveOutputDirectory = String(
      config.archiveOutputDirectory ?? this.config.archiveOutputDirectory ?? ''
    ).trim();
    const hasArchiveOutputDirectory = Object.prototype.hasOwnProperty.call(config, 'archiveOutputDirectory');
    const hasArchiveStagingDirectory = Object.prototype.hasOwnProperty.call(config, 'archiveStagingDirectory');
    let archiveStagingDirectory = String(
      config.archiveStagingDirectory ?? this.config.archiveStagingDirectory ?? ''
    ).trim();
    if (!hasArchiveStagingDirectory && hasArchiveOutputDirectory) {
      const previousDerived = makeArchiveStagingDirectory(previousArchiveOutputDirectory);
      if (!archiveStagingDirectory ||
          normalizeForComparison(archiveStagingDirectory) === normalizeForComparison(previousDerived)) {
        archiveStagingDirectory = makeArchiveStagingDirectory(archiveOutputDirectory);
      }
    }
    if (hasArchiveOutputDirectory && archiveOutputDirectory && !archiveStagingDirectory) {
      archiveStagingDirectory = makeArchiveStagingDirectory(archiveOutputDirectory);
    }
    this.config = {
      ...this.config,
      ...config,
      archivePassword,
      backupLocation,
      videoFrameCount,
      thumbnailLimit,
      archiveFormat,
      compressionLevel,
      archiveVolumeEnabled,
      archiveVolumeBytes,
      smallItemFilter,
      largeFolderSimplification,
      largeFolderFileThreshold,
      largeFolderMd5SampleLimit,
      skipTinyMd5Files,
      tinyFileMd5ThresholdBytes,
      autoSkipExactDuplicates,
      autoSkipExactDuplicateAction: autoSkipExactDuplicateActionRaw,
      similarityReportEnabled,
      recordArchivePassword: Boolean(config.recordArchivePassword ?? this.config.recordArchivePassword),
      minimumTaskBytes: Number.isFinite(minimumTaskBytes) ? minimumTaskBytes : 100 * MIB,
      scheduleStart,
      scheduleEnd,
      archiveNamingMode,
      customArchiveName,
      similarityStrength,
      similarityEnabled,
      moveCompleted,
      autoTrashCompleted,
      processedSourceDirectory,
      archiveOutputDirectory,
      archiveStagingDirectory
    };
    if (this.config.intakeDirectory && this.config.archiveStagingDirectory && this.config.archiveOutputDirectory) {
      validatePathLayout(this.config, this.config.intakeDirectory);
    }
    if (this.config.archiveStagingDirectory) await fs.mkdir(this.config.archiveStagingDirectory, { recursive: true });
    if (moveCompleted) await fs.mkdir(processedSourceDirectory, { recursive: true });
    await this.store.saveSettings(this.config);
    if (strengthChanged) {
      this.similarityStrength = similarityStrength;
      this.markTermStatisticsDirty();
    }
    if (previousRepositoryDirectory !== this.config.repositoryDirectory) {
      this.jobs = await this.store.loadJobs(this.config.repositoryDirectory);
      this.catalog = (await this.store.loadCatalog(this.config.repositoryDirectory)).map(normalizeCatalogMetadata);
      normalizeThumbnailReferences(this.jobs, this.config.repositoryDirectory);
      normalizeThumbnailReferences(this.catalog, this.config.repositoryDirectory);
      await this.store.saveJobs(this.config.repositoryDirectory, this.jobs);
      this.markTermStatisticsDirty();
      await this.rebuildAllSimilarityRelations();
      this.undoStack = [];
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    }
    this.emitState();
    return this.getState();
  }

  async skipExactDuplicateJob(job, projectMatches, manifest = null) {
    const matches = (projectMatches || []).slice(0, 20);
    const matchedTitles = matches.map((match) => match.title || match.displayName).filter(Boolean);
    const removeFromQueue = this.config.autoSkipExactDuplicateAction === 'remove';
    Object.assign(job, {
      status: 'skipped_duplicate',
      stageText: '与仓库内项目完全一致，已自动跳过',
      progress: 100,
      exactProjectMatches: matches,
      automaticDuplicateCheckPending: false,
      completedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null
    });
    this.discardPendingProgress(job.id);
    if (removeFromQueue) await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);
    else if (Array.isArray(manifest)) {
      await this.store.savePendingManifest(this.config.repositoryDirectory, job.id, manifest);
    }
    if (this.config.archiveStagingDirectory) {
      await fs.rm(path.join(this.config.archiveStagingDirectory, job.id), { recursive: true, force: true });
    }
    if (removeFromQueue) this.jobs = this.jobs.filter((candidate) => candidate.id !== job.id);
    await this.persistJobs();
    const targetSummary = matchedTitles.length > 0 ? `：${matchedTitles.join('、')}` : '';
    await this.log('info', `自动跳过项目完全重复的任务“${job.displayName}”${targetSummary}；源文件和仓库均未修改，${removeFromQueue ? '队列项已删除' : '队列项已保留'}。`, job.id);
  }

  async verifyExactProjectMatches(job, manifest) {
    const directCandidates = this.findIndexedProjectCandidates(manifest, 'content', job.sourceCatalogRecordId);
    const directMatches = findExactProjectMatches(manifest, directCandidates, job.sourceCatalogRecordId);
    if (directMatches.length > 0) return { manifest, matches: directMatches, verificationIncomplete: false };
    const shapeCandidates = this.findIndexedProjectCandidates(manifest, 'shape', job.sourceCatalogRecordId);
    if (shapeCandidates.length === 0) return { manifest, matches: [], verificationIncomplete: false };
    let verificationManifest = manifest;
    const completeShapeCandidates = shapeCandidates.filter((record) => hasCompleteMd5Manifest(record.manifest));
    if (!hasCompleteMd5Manifest(verificationManifest) && completeShapeCandidates.length > 0) {
      const candidateResult = await verifyManifestMd5AgainstCompleteCandidates(
        job.sourcePath,
        job.sourceType,
        verificationManifest,
        completeShapeCandidates,
        {
          signal: this.abortController?.signal,
          pauseController: this.pauseController,
          onProgress: (progress) => {
            job.stageText = `正在筛选内容完全一致候选：${progress.processedFiles}/${progress.totalFiles} · ${progress.currentFile}`;
            job.progress = progress.percent;
            this.emitProgressThrottled(job);
          }
        }
      );
      verificationManifest = candidateResult.manifest;
      const candidateMatches = findExactProjectMatches(
        verificationManifest,
        candidateResult.matches,
        job.sourceCatalogRecordId
      );
      if (candidateMatches.length > 0) {
        return { manifest: verificationManifest, matches: candidateMatches, verificationIncomplete: false };
      }
      if (candidateResult.hashedFiles > 0 && candidateResult.matches.length === 0) {
        await this.log('info', `内容完全一致候选已提前排除；读取 ${candidateResult.hashedFiles} 个文件后停止完整核验。`, job.id);
      }
    }

    const partialShapeCandidates = shapeCandidates.filter((record) =>
      !hasCompleteMd5Manifest(record.manifest) &&
      manifestCompatibleWithKnownMd5(verificationManifest, record.manifest));
    if (partialShapeCandidates.length === 0) {
      return { manifest: verificationManifest, matches: [], verificationIncomplete: false };
    }
    try {
      verificationManifest = hasCompleteMd5Manifest(manifest)
        ? verificationManifest
        : await completeManifestMd5(job.sourcePath, job.sourceType, verificationManifest, {
          signal: this.abortController?.signal,
          pauseController: this.pauseController,
          onProgress: (progress) => {
            job.stageText = `正在核验内容完全一致：${progress.processedFiles}/${progress.totalFiles} · ${progress.currentFile}`;
            job.progress = progress.percent;
            this.emitProgressThrottled(job);
          }
        });
    } catch (error) {
      if (error instanceof CancelledError || error.code === 'TASK_CANCELLED' || error.code === 'SOURCE_CHANGED') throw error;
      await this.log('warning', `内容完全一致补充核验未完成，继续使用常规重复保护：${error.message}`, job.id);
      return { manifest, matches: [], verificationIncomplete: false };
    }

    const completeCandidates = [];
    let verificationIncomplete = false;
    const candidateReadBudget = {
      remainingFiles: verificationManifest.length,
      remainingBytes: verificationManifest.reduce((sum, file) => sum + Number(file?.size || 0), 0)
    };
    const orderedCandidates = [...partialShapeCandidates].sort((left, right) => {
      const leftComplete = hasCompleteMd5Manifest(left.manifest) ? 1 : 0;
      const rightComplete = hasCompleteMd5Manifest(right.manifest) ? 1 : 0;
      if (leftComplete !== rightComplete) return rightComplete - leftComplete;
      const md5Count = (record) => (record.manifest || [])
        .filter((file) => /^[a-f0-9]{32}$/i.test(String(file?.md5 || ''))).length;
      return md5Count(right) - md5Count(left);
    });
    for (const record of orderedCandidates) {
      if (hasCompleteMd5Manifest(record.manifest)) {
        completeCandidates.push(record);
        continue;
      }
      const candidatePaths = [];
      const seenCandidatePaths = new Set();
      for (const candidatePath of [getOriginalSourcePath(record), String(record.sourcePath || '').trim()].filter(Boolean)) {
        const candidateKey = normalizeForComparison(candidatePath);
        if (seenCandidatePaths.has(candidateKey)) continue;
        seenCandidatePaths.add(candidateKey);
        candidatePaths.push(candidatePath);
      }
      for (const candidatePath of candidatePaths) {
        if (normalizeForComparison(candidatePath) === normalizeForComparison(job.sourcePath) &&
            manifestsHaveSameStableMetadata(manifest, record.manifest)) {
          completeCandidates.push({ ...record, manifest: verificationManifest });
          break;
        }
        try {
          const result = await verifyManifestMd5AgainstReference(
            candidatePath,
            record.sourceType || 'directory',
            record.manifest,
            verificationManifest,
            {
              signal: this.abortController?.signal,
              pauseController: this.pauseController,
              budget: candidateReadBudget
            }
          );
          if (result.budgetExceeded) {
            verificationIncomplete = true;
            break;
          }
          if (result.matches) {
            completeCandidates.push({ ...record, manifest: verificationManifest });
            break;
          }
        } catch (error) {
          if (error instanceof CancelledError || error.code === 'TASK_CANCELLED') throw error;
          // 旧来源已移动或元数据已变化时继续尝试记录中的其他已知来源。
        }
      }
    }
    if (verificationIncomplete) {
      await this.log('warning', '内容完全一致候选核验达到读取预算，未完成的候选已转为人工复核；不会自动跳过。', job.id);
    }
    return {
      manifest: verificationManifest,
      matches: findExactProjectMatches(verificationManifest, completeCandidates, job.sourceCatalogRecordId),
      verificationIncomplete
    };
  }

  async changeWarehouseDirectory(inputPath) {
    if (this.running) throw new Error('队列运行期间不能修改仓库位置。');
    const rawTarget = String(inputPath || '').trim();
    if (!rawTarget) throw new Error('仓库位置不能为空。');
    const target = path.resolve(rawTarget);
    const previous = path.resolve(this.config.repositoryDirectory);
    if (normalizeForComparison(target) === normalizeForComparison(previous)) {
      return { state: this.getState(), copied: false, previous };
    }
    if (isPathInside(previous, target) || isPathInside(target, previous)) {
      throw new Error('新仓库与当前仓库不能互相包含。');
    }
    if (this.config.intakeDirectory && this.config.archiveStagingDirectory && this.config.archiveOutputDirectory) {
      validatePathLayout({ ...this.config, repositoryDirectory: target }, this.config.intakeDirectory);
    }
    await fs.mkdir(target, { recursive: true });
    const targetEntries = await fs.readdir(target);
    const hasDatabase = targetEntries.includes('warehouse.sqlite');
    let copied = false;
    if (!hasDatabase && targetEntries.length > 0) {
      throw new Error('所选仓库位置不是空目录，也不包含 warehouse.sqlite。请选择空目录或已有仓库。');
    }
    if (!hasDatabase) {
      await this.store.checkpoint?.(previous);
      this.store.closeRepository?.(previous);
      const sourceEntries = ['warehouse.sqlite', 'thumbnails'];
      for (const entry of sourceEntries) {
        const sourcePath = path.join(previous, entry);
        try {
          await fs.access(sourcePath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        await fs.cp(sourcePath, path.join(target, entry), {
          recursive: true,
          force: false,
          errorOnExist: true
        });
      }
      copied = true;
    }
    this.config.repositoryDirectory = target;
    this.jobs = relocateOwnedPaths(await this.store.loadJobs(target), previous, target);
    this.catalog = relocateOwnedPaths(await this.store.loadCatalog(target), previous, target)
      .map(normalizeCatalogMetadata);
    normalizeThumbnailReferences(this.jobs, target);
    normalizeThumbnailReferences(this.catalog, target);
    this.markTermStatisticsDirty();
    await this.rebuildAllSimilarityRelations();
    this.undoStack = [];
    await this.store.saveJobs(target, this.jobs);
    await this.store.saveCatalog(target, this.catalog);
    await this.store.saveSettings(this.config);
    this.store.closeRepository?.(previous);
    await this.log('warning', copied
      ? `仓库已复制到：${target}。原仓库保留在：${previous}。`
      : `已切换到现有仓库：${target}。`);
    this.emitState();
    return { state: this.getState(), copied, previous };
  }

  async exportWarehouseToFile(targetFile) {
    const rawTarget = String(targetFile || '').trim();
    if (!rawTarget) throw new Error('请选择导出文件位置。');
    const targetPath = path.resolve(rawTarget);
    if (!/\.zip$/i.test(targetPath)) {
      throw new Error('导出仓库必须保存为 .zip 压缩包。');
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await this.store.checkpoint?.(this.config.repositoryDirectory);

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-warehouse-export-'));
    const exportDir = path.join(tempRoot, 'warehouse');
    await fs.mkdir(exportDir, { recursive: true });
    try {
      for (const entry of ['warehouse.sqlite', 'thumbnails']) {
        const sourcePath = path.join(this.config.repositoryDirectory, entry);
        try {
          await fs.access(sourcePath);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        await fs.cp(sourcePath, path.join(exportDir, entry), {
          recursive: true,
          force: false,
          errorOnExist: true
        });
      }
      try {
        await fs.rm(targetPath, { force: true });
      } catch {}
      await execFileAsync(this.resolveProgramPath(this.config.sevenZipPath), [
        'a', '-tzip', targetPath, '*', '-bso0', '-bsp0'
      ], {
        cwd: exportDir,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      });
      const archiveStat = await fs.stat(targetPath);
      if (archiveStat.size === 0) {
        throw new Error('导出压缩包生成失败，文件为空。');
      }
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
    await this.log('warning', `仓库已导出为压缩包：${targetPath}`);
    return { path: targetPath, state: this.getState() };
  }

  async importWarehouseFromArchiveOrDirectory(sourcePath) {
    const source = path.resolve(String(sourcePath || '').trim());
    const sourceStat = await fs.stat(source);
    let workingDirectory = source;
    let tempRoot = null;

    if (sourceStat.isFile()) {
      if (!/\.zip$/i.test(source)) {
        throw new Error('外来仓库文件必须是 .zip 压缩包。');
      }
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-warehouse-import-'));
      const extractDir = path.join(tempRoot, 'extract');
      await fs.mkdir(extractDir, { recursive: true });
      await execFileAsync(this.resolveProgramPath(this.config.sevenZipPath), [
        'x', source, `-o${extractDir}`, '-y', '-bso0', '-bsp0'
      ], {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      });
      const rootDatabase = path.join(extractDir, 'warehouse.sqlite');
      try {
        await fs.access(rootDatabase);
        workingDirectory = extractDir;
      } catch {
        const entries = await fs.readdir(extractDir, { withFileTypes: true });
        let found = null;
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const candidate = path.join(extractDir, entry.name, 'warehouse.sqlite');
          try {
            await fs.access(candidate);
            found = path.join(extractDir, entry.name);
            break;
          } catch {}
        }
        if (!found) throw new Error('压缩包内没有找到 warehouse.sqlite。');
        workingDirectory = found;
      }
    } else if (!sourceStat.isDirectory()) {
      throw new Error('请选择仓库目录或 .zip 压缩包。');
    }

    try {
      return await this.importWarehouseFromDirectory(workingDirectory, { importedFrom: source });
    } finally {
      if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }

  async importWarehouseFromDirectory(sourceDirectory, options = {}) {
    const source = path.resolve(String(sourceDirectory || '').trim());
    const databasePath = path.join(source, 'warehouse.sqlite');
    try {
      await fs.access(databasePath);
    } catch {
      throw new Error('所选目录不是有效的仓库目录：缺少 warehouse.sqlite。');
    }

    const externalCatalog = await this.store.loadCatalog(source);
    if (normalizeForComparison(source) !== normalizeForComparison(this.config.repositoryDirectory)) {
      this.store.closeRepository(source);
    }
    const currentIds = new Set(this.catalog.map((record) => record.id));
    const importedIds = [];
    const skippedIds = [];

    const sourceThumbnails = path.join(source, 'thumbnails');
    const targetThumbnails = path.join(this.config.repositoryDirectory, 'thumbnails');
    try {
      await fs.access(sourceThumbnails);
      await fs.cp(sourceThumbnails, targetThumbnails, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    for (const rawRecord of externalCatalog) {
      const record = normalizeCatalogMetadata(rawRecord);
      if (currentIds.has(record.id)) {
        skippedIds.push(record.id);
        continue;
      }
      const relocated = relocateOwnedPaths(record, source, this.config.repositoryDirectory);
      normalizeThumbnailReferences(relocated, this.config.repositoryDirectory);
      if (relocated.recordType !== 'manual') {
        // 外部仓库的压缩包没有随仓库数据库一起导入，必须保留原始
        // archiveDirectory；删除外部记录时也不会触碰这些外部实体。
        relocated.archiveDirectory = record.archiveDirectory || '';
        relocated.importedFrom = options.importedFrom || source;
      }
      this.catalog.push(relocated);
      currentIds.add(relocated.id);
      importedIds.push(relocated.id);
    }

    if (importedIds.length > 0) {
      this.markTermStatisticsDirty();
      await this.rebuildAllSimilarityRelations();
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
      await this.log('warning', `已并入外部仓库 ${importedIds.length} 条，跳过 ${skippedIds.length} 条已存在记录。`);
    } else {
      await this.log('info', `外部仓库没有可并入的新记录；已存在 ${skippedIds.length} 条。`);
    }
    this.emitState();
    return {
      state: this.getState(),
      importedCount: importedIds.length,
      skippedCount: skippedIds.length
    };
  }


  async log(level, message, jobId = null, emit = true) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message,
      jobId
    };
    this.logs.push(entry);
    this.logs = this.logs.slice(-300);
    try {
      await this.store.appendLog(this.config.repositoryDirectory, entry);
    } catch {
      // 界面仍保留日志；日志落盘失败不覆盖原始业务错误。
    }
    if (emit) this.emitState();
  }

  async moveCompletedItem(job, destinationRoot) {
    if (this.services.moveCompletedItem) return this.services.moveCompletedItem(job.sourcePath, destinationRoot, job);
    await fs.mkdir(destinationRoot, { recursive: true });
    const targetPath = assertOwnedChildPath(destinationRoot, path.join(destinationRoot, path.basename(job.sourcePath)));
    try {
      await fs.access(targetPath);
      throw new Error(`移动位置已经存在同名项目：${path.basename(targetPath)}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(job.sourcePath, targetPath);
      return targetPath;
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
    }

    if (typeof fs.statfs === 'function') {
      const storage = await fs.statfs(destinationRoot);
      const freeBytes = Number(storage.bavail) * Number(storage.bsize);
      const safetyMargin = Math.max(1024 ** 3, Math.ceil(job.totalBytes * 0.05));
      if (freeBytes < job.totalBytes + safetyMargin) {
        const error = new Error('已备份原文件存放磁盘空间不足；源项目仍保留在原位置。');
        error.code = 'INSUFFICIENT_COMPLETED_SPACE';
        throw error;
      }
    }
    const incomingPath = `${targetPath}.incoming-${job.id}`;
    try {
      if (job.sourceType === 'directory') {
        await fs.cp(job.sourcePath, incomingPath, { recursive: true, errorOnExist: true, force: false });
        const copied = await inspectPath(incomingPath, 'directory');
        if (copied.fileCount !== job.fileCount || copied.totalBytes !== job.totalBytes) {
          throw new Error('跨磁盘移动复核失败，复制后的文件数量或大小不一致。');
        }
      } else {
        await fs.copyFile(job.sourcePath, incomingPath, fsConstants.COPYFILE_EXCL);
        const copied = await fs.stat(incomingPath);
        if (copied.size !== job.totalBytes) throw new Error('跨磁盘移动复核失败，视频大小不一致。');
      }
      await fs.rename(incomingPath, targetPath);
      try {
        await fs.rm(job.sourcePath, { recursive: job.sourceType === 'directory', force: true });
      } catch (cleanupError) {
        // 目标副本已经完整验收并正式就位，此时不能为了“回滚”而删除唯一完整副本；
        // 返回明确状态，让记录保留两个位置并提示用户手动核对。
        return { path: targetPath, sourceRetained: true, cleanupError: cleanupError.message };
      }
      return { path: targetPath, sourceRetained: false };
    } catch (error) {
      await fs.rm(incomingPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async completeSourceDisposition(record, job) {
    if (record.completionAction === 'move' || record.completionAction === 'trash') {
      if (this.services.validateSourceBeforeDisposition) {
        await this.services.validateSourceBeforeDisposition(job, record);
      } else {
        await validateManifestUnchanged(job.sourcePath, job.sourceType, record.manifest || []);
      }
    }
    if (record.completionAction === 'move') {
      const moveResult = await this.moveCompletedItem(job, record.completionDestination);
      const movedTo = typeof moveResult === 'string' ? moveResult : moveResult.path;
      const sourceRetained = Boolean(moveResult?.sourceRetained);
      record.sourceDisposition = sourceRetained ? 'moved_source_retained' : 'moved';
      record.movedTo = movedTo;
      record.movedAt = new Date().toISOString();
      if (sourceRetained) {
        record.sourceActionError = `目标副本已验证，但原位置副本未能删除：${moveResult.cleanupError}`;
        return '已验证入库并复制到完成位置，但原位置副本未能删除，请手动核对';
      }
      delete record.sourceActionError;
      return '已验证入库，源项目已移到完成位置';
    }
    if (record.completionAction === 'trash') {
      if (!this.services.trashItem) throw new Error('系统回收站服务不可用。');
      await this.services.trashItem(job.sourcePath);
      record.sourceDisposition = 'trashed';
      record.trashedAt = new Date().toISOString();
      // Windows 回收站空间不足、超出配额或不支持该项目时，系统调用可能完成，
      // 但项目未必仍可从回收站恢复。必须独立复核，失败时由调用方熔断整个队列。
      let trashVerified = null;
      if (this.services.isTrashItemPresent) {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            trashVerified = await this.services.isTrashItemPresent(job.sourcePath);
          } catch (error) {
            trashVerified = null;
            await this.log('warning', `回收站复核暂时不可用：${record.title} · ${error.message}`, job.id, false);
            break;
          }
          if (trashVerified) break;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
      record.trashVerified = trashVerified;
      if (trashVerified !== true) {
        let sourceStillExists = false;
        try { await fs.access(job.sourcePath); sourceStillExists = true; } catch { sourceStillExists = false; }
        const verificationUnavailable = trashVerified === null;
        const error = new Error(sourceStillExists
          ? '源项目没有进入回收站，仍保留在原位置。为避免后续项目发生永久删除，队列已安全停止。'
          : verificationUnavailable
            ? '无法确认源项目是否保留在回收站，且原位置已经不存在。队列已安全停止，请立即检查回收站。'
            : '源项目在原位置和回收站中都未找到。回收站可能已满或超出配额，文件可能已被永久删除；队列已安全停止。');
        error.code = sourceStillExists
          ? 'TRASH_NOT_PERFORMED'
          : verificationUnavailable ? 'TRASH_VERIFICATION_UNAVAILABLE' : 'TRASH_RETENTION_FAILED';
        error.sourceStillExists = sourceStillExists;
        error.trashVerified = trashVerified;
        throw error;
      }
      return '已验证入库，源项目已移入回收站';
    }
    record.sourceDisposition = 'kept';
    return '已验证并入库';
  }

  restoreCatalogSnapshot(snapshot) {
    this.catalog = snapshot;
    this.catalogThumbnailSummaryCache = new WeakMap();
    this.markTermStatisticsDirty();
  }

  async compensateUncommittedArchive(job, result, generatedThumbnailDirectory) {
    const attemptedAt = new Date().toISOString();
    const publication = result?.archivePublication;
    const archiveFiles = Array.isArray(result?.archiveFiles) ? result.archiveFiles : [];
    let archiveState = archiveFiles.length > 0 ? 'manual_recovery_required' : 'not_applicable';
    let recoveryDirectory = '';
    let recoveredFiles = [];
    let unrecoveredPaths = [];
    const failures = [];

    if (publication?.files?.length > 0) {
      try {
        const recover = this.services.recoverPublishedArchiveFiles || recoverPublishedArchiveFiles;
        const recovered = await recover(publication);
        recoveryDirectory = String(recovered?.recoveryDirectory || '');
        recoveredFiles = Array.isArray(recovered?.recoveredFiles) ? recovered.recoveredFiles : [];
        archiveState = 'recovered_to_staging';
      } catch (error) {
        recoveryDirectory = String(error.recoveryDirectory || '');
        recoveredFiles = Array.isArray(error.recoveredFiles) ? error.recoveredFiles : [];
        unrecoveredPaths = Array.isArray(error.unrecoveredPaths)
          ? error.unrecoveredPaths.map(String).filter(Boolean)
          : publication.files.map((file) => String(file.path || '')).filter(Boolean);
        failures.push(`成品补偿失败：${error.message}`);
      }
    } else if (archiveFiles.length > 0) {
      failures.push('归档执行器没有返回本任务的发布凭据；为避免误删用户文件，成品未自动移动。');
      unrecoveredPaths = archiveFiles.map((file) => path.join(
        this.config.archiveOutputDirectory,
        String(file?.name || '')
      ));
    }

    let thumbnailState = 'not_applicable';
    if (generatedThumbnailDirectory) {
      try {
        await fs.rm(generatedThumbnailDirectory, { recursive: true, force: true });
        thumbnailState = 'removed';
      } catch (error) {
        thumbnailState = 'manual_recovery_required';
        failures.push(`缩略图补偿失败：${generatedThumbnailDirectory} · ${error.message}`);
      }
    }

    return {
      attemptedAt,
      archiveState,
      recoveryDirectory,
      recoveredFiles,
      unrecoveredPaths,
      thumbnailState,
      thumbnailPath: generatedThumbnailDirectory || '',
      failures,
      recoveryRequired: failures.length > 0
    };
  }

  catalogCommitFailure(originalError, compensation) {
    return this.uncommittedArchiveFailure(originalError, compensation, '仓库记录保存失败');
  }

  uncommittedArchiveFailure(originalError, compensation, context) {
    const locations = [
      compensation.recoveryDirectory,
      ...compensation.unrecoveredPaths,
      compensation.thumbnailState === 'manual_recovery_required' ? compensation.thumbnailPath : ''
    ].filter(Boolean);
    const recoveryText = compensation.recoveryRequired
      ? `自动补偿未完成（${compensation.failures.join('；')}），需要人工恢复：${locations.join('；') || '请查看运行日志'}`
      : compensation.archiveState === 'recovered_to_staging'
        ? `本任务成品已移回恢复目录：${compensation.recoveryDirectory}`
        : '未提交的本任务生成物已清理';
    const error = new Error(`${context}：${originalError.message}；内存仓库未提交；${recoveryText}。源文件保持原位。`);
    error.code = originalError.code || 'CATALOG_COMMIT_FAILED';
    error.cause = originalError;
    error.catalogRecovery = compensation;
    return error;
  }

  async persistJobs() {
    await this.store.saveJobs(this.config.repositoryDirectory, this.jobs);
  }

  createJob(task) {
    const now = new Date().toISOString();
    const sourceCatalogRecordId = String(task.sourceCatalogRecordId || '');
    this.ensureTermStatistics();
    const normalizedTaskName = normalizeName(task.displayName);
    const exactNameIds = !sourceCatalogRecordId && this.store.findCatalogIdsByExactName
      ? this.store.findCatalogIdsByExactName(this.config.repositoryDirectory, normalizedTaskName, 20)
      : !sourceCatalogRecordId
        ? this.catalog.filter((record) => [record.title, record.displayName]
          .some((name) => normalizeName(String(name || '')) === normalizedTaskName)).map((record) => record.id)
        : [];
    const catalogMatches = exactNameIds
      .filter((recordId) => recordId !== sourceCatalogRecordId)
      .slice(0, 20)
      .map((recordId) => {
        const record = this.catalog.find((candidate) => candidate.id === recordId);
        return record ? {
          archiveId: record.id,
          displayName: record.displayName,
          archiveBaseName: record.archiveBaseName
        } : null;
      })
      .filter(Boolean);
    const queueMatches = sourceCatalogRecordId ? [] : this.jobs
      .filter((job) => isDuplicateCandidateJob(job) && normalizeName(job.displayName) === normalizedTaskName)
      .slice(0, 20)
      .map((job) => ({ jobId: job.id, displayName: job.displayName, archiveBaseName: job.archiveBaseName }));
    const nameDuplicateMatches = [...catalogMatches, ...queueMatches].slice(0, 20);
    const similaritySubject = { ...task, id: sourceCatalogRecordId || task.id };
    const similarMatches = !sourceCatalogRecordId && this.isSimilarityEnabled()
      ? [
          ...findSimilarProjects(
            similaritySubject,
            this.getSimilarityCandidates(similaritySubject)
              .filter((record) => record.id !== sourceCatalogRecordId),
            this.similarityIgnoreTerms,
            this.similarityStrength
          ),
          ...findSimilarProjects(
            task,
            this.jobs.filter(isDuplicateCandidateJob),
            this.similarityIgnoreTerms,
            this.similarityStrength
          )
        ].filter((match, index, items) => items.findIndex((item) => item.id === match.id) === index).slice(0, 20)
      : [];
    const confirmationReasons = [];
    if (task.totalBytes > LARGE_TASK_BYTES) confirmationReasons.push('large_task');
    if (nameDuplicateMatches.length > 0) confirmationReasons.push('name_match');
    if (similarMatches.some((match) => match.reasons.includes('标题相似'))) confirmationReasons.push('similar_title');
    if (similarMatches.some((match) => match.reasons.includes('视频大小完全一致'))) confirmationReasons.push('same_video_size');
    const explicitProcessingMode = ['archive', 'inventory_only', 'archive_existing'].includes(task.processingMode);
    const intakeModeSelected = Boolean(sourceCatalogRecordId || task.intakeModeSelected === true || explicitProcessingMode);
    const automaticDuplicateCheckPending = false;
    const blockingConfirmationReasons = confirmationReasons.filter((reason) => reason === 'large_task');
    const similarityNotice = [
      nameDuplicateMatches.length > 0 ? '名称存在仓库候选' : null,
      similarMatches.length > 0 ? `发现 ${similarMatches.length} 个相似候选` : null
    ].filter(Boolean).join(' · ');
    return {
      id: crypto.randomUUID(),
      ...task,
      processingMode: task.processingMode === 'inventory_only'
        ? 'inventory_only'
        : task.processingMode === 'archive_existing' ? 'archive_existing' : 'archive',
      intakeModeSelected,
      sourceCatalogRecordId: sourceCatalogRecordId || null,
      requiresConfirmation: task.totalBytes > LARGE_TASK_BYTES,
      confirmationReasons,
      nameDuplicateMatches,
      similarMatches,
      exactDuplicateMatches: [],
      confirmedAt: null,
      duplicateConfirmedAt: null,
      exactDuplicateOverrideAt: null,
      duplicateReviewFingerprint: null,
      duplicateConfirmedManifestFingerprint: null,
      duplicateReviewKind: null,
      similarityPreflightBlocking: false,
      automaticDuplicateCheckPending,
      status: blockingConfirmationReasons.length > 0 ? 'awaiting_confirmation' : 'queued',
      progress: 0,
      stageText: blockingConfirmationReasons.length > 0
        ? [
            task.totalBytes > LARGE_TASK_BYTES ? '超过 10 GiB' : null,
            similarityNotice || null,
            '等待手动确认'
          ].filter(Boolean).join(' · ')
        : [
            similarityNotice || null,
            !intakeModeSelected ? '等待选择入库方式'
              : task.processingMode === 'inventory_only' ? '等待不压缩入库'
                : sourceCatalogRecordId ? '库内项目压缩 · 等待压缩' : '等待压缩'
          ].filter(Boolean).join(' · '),
      archiveBaseName: createConfiguredArchiveName(task.displayName, this.config),
      archiveFormat: this.config.archiveFormat || '7z',
      compressionLevel: Number(this.config.compressionLevel ?? 1),
      archiveVolumeEnabled: this.config.archiveVolumeEnabled !== false,
      archiveVolumeBytes: Number(this.config.archiveVolumeBytes ?? LARGE_TASK_BYTES),
      largeFolderSimplification: this.config.largeFolderSimplification === true,
      largeFolderFileThreshold: Number(this.config.largeFolderFileThreshold ?? DEFAULT_LARGE_FOLDER_FILE_THRESHOLD),
      largeFolderMd5SampleLimit: Number(this.config.largeFolderMd5SampleLimit ?? DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT),
      skipTinyMd5Files: this.config.skipTinyMd5Files === true,
      tinyFileMd5ThresholdBytes: Number(this.config.tinyFileMd5ThresholdBytes ?? DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES),
      archivePassword: String(this.config.archivePassword || ''),
      hasPassword: Boolean(this.config.archivePassword),
      recordArchivePassword: Boolean(this.config.recordArchivePassword),
      archiveFiles: [],
      createdAt: now,
      startedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null
    };
  }

  async scanSource(intakeDirectory = this.config.intakeDirectory, scanToken = '') {
    if (this.running) throw new Error('队列运行期间不能重新扫描。');
    validateSourceSelection(this.config, intakeDirectory);
    await this.log('info', `开始扫描目录：${intakeDirectory}`);
    const result = await scanIntakeDirectory(intakeDirectory, {
      minimumBytes: this.config.smallItemFilter ? this.config.minimumTaskBytes : 0,
      onProgress: (progress) => {
        if (progress.displayName) {
          this.emit('scan-progress', { ...progress, scanToken });
        }
      }
    });

    const existingPaths = new Set(
      this.jobs
        .filter((job) => !['cancelled', 'failed'].includes(job.status))
        .map((job) => path.resolve(job.sourcePath).toLowerCase())
    );
    const added = result.tasks
      .filter((task) => !existingPaths.has(path.resolve(task.sourcePath).toLowerCase()))
      .map((task) => this.createJob(task));

    this.jobs.push(...added);
    this.skippedRootFiles = [
      ...result.skippedRootFiles,
      ...(result.filteredItems || []).map((item) => ({
        path: item.sourcePath,
        name: item.displayName,
        size: item.totalBytes,
        reason: `低于过滤阈值 ${Math.round(this.config.minimumTaskBytes / MIB)} MB`
      }))
    ];
    for (const task of result.tasks) {
      for (const warning of task.skippedFiles || []) {
        await this.log('warning', `扫描时跳过无法读取的内容：${warning.path}（${warning.code}）`, null, false);
      }
    }
    await this.persistJobs();
    await this.log(
      'info',
      `扫描完成：新增 ${added.length} 个任务，过滤 ${(result.filteredItems || []).length} 个小项目，记录 ${result.skippedRootFiles.length} 个根级跳过项。`
    );
    return this.getState();
  }

  async addSingle(sourcePath) {
    if (this.running) throw new Error('队列运行期间不能添加单项。');
    validateSourceSelection(this.config, sourcePath);
    const stats = await require('node:fs/promises').stat(sourcePath);
    let sourceType;
    if (stats.isDirectory()) sourceType = 'directory';
    else if (stats.isFile() && isVideoFile(sourcePath)) sourceType = 'video';
    else throw new Error('单项归档当前只支持文件夹或视频文件。');

    const summary = await inspectPath(sourcePath, sourceType);
    if (this.config.smallItemFilter && summary.totalBytes < this.config.minimumTaskBytes) {
      throw new Error(`该项目只有 ${Math.max(0.1, summary.totalBytes / MIB).toFixed(1)} MB，低于当前 ${Math.round(this.config.minimumTaskBytes / MIB)} MB 的入库阈值。`);
    }
    const job = this.createJob({
      sourcePath,
      displayName: path.basename(sourcePath),
      sourceType,
      ...summary
    });
    this.jobs.push(job);
    await this.persistJobs();
    await this.log('info', `已添加单项任务：${job.displayName}`, job.id);
    return this.getState();
  }

  async startInventoryOnlyQueue() {
    if (this.running) throw new Error('队列已经在运行。');
    const candidates = this.jobs.filter((job) =>
      !job.sourceCatalogRecordId && ['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status));
    if (candidates.length === 0) throw new Error('任务列表中没有可以直接入库的项目。');
    for (const job of candidates) {
      job.processingMode = 'inventory_only';
      job.intakeModeSelected = true;
      job.stageText = job.status === 'queued'
        ? '等待不压缩入库'
        : `未压缩直接入库 · ${job.stageText || '等待手动确认'}`;
    }
    await this.persistJobs();
    await this.log('warning', `已选择不压缩直接入库，共 ${candidates.length} 个任务；原文件将保留在原位置。`);
    void this.startQueue();
    return this.getState();
  }

  async startArchiveQueue() {
    if (this.running) throw new Error('队列已经在运行。');
    const candidates = this.jobs.filter((job) =>
      ['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status));
    if (candidates.length === 0) throw new Error('任务列表中没有可以压缩入库的项目。');
    for (const job of candidates) {
      if (!job.sourceCatalogRecordId) job.processingMode = 'archive';
      job.intakeModeSelected = true;
      job.stageText = job.status === 'queued'
        ? job.sourceCatalogRecordId ? '库内项目压缩 · 等待压缩' : '等待压缩'
        : `${job.sourceCatalogRecordId ? '库内项目压缩' : '压缩入库'} · ${job.stageText || '等待手动确认'}`;
    }
    await this.persistJobs();
    await this.log('info', `已选择压缩入库，共 ${candidates.length} 个任务。`);
    void this.startQueue();
    return this.getState();
  }

  async queueCatalogRecordsForCompression(recordIds) {
    if (this.running) throw new Error('请等待当前队列停止后再添加库内项目。');
    const ids = [...new Set(recordIds || [])];
    if (ids.length === 0) throw new Error('请先选择仓库内容。');
    const existingCatalogJobs = new Set(this.jobs
      .filter((job) => isDuplicateCandidateJob(job) && job.sourceCatalogRecordId)
      .map((job) => job.sourceCatalogRecordId));
    const added = [];
    const failures = [];
    for (const recordId of ids) {
      const record = this.catalog.find((candidate) => candidate.id === recordId);
      if (!record || record.archiveState !== 'uncompressed') continue;
      if (existingCatalogJobs.has(record.id)) {
        failures.push({ id: record.id, title: record.title, reason: '已经在任务列表中' });
        continue;
      }
      const sourcePath = getOriginalSourcePath(record);
      try {
        if (!sourcePath || !Array.isArray(record.manifest) || record.manifest.length === 0) {
          throw new Error('没有可复用的原文件位置或清单');
        }
        const stats = await fs.stat(sourcePath);
        const sourceType = record.sourceType === 'video' ? 'video' : 'directory';
        if ((sourceType === 'video' && !stats.isFile()) || (sourceType === 'directory' && !stats.isDirectory())) {
          throw new Error('原文件类型已经变化');
        }
        await validateManifestUnchanged(sourcePath, sourceType, record.manifest);
        const job = this.createJob({
          sourcePath,
          displayName: record.displayName || path.basename(sourcePath),
          sourceType,
          fileCount: record.manifest.length,
          totalBytes: Number(record.originalBytes) || record.manifest.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
          skippedFiles: record.skippedFiles || [],
          processingMode: 'archive_existing',
          sourceCatalogRecordId: record.id
        });
        this.jobs.push(job);
        existingCatalogJobs.add(record.id);
        await this.store.savePendingManifest(this.config.repositoryDirectory, job.id, record.manifest);
        added.push(job);
      } catch (error) {
        failures.push({ id: record.id, title: record.title || record.displayName, reason: error.message });
        await this.log('error', `库内项目“${record.title || record.displayName}”未能加入压缩队列：${error.message}`, record.jobId, false);
      }
    }
    await this.persistJobs();
    if (added.length > 0) await this.log('info', `已把 ${added.length} 个未压缩仓库项目送入队列，标记为“库内项目压缩”。`);
    this.emitState();
    return {
      state: this.getState(),
      queuedCount: added.length,
      failedCount: failures.length,
      failures
    };
  }

  findJob(jobId) {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('没有找到指定任务。');
    return job;
  }

  async confirmJob(jobId) {
    const job = this.findJob(jobId);
    const confirmsQueuedAutomaticCheck = job.status === 'queued' &&
      hasPendingAutomaticDuplicateCheck(job) && !job.exactDuplicateOverrideAt;
    if (!['awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status) && !confirmsQueuedAutomaticCheck) {
      throw new Error('当前任务不处于等待确认状态。');
    }
    const now = new Date().toISOString();
    const confirmsExactDuplicateOverride = job.status === 'awaiting_duplicate_confirmation' || confirmsQueuedAutomaticCheck;
    const confirmsPreflightSimilarity = job.similarityPreflightBlocking !== false &&
      job.status === 'awaiting_confirmation' && hasDuplicateConfirmationReason(job);
    if (job.status === 'awaiting_confirmation') job.confirmedAt = now;
    if (confirmsPreflightSimilarity || confirmsExactDuplicateOverride) job.duplicateConfirmedAt = now;
    if (confirmsExactDuplicateOverride) {
      job.exactDuplicateOverrideAt = now;
      if (job.duplicateReviewFingerprint) {
        job.duplicateConfirmedManifestFingerprint = job.duplicateReviewFingerprint;
      }
      job.automaticDuplicateCheckPending = false;
    }
    job.status = 'queued';
    job.stageText = !hasSelectedIntakeMode(job)
      ? '已确认，等待选择入库方式'
      : job.processingMode === 'inventory_only'
      ? '已确认，等待不压缩入库'
      : job.sourceCatalogRecordId ? '已确认，等待库内项目压缩' : '已确认，等待压缩';
    await this.persistJobs();
    const requestedVolumeBytes = Number(job.archiveVolumeBytes);
    const configuredVolumeBytes = job.archiveVolumeEnabled === true &&
      Number.isInteger(requestedVolumeBytes) &&
      requestedVolumeBytes >= MIN_ARCHIVE_VOLUME_BYTES && requestedVolumeBytes <= MAX_ARCHIVE_VOLUME_BYTES
      ? requestedVolumeBytes
      : LARGE_TASK_BYTES;
    const volumeLabel = configuredVolumeBytes % (1024 ** 3) === 0
      ? `${configuredVolumeBytes / (1024 ** 3)} GiB`
      : `${Math.round(configuredVolumeBytes / MIB)} MiB`;
    await this.log(
      'warning',
      confirmsExactDuplicateOverride
        ? job.duplicateReviewKind === 'similarity'
          ? '用户已确认相似报告，任务复用已生成清单并重新进入队列。'
          : '用户已确认内容完全一致提示，任务复用已生成清单并重新进入队列。'
        : confirmsPreflightSimilarity
          ? '用户已确认名称或相似项目提示；内容完全一致核验仍将在生成完整 MD5 后执行。'
          : `用户已确认任务风险；大任务将按 ${volumeLabel} 分卷。`,
      job.id
    );
    if (isRunnableQueuedJob(job)) void this.startQueue();
    return this.getState();
  }

  async confirmAllDuplicateJobs() {
    const jobs = this.jobs.filter((job) =>
      job.status === 'awaiting_duplicate_confirmation' ||
      (job.similarityPreflightBlocking !== false && job.status === 'awaiting_confirmation' && hasDuplicateConfirmationReason(job)) ||
      (job.status === 'queued' && hasPendingAutomaticDuplicateCheck(job) && !job.exactDuplicateOverrideAt)
    );
    if (jobs.length === 0) return { state: this.getState(), confirmedCount: 0 };
    const now = new Date().toISOString();
    for (const job of jobs) {
      const stillNeedsLargeTaskConfirmation = job.status === 'awaiting_confirmation' &&
        (job.confirmationReasons || []).includes('large_task');
      const confirmsExactDuplicateOverride = job.status === 'awaiting_duplicate_confirmation' ||
        (job.status === 'queued' && hasPendingAutomaticDuplicateCheck(job));
      job.duplicateConfirmedAt = now;
      if (confirmsExactDuplicateOverride) {
        job.exactDuplicateOverrideAt = now;
        if (job.duplicateReviewFingerprint) {
          job.duplicateConfirmedManifestFingerprint = job.duplicateReviewFingerprint;
        }
        job.automaticDuplicateCheckPending = false;
      }
      if (!stillNeedsLargeTaskConfirmation) {
        if (job.status === 'awaiting_confirmation') job.confirmedAt = now;
        job.status = 'queued';
        job.stageText = !hasSelectedIntakeMode(job)
          ? '已批量确认重复风险，等待选择入库方式'
          : job.processingMode === 'inventory_only'
          ? '已批量确认重复风险，等待不压缩入库'
          : job.sourceCatalogRecordId ? '已批量确认重复风险，等待库内项目压缩' : '已批量确认重复风险，等待压缩';
      }
    }
    await this.persistJobs();
    await this.log('warning', `已批量确认 ${jobs.length} 个重复或相似任务。`);
    if (jobs.some(isRunnableQueuedJob)) void this.startQueue();
    return { state: this.getState(), confirmedCount: jobs.length };
  }

  async confirmAnomaly(jobId) {
    const job = this.findJob(jobId);
    if (job.status !== 'awaiting_anomaly_confirmation' || !job.pendingCatalogRecord) {
      throw new Error('当前任务没有等待确认的大小异常。');
    }
    const record = normalizeCatalogMetadata(job.pendingCatalogRecord);
    const catalogBeforeCommit = structuredClone(this.catalog);
    const existingIndex = this.catalog.findIndex((candidate) => candidate.id === record.id);
    if (existingIndex >= 0) this.catalog[existingIndex] = record;
    else this.catalog.push(record);
    this.refreshSimilarityForRecord(record);
    try {
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    } catch (error) {
      this.restoreCatalogSnapshot(catalogBeforeCommit);
      throw error;
    }
    await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);

    let status = 'completed';
    let stageText = '大小异常已人工确认并入库';
    if (['move_pending', 'trash_pending'].includes(record.sourceDisposition)) {
      try {
        stageText = await this.completeSourceDisposition(record, job);
      } catch (error) {
        if (['TRASH_NOT_PERFORMED', 'TRASH_VERIFICATION_UNAVAILABLE', 'TRASH_RETENTION_FAILED'].includes(error.code)) {
          await this.activateTrashSafetyHalt(record, job, error, record.archiveFiles || []);
          await this.log('error', `回收站安全熔断：${error.message} 自动移入回收站已关闭，后续任务没有启动。`, job.id);
          return this.getState();
        }
        record.sourceDisposition = `${record.completionAction}_failed`;
        record.sourceActionError = error.message;
        status = 'completed_cleanup_failed';
        stageText += '，但源项目后处理失败，原位置已保留';
      }
      await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    }
    delete job.pendingCatalogRecord;
    await this.updateJob(job, { status, stageText, progress: 100, completedAt: record.completedAt });
    await this.log('warning', '用户已核对压缩体积异常，并确认入库。', job.id);
    return this.getState();
  }

  async discardAnomalousArchive(jobId) {
    const job = this.findJob(jobId);
    if (job.status !== 'awaiting_anomaly_confirmation' || !job.pendingCatalogRecord) {
      throw new Error('当前任务没有可删除的异常成品。');
    }
    if (!this.services.trashItem) throw new Error('Windows 回收站服务不可用。');
    const record = job.pendingCatalogRecord;
    await quarantineAndTrashArchiveFiles(
      { ...record, archiveDirectory: record.archiveDirectory || this.config.archiveOutputDirectory },
      this.config.archiveStagingDirectory,
      this.services.trashItem,
      async (targetPath) => {
        try { await fs.access(targetPath); return true; } catch (error) {
          if (error.code === 'ENOENT') return false;
          throw error;
        }
      }
    );
    if (record.jobId && !job.sourceCatalogRecordId) {
      const thumbnailPath = assertOwnedChildPath(
        path.join(this.config.repositoryDirectory, 'thumbnails'),
        path.join(this.config.repositoryDirectory, 'thumbnails', assertSafePathSegment(record.jobId, '缩略图目录'))
      );
      try {
        await fs.access(thumbnailPath);
        await this.services.trashItem(thumbnailPath);
      } catch (error) {
        if (error.code !== 'ENOENT') await this.log('warning', `异常成品已删除，但缩略图清理失败：${error.message}`, job.id);
      }
    }
    delete job.pendingCatalogRecord;
    await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);
    await this.updateJob(job, {
      status: 'cancelled',
      stageText: '异常成品已移入回收站，源项目保持原位',
      progress: 0,
      archiveFiles: [],
      errorCode: null,
      errorMessage: null
    });
    await this.log('warning', '用户删除了大小异常成品；源项目未移动、未删除。', job.id);
    return this.getState();
  }

  async activateTrashSafetyHalt(record, job, error, archiveFiles = []) {
    const sourceStillExists = Boolean(error.sourceStillExists);
    const detectedAt = new Date().toISOString();
    record.sourceDisposition = sourceStillExists ? 'kept' : 'missing';
    record.sourceActionError = error.message;
    record.trashVerified = error.trashVerified;
    record.trashVerificationFailedAt = detectedAt;
    record.metadataUpdatedAt = detectedAt;
    if (sourceStillExists) delete record.trashedAt;
    else {
      record.originalSourcePath = '';
      record.movedTo = '';
    }
    this.config.autoTrashCompleted = false;
    this.stopRequested = true;
    this.safetyHalt = {
      id: crypto.randomUUID(),
      type: 'trash_retention',
      jobId: job.id,
      message: error.message,
      sourceStillExists,
      detectedAt
    };
    this.config.pendingTrashSafetyHalt = { ...this.safetyHalt };
    await this.store.saveSettings(this.config);
    await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
    await this.updateJob(job, {
      status: 'awaiting_trash_safety_confirmation',
      stageText: sourceStillExists
        ? '安全停止：原文件未进入回收站，仍在原位置'
        : '安全停止：回收站未保留原文件，请立即检查',
      progress: 100,
      archiveFiles,
      completedAt: record.completedAt,
      errorCode: error.code,
      errorMessage: error.message,
      sourceStillExists,
      safetyHaltAt: detectedAt
    });
  }

  async acknowledgeTrashSafetyHalt(referenceId) {
    const halt = this.safetyHalt;
    if (!halt || ![halt.id, halt.jobId, halt.recordId].filter(Boolean).includes(referenceId)) {
      throw new Error('当前没有与该项目对应的回收站安全警告。');
    }
    const job = halt.jobId ? this.jobs.find((candidate) => candidate.id === halt.jobId) : null;
    if (job?.status === 'awaiting_trash_safety_confirmation') {
      job.status = 'completed_cleanup_failed';
      job.safetyAcknowledgedAt = new Date().toISOString();
      job.stageText = job.sourceStillExists
        ? '归档已入库；原文件仍在原位置，自动移入回收站已关闭'
        : '归档已入库；未能在回收站或原位置找到源文件，自动移入回收站已关闭';
    }
    this.safetyHalt = null;
    delete this.config.pendingTrashSafetyHalt;
    await this.store.saveSettings(this.config);
    await this.persistJobs();
    await this.log('warning', '用户已确认回收站安全警告；队列仍保持停止，后续任务需手动重新开始。', job?.id || null);
    return this.getState();
  }

  async cancelJob(jobId) {
    const job = this.findJob(jobId);
    if (RUNNING_STATUSES.has(job.status)) {
      await this.pauseController?.resume();
      this.paused = false;
      this.abortController?.abort();
      job.stageText = '正在安全取消';
    } else if (['queued', 'awaiting_confirmation', 'awaiting_duplicate_confirmation', 'failed'].includes(job.status)) {
      job.status = 'cancelled';
      job.stageText = '已取消';
      await this.persistJobs();
      await this.log('warning', '任务已取消。', job.id);
    await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);
    }
    this.emitState();
    return this.getState();
  }

  async retryJob(jobId) {
    if (this.running) throw new Error('请在当前队列结束后重试。');
    const job = this.findJob(jobId);
    if (!['failed', 'cancelled'].includes(job.status)) throw new Error('当前任务不能重试。');
    job.archiveBaseName = createConfiguredArchiveName(job.displayName, this.config);
    job.archiveFiles = [];
    job.progress = 0;
    job.errorCode = null;
    job.errorMessage = null;
    delete job.catalogRecovery;
    job.exactDuplicateMatches = [];
    job.status = job.requiresConfirmation && !job.confirmedAt ? 'awaiting_confirmation' : 'queued';
    job.stageText = job.status === 'queued'
      ? !hasSelectedIntakeMode(job) ? '等待选择入库方式'
        : hasPendingAutomaticDuplicateCheck(job) && !job.exactDuplicateOverrideAt ? '等待内容完全一致核验'
          : job.processingMode === 'inventory_only' ? '等待不压缩入库'
            : job.sourceCatalogRecordId ? '库内项目压缩 · 等待压缩' : '等待压缩'
      : '等待手动确认';
    await this.persistJobs();
    await this.log('info', '任务已重新加入队列。', job.id);
    return this.getState();
  }

  async updateJob(job, updates) {
    Object.assign(job, updates);
    if (updates.status && !RUNNING_STATUSES.has(updates.status)) this.discardPendingProgress(job.id);
    await this.persistJobs();
    this.emitState();
  }

  async pauseCurrent() {
    if (!this.running || !this.pauseController) throw new Error('当前没有可暂停的任务。');
    const job = this.jobs.find((candidate) => RUNNING_STATUSES.has(candidate.status));
    if (!job || !['inventorying', 'compressing', 'verifying'].includes(job.status)) {
      throw new Error('当前阶段不能暂停，请等待文件移动完成。');
    }
    await this.pauseController.pause();
    this.paused = true;
    this.schedulePaused = false;
    job.prePauseStageText = job.stageText;
    job.stageText = `已暂停 · ${job.stageText || ''}`;
    await this.persistJobs();
    await this.log('warning', '当前任务已暂停；程序保持打开即可稍后继续。', job.id);
    return this.getState();
  }

  async resumeCurrent() {
    if (!this.paused || !this.pauseController) return this.getState();
    const job = this.jobs.find((candidate) => RUNNING_STATUSES.has(candidate.status));
    try {
      await this.pauseController.resume();
    } catch (error) {
      this.stopRequested = true;
      this.paused = false;
      this.schedulePaused = false;
      this.abortController?.abort();
      await this.log('error', `恢复暂停任务失败，已取消当前任务并停止队列：${error.message}`, job?.id || null);
      const wrapped = new Error(`恢复任务失败，已安全取消当前任务并停止队列：${error.message}`);
      wrapped.code = error.code || 'PROCESS_RESUME_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
    this.paused = false;
    this.schedulePaused = false;
    if (job) {
      job.stageText = job.prePauseStageText || (job.stageText || '').replace(/^已暂停 · /, '');
      delete job.prePauseStageText;
    }
    await this.persistJobs();
    await this.log('info', '当前任务已继续运行。', job?.id || null);
    return this.getState();
  }

  scheduleWindow(now = new Date()) {
    if (!this.config.scheduleEnabled) return { enabled: false, active: true, endAt: null };
    const parse = (value) => {
      const [hours, minutes] = String(value).split(':').map(Number);
      return (hours * 60) + minutes;
    };
    const startMinutes = parse(this.config.scheduleStart);
    const endMinutes = parse(this.config.scheduleEnd);
    const nowMinutes = (now.getHours() * 60) + now.getMinutes();
    const crossesMidnight = startMinutes > endMinutes;
    const active = crossesMidnight
      ? nowMinutes >= startMinutes || nowMinutes < endMinutes
      : nowMinutes >= startMinutes && nowMinutes < endMinutes;
    if (!active) return { enabled: true, active: false, endAt: null };
    const endAt = new Date(now);
    endAt.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    if (crossesMidnight && nowMinutes >= startMinutes) endAt.setDate(endAt.getDate() + 1);
    return { enabled: true, active: true, endAt };
  }

  estimateJobDurationMs(job) {
    return Math.ceil(job.totalBytes / this.compressionBytesPerMs()) + 60_000;
  }

  canStartScheduledJob(job, now = new Date()) {
    const window = this.scheduleWindow(now);
    if (!window.enabled) return { allowed: true, estimatedMs: this.estimateJobDurationMs(job), remainingMs: Infinity };
    if (!window.active) return { allowed: false, estimatedMs: this.estimateJobDurationMs(job), remainingMs: 0 };
    const estimatedMs = this.estimateJobDurationMs(job);
    const remainingMs = window.endAt.getTime() - now.getTime();
    return { allowed: estimatedMs <= remainingMs, estimatedMs, remainingMs };
  }

  async finishNextAndPause() {
    this.pauseAfterCurrent = true;
    this.emitState();
    await this.log('info', this.running ? '当前任务完成后将暂停队列。' : '下一项任务完成后将暂停队列。');
    if (!this.running) void this.startQueue();
    return this.getState();
  }

  async handleScheduleTick(now = new Date()) {
    if (!this.config.scheduleEnabled) return this.getState();
    const window = this.scheduleWindow(now);
    if (window.active) {
      if (this.running && this.paused && this.schedulePaused) {
        await this.resumeCurrent();
      } else if (!this.running && this.jobs.some(isRunnableQueuedJob)) {
        void this.startQueue();
      }
    } else if (this.running && !this.paused) {
      try {
        await this.pauseCurrent();
        this.schedulePaused = true;
        await this.log('warning', '已到定时结束时间，当前任务已安全暂停。');
      } catch {
        this.scheduleWaiting = true;
      }
    }
    return this.getState();
  }

  async removeJobs(jobIds) {
    const ids = new Set(jobIds || []);
    if (ids.size === 0) return this.getState();
    const runningSelected = this.jobs.some((job) => ids.has(job.id) && RUNNING_STATUSES.has(job.status));
    if (runningSelected) throw new Error('运行中的任务不能直接移除，请先取消它。');
    if (this.jobs.some((job) => ids.has(job.id) && job.status === 'awaiting_anomaly_confirmation')) {
      throw new Error('大小异常的成品已经生成，请先确认入库，不能直接从任务列表移除。');
    }
    if (this.jobs.some((job) => ids.has(job.id) && job.status === 'awaiting_trash_safety_confirmation')) {
      throw new Error('回收站安全警告尚未确认，不能直接移除对应任务。');
    }
    for (const jobId of ids) {
    await this.store.deletePendingManifest(this.config.repositoryDirectory, jobId);
    }
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => !ids.has(job.id));
    await this.persistJobs();
    await this.log('info', `已从任务列表移除 ${before - this.jobs.length} 项；归档库记录不受影响。`);
    return this.getState();
  }

  async removePotentialDuplicateJobs() {
    const duplicateIds = this.jobs
      .filter((job) => !RUNNING_STATUSES.has(job.status) && job.status !== 'awaiting_anomaly_confirmation')
      .filter((job) => (job.nameDuplicateMatches || []).length > 0 ||
        (job.similarMatches || []).length > 0 ||
        (job.confirmationReasons || []).includes('name_match'))
      .map((job) => job.id);
    if (duplicateIds.length === 0) return { state: this.getState(), removedCount: 0 };
    const state = await this.removeJobs(duplicateIds);
    return { state, removedCount: duplicateIds.length };
  }

  async removeExactDuplicateJobs() {
    const duplicateIds = this.jobs
      .filter((job) => !RUNNING_STATUSES.has(job.status) && job.status !== 'awaiting_anomaly_confirmation')
      .filter((job) => (job.exactDuplicateMatches || []).length > 0 ||
        (job.exactProjectMatches || []).length > 0)
      .map((job) => job.id);
    if (duplicateIds.length === 0) return { state: this.getState(), removedCount: 0 };
    const state = await this.removeJobs(duplicateIds);
    return { state, removedCount: duplicateIds.length };
  }

  async clearCompletedJobs() {
    const ids = this.jobs
      .filter((job) => String(job.status || '').startsWith('completed'))
      .map((job) => job.id);
    if (ids.length === 0) return { state: this.getState(), removedCount: 0 };
    for (const jobId of ids) await this.store.deletePendingManifest(this.config.repositoryDirectory, jobId);
    const completedIds = new Set(ids);
    this.jobs = this.jobs.filter((job) => !completedIds.has(job.id));
    await this.persistJobs();
    await this.log('info', `已清除 ${ids.length} 个已完成任务；仓库记录、压缩包和源文件均未删除。`);
    return { state: this.getState(), removedCount: ids.length };
  }

  async clearCancelledJobs() {
    const ids = this.jobs
      .filter((job) => job.status === 'cancelled')
      .map((job) => job.id);
    if (ids.length === 0) return { state: this.getState(), removedCount: 0 };
    for (const jobId of ids) await this.store.deletePendingManifest(this.config.repositoryDirectory, jobId);
    const cancelledIds = new Set(ids);
    this.jobs = this.jobs.filter((job) => !cancelledIds.has(job.id));
    await this.persistJobs();
    await this.log('info', `已清除 ${ids.length} 个已取消任务；仓库记录、压缩包和源文件均未删除。`);
    return { state: this.getState(), removedCount: ids.length };
  }

  async clearQueue() {
    this.stopRequested = true;
    if (this.running) {
      const idle = new Promise((resolve) => this.once('idle', resolve));
      try { await this.pauseController?.resume(); } catch { /* 终止进程仍可继续 */ }
      this.paused = false;
      this.abortController?.abort();
      await idle;
    }
    const protectedStatuses = new Set(['awaiting_anomaly_confirmation', 'awaiting_trash_safety_confirmation']);
    const protectedJobs = this.jobs.filter((job) => protectedStatuses.has(job.status));
    const ids = this.jobs.filter((job) => !protectedStatuses.has(job.status)).map((job) => job.id);
    for (const jobId of ids) {
    await this.store.deletePendingManifest(this.config.repositoryDirectory, jobId);
    }
    this.jobs = protectedJobs;
    await this.persistJobs();
    this.stopRequested = false;
    await this.log('warning', protectedJobs.length > 0
      ? `任务列表已清理；${protectedJobs.length} 个安全或大小异常任务仍等待确认。`
      : '任务列表已清空；已入库档案和源文件均未删除。');
    return this.getState();
  }

  async startQueue() {
    if (this.running) return this.getState();
    if (this.safetyHalt || this.jobs.some((job) => job.status === 'awaiting_trash_safety_confirmation')) {
      await this.log('warning', '回收站安全警告尚未确认，队列保持停止。');
      return this.getState();
    }
    this.running = true;
    this.stopRequested = false;
    this.emitState();
    await this.log('info', '归档队列已启动。');

    try {
      while (!this.stopRequested) {
        const job = this.jobs.find(isRunnableQueuedJob);
        if (!job) break;
        const scheduleDecision = this.canStartScheduledJob(job);
        if (!scheduleDecision.allowed) {
          this.scheduleWaiting = true;
          const minutes = Math.max(0, Math.floor(scheduleDecision.remainingMs / 60_000));
          await this.log('warning', scheduleDecision.remainingMs > 0
            ? `下一项预计需要 ${Math.ceil(scheduleDecision.estimatedMs / 60_000)} 分钟，剩余 ${minutes} 分钟，本时段不再启动新任务。`
            : '当前不在定时运行时段；已记录入库方式，队列将在计划开始时间自动运行。');
          break;
        }
        this.scheduleWaiting = false;
        await this.runOne(job);
        if (job.status === 'queued') {
          this.stopRequested = true;
          await this.updateJob(job, {
            status: 'failed',
            stageText: '队列状态异常，已安全停止',
            progress: 0,
            errorCode: 'QUEUE_STATE_STALLED',
            errorMessage: '任务执行结束后仍处于等待状态，为防止重复运行已停止队列。'
          });
          await this.log('error', '检测到任务状态没有推进，已停止队列以避免重复执行。', job.id);
          break;
        }
        if (this.pauseAfterCurrent) {
          await this.log('info', '已按要求完成一项，队列现已暂停。');
          break;
        }
      }
    } finally {
      this.running = false;
      this.abortController = null;
      this.pauseController = null;
      this.paused = false;
      this.pauseAfterCurrent = false;
      this.emitState();
      await this.log('info', this.scheduleWaiting ? '队列已进入定时等待。' : '当前可执行任务已经处理完毕。');
      this.emit('idle');
    }
    return this.getState();
  }

  async stopForShutdown() {
    if (!this.running) return;
    this.stopRequested = true;
    const idle = new Promise((resolve) => this.once('idle', resolve));
    try { await this.pauseController?.resume(); } catch { /* 随后强制终止子进程 */ }
    this.paused = false;
    this.abortController?.abort();
    await idle;
  }

  async runOne(job) {
    this.abortController = new AbortController();
    this.pauseController = this.services.createPauseController?.() || new PauseController();
    let compressionStartedAt = 0;
    let compressionFinishedAt = 0;
    let generatedThumbnailDirectory = '';
    let result = null;
    let publishedArtifactsFinalized = false;
    await this.updateJob(job, {
      status: 'inventorying',
      startedAt: new Date().toISOString(),
      progress: 0,
      errorCode: null,
      errorMessage: null
    });

    try {
      const preparedManifest = await this.store.loadPendingManifest(this.config.repositoryDirectory, job.id);
      const inventoryOnly = job.processingMode === 'inventory_only';
      const existingRecordIndex = job.sourceCatalogRecordId
        ? this.catalog.findIndex((record) => record.id === job.sourceCatalogRecordId)
        : -1;
      const existingRecord = existingRecordIndex >= 0 ? this.catalog[existingRecordIndex] : null;
      if (job.sourceCatalogRecordId && !existingRecord) throw new Error('对应的未压缩仓库项目已经不存在。');
      const archiveRunner = inventoryOnly ? runInventoryOnlyJob : (this.services.archiveRunner || runArchiveJob);
      const jobConfig = {
        ...this.config,
        sevenZipPath: this.resolveProgramPath(this.config.sevenZipPath),
        ffmpegPath: this.resolveProgramPath(this.config.ffmpegPath),
        archiveFormat: job.archiveFormat || this.config.archiveFormat || '7z',
        compressionLevel: Number(job.compressionLevel ?? this.config.compressionLevel ?? 1),
        archiveVolumeEnabled: typeof job.archiveVolumeEnabled === 'boolean'
          ? job.archiveVolumeEnabled
          : this.config.archiveVolumeEnabled !== false,
        archiveVolumeBytes: Number(job.archiveVolumeBytes ?? this.config.archiveVolumeBytes ?? LARGE_TASK_BYTES),
        largeFolderSimplification: typeof job.largeFolderSimplification === 'boolean'
          ? job.largeFolderSimplification
          : this.config.largeFolderSimplification === true,
        largeFolderFileThreshold: Number(job.largeFolderFileThreshold ?? this.config.largeFolderFileThreshold ?? DEFAULT_LARGE_FOLDER_FILE_THRESHOLD),
        largeFolderMd5SampleLimit: Number(
          job.largeFolderMd5SampleLimit ?? this.config.largeFolderMd5SampleLimit ?? DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT
        ),
        skipTinyMd5Files: typeof job.skipTinyMd5Files === 'boolean'
          ? job.skipTinyMd5Files
          : this.config.skipTinyMd5Files === true,
        tinyFileMd5ThresholdBytes: Number(
          job.tinyFileMd5ThresholdBytes ?? this.config.tinyFileMd5ThresholdBytes ?? DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES
        ),
        archivePassword: typeof job.archivePassword === 'string'
          ? job.archivePassword
          : String(this.config.archivePassword || '')
      };
      result = await archiveRunner(job, jobConfig, {
        preparedManifest,
        pauseController: this.pauseController,
        onStage: async (status, stageText) => {
          if (status === 'compressing' && !compressionStartedAt) {
            compressionStartedAt = Date.now();
            job.compressionStartedAt = new Date(compressionStartedAt).toISOString();
          }
          if (compressionStartedAt && !compressionFinishedAt && job.status === 'compressing' && status !== 'compressing') {
            compressionFinishedAt = Date.now();
          }
          await this.updateJob(job, { status, stageText, progress: status === 'compressing' ? 0 : job.progress });
        },
        onProgress: (progress) => {
          job.progress = progress;
          this.emitProgressThrottled(job);
        },
        onInventoryProgress: (progress) => {
          job.stageText = `正在生成 MD5：${progress.processedFiles}/${progress.totalFiles} · ${progress.currentFile}`;
          job.progress = progress.totalFiles > 0 ? Math.round((progress.processedFiles / progress.totalFiles) * 100) : 0;
          this.emitProgressThrottled(job);
        },
        onInventoryPlan: (plan) => {
          if (plan.simplified) {
            void this.log('info', `卡顿规避：${plan.totalFiles} 个文件中选取 ${plan.md5Files} 个代表文件记录 MD5、计算文件相似度。`, job.id);
          }
          if (plan.tinyFilesSkipped > 0) {
            const tinyThresholdKb = Math.round(plan.tinyFileMd5ThresholdBytes / 1024);
            void this.log('info', `卡顿规避：已跳过 ${plan.tinyFilesSkipped} 个小于 ${tinyThresholdKb} KB 的极小文件，不计算 MD5。`, job.id);
          }
        },
        onManifestReady: async (manifest) => {
          if (job.sourceCatalogRecordId) {
            job.automaticDuplicateCheckPending = false;
            return;
          }
          const initialReviewFingerprint = createManifestReviewFingerprint(manifest);
          const legacyReviewConfirmed = Boolean(
            job.exactDuplicateOverrideAt && Array.isArray(preparedManifest) && preparedManifest.length > 0
          );
          let reviewConfirmed = Boolean(
            initialReviewFingerprint &&
            job.duplicateConfirmedManifestFingerprint === initialReviewFingerprint
          ) || legacyReviewConfirmed;
          if (legacyReviewConfirmed && !job.duplicateConfirmedManifestFingerprint) {
            job.duplicateConfirmedManifestFingerprint = initialReviewFingerprint;
          }
          let exactVerification;
          if (!reviewConfirmed && this.config.autoSkipExactDuplicates) {
            exactVerification = await this.verifyExactProjectMatches(job, manifest);
          } else if (!reviewConfirmed) {
            const directCandidates = this.findIndexedProjectCandidates(manifest, 'content', job.sourceCatalogRecordId);
            exactVerification = {
              manifest,
              matches: findExactProjectMatches(manifest, directCandidates, job.sourceCatalogRecordId),
              verificationIncomplete: false
            };
          } else {
            exactVerification = { manifest, matches: [], verificationIncomplete: false };
          }
          const reviewManifest = exactVerification.manifest || manifest;
          const reviewFingerprint = createManifestReviewFingerprint(reviewManifest);
          reviewConfirmed = reviewConfirmed || Boolean(
            reviewFingerprint && job.duplicateConfirmedManifestFingerprint === reviewFingerprint
          );
          const exactProjectMatches = exactVerification.matches;
          if (this.config.autoSkipExactDuplicates && exactProjectMatches.length > 0) {
            const skipped = new Error('项目与仓库中的现有项目完全一致，已按设置自动跳过。');
            skipped.code = 'AUTO_SKIPPED_EXACT_DUPLICATE';
            skipped.projectMatches = exactProjectMatches;
            skipped.manifest = exactVerification.manifest;
            throw skipped;
          }
          const similaritySubject = { ...job, id: job.sourceCatalogRecordId || job.id, manifest: reviewManifest };
          const exactMatches = this.findIndexedExactFileMatches(reviewManifest, job.sourceCatalogRecordId);
          const manifestSimilarMatches = findSimilarProjects(
            similaritySubject,
            this.getSimilarityCandidates(similaritySubject).filter((record) => record.id !== job.sourceCatalogRecordId),
            this.similarityIgnoreTerms,
            this.similarityStrength
          );
          const combinedSimilarMatches = [
            ...(job.similarMatches || []),
            ...manifestSimilarMatches
          ].filter((match, index, items) => items.findIndex((item) => item.id === match.id) === index);
          const hasNameDuplicate = (job.nameDuplicateMatches || []).length > 0;
          const preflightSimilarityConfirmed = job.similarityPreflightBlocking !== false &&
            Boolean(job.confirmedAt || job.duplicateConfirmedAt) &&
            (job.confirmationReasons || []).some((reason) =>
              ['name_match', 'similar_title', 'same_video_size'].includes(reason));
          const requiresExactReview = (exactProjectMatches.length > 0 || exactMatches.length > 0) && !reviewConfirmed;
          const requiresNewSimilarityReview = (combinedSimilarMatches.length > 0 || hasNameDuplicate) &&
            !preflightSimilarityConfirmed && !reviewConfirmed;
          const requiresVerificationReview = exactVerification.verificationIncomplete && !reviewConfirmed;
          if (requiresExactReview || requiresNewSimilarityReview || requiresVerificationReview) {
            job.automaticDuplicateCheckPending = false;
            await this.store.savePendingManifest(this.config.repositoryDirectory, job.id, reviewManifest);
            const reasons = [
              exactProjectMatches.length > 0 ? '完整项目与仓库内容完全一致' : null,
              exactMatches.length > 0 ? `${exactMatches.length} 个内容完全相同的文件` : null,
              hasNameDuplicate ? '名称可能重复' : null,
              combinedSimilarMatches.length > 0 ? `${combinedSimilarMatches.length} 个相似项目或视频` : null,
              requiresVerificationReview ? '内容完全一致候选待人工核对' : null
            ].filter(Boolean).join('，');
            const review = new Error(`发现${reasons}，需要确认后才能${inventoryOnly ? '直接入库' : '压缩'}。`);
            review.code = 'DUPLICATE_REVIEW_REQUIRED';
            review.matches = exactMatches;
            review.projectMatches = exactProjectMatches;
            review.similarMatches = combinedSimilarMatches;
            review.verificationIncomplete = requiresVerificationReview;
            review.reviewFingerprint = reviewFingerprint;
            review.reviewKind = requiresExactReview || requiresVerificationReview ? 'exact' : 'similarity';
            throw review;
          }
          job.automaticDuplicateCheckPending = false;
          job.duplicateReviewFingerprint = null;
          job.duplicateReviewKind = null;
        },
        onSkippedFile: (item) => {
          job.skippedFiles = [...(job.skippedFiles || []), item].slice(-500);
        },
        onLog: (message) => { void this.log('info', message, job.id, false); }
      }, this.abortController.signal);

      if (compressionStartedAt) {
        const archiveFinishedAt = Date.now();
        await this.rememberCompressionSample(
          job.totalBytes,
          (compressionFinishedAt || Date.now()) - compressionStartedAt,
          archiveFinishedAt - Date.parse(job.startedAt),
          compressionFinishedAt ? archiveFinishedAt - compressionFinishedAt : 0
        );
      }

      if (this.services.createThumbnails && !job.sourceCatalogRecordId) {
        const thumbnailRoot = path.join(this.config.repositoryDirectory, 'thumbnails');
        const thumbnailDirectory = assertOwnedChildPath(
          thumbnailRoot,
          path.join(thumbnailRoot, assertSafePathSegment(job.id, '缩略图目录'))
        );
        const thumbnailDirectoryExisted = await pathExists(thumbnailDirectory);
        try {
          result.manifest = await this.services.createThumbnails(job, result.manifest, jobConfig, {
            pauseController: this.pauseController,
            signal: this.abortController.signal,
            onLog: (message, level = 'warning') => { void this.log(level, message, job.id, false); }
          });
        } catch (error) {
          if (error instanceof CancelledError || error.code === 'TASK_CANCELLED' || this.abortController.signal.aborted) {
            throw error;
          }
          await this.log('warning', `缩略图生成未完成：${error.message}`, job.id);
        } finally {
          if (!thumbnailDirectoryExisted) generatedThumbnailDirectory = thumbnailDirectory;
        }
      }

      const completedAt = new Date().toISOString();
      const hasSkippedFiles = (result.skippedFiles || job.skippedFiles || []).length > 0;
      const skipSourceAction = this.stopRequested || this.abortController.signal.aborted || hasSkippedFiles;
      const shouldRecordPassword = !inventoryOnly && (typeof job.recordArchivePassword === 'boolean'
        ? job.recordArchivePassword
        : Boolean(this.config.recordArchivePassword));
      const completionAction = inventoryOnly ? 'keep' : this.config.moveCompleted
        ? 'move'
        : this.config.autoTrashCompleted ? 'trash' : 'keep';
      const preservedTags = existingRecord?.tags || [];
      const nextTags = inventoryOnly
        ? ['未压缩', ...preservedTags.filter((tag) => tag !== '未压缩')]
        : preservedTags.filter((tag) => tag !== '未压缩');
      const record = {
        ...(existingRecord || {}),
        id: existingRecord?.id || crypto.randomUUID(),
        jobId: existingRecord?.jobId || job.id,
        archiveJobId: job.id,
        sourcePath: job.sourcePath,
        originalSourcePath: existingRecord?.originalSourcePath || job.sourcePath,
        displayName: job.displayName,
        title: existingRecord?.title || job.displayName,
        tags: nextTags,
        rating: Number(existingRecord?.rating) || 0,
        notes: existingRecord?.notes || '',
        backupLocation: existingRecord
          ? String(existingRecord.backupLocation || '')
          : this.config.recordBackupLocation ? String(this.config.backupLocation || '').trim() : '',
        coverRelativePath: existingRecord?.coverRelativePath || null,
        coverThumbnailRef: existingRecord?.coverThumbnailRef || null,
        manualImages: existingRecord?.manualImages || [],
        similarRecords: [],
        dismissedSimilarRecordIds: existingRecord?.dismissedSimilarRecordIds || [],
        duplicateEvidence: Boolean(
          (job.nameDuplicateMatches || []).length ||
          (job.similarMatches || []).length ||
          (job.exactDuplicateMatches || []).length
        ),
        duplicateReasons: [...new Set([
          ...((job.nameDuplicateMatches || []).length ? ['名称重复'] : []),
          ...(job.similarMatches || []).flatMap((match) => match.reasons || []),
          ...((job.exactDuplicateMatches || []).length ? ['存在内容完全一致的文件'] : [])
        ])],
        possibleDuplicate: false,
        recordType: 'archive',
        sourceType: job.sourceType,
        fileCount: job.fileCount,
        originalBytes: job.totalBytes,
        archiveBaseName: inventoryOnly ? '' : job.archiveBaseName,
        archiveDirectory: inventoryOnly ? '' : this.config.archiveOutputDirectory,
        archiveFormat: inventoryOnly ? 'none' : (jobConfig.archiveFormat || this.config.archiveFormat || '7z'),
        compressionLevel: inventoryOnly ? null : Number(jobConfig.compressionLevel ?? this.config.compressionLevel ?? 1),
        archivePassword: shouldRecordPassword ? jobConfig.archivePassword : '',
        hasPassword: !inventoryOnly && Boolean(jobConfig.archivePassword),
        passwordRecorded: shouldRecordPassword,
        ...result,
        skippedFiles: result.skippedFiles || job.skippedFiles || [],
        archiveState: inventoryOnly ? 'uncompressed' : 'compressed',
        completionAction,
        completionDestination: completionAction === 'move' ? this.config.processedSourceDirectory : '',
        sourceDisposition: completionAction === 'keep'
          ? 'kept'
          : hasSkippedFiles ? `${completionAction}_skipped_unreadable`
            : skipSourceAction ? `${completionAction}_skipped_stopping` : `${completionAction}_pending`,
        completedAt,
        inventoryDate: existingRecord?.inventoryDate || completedAt,
        metadataUpdatedAt: completedAt
      };
      const archivePublication = result.archivePublication || null;
      delete record.archivePublication;
      normalizeThumbnailReferences(record, this.config.repositoryDirectory, { strict: true });
      const sizeCheck = inventoryOnly
        ? { abnormal: false, ratio: null, reason: '未压缩' }
        : assessArchiveSize(job.totalBytes, result.archiveTotalBytes);
      record.archiveSizeCheck = sizeCheck;
      if (sizeCheck.abnormal) {
        job.pendingCatalogRecord = record;
        await this.updateJob(job, {
          status: 'awaiting_anomaly_confirmation',
          stageText: `${sizeCheck.reason}（压缩率 ${(sizeCheck.ratio * 100).toFixed(2)}%），等待核验`,
          progress: 100,
          archiveFiles: result.archiveFiles,
          completedAt,
          errorCode: 'ARCHIVE_SIZE_ANOMALY',
          errorMessage: sizeCheck.reason
        });
        await this.log('error', `压缩体积异常：${sizeCheck.reason}；完整性测试已通过，但必须人工确认后才会入库。`, job.id);
        publishedArtifactsFinalized = true;
        return;
      }
      const catalogBeforeCommit = structuredClone(this.catalog);
      try {
        if (existingRecordIndex >= 0) this.catalog[existingRecordIndex] = record;
        else this.catalog.push(record);
        this.refreshSimilarityForRecord(record);
        await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
      } catch (error) {
        this.restoreCatalogSnapshot(catalogBeforeCommit);
        const compensation = await this.compensateUncommittedArchive(
          job,
          { ...result, archivePublication },
          generatedThumbnailDirectory
        );
        publishedArtifactsFinalized = true;
        throw this.catalogCommitFailure(error, compensation);
      }
      publishedArtifactsFinalized = true;
      await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);

      let completionStatus = 'completed';
      let completionText = inventoryOnly ? '已生成完整清单并直接入库（未压缩）' : '已验证并入库';
      if (completionAction !== 'keep' && !skipSourceAction && !this.safetyHalt) {
        let sourceDispositionCompleted = false;
        try {
          completionText = await this.completeSourceDisposition(record, job);
          sourceDispositionCompleted = true;
          await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
          await this.log('warning', completionText, job.id);
        } catch (error) {
          if (sourceDispositionCompleted) {
            const persistenceError = new Error(
              `源文件后处理已经执行，但处理结果未能写回仓库：${error.message}。请勿重试归档，并按运行日志核对源文件位置。`
            );
            persistenceError.code = 'SOURCE_DISPOSITION_COMMIT_FAILED';
            persistenceError.cause = error;
            persistenceError.sourceDispositionRecovery = {
              action: completionAction,
              sourceDisposition: record.sourceDisposition,
              originalSourcePath: job.sourcePath,
              movedTo: String(record.movedTo || ''),
              trashedAt: String(record.trashedAt || '')
            };
            throw persistenceError;
          }
          if (['TRASH_NOT_PERFORMED', 'TRASH_VERIFICATION_UNAVAILABLE', 'TRASH_RETENTION_FAILED'].includes(error.code)) {
            await this.activateTrashSafetyHalt(record, job, error, result.archiveFiles);
            await this.log('error', `回收站安全熔断：${error.message} 自动移入回收站已关闭，后续任务没有启动。`, job.id);
            return;
          }
          record.sourceDisposition = `${completionAction}_failed`;
          record.sourceActionError = error.message;
          await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
          completionStatus = 'completed_cleanup_failed';
          completionText = completionAction === 'move'
            ? '归档成功，但移动源项目失败，原位置已保留'
            : '归档成功，但移入回收站失败';
          await this.log('error', completionText + `：${error.message}`, job.id);
        }
      } else if (completionAction !== 'keep' && (skipSourceAction || this.safetyHalt)) {
        if (this.safetyHalt) {
          record.sourceDisposition = 'kept';
          record.sourceActionError = '回收站安全熔断期间未执行源文件后处理。';
          await this.store.saveCatalog(this.config.repositoryDirectory, this.catalog);
        }
        completionText = this.safetyHalt
          ? '已验证入库；因回收站安全熔断，源项目保留在原位置'
          : hasSkippedFiles
          ? `已验证入库；有 ${(record.skippedFiles || []).length} 个内容无法读取，源项目为防止遗漏而保留`
          : '已验证入库；因队列正在停止，源项目已保留';
        await this.log('warning', completionText, job.id);
      }
      await this.updateJob(job, {
        status: completionStatus,
        stageText: completionText,
        progress: 100,
        archiveFiles: result.archiveFiles,
        completedAt
      });
      await this.log('success', inventoryOnly
        ? '任务已生成清单和缩略图并直接入库；未生成压缩包，原文件保持原位。'
        : job.sourceCatalogRecordId
          ? '库内未压缩项目已完成压缩，原仓库记录已升级。'
          : '任务已完成完整性测试并成功入库。', job.id);
    } catch (caughtError) {
      let error = caughtError;
      if (result?.archivePublication && !publishedArtifactsFinalized) {
        const compensation = await this.compensateUncommittedArchive(job, result, generatedThumbnailDirectory);
        publishedArtifactsFinalized = true;
        const cancelled = error instanceof CancelledError || error.code === 'TASK_CANCELLED' || this.abortController.signal.aborted;
        if (cancelled && !compensation.recoveryRequired) {
          error.catalogRecovery = compensation;
        } else {
          error = this.uncommittedArchiveFailure(error, compensation, '归档成品发布后的处理失败');
        }
      }
      if (error.code === 'AUTO_SKIPPED_EXACT_DUPLICATE') {
        await this.skipExactDuplicateJob(job, error.projectMatches || [], error.manifest);
      } else if (error.code === 'DUPLICATE_REVIEW_REQUIRED') {
        const projectCount = (error.projectMatches || []).length;
        const exactCount = (error.matches || []).length;
        const similarCount = (error.similarMatches || []).length;
        const reasonText = [
          projectCount > 0 ? '项目完全重复' : null,
          exactCount > 0 ? `${exactCount} 个文件内容完全一致` : null,
          similarCount > 0 ? `${similarCount} 个相似项目或视频` : null,
          error.verificationIncomplete ? '内容完全一致候选待人工核对' : null
        ].filter(Boolean).join('，') || '重复风险';
        await this.updateJob(job, {
          status: 'awaiting_duplicate_confirmation',
          stageText: `发现 ${reasonText}，已延后等待确认`,
          progress: 0,
          exactProjectMatches: error.projectMatches || [],
          exactDuplicateMatches: error.matches,
          similarMatches: error.similarMatches || job.similarMatches || [],
          duplicateReviewFingerprint: error.reviewFingerprint || null,
          duplicateReviewKind: error.reviewKind || 'similarity',
          errorCode: null,
          errorMessage: null
        });
        await this.log('warning', error.message, job.id);
      } else if (error instanceof CancelledError || error.code === 'TASK_CANCELLED') {
        await this.updateJob(job, {
          status: 'cancelled',
          stageText: error.catalogRecovery?.archiveState === 'recovered_to_staging'
            ? '已取消，成品已移回恢复目录，源文件未修改'
            : '已取消，源文件未修改',
          progress: 0,
          errorCode: null,
          errorMessage: null,
          catalogRecovery: error.catalogRecovery || null
        });
        await this.log('warning', '运行中的任务已安全取消。', job.id);
        await this.store.deletePendingManifest(this.config.repositoryDirectory, job.id);
      } else if (error.code === 'SOURCE_DISPOSITION_COMMIT_FAILED') {
        await this.log('error', error.message, job.id);
        await this.updateJob(job, {
          status: 'completed_cleanup_failed',
          stageText: '归档已入库，源文件后处理已完成，但仓库状态保存失败；请查看日志且不要重试',
          progress: 100,
          archiveFiles: result?.archiveFiles || [],
          errorCode: error.code,
          errorMessage: error.message,
          sourceDispositionRecovery: error.sourceDispositionRecovery
        });
      } else {
        const diskSafetyError = ['INSUFFICIENT_DISK_SPACE', 'DISK_SPACE_CHECK_UNAVAILABLE'].includes(error.code);
        if (diskSafetyError) this.stopRequested = true;
        const failureLogMessage = diskSafetyError
          ? `${error.message} 整个队列已停止，释放空间并确认目录可用后可重试。`
          : error.message;
        // 补偿结果先写独立运行日志；即使仓库同时无法保存任务状态，恢复位置也不会静默丢失。
        if (error.catalogRecovery) await this.log('error', failureLogMessage, job.id);
        await this.updateJob(job, {
          status: 'failed',
          stageText: diskSafetyError ? '磁盘空间安全停止，等待用户处理' : '处理失败，可重试',
          progress: 0,
          errorCode: error.code || 'UNKNOWN_ERROR',
          errorMessage: error.message,
          catalogRecovery: error.catalogRecovery || null
        });
        if (!error.catalogRecovery) await this.log('error', failureLogMessage, job.id);
      }
    } finally {
      try { await this.pauseController?.resume(); } catch { /* 子进程已退出时忽略 */ }
      this.paused = false;
      this.abortController = null;
      this.pauseController = null;
    }
  }
}

module.exports = { QueueManager };
