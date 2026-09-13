'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_PAGE = 100;
const SOURCE_DISPOSITIONS = ['keep', 'trash', 'move'];
const THEME_VALUES = ['classic', 'day', 'night', 'forest', 'twilight'];

const objectSchema = (properties = {}, required = [], additionalProperties = false) => ({
  type: 'object', properties, required, additionalProperties
});
const stringSchema = (maxLength = 4096) => ({ type: 'string', minLength: 1, maxLength });
const idListSchema = { type: 'array', minItems: 1, maxItems: 100, items: stringSchema(128) };
const pageProperties = {
  offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE }
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
      continue;
    }
    if (/token|secret/i.test(key)) continue;
    result[key] = redact(entry);
  }
  return result;
}

function compactState(manager) {
  return redact({
    running: manager.running,
    paused: manager.paused,
    scheduleWaiting: manager.scheduleWaiting,
    safetyHalt: manager.safetyHalt,
    undoDepth: manager.undoStack?.length || 0,
    jobs: (manager.jobs || []).map((job) => ({
      id: job.id, requestId: job.mcpRequestId, displayName: job.displayName, status: job.status,
      progress: job.progress, stageText: job.stageText, errorCode: job.errorCode,
      errorMessage: job.errorMessage, sourcePath: job.sourcePath, processingMode: job.processingMode
    }))
  });
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
    if (hidden.has(key) || /password/i.test(key) || /token|secret/i.test(key)) continue;
    settings[key] = redact(value);
  }
  settings.passwordConfigured = Boolean(config?.archivePassword);
  return settings;
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
    repositoryDirectory: manager.config?.repositoryDirectory,
    archiveOutputDirectory: manager.config?.archiveOutputDirectory,
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
  ['settings.patch', 'settings', 'Update a partial set of validated settings. Password text is accepted but never returned.', { patch: { type: 'object', additionalProperties: true } }, false, ['patch']],
  ['settings.intake_preferences', 'settings', 'Save the archive output and keep/trash/move preference used by future AI intake.', {
    archiveOutputDirectory: stringSchema(), sourceDisposition: { type: 'string', enum: SOURCE_DISPOSITIONS }, processedSourceDirectory: stringSchema()
  }, false, ['archiveOutputDirectory', 'sourceDisposition']],
  ['intake.scan', 'intake', 'Scan an intake directory through the real product scanner.', { directory: stringSchema(), scanToken: { type: 'string', maxLength: 128 } }, false, ['directory']],
  ['intake.add_batch', 'intake', 'Add up to 100 folders or videos and optionally start their selected mode.', {
    requestId: stringSchema(128), paths: { type: 'array', minItems: 1, maxItems: 100, items: stringSchema() },
    mode: { type: 'string', enum: ['archive', 'inventory_only'] }, start: { type: 'boolean' },
    archiveOutputDirectory: stringSchema(), sourceDisposition: { type: 'string', enum: SOURCE_DISPOSITIONS }, processedSourceDirectory: stringSchema()
  }, false, ['requestId', 'paths', 'mode']],
  ['queue.state', 'queue', 'Read compact queue state and job progress.', pageProperties, true],
  ['queue.start_archive', 'queue', 'Choose archive mode and start eligible jobs.', {}, false],
  ['queue.start_inventory', 'queue', 'Choose inventory-only mode and start eligible jobs.', {}, false],
  ['queue.pause', 'queue', 'Pause the current safe processing stage.', {}, false],
  ['queue.resume', 'queue', 'Resume the paused task.', {}, false],
  ['queue.finish_next', 'queue', 'Finish one task and pause before another starts.', {}, false],
  ['queue.confirm', 'queue', 'Confirm one large/duplicate queue decision after reading evidence.', { jobId: stringSchema(128) }, false, ['jobId']],
  ['queue.confirm_all_duplicates', 'queue', 'Confirm all current duplicate-review jobs.', {}, false],
  ['queue.confirm_anomaly', 'queue', 'Accept and record an archive whose verified size is anomalous.', { jobId: stringSchema(128) }, false, ['jobId']],
  ['queue.discard_anomaly', 'queue', 'Move anomalous generated archives to the recycle bin; sources stay.', { jobId: stringSchema(128) }, false, ['jobId']],
  ['queue.acknowledge_trash_safety', 'queue', 'Acknowledge a recycle-bin safety stop without re-enabling trash.', { referenceId: stringSchema(128) }, false, ['referenceId']],
  ['queue.cancel', 'queue', 'Safely cancel one job.', { jobId: stringSchema(128) }, false, ['jobId']],
  ['queue.retry', 'queue', 'Retry one failed or cancelled job.', { jobId: stringSchema(128) }, false, ['jobId']],
  ['queue.remove', 'queue', 'Remove queue rows without deleting catalog records, archives, or sources.', { jobIds: idListSchema }, false, ['jobIds']],
  ['queue.clear', 'queue', 'Cancel processing and clear removable queue rows; protected safety rows remain.', {}, false],
  ['queue.clear_completed', 'queue', 'Clear completed queue rows only.', {}, false],
  ['queue.clear_cancelled', 'queue', 'Clear cancelled queue rows only.', {}, false],
  ['queue.clear_duplicates', 'queue', 'Remove non-running potential duplicate queue rows.', {}, false],
  ['queue.clear_exact_duplicates', 'queue', 'Remove non-running exact duplicate queue rows.', {}, false],
  ['catalog.search', 'catalog', 'Search catalog metadata with filters and pagination.', { query: { type: 'string', maxLength: 512 }, tag: { type: 'string', maxLength: 200 }, backupLocation: { type: 'string', maxLength: 200 }, rating: { type: 'integer', minimum: 0, maximum: 5 }, sort: { type: 'string', enum: ['inventory_desc', 'inventory_asc', 'name_asc', 'name_desc'] }, ...pageProperties }, true],
  ['catalog.suggestions', 'catalog', 'Get title suggestions.', { query: stringSchema(512), limit: { type: 'integer', minimum: 1, maximum: 20 } }, true, ['query']],
  ['catalog.insights', 'catalog', 'Read warehouse counts, bytes and activity.', {}, true],
  ['catalog.random', 'catalog', 'Read a random catalog summary.', { excludeId: stringSchema(128) }, true],
  ['catalog.details', 'catalog', 'Read full metadata and a paginated manifest, with passwords redacted.', { recordId: stringSchema(128), ...pageProperties }, true, ['recordId']],
  ['catalog.update_metadata', 'catalog', 'Update title, tags, rating, notes, backup location or recorded password metadata.', { recordId: stringSchema(128), metadata: { type: 'object', additionalProperties: true } }, false, ['recordId', 'metadata']],
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
  ['app.copy_text', 'app', 'Copy explicit text to the clipboard.', { text: { type: 'string', maxLength: 100000 } }, false, ['text']],
  ['path.open', 'app', 'Open a product-owned location selected by kind and optional record/job id.', { kind: { type: 'string', enum: ['warehouse', 'source', 'catalog_source', 'similarity_terms'] }, id: stringSchema(128) }, false, ['kind']],
  ['update.check', 'update', 'Check for application updates.', { mode: { type: 'string', enum: ['manual', 'automatic'] } }, true],
  ['update.install', 'update', 'Install the previously checked update version using the product updater.', { version: stringSchema(64) }, false, ['version']],
  ['update.install_package', 'update', 'Validate and install an update package from an absolute path.', { packagePath: stringSchema() }, false, ['packagePath']],
  ['user_data.preflight_move', 'user_data', 'Inspect a user-data relocation without writing.', { targetDirectory: stringSchema() }, true, ['targetDirectory']],
  ['user_data.move', 'user_data', 'Schedule or perform a validated user-data relocation with app-exit safeguards.', { targetDirectory: stringSchema() }, false, ['targetDirectory']]
].map(([name, domain, description, properties, readOnly, required = []]) => {
  const conditional = ['settings.patch', 'settings.intake_preferences', 'intake.add_batch'];
  const confirmation = ['catalog.delete', 'catalog.restore_source', 'queue.discard_anomaly', 'warehouse.change_directory', 'warehouse.export', 'warehouse.import', 'update.install', 'update.install_package', 'user_data.move', 'similarity.rebuild', 'queue.clear', 'catalog.delete_thumbnail'];
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
      return { target: keys, impact: 'Changes future archive destinations, source handling, repository pointer, or archive password.', recovery: 'Apply another validated settings patch before starting new work.' };
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
      for (const key of Object.keys(patch)) if (/token|secret/i.test(key) || key === 'pendingTrashSafetyHalt' || key === 'intakePreferences') throw new Error(`Setting ${key} cannot be written through MCP`);
      const preferenceKeys = ['archiveOutputDirectory', 'moveCompleted', 'autoTrashCompleted', 'processedSourceDirectory'];
      const state = await manager.updateConfig({ ...manager.config, ...patch }, { source: 'mcp', recordIntakePreferences: preferenceKeys.some((key) => Object.hasOwn(patch, key)) });
      return { settings: publicSettings(state.config) };
    }
    if (name === 'settings.intake_preferences') {
      const patch = sourceDispositionPatch(input);
      await manager.updateConfig({ ...manager.config, ...patch }, { source: 'mcp', recordIntakePreferences: true });
      return { intakePreferences: intakePreferences(manager), settings: publicSettings(manager.config) };
    }
    if (name === 'intake.scan') return compactState(await manager.scanSource(path.resolve(input.directory), input.scanToken || 'mcp'));
    if (name === 'intake.add_batch') {
      let preferences = intakePreferences(manager);
      if (input.archiveOutputDirectory || input.sourceDisposition || input.processedSourceDirectory) {
        const prefPatch = sourceDispositionPatch(input);
        await manager.updateConfig({ ...manager.config, ...prefPatch }, { source: 'mcp', recordIntakePreferences: true });
        preferences = intakePreferences(manager);
      }
      if (!preferences.configured) return preferences;
      const normalizedPaths = [...new Set(input.paths.map((entry) => {
        if (!path.isAbsolute(entry) || entry.includes('\0')) throw new Error('Each source must be an absolute local path');
        return path.normalize(entry);
      }))];
      const previous = manager.jobs.filter((job) => job.mcpRequestId === input.requestId);
      if (previous.some((job) => job.processingMode !== input.mode || !normalizedPaths.includes(job.sourcePath))) throw new Error('REQUEST_ID_CONFLICT');
      const failures = [];
      for (const source of normalizedPaths.filter((entry) => !previous.some((job) => job.sourcePath === entry))) {
        try {
          await manager.addSingle(source, { requestId: input.requestId, mode: input.mode, sourceDisposition: preferences.sourceDisposition, processedSourceDirectory: preferences.processedSourceDirectory });
        } catch (error) { failures.push({ source, code: error.code || 'INTAKE_FAILED', message: error.message }); }
      }
      const jobs = manager.jobs.filter((job) => job.mcpRequestId === input.requestId);
      if (input.start !== false && jobs.length && !manager.running) void manager.startQueue().catch((error) => manager.emit('automation-error', error));
      return { jobs: jobs.map(redact), failures, reused: failures.length === 0 && jobs.length === previous.length };
    }
    if (name === 'queue.state') return { ...compactState(manager), ...page((manager.jobs || []).map(redact), input) };
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
      'similarity.reload': () => manager.reloadSimilarityIgnoreTerms({ rebuild: input.rebuild !== false }),
      'similarity.rebuild': () => manager.rebuildAllSimilarityRelations(),
      'warehouse.change_directory': () => manager.changeWarehouseDirectory(path.resolve(input.targetDirectory)),
      'warehouse.export': () => manager.exportWarehouseToFile(path.resolve(input.targetFile)),
      'warehouse.import': () => manager.importWarehouseFromArchiveOrDirectory(path.resolve(input.sourcePath))
    };
    if (direct[name]) return redact(await direct[name]());
    if (name === 'catalog.search') return page(manager.searchCatalog(input).map(redact), input);
    if (name === 'catalog.suggestions') return manager.getCatalogSuggestions(input.query, input.limit);
    if (name === 'catalog.insights') return manager.getWarehouseInsights();
    if (name === 'catalog.random') return redact(manager.getRandomCatalogRecord(input.excludeId));
    if (name === 'catalog.details') {
      const details = sanitizeCatalogDetails(manager.getCatalogDetails(input.recordId));
      const manifest = details.manifest || [];
      delete details.manifest;
      return { ...details, manifest: page(manifest, input) };
    }
    if (name === 'similarity.terms') return page([...(manager.similarityIgnoreTerms || [])], input);
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
        (!needle || `${entry.name} ${entry.description}`.toLowerCase().includes(needle)))
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

module.exports = { capabilities, createCapabilityService, intakePreferences, publicSettings, redact };
