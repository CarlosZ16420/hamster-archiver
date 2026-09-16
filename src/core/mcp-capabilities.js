'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isVideoFile } = require('./constants');
const { normalizeForComparison } = require('./paths');

const MAX_PAGE = 100;
const SOURCE_DISPOSITIONS = ['keep', 'trash', 'move'];
const THEME_VALUES = ['classic', 'day', 'night', 'forest', 'twilight'];
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const capabilitySearchTerms = {
  'intake.plan': '整理 收纳 计划 预检 organize downloads preview intake',
  'intake.add_batch': '整理 收纳 下载目录 批量归档 建库 organize downloads archive catalog files',
  'catalog.search': '搜索 查找收藏 备份位置 find projects backup location media catalog',
  'catalog.update_metadata': '分类 标签 备注 星级 organize tag notes rating',
  'queue.state': '进度 状态 跟踪 completion progress status',
  'settings.intake_preferences': '保存位置 保留原文件 回收站 move keep source preferences'
};

const objectSchema = (properties = {}, required = [], additionalProperties = false) => ({
  type: 'object', properties, required, additionalProperties
});
const stringSchema = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const idListSchema = { type: 'array', minItems: 1, maxItems: 100, items: stringSchema(128) };
const pageProperties = {
  offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE }
};
const optionalStringSchema = (maxLength = 4096) => ({ type: 'string', maxLength });
const settingsPatchProperties = {
  language: { type: 'string', enum: ['zh-CN', 'en-US'] },
  intakeDirectory: optionalStringSchema(),
  archiveStagingDirectory: optionalStringSchema(),
  archiveOutputDirectory: optionalStringSchema(),
  moveCompleted: { type: 'boolean' },
  autoTrashCompleted: { type: 'boolean' },
  processedSourceDirectory: optionalStringSchema(),
  archiveNamingMode: { type: 'string', enum: ['timestamp_random', 'original', 'custom_random'] },
  customArchiveName: optionalStringSchema(120),
  archiveFormat: { type: 'string', enum: ['7z', 'zip'] },
  compressionLevel: { type: 'integer', minimum: 0, maximum: 9 },
  archiveVolumeEnabled: { type: 'boolean' },
  archiveVolumeBytes: { type: 'integer', minimum: 64 * MIB, maximum: 10 * GIB },
  archivePassword: optionalStringSchema(128),
  recordArchivePassword: { type: 'boolean' },
  videoFrameBackup: { type: 'boolean' },
  videoFrameCount: { type: 'integer', minimum: 1, maximum: 20 },
  thumbnailLimit: { type: 'integer', minimum: 1, maximum: 500 },
  smallItemFilter: { type: 'boolean' },
  minimumTaskBytes: { type: 'integer', minimum: MIB, maximum: 100 * 1024 * MIB },
  similarityReportEnabled: { type: 'boolean' },
  largeFolderSimplification: { type: 'boolean' },
  largeFolderFileThreshold: { type: 'integer', minimum: 1, maximum: 100000 },
  largeFolderMd5SampleLimit: { type: 'integer', minimum: 1, maximum: 100000 },
  skipTinyMd5Files: { type: 'boolean' },
  tinyFileMd5ThresholdBytes: { type: 'integer', minimum: 1024, maximum: GIB },
  autoSkipExactDuplicates: { type: 'boolean' },
  autoSkipExactDuplicateAction: { type: 'string', enum: ['keep', 'remove'] },
  scheduleEnabled: { type: 'boolean' },
  scheduleStart: optionalStringSchema(5),
  scheduleEnd: optionalStringSchema(5),
  similarityEnabled: { type: 'boolean' },
  similarityStrength: { type: 'string', enum: ['loose', 'standard', 'strict'] },
  recordBackupLocation: { type: 'boolean' },
  backupLocation: optionalStringSchema(200),
  suppressInventoryOnlyRisk: { type: 'boolean' },
  suppressCatalogCompressionRisk: { type: 'boolean' },
  suppressOnboarding: { type: 'boolean' }
};
const settingsPatchKeys = new Set(Object.keys(settingsPatchProperties));
const safePasswordMetadataKeys = new Set([
  'hasPassword', 'passwordConfigured', 'passwordRecorded', 'passwordScheme', 'recordArchivePassword'
]);
const catalogMetadataProperties = {
  title: optionalStringSchema(200),
  tags: { type: 'array', maxItems: 30, items: optionalStringSchema(30) },
  rating: { type: 'integer', minimum: 0, maximum: 5 },
  notes: optionalStringSchema(5000),
  backupLocation: optionalStringSchema(200),
  archivePassword: optionalStringSchema(128),
  passwordRecorded: { type: 'boolean' }
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/password/i.test(key)) {
      if (key === 'archivePassword') result.passwordConfigured = Boolean(entry);
      else if (safePasswordMetadataKeys.has(key)) result[key] = redact(entry);
      continue;
    }
    if (/token|secret/i.test(key)) continue;
    result[key] = redact(entry);
  }
  return result;
}

function queueSummary(manager) {
  return redact({
    running: manager.running,
    paused: manager.paused,
    scheduleWaiting: manager.scheduleWaiting,
    safetyHalt: manager.safetyHalt,
    undoDepth: manager.undoStack?.length || 0,
    totalJobs: manager.jobs?.length || 0
  });
}

function decisionToken(job) {
  return crypto.createHash('sha256').update(JSON.stringify([
    job.id, job.status, job.duplicateReviewFingerprint, job.errorCode, job.errorMessage,
    job.startedAt, job.confirmedAt, job.completedAt
  ])).digest('hex');
}

function jobSummary(job) {
  const status = String(job.status || '');
  const possibleActions = ['awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(status)
    ? ['continue', 'skip']
    : ['failed', 'cancelled'].includes(status) ? ['retry']
      : ['awaiting_anomaly_confirmation', 'awaiting_trash_safety_confirmation'].includes(status) ||
          status.startsWith('completed') || status === 'skipped_duplicate'
        ? [] : status === 'queued' ? ['skip'] : ['cancel'];
  return {
    ...redact({
      id: job.id, requestId: job.mcpRequestId, displayName: job.displayName, status,
      progress: job.progress, stageText: job.stageText, errorCode: job.errorCode,
      errorMessage: job.errorMessage, sourcePath: job.sourcePath, processingMode: job.processingMode,
      confirmationReasons: job.confirmationReasons,
      duplicateReviewKind: job.duplicateReviewKind,
      similarMatches: (job.similarMatches || []).slice(0, 5),
      exactProjectMatches: (job.exactProjectMatches || []).slice(0, 5),
      exactDuplicateMatches: (job.exactDuplicateMatches || []).slice(0, 5),
      nameDuplicateMatches: (job.nameDuplicateMatches || []).slice(0, 5),
      possibleActions,
      needsDesktop: ['awaiting_anomaly_confirmation', 'awaiting_trash_safety_confirmation'].includes(status)
    }),
    decisionToken: decisionToken(job)
  };
}

function compactState(manager) {
  return queueSummary(manager);
}

function intakeRequestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function pathsOverlap(left, right) {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  const relative = path.relative(a, b);
  const reverse = path.relative(b, a);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ||
    (!reverse.startsWith('..') && !path.isAbsolute(reverse));
}

function catalogSummary(record) {
  if (!record) return null;
  return redact(Object.fromEntries([
    'id', 'title', 'displayName', 'recordType', 'fileCount', 'originalBytes', 'archiveState',
    'inventoryDate', 'rating', 'tags', 'backupLocation', 'sourceDisposition', 'verifiedAt'
  ].map((key) => [key, record[key]])));
}

function page(items, input = {}) {
  const offset = input.offset || 0;
  const limit = input.limit || 50;
  return { total: items.length, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}

function serviceAt(services, dottedName) {
  return dottedName.split('.').reduce((value, key) => value?.[key], services);
}

function publicSettings(config) {
  const hidden = new Set(['pendingTrashSafetyHalt', 'compressionHistory', 'migratedRepositoryFrom']);
  const settings = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (hidden.has(key) || key === 'archivePassword' ||
        (/password/i.test(key) && !safePasswordMetadataKeys.has(key)) || /token|secret/i.test(key)) continue;
    settings[key] = redact(value);
  }
  settings.passwordConfigured = Boolean(config?.archivePassword);
  return settings;
}

function publicSettingsPatch(config, keys) {
  const settings = publicSettings(config);
  const result = {};
  for (const key of keys) {
    if (key === 'archivePassword') {
      result.passwordConfigured = settings.passwordConfigured;
    } else if (Object.hasOwn(settings, key)) {
      result[key] = settings[key];
    }
  }
  return result;
}

function intakePreferences(manager) {
  const marker = manager.config?.intakePreferences;
  if (marker?.version === 1 && SOURCE_DISPOSITIONS.includes(marker.sourceDisposition) &&
      String(marker.archiveOutputDirectory || '').trim()) {
    return { configured: true, evidence: 'saved_marker', ...marker };
  }
  const archiveOutputDirectory = String(manager.config?.archiveOutputDirectory || '').trim();
  const move = manager.config?.moveCompleted === true;
  const trash = manager.config?.autoTrashCompleted === true;
  const processedSourceDirectory = String(manager.config?.processedSourceDirectory || '').trim();
  if (archiveOutputDirectory && ((move && processedSourceDirectory) || trash)) {
    return {
      configured: true,
      evidence: 'legacy_non_default',
      archiveOutputDirectory,
      sourceDisposition: move ? 'move' : 'trash',
      processedSourceDirectory: move ? processedSourceDirectory : ''
    };
  }
  return {
    configured: false,
    missingPreferences: ['archiveOutputDirectory', 'sourceDisposition'],
    allowedSourceDispositions: SOURCE_DISPOSITIONS,
    reason: 'No explicit saved preference was found. Default false switches do not prove that keep was chosen.'
  };
}

function managerFingerprint(manager) {
  return crypto.createHash('sha256').update(JSON.stringify(stable({
    config: manager.config,
    running: manager.running,
    safetyHalt: manager.safetyHalt?.id || null,
    jobs: (manager.jobs || []).map((job) => [job.id, job.status, job.progress]),
    catalog: (manager.catalog || []).map((record) => [record.id, record.metadataUpdatedAt, record.sourceDisposition]),
    undoDepth: manager.undoStack?.length || 0
}))).digest('hex');
}

function sourceDispositionPatch(input) {
  const disposition = input.sourceDisposition;
  if (!SOURCE_DISPOSITIONS.includes(disposition)) throw new Error('sourceDisposition must be keep, trash, or move');
  const output = String(input.archiveOutputDirectory || '').trim();
  if (!output || !path.isAbsolute(output) || output.includes('\0')) throw new Error('archiveOutputDirectory must be an absolute local path');
  const processed = String(input.processedSourceDirectory || '').trim();
  if (disposition === 'move' && (!processed || !path.isAbsolute(processed) || processed.includes('\0'))) {
    throw new Error('processedSourceDirectory must be an absolute local path when sourceDisposition is move');
  }
  return {
    archiveOutputDirectory: path.normalize(output),
    moveCompleted: disposition === 'move',
    autoTrashCompleted: disposition === 'trash',
    processedSourceDirectory: disposition === 'move' ? path.normalize(processed) : ''
  };
}

function sanitizeCatalogDetails(value) {
  return redact(value);
}

const capabilities = [
  ['settings.get', 'settings', 'Read all user settings and directories with password status only.', {}, true],
  ['settings.patch', 'settings', 'Update only the supplied common settings through product validation. Byte fields use binary units. Password text is accepted but never returned; an empty password clears it for future archives.', { patch: objectSchema(settingsPatchProperties) }, false, ['patch']],
  ['settings.intake_preferences', 'settings', 'Save the archive output and keep/trash/move preference used by future AI intake.', {
    archiveOutputDirectory: stringSchema(), sourceDisposition: { type: 'string', enum: SOURCE_DISPOSITIONS }, processedSourceDirectory: stringSchema()
  }, false, ['archiveOutputDirectory', 'sourceDisposition']],
  ['intake.plan', 'intake', 'Inspect explicit source boundaries and required preferences without scanning, hashing, queuing or changing settings.', {
    paths: { type: 'array', minItems: 1, maxItems: 100, items: stringSchema() },
    mode: { type: 'string', enum: ['archive', 'inventory_only'] }
  }, true, ['paths', 'mode']],
  ['intake.scan', 'intake', 'Scan an intake directory and add discovered items to the real product queue. This is not a read-only probe.', { directory: stringSchema(), scanToken: { type: 'string', maxLength: 128 } }, false, ['directory']],
  ['intake.add_batch', 'intake', 'Add up to 100 folders or videos and optionally start their selected mode.', {
    requestId: stringSchema(128), paths: { type: 'array', minItems: 1, maxItems: 100, items: stringSchema() },
    mode: { type: 'string', enum: ['archive', 'inventory_only'] }, start: { type: 'boolean' },
    archiveOutputDirectory: stringSchema(), sourceDisposition: { type: 'string', enum: SOURCE_DISPOSITIONS }, processedSourceDirectory: stringSchema()
  }, false, ['requestId', 'paths', 'mode']],
  ['queue.state', 'queue', 'Read compact, paginated queue state. Filter by requestId or jobId when polling to avoid unrelated jobs.', { requestId: optionalStringSchema(128), jobId: optionalStringSchema(128), ...pageProperties }, true],
  ['queue.request', 'queue', 'Read the retained receipt for one AI request, including jobs removed from the visible queue.', { requestId: stringSchema(128) }, true, ['requestId']],
  ['queue.start_archive', 'queue', 'Choose archive mode and start eligible jobs.', {}, false],
  ['queue.start_inventory', 'queue', 'Choose inventory-only mode and start eligible jobs.', {}, false],
  ['queue.pause', 'queue', 'Pause the current safe processing stage.', {}, false],
  ['queue.resume', 'queue', 'Resume the paused task.', {}, false],
  ['queue.finish_next', 'queue', 'Finish one task and pause before another starts.', {}, false],
  ['queue.confirm', 'queue', 'Confirm one current large/duplicate queue decision after the user chooses to continue.', { jobId: stringSchema(128), decisionToken: stringSchema(128) }, false, ['jobId', 'decisionToken']],
  ['queue.confirm_all_duplicates', 'queue', 'Confirm all current duplicate-review jobs.', {}, false],
  ['queue.confirm_anomaly', 'queue', 'Accept and record an archive whose verified size is anomalous after desktop review.', { jobId: stringSchema(128), decisionToken: stringSchema(128) }, false, ['jobId', 'decisionToken']],
  ['queue.discard_anomaly', 'queue', 'Move anomalous generated archives to the recycle bin; sources stay.', { jobId: stringSchema(128), decisionToken: stringSchema(128) }, false, ['jobId', 'decisionToken']],
  ['queue.acknowledge_trash_safety', 'queue', 'Acknowledge a recycle-bin safety stop without re-enabling trash.', { referenceId: stringSchema(128) }, false, ['referenceId']],
  ['queue.cancel', 'queue', 'Safely skip or cancel one job in its current state.', { jobId: stringSchema(128), decisionToken: stringSchema(128) }, false, ['jobId', 'decisionToken']],
  ['queue.retry', 'queue', 'Retry one current failed or cancelled job.', { jobId: stringSchema(128), decisionToken: stringSchema(128) }, false, ['jobId', 'decisionToken']],
  ['queue.remove', 'queue', 'Remove queue rows without deleting catalog records, archives, or sources.', { jobIds: idListSchema }, false, ['jobIds']],
  ['queue.clear', 'queue', 'Cancel processing and clear removable queue rows; protected safety rows remain.', {}, false],
  ['queue.clear_completed', 'queue', 'Clear completed queue rows only.', {}, false],
  ['queue.clear_cancelled', 'queue', 'Clear cancelled queue rows only.', {}, false],
  ['queue.clear_duplicates', 'queue', 'Remove non-running potential duplicate queue rows.', {}, false],
  ['queue.clear_exact_duplicates', 'queue', 'Remove non-running exact duplicate queue rows.', {}, false],
  ['catalog.search', 'catalog', 'Search catalog metadata with filters and pagination.', { query: { type: 'string', maxLength: 512 }, tag: { type: 'string', maxLength: 200 }, backupLocation: { type: 'string', maxLength: 200 }, rating: { type: 'integer', minimum: 0, maximum: 5 }, sort: { type: 'string', enum: ['inventory_desc', 'inventory_asc', 'name_asc', 'name_desc'] }, ...pageProperties }, true],
  ['catalog.suggestions', 'catalog', 'Get title suggestions.', { query: stringSchema(512), limit: { type: 'integer', minimum: 1, maximum: 20 } }, true, ['query']],
  ['catalog.insights', 'catalog', 'Read compact warehouse counts and bytes. Set includeActivity only when non-empty daily activity is needed.', { includeActivity: { type: 'boolean' } }, true],
  ['catalog.random', 'catalog', 'Read a random catalog summary.', { excludeId: stringSchema(128) }, true],
  ['catalog.details', 'catalog', 'Read full metadata and a paginated manifest, with passwords redacted.', { recordId: stringSchema(128), ...pageProperties }, true, ['recordId']],
  ['catalog.update_metadata', 'catalog', 'Update only supplied title, tags, rating, notes, backup location or recorded password metadata.', { recordId: stringSchema(128), metadata: objectSchema(catalogMetadataProperties) }, false, ['recordId', 'metadata']],
  ['catalog.recalculate_similarity', 'catalog', 'Recalculate similarity for one record.', { recordId: stringSchema(128) }, false, ['recordId']],
  ['catalog.remove_similarity', 'catalog', 'Dismiss a similarity relationship in both directions.', { recordId: stringSchema(128), similarId: stringSchema(128) }, false, ['recordId', 'similarId']],
  ['catalog.set_cover', 'catalog', 'Set an existing thumbnail as cover.', { recordId: stringSchema(128), thumbnailRef: stringSchema() }, false, ['recordId', 'thumbnailRef']],
  ['catalog.delete_thumbnail', 'catalog', 'Move one thumbnail into the warehouse thumbnail trash; undo is available.', { recordId: stringSchema(128), thumbnailRef: stringSchema() }, false, ['recordId', 'thumbnailRef']],
  ['catalog.add_manual', 'catalog', 'Add a manual inventory record.', { title: stringSchema(200), notes: stringSchema(5000), tags: { type: 'array', maxItems: 30, items: stringSchema(30) }, sourcePath: { type: 'string', maxLength: 2000 }, backupLocation: { type: 'string', maxLength: 200 } }, false, ['title', 'notes']],
  ['catalog.add_image', 'catalog', 'Add an image using the product image storage service.', { recordId: stringSchema(128), image: { type: 'object', additionalProperties: true } }, false, ['recordId', 'image']],
  ['catalog.add_tags', 'catalog', 'Append tags to selected records.', { recordIds: idListSchema, tags: { type: 'array', minItems: 1, maxItems: 30, items: stringSchema(30) } }, false, ['recordIds', 'tags']],
  ['catalog.update_backup_location', 'catalog', 'Set backup location on selected records.', { recordIds: idListSchema, location: stringSchema(200) }, false, ['recordIds', 'location']],
  ['catalog.queue_compression', 'catalog', 'Queue selected uncompressed records for compression.', { recordIds: idListSchema }, false, ['recordIds']],
  ['catalog.restore_source', 'catalog', 'Restore a moved/recycled original to its recorded source path.', { recordId: stringSchema(128) }, false, ['recordId']],
  ['catalog.delete', 'catalog', 'Delete catalog records and recycle owned archives; never permanently deletes files.', { recordIds: idListSchema, restoreOriginalSources: { type: 'boolean' } }, false, ['recordIds']],
  ['catalog.undo', 'catalog', 'Undo the latest supported catalog edit.', {}, false],
  ['similarity.terms', 'similarity', 'Read current similarity ignore terms.', pageProperties, true],
  ['similarity.add_term', 'similarity', 'Add one similarity ignore term through the real terms file service.', { term: stringSchema(200) }, false, ['term']],
  ['similarity.reload', 'similarity', 'Reload ignore terms and optionally rebuild all relations.', { rebuild: { type: 'boolean' } }, false],
  ['similarity.rebuild', 'similarity', 'Rebuild similarity relations for the whole catalog.', {}, false],
  ['warehouse.change_directory', 'warehouse', 'Copy to an empty directory or activate an existing warehouse.', { targetDirectory: stringSchema() }, false, ['targetDirectory']],
  ['warehouse.export', 'warehouse', 'Export the active warehouse database and thumbnails to a ZIP.', { targetFile: stringSchema(), overwrite: { type: 'boolean' } }, false, ['targetFile']],
  ['warehouse.import', 'warehouse', 'Merge records and thumbnails from a warehouse directory or ZIP.', { sourcePath: stringSchema() }, false, ['sourcePath']],
  ['app.show_ui', 'app', 'Show the desktop application at an optional section.', { section: { type: 'string', enum: ['workbench', 'catalog', 'settings'] } }, false],
  ['app.set_view', 'app', 'Switch the desktop view.', { section: { type: 'string', enum: ['workbench', 'catalog', 'settings'] } }, false, ['section']],
  ['app.set_theme', 'app', 'Set the desktop theme.', { theme: { type: 'string', enum: THEME_VALUES } }, false, ['theme']],
  ['app.copy_text', 'app', 'Copy explicit text to the clipboard.', { text: { type: 'string', maxLength: 10000 } }, false, ['text']],
  ['path.open', 'app', 'Open a product-owned location selected by kind and optional record/job id.', { kind: { type: 'string', enum: ['warehouse', 'source', 'catalog_source', 'similarity_terms'] }, id: stringSchema(128) }, false, ['kind']],
  ['update.check', 'update', 'Check for application updates.', { mode: { type: 'string', enum: ['manual', 'automatic'] } }, true, ['mode']],
  ['update.install', 'update', 'Install the previously checked update version using the product updater.', { version: stringSchema(64) }, false, ['version']],
  ['update.install_package', 'update', 'Validate and install an update package from an absolute path.', { packagePath: stringSchema() }, false, ['packagePath']],
  ['user_data.preflight_move', 'user_data', 'Inspect a user-data relocation without writing.', { targetDirectory: stringSchema() }, true, ['targetDirectory']],
  ['user_data.move', 'user_data', 'Schedule or perform a validated user-data relocation with app-exit safeguards.', { targetDirectory: stringSchema() }, false, ['targetDirectory']]
].map(([name, domain, description, properties, readOnly, required = []]) => {
  const conditional = ['settings.patch', 'settings.intake_preferences', 'intake.add_batch', 'similarity.reload'];
  const confirmation = ['catalog.delete', 'catalog.restore_source', 'queue.confirm', 'queue.confirm_all_duplicates', 'queue.confirm_anomaly', 'queue.discard_anomaly', 'queue.acknowledge_trash_safety', 'warehouse.change_directory', 'warehouse.export', 'warehouse.import', 'update.install', 'update.install_package', 'user_data.move', 'similarity.rebuild', 'queue.clear', 'catalog.delete_thumbnail'];
  return {
    name, domain, description, readOnly, inputSchema: objectSchema(properties, required),
    risk: conditional.includes(name) ? 'conditional' : confirmation.includes(name) ? 'confirmation' : 'none'
  };
});

const capabilityMap = new Map(capabilities.map((entry) => [entry.name, entry]));

function createCapabilityService(manager, services = {}) {
  const confirmations = new Map();
  const unavailableService = {
    'app.show_ui': 'app.showUi', 'app.set_view': 'app.setView', 'app.set_theme': 'app.setTheme',
    'app.copy_text': 'app.copyText', 'path.open': 'paths.open', 'update.check': 'updates.check',
    'update.install': 'updates.install', 'update.install_package': 'updates.installPackage',
    'user_data.preflight_move': 'userData.preflightMove', 'user_data.move': 'userData.move'
  };

  const availability = (entry) => {
    const requiredService = unavailableService[entry.name];
    if (requiredService && typeof serviceAt(services, requiredService) !== 'function') {
      return { available: false, reason: `Runtime service ${requiredService} is not installed.` };
    }
    if (entry.name === 'catalog.add_image' && typeof manager.services?.storeCatalogImage !== 'function') {
      return { available: false, reason: 'Product image storage service is not installed.' };
    }
    if (entry.name === 'intake.add_batch') {
      const preferences = intakePreferences(manager);
      return {
        available: true,
        modeRequirements: {
          inventory_only: [],
          archive: preferences.configured ? [] : preferences.missingPreferences
        }
      };
    }
    return { available: true };
  };

  async function impactFor(name, input) {
    if (name === 'settings.intake_preferences') {
      if (input.sourceDisposition === 'keep') return null;
      return { target: input.sourceDisposition === 'move' ? input.processedSourceDirectory : 'Windows recycle bin', impact: `After successful archive verification, each AI-created source will be ${input.sourceDisposition === 'move' ? 'moved' : 'recycled'}.`, recovery: input.sourceDisposition === 'move' ? 'Catalog source restore can move it back if the original path is free.' : 'Catalog source restore can ask Windows to restore the recycle-bin item.' };
    }
    if (name === 'intake.add_batch' && input.mode === 'archive' && input.sourceDisposition && input.sourceDisposition !== 'keep') {
      return { target: input.paths, impact: `After verified archive completion, sources will be ${input.sourceDisposition === 'move' ? 'moved' : 'sent to the recycle bin'}.`, recovery: 'Use catalog.restore_source while the destination/original path remains recoverable.' };
    }
    if (name === 'settings.patch') {
      const keys = Object.keys(input.patch || {});
      if (!keys.some((key) => ['archiveOutputDirectory', 'archiveStagingDirectory', 'repositoryDirectory', 'moveCompleted', 'autoTrashCompleted', 'processedSourceDirectory', 'archivePassword'].includes(key))) return null;
      return { target: keys, impact: 'Changes future archive destinations, source handling, or archive password.', recovery: 'Apply another validated settings patch before starting new work.' };
    }
    if (name === 'queue.confirm') {
      const job = (manager.jobs || []).find((candidate) => candidate.id === input.jobId);
      return { target: jobSummary(job || { id: input.jobId }), impact: 'Continues this task after the user accepts its current large-item or duplicate evidence.', recovery: 'The task can be safely cancelled while it remains pending or at a cancellable stage.' };
    }
    if (name === 'queue.confirm_all_duplicates') {
      const jobs = (manager.jobs || []).filter((job) => ['awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status));
      return { target: jobs.slice(0, 20).map(jobSummary), impact: `Continues ${jobs.length} currently waiting duplicate-review tasks.`, recovery: 'Cancel individual tasks that should not continue before confirming again.' };
    }
    if (name === 'queue.confirm_anomaly') {
      return { target: input.jobId, impact: 'Accepts a verified archive-size anomaly, writes its catalog record, and may apply the saved source disposition.', recovery: 'Review the generated archive and source state in the desktop application before confirming.' };
    }
    if (name === 'queue.acknowledge_trash_safety') {
      return { target: input.referenceId, impact: 'Acknowledges the current recycle-bin safety stop; automatic recycling stays disabled and the queue stays stopped.', recovery: 'Inspect the source and recycle bin before manually starting more work.' };
    }
    if (name === 'catalog.delete') {
      const records = (manager.catalog || []).filter((record) => input.recordIds.includes(record.id));
      return { target: records.map((record) => ({ id: record.id, title: record.title, archiveFiles: record.archiveFiles?.length || 0, sourceDisposition: record.sourceDisposition })), impact: 'Removes catalog records and sends product-owned archive files to the Windows recycle bin. Permanent deletion is never used.', recovery: input.restoreOriginalSources ? 'Moved/recycled originals are restored first where possible; recycle-bin archives may be restored manually.' : 'Archives may be restored manually from the recycle bin; catalog records are not undoable.' };
    }
    if (name === 'catalog.restore_source') {
      const record = (manager.catalog || []).find((item) => item.id === input.recordId);
      return { target: record ? { id: record.id, originalSourcePath: record.originalSourcePath, movedTo: record.movedTo, disposition: record.sourceDisposition } : input.recordId, impact: 'Writes the original source path by moving back the saved source or restoring it from the recycle bin.', recovery: 'The operation refuses to overwrite an occupied original path.' };
    }
    if (name === 'warehouse.change_directory') return { target: path.resolve(input.targetDirectory), impact: `Copies the current warehouse if the target is empty, or activates the target's existing warehouse. Current: ${manager.config.repositoryDirectory}`, recovery: 'The previous warehouse is retained and can be selected again.' };
    if (name === 'warehouse.export') {
      let exists = false;
      try { await fs.access(path.resolve(input.targetFile)); exists = true; } catch {}
      if (exists && input.overwrite !== true) throw new Error('TARGET_EXISTS: set overwrite=true to request a replacement preflight');
      return { target: path.resolve(input.targetFile), impact: exists ? 'Replaces the existing ZIP after a fresh export is prepared.' : 'Creates a new warehouse ZIP.', recovery: exists ? 'Keep another copy if the previous ZIP is needed.' : 'Delete or recycle the generated ZIP.' };
    }
    if (name === 'warehouse.import') return { target: path.resolve(input.sourcePath), impact: 'Merges new record IDs and thumbnails into the active warehouse; matching IDs are skipped. The source is retained.', recovery: 'Imported catalog edits can be reviewed; restore the prior warehouse backup for a whole-database rollback.' };
    if (name === 'similarity.rebuild') return { target: `${manager.catalog?.length || 0} catalog records`, impact: 'Recomputes and persists all similarity relations and may take significant time.', recovery: 'Run again after changing similarity settings or ignore terms.' };
    if (name === 'similarity.reload' && input.rebuild === true) return { target: `${manager.catalog?.length || 0} catalog records`, impact: 'Reloads ignore terms and recomputes all persisted similarity relations.', recovery: 'Run another explicit rebuild after correcting the terms.' };
    if (name === 'queue.clear') return { target: `${manager.jobs?.length || 0} queue rows`, impact: 'Safely cancels active work and clears removable queue rows; catalog, archives, sources and protected safety rows remain.', recovery: 'Sources can be scanned or added again.' };
    if (name === 'queue.discard_anomaly') return { target: input.jobId, impact: 'Moves the generated anomalous archive and its task thumbnails to the Windows recycle bin; source stays.', recovery: 'Restore the generated files manually from the recycle bin or retry the source.' };
    if (name === 'catalog.delete_thumbnail') return { target: { recordId: input.recordId, thumbnailRef: input.thumbnailRef }, impact: 'Moves the thumbnail into warehouse-local trash and updates cover selection.', recovery: 'catalog.undo can restore the latest deletion.' };
    if (name.startsWith('update.install')) return { target: input.version || path.resolve(input.packagePath), impact: 'Validates and starts product update installation, which may close and replace the application.', recovery: 'Use the product updater/previous installer if rollback is required.' };
    if (name === 'user_data.move') {
      const inspect = serviceAt(services, 'userData.preflightMove');
      return inspect(input);
    }
    return capabilityMap.get(name)?.risk === 'confirmation'
      ? { target: input, impact: 'Executes the described state-changing product action.', recovery: 'Review product state and use the corresponding undo or restore operation when available.' }
      : null;
  }

  function issueConfirmation(name, input, impact) {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    confirmations.set(token, { name, input: JSON.stringify(stable(input)), fingerprint: managerFingerprint(manager), expiresAt });
    return { requiresConfirmation: true, confirmation: { token, expiresAt, capability: name, ...impact } };
  }

  function consumeConfirmation(token, name, input) {
    const saved = confirmations.get(token);
    confirmations.delete(token);
    if (!saved || saved.name !== name || saved.input !== JSON.stringify(stable(input))) throw new Error('INVALID_CONFIRMATION: request a fresh preflight');
    if (Date.parse(saved.expiresAt) < Date.now()) throw new Error('EXPIRED_CONFIRMATION: request a fresh preflight');
    if (saved.fingerprint !== managerFingerprint(manager)) throw new Error('STALE_CONFIRMATION: product state changed; request a fresh preflight');
  }

  async function execute(name, input) {
    if (name === 'settings.get') return { settings: publicSettings(manager.config), intakePreferences: intakePreferences(manager) };
    if (name === 'settings.patch') {
      const patch = { ...(input.patch || {}) };
      for (const key of Object.keys(patch)) if (!settingsPatchKeys.has(key)) throw new Error(`Setting ${key} cannot be written through MCP`);
      const preferenceKeys = ['archiveOutputDirectory', 'moveCompleted', 'autoTrashCompleted', 'processedSourceDirectory'];
      const state = await manager.updateConfig({ ...manager.config, ...patch }, { source: 'mcp', recordIntakePreferences: preferenceKeys.some((key) => Object.hasOwn(patch, key)) });
      return { settings: publicSettingsPatch(state.config, Object.keys(patch)) };
    }
    if (name === 'settings.intake_preferences') {
      const patch = sourceDispositionPatch(input);
      await manager.updateConfig({ ...manager.config, ...patch }, { source: 'mcp', recordIntakePreferences: true });
      return { intakePreferences: intakePreferences(manager), settings: publicSettings(manager.config) };
    }
    if (name === 'intake.plan') {
      const preferences = intakePreferences(manager);
      const targets = [];
      for (const raw of input.paths) {
        if (!path.isAbsolute(raw) || raw.includes('\0')) throw new Error('Each source must be an absolute local path');
        const source = path.normalize(raw);
        let stats;
        try { stats = await fs.stat(source); }
        catch (error) { targets.push({ source, exists: false, errorCode: error.code || 'SOURCE_UNAVAILABLE' }); continue; }
        const conflicts = [
          ['warehouse', manager.config?.repositoryDirectory],
          ['archive_output', input.mode === 'archive' ? (preferences.archiveOutputDirectory || manager.config?.archiveOutputDirectory) : ''],
          ['archive_staging', input.mode === 'archive' ? manager.config?.archiveStagingDirectory : '']
        ].filter(([, target]) => target && pathsOverlap(source, target)).map(([kind]) => kind);
        const type = stats.isDirectory() ? 'directory' : stats.isFile() && isVideoFile(source) ? 'video' : 'unsupported';
        targets.push({ source, exists: true, type, conflicts });
      }
      return {
        ready: targets.every((target) => target.exists && target.type !== 'unsupported' && target.conflicts.length === 0) &&
          (input.mode === 'inventory_only' || preferences.configured),
        mode: input.mode,
        targets,
        ...(input.mode === 'archive' && !preferences.configured ? { missingPreferences: preferences.missingPreferences } : {}),
        sourceDisposition: input.mode === 'inventory_only' ? 'keep' : preferences.sourceDisposition,
        sideEffects: 'none'
      };
    }
    if (name === 'intake.scan') return compactState(await manager.scanSource(path.resolve(input.directory), input.scanToken || 'mcp'));
    if (name === 'intake.add_batch') {
      if (manager.running) throw new Error('QUEUE_RUNNING: wait until the queue is idle before adding an AI batch');
      if ((manager.jobs || []).some((job) => !job.mcpRequestId && job.intakeModeSelected && job.status === 'queued')) {
        throw new Error('UNRELATED_QUEUE_WORK: finish or pause selected desktop jobs before AI intake');
      }
      let preferences = input.mode === 'inventory_only'
        ? { configured: true, archiveOutputDirectory: '', sourceDisposition: 'keep', processedSourceDirectory: '', evidence: 'inventory_only' }
        : intakePreferences(manager);
      let preferencePatch = null;
      if (input.mode === 'archive' && (input.archiveOutputDirectory || input.sourceDisposition || input.processedSourceDirectory)) {
        preferencePatch = sourceDispositionPatch(input);
        preferences = {
          configured: true,
          evidence: 'request',
          archiveOutputDirectory: preferencePatch.archiveOutputDirectory,
          sourceDisposition: input.sourceDisposition,
          processedSourceDirectory: preferencePatch.processedSourceDirectory
        };
      }
      if (!preferences.configured) return preferences;
      const normalizedPaths = [...new Set(input.paths.map((entry) => {
        if (!path.isAbsolute(entry) || entry.includes('\0')) throw new Error('Each source must be an absolute local path');
        return path.normalize(entry);
      }))];
      const fingerprint = intakeRequestFingerprint({
        mode: input.mode,
        paths: normalizedPaths.map(normalizeForComparison).sort((left, right) => left.localeCompare(right, 'en-US')),
        archiveOutputDirectory: preferences.archiveOutputDirectory ? normalizeForComparison(preferences.archiveOutputDirectory) : '',
        sourceDisposition: input.mode === 'inventory_only' ? 'keep' : preferences.sourceDisposition,
        processedSourceDirectory: preferences.processedSourceDirectory ? normalizeForComparison(preferences.processedSourceDirectory) : ''
      });
      const retained = manager.findAutomationRequest?.(input.requestId);
      if (retained && retained.fingerprint !== fingerprint) throw new Error('REQUEST_ID_CONFLICT');
      const previous = manager.jobs.filter((job) => job.mcpRequestId === input.requestId);
      const normalizedPathKeys = new Set(normalizedPaths.map(normalizeForComparison));
      if (previous.some((job) => job.processingMode !== input.mode || !normalizedPathKeys.has(normalizeForComparison(job.sourcePath)))) throw new Error('REQUEST_ID_CONFLICT');
      const retainedPaths = new Set((retained?.jobs || []).map((job) => normalizeForComparison(job.sourcePath)));
      if (preferencePatch) {
        await manager.updateConfig({ ...manager.config, ...preferencePatch }, { source: 'mcp', recordIntakePreferences: true });
        preferences = intakePreferences(manager);
      }
      const failures = [];
      for (const source of normalizedPaths.filter((entry) => !previous.some((job) => normalizeForComparison(job.sourcePath) === normalizeForComparison(entry)) && !retainedPaths.has(normalizeForComparison(entry)))) {
        try {
          await manager.addSingle(source, { requestId: input.requestId, mode: input.mode, sourceDisposition: preferences.sourceDisposition, processedSourceDirectory: preferences.processedSourceDirectory });
        } catch (error) { failures.push({ source, code: error.code || 'INTAKE_FAILED', message: error.message }); }
      }
      const jobs = manager.jobs.filter((job) => job.mcpRequestId === input.requestId);
      const receipt = await manager.recordAutomationRequest?.({ requestId: input.requestId, fingerprint, mode: input.mode, paths: normalizedPaths, jobs, failures });
      if (input.start !== false && jobs.length && !manager.running) void manager.startQueue(jobs.map((job) => job.id)).catch((error) => manager.emit('automation-error', error));
      const visibleJobs = jobs.length ? jobs.map(jobSummary) : (receipt?.jobs || retained?.jobs || []);
      return { jobs: visibleJobs, failures, reused: failures.length === 0 && (retainedPaths.size > 0 || jobs.length === previous.length), retained: Boolean(retained && jobs.length === 0) };
    }
    if (name === 'queue.state') {
      const jobs = (manager.jobs || []).filter((job) =>
        (!input.requestId || job.mcpRequestId === input.requestId) && (!input.jobId || job.id === input.jobId));
      return { ...compactState(manager), ...page(jobs.map(jobSummary), input) };
    }
    if (name === 'queue.request') {
      const retained = manager.findAutomationRequest?.(input.requestId);
      if (!retained) throw new Error('REQUEST_NOT_FOUND');
      return redact(retained);
    }
    if (['queue.confirm', 'queue.confirm_anomaly', 'queue.discard_anomaly', 'queue.cancel', 'queue.retry'].includes(name)) {
      const job = manager.findJob(input.jobId);
      if (decisionToken(job) !== input.decisionToken) throw new Error('STALE_DECISION: read queue.state again');
    }
    const direct = {
      'queue.start_archive': () => manager.startArchiveQueue(), 'queue.start_inventory': () => manager.startInventoryOnlyQueue(),
      'queue.pause': () => manager.pauseCurrent(), 'queue.resume': () => manager.resumeCurrent(), 'queue.finish_next': () => manager.finishNextAndPause(),
      'queue.confirm': () => manager.confirmJob(input.jobId), 'queue.confirm_all_duplicates': () => manager.confirmAllDuplicateJobs(),
      'queue.confirm_anomaly': () => manager.confirmAnomaly(input.jobId), 'queue.discard_anomaly': () => manager.discardAnomalousArchive(input.jobId),
      'queue.acknowledge_trash_safety': () => manager.acknowledgeTrashSafetyHalt(input.referenceId), 'queue.cancel': () => manager.cancelJob(input.jobId),
      'queue.retry': () => manager.retryJob(input.jobId), 'queue.remove': () => manager.removeJobs(input.jobIds), 'queue.clear': () => manager.clearQueue(),
      'queue.clear_completed': () => manager.clearCompletedJobs(), 'queue.clear_cancelled': () => manager.clearCancelledJobs(),
      'queue.clear_duplicates': () => manager.removePotentialDuplicateJobs(), 'queue.clear_exact_duplicates': () => manager.removeExactDuplicateJobs(),
      'catalog.update_metadata': () => manager.updateCatalogMetadata(input.recordId, input.metadata),
      'catalog.recalculate_similarity': () => manager.recalculateCatalogSimilarity(input.recordId),
      'catalog.remove_similarity': () => manager.removeCatalogSimilarity(input.recordId, input.similarId),
      'catalog.set_cover': () => manager.setCatalogCover(input.recordId, input.thumbnailRef),
      'catalog.delete_thumbnail': () => manager.deleteCatalogThumbnail(input.recordId, input.thumbnailRef),
      'catalog.add_manual': () => manager.addManualCatalogRecord(input), 'catalog.add_image': () => manager.addCatalogImage(input.recordId, input.image),
      'catalog.add_tags': () => manager.addTagsToCatalogRecords(input.recordIds, input.tags),
      'catalog.update_backup_location': () => manager.updateBackupLocationForCatalogRecords(input.recordIds, input.location),
      'catalog.queue_compression': () => manager.queueCatalogRecordsForCompression(input.recordIds),
      'catalog.restore_source': () => manager.restoreCatalogSource(input.recordId),
      'catalog.delete': () => manager.deleteCatalogRecords(input.recordIds, { restoreOriginalSources: input.restoreOriginalSources === true }),
      'catalog.undo': () => manager.undoCatalogAction(), 'similarity.add_term': () => manager.addSimilarityIgnoreTerm(input.term),
      'similarity.reload': () => manager.reloadSimilarityIgnoreTerms({ rebuild: input.rebuild === true }),
      'similarity.rebuild': () => manager.rebuildAllSimilarityRelations(),
    };
    if (direct[name]) {
      const result = await direct[name]();
      if (name.startsWith('queue.')) {
        const job = input.jobId ? (manager.jobs || []).find((candidate) => candidate.id === input.jobId) : null;
        return { ...queueSummary(manager), ...(job ? { job: jobSummary(job) } : {}), ...(Number.isInteger(result?.removedCount) ? { removedCount: result.removedCount } : {}) };
      }
      if (name.startsWith('catalog.')) {
        const recordIds = input.recordIds || (input.recordId ? [input.recordId] : result?.id ? [result.id] : []);
        return { records: recordIds.map((id) => catalogSummary((manager.catalog || []).find((record) => record.id === id))).filter(Boolean), totalRecords: manager.catalog?.length || 0 };
      }
      if (name.startsWith('similarity.')) {
        return { path: result?.path || '', count: Number(result?.count) || manager.similarityIgnoreTerms?.length || 0, totalRecords: manager.catalog?.length || 0 };
      }
      return redact(result);
    }
    if (name === 'catalog.search') return page(manager.searchCatalog(input).map(redact), input);
    if (name === 'catalog.suggestions') return manager.getCatalogSuggestions(input.query, input.limit);
    if (name === 'catalog.insights') {
      const { activity = [], ...summary } = manager.getWarehouseInsights();
      if (input.includeActivity !== true) return summary;
      return {
        ...summary,
        activity: activity.filter((entry) => Number(entry.inventoryCount) > 0 || Number(entry.originalBytes) > 0)
      };
    }
    if (name === 'catalog.random') return redact(manager.getRandomCatalogRecord(input.excludeId));
    if (name === 'catalog.details') {
      const details = sanitizeCatalogDetails(manager.getCatalogDetails(input.recordId));
      const manifest = details.manifest || [];
      delete details.manifest;
      return { ...details, manifest: page(manifest, input) };
    }
    if (name === 'similarity.terms') return page([...(manager.similarityIgnoreTerms || [])], input);
    if (name === 'warehouse.change_directory') {
      const result = await manager.changeWarehouseDirectory(path.resolve(input.targetDirectory));
      return { copied: result.copied, previousDirectory: result.previous, warehouseDirectory: manager.config.repositoryDirectory, totalRecords: manager.catalog?.length || 0 };
    }
    if (name === 'warehouse.export') {
      const result = await manager.exportWarehouseToFile(path.resolve(input.targetFile));
      return { path: result.path, totalRecords: manager.catalog?.length || 0 };
    }
    if (name === 'warehouse.import') {
      const result = await manager.importWarehouseFromArchiveOrDirectory(path.resolve(input.sourcePath));
      return { importedCount: result.importedCount, skippedCount: result.skippedCount, warehouseDirectory: manager.config.repositoryDirectory, totalRecords: manager.catalog?.length || 0 };
    }
    const serviceName = unavailableService[name];
    if (serviceName) {
      const handler = serviceAt(services, serviceName);
      if (typeof handler !== 'function') throw new Error(`CAPABILITY_UNAVAILABLE: runtime service ${serviceName} is not installed`);
      if (name === 'user_data.move') {
        const preflight = await serviceAt(services, 'userData.preflightMove')(input);
        return redact(await handler({ ...input, expectedStateFingerprint: preflight.stateFingerprint }));
      }
      return redact(await handler(input));
    }
    throw new Error('CAPABILITY_NOT_IMPLEMENTED');
  }

  return {
    capabilities,
    discover(input = {}) {
      const needle = String(input.query || '').trim().toLowerCase();
      const items = capabilities.filter((entry) => (!input.domain || entry.domain === input.domain) &&
        (!needle || `${entry.name} ${entry.description} ${capabilitySearchTerms[entry.name] || ''}`.toLowerCase().includes(needle)))
        .map((entry) => ({ name: entry.name, domain: entry.domain, description: entry.description, readOnly: entry.readOnly, risk: entry.risk, ...availability(entry) }));
      return page(items, input);
    },
    describe(name) {
      const entry = capabilityMap.get(name);
      if (!entry) throw new Error('UNKNOWN_CAPABILITY');
      return { ...entry, ...availability(entry) };
    },
    async call(name, input = {}, confirmationToken = '') {
      const entry = capabilityMap.get(name);
      if (!entry) throw new Error('UNKNOWN_CAPABILITY');
      const status = availability(entry);
      if (!status.available) throw new Error(`CAPABILITY_UNAVAILABLE: ${status.reason}`);
      const impact = await impactFor(name, input);
      if (impact) {
        if (!confirmationToken) return issueConfirmation(name, input, impact);
        consumeConfirmation(confirmationToken, name, input);
      } else if (confirmationToken) throw new Error('UNEXPECTED_CONFIRMATION');
      return execute(name, input);
    }
  };
}

module.exports = { capabilities, createCapabilityService, decisionToken, intakePreferences, jobSummary, publicSettings, queueSummary, redact };
