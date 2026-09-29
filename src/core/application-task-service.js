'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { isVideoFile } = require('./constants');
const { normalizeForComparison, validatePathLayout } = require('./paths');
const { resolveIntakeOptions, savedIntakePreferences } = require('./intake-options');
const {
  codedError,
  isTerminalTaskStatus,
  summarizeJobs,
  taskStatus
} = require('./task-contracts');

const servicesByManager = new WeakMap();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeInputPaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 100) {
    throw codedError('INVALID_PATHS', 'paths must contain between 1 and 100 local paths.', 'prepare', {
      requiredAction: 'choose_source_paths'
    });
  }
  return [...new Map(paths.map((raw) => {
    const value = String(raw || '').trim();
    if (!value || value.includes('\0') || !path.isAbsolute(value)) {
      throw codedError('INVALID_PATH', 'Each source must be an absolute local path.', 'prepare', {
        requiredAction: 'correct_path'
      });
    }
    const selected = path.normalize(value);
    return [normalizeForComparison(selected), selected];
  })).values()];
}

async function normalizePaths(paths) {
  const normalized = await Promise.all(normalizeInputPaths(paths).map(async (selected) => {
    // Resolve Windows junctions and symbolic links before assigning task identity.
    // Missing paths remain in the request so intake can report their own failure.
    const canonical = await fs.realpath(selected).catch(() => selected);
    return [normalizeForComparison(canonical), canonical];
  }));
  return [...new Map(normalized).values()];
}

function taskFingerprint(paths, options) {
  return fingerprint({
    paths: paths.map(normalizeForComparison).sort((left, right) => left.localeCompare(right, 'en-US')),
    options: {
      mode: options.mode,
      archiveOutputDirectory: options.archiveOutputDirectory ? normalizeForComparison(options.archiveOutputDirectory) : '',
      archiveStagingDirectory: options.archiveStagingDirectory ? normalizeForComparison(options.archiveStagingDirectory) : '',
      sourceDisposition: options.sourceDisposition,
      processedSourceDirectory: options.processedSourceDirectory ? normalizeForComparison(options.processedSourceDirectory) : ''
    }
  });
}

function legacyTaskFingerprint(paths, options) {
  return fingerprint({
    mode: options.mode,
    paths: paths.map(normalizeForComparison).sort((left, right) => left.localeCompare(right, 'en-US')),
    archiveOutputDirectory: options.archiveOutputDirectory ? normalizeForComparison(options.archiveOutputDirectory) : '',
    sourceDisposition: options.sourceDisposition,
    processedSourceDirectory: options.processedSourceDirectory ? normalizeForComparison(options.processedSourceDirectory) : ''
  });
}

function explicitInputFingerprint(input, paths) {
  return fingerprint({
    paths: paths.map(normalizeForComparison).sort(),
    mode: input.mode,
    layout: input.layout ?? 'single',
    onDuplicate: input.onDuplicate ?? 'ask',
    archiveOutputDirectory: input.archiveOutputDirectory ?? null,
    archiveStagingDirectory: input.archiveStagingDirectory ?? null,
    sourceDisposition: input.sourceDisposition ?? null,
    processedSourceDirectory: input.processedSourceDirectory ?? null
  });
}

function snapshotRuntimeOptions(config) {
  const fields = [
    'archiveNamingMode', 'customArchiveName', 'archiveFormat', 'compressionLevel',
    'archiveVolumeEnabled', 'archiveVolumeBytes', 'largeFolderSimplification',
    'largeFolderFileThreshold', 'largeFolderMd5SampleLimit', 'skipTinyMd5Files',
    'tinyFileMd5ThresholdBytes', 'archivePassword', 'recordArchivePassword',
    'videoFrameBackup', 'videoFrameCount', 'thumbnailLimit', 'sevenZipPath',
    'ffmpegPath', 'queueConcurrency', 'autoSkipExactDuplicates', 'autoSkipExactDuplicateAction'
  ];
  return Object.fromEntries(fields.map((key) => [key, config[key]]));
}

async function shallowSourceLayout(sourcePath) {
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) {
    if (!isVideoFile(sourcePath)) throw codedError('UNSUPPORTED_SOURCE', 'Intake supports directories and video files.', 'prepare');
    return { type: 'video', candidates: [], rootFiles: [], fingerprint: fingerprint({ type: 'video', path: sourcePath }) };
  }
  if (!stat.isDirectory()) throw codedError('UNSUPPORTED_SOURCE', 'Intake supports directories and video files.', 'prepare');
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory() || entry.isFile() && isVideoFile(entry.name))
    .map((entry) => path.join(sourcePath, entry.name));
  const rootFiles = entries.filter((entry) => !(entry.isDirectory() || entry.isFile() && isVideoFile(entry.name)))
    .map((entry) => entry.name);
  const shape = entries.map((entry) => [entry.name, entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'])
    .sort((left, right) => left[0].localeCompare(right[0], 'en-US'));
  return { type: 'directory', candidates, rootFiles, fingerprint: fingerprint(shape) };
}

function publicJob(job) {
  const missingRecord = job.errorCode === 'CATALOG_SOURCE_RECORD_MISSING';
  return {
    id: job.id,
    displayName: job.displayName,
    sourcePath: job.sourcePath,
    mode: job.processingMode,
    status: job.status,
    progress: Number(job.progress) || 0,
    stage: job.stageText || '',
    ...(job.sourceChangeReport ? { sourceChangeReport: {
      jobId: job.id,
      snapshotId: job.sourceChangeReport.snapshotId,
      targetRecordId: job.sourceChangeReport.targetRecord?.id,
      summary: job.sourceChangeReport.summary,
      needsDesktop: true
    } } : {}),
    ...(job.sourceDispositionRecovery ? { sourceDispositionRecovery: {
      action: job.sourceDispositionRecovery.action,
      sourceDisposition: job.sourceDispositionRecovery.sourceDisposition,
      originalSourcePath: job.sourceDispositionRecovery.originalSourcePath,
      movedTo: job.sourceDispositionRecovery.movedTo,
      trashedAt: job.sourceDispositionRecovery.trashedAt
    } } : {}),
    error: job.errorCode || job.errorMessage
      ? { code: job.errorCode || 'TASK_FAILED',
          message: missingRecord
            ? 'The linked uncompressed Warehouse item is gone. Cancel this task and submit the source again; this task did not change the source files.'
            : job.errorMessage || job.stageText || 'Task failed.',
          ...(missingRecord ? { requiredAction: 'cancel_and_resubmit_source' } : {}) }
      : null
  };
}

function localizedQuestion(english, chinese) {
  return { question: english, questionLocalized: { 'en-US': english, 'zh-CN': chinese } };
}

class ApplicationTaskService {
  constructor(manager) {
    if (!manager) throw new Error('ApplicationTaskService requires QueueManager.');
    this.manager = manager;
    this.scheduling = false;
    this.v2Preparations = new Map();
    this.v2AdmissionTail = Promise.resolve();
    this.manager.on?.('idle', () => { void this.schedule().catch((error) => this.recordAsyncError(error)); });
    setImmediate(() => {
      for (const task of this.manager.automationRequests || []) {
        if (task.responseVersion === 2 && task.cancellationRequested && !task.cancelFinalized) {
          void this.cancel(task.taskId).catch((error) => this.recordAsyncError(error, task));
          continue;
        }
        if (task.responseVersion === 2 && task.preparing && !task.recoveryRequired &&
            !task.decision && this.findTask(task.taskId)) this.beginV2Preparation(task);
      }
    });
  }

  findTask(taskId) {
    const value = String(taskId || '').trim();
    const task = (this.manager.automationRequests || []).find((entry) =>
      (entry.taskId === value || entry.requestId === value) &&
      normalizeForComparison(entry.repositoryDirectory || this.manager.config.repositoryDirectory) ===
        normalizeForComparison(this.manager.config.repositoryDirectory)) || null;
    if (task && this.manager.automationCancellationIntents?.has(task.taskId)) {
      task.cancellationRequested = true;
      task.startAuthorized = false;
    }
    return task;
  }

  jobsFor(task) {
    const ids = new Set(task?.jobIds || (task?.jobs || []).map((job) => job.id));
    // Queue jobs may be durable before their request-ledger refresh succeeds.
    // Reconcile by both identities for every accepted task, including a v2
    // preparation failure whose error code is no longer INTAKE_LEDGER_PENDING.
    for (const job of this.manager.jobs || []) {
      if (job.mcpRequestId === task?.requestId && job.applicationTaskId === task?.taskId) ids.add(job.id);
    }
    const live = (this.manager.jobs || []).filter((job) => ids.has(job.id));
    const liveIds = new Set(live.map((job) => job.id));
    return [...live, ...(task?.jobs || []).filter((job) => !liveIds.has(job.id))];
  }

  receipt(taskOrId, responseVersion = 1) {
    const task = typeof taskOrId === 'string' ? this.findTask(taskOrId) : taskOrId;
    if (!task) throw codedError('TASK_NOT_FOUND', 'The requested Hamster task does not exist.', 'lookup', {
      requiredAction: 'check_task_id'
    });
    if (task.terminalReceipts?.[responseVersion]) return structuredClone(task.terminalReceipts[responseVersion]);
    const jobs = this.jobsFor(task);
    let status = taskStatus(jobs, task);
    if (this.manager.paused && status === 'running') status = 'paused';
    const savedJobs = new Map((task.jobs || []).map((job) => [job.id, job]));
    const warnings = [];
    for (const job of jobs) {
      if (job.status === 'completed_cleanup_failed') warnings.push({
        code: job.errorCode || 'SOURCE_DISPOSITION_FAILED',
        message: job.errorMessage || job.stageText || 'The archive was saved but source handling did not finish.',
        jobId: job.id
      });
    }
    const results = jobs.flatMap((job) => {
      const historical = savedJobs.get(job.id)?.terminalResult || job.terminalResult;
      if (historical) return [historical];
      const record = (this.manager.catalog || []).find((item) =>
        item.archiveJobId === job.id || item.jobId === job.id ||
        (job.status === 'completed' && job.taskKind === 'catalog_refresh' && job.sourceCatalogRecordId === item.id));
      if (!record) return [];
      return [{ recordId: record.id, jobId: job.id,
        mode: record.archiveState === 'uncompressed' ? 'inventory_only' : 'archive',
        catalogCommitted: true, sourceDisposition: record.sourceDisposition || 'kept',
        archiveVerification: record.archiveState === 'uncompressed' ? 'not_applicable'
          : record.verifiedAt ? 'verified' : 'unknown',
        ...(record.archiveDirectory ? { archiveDirectory: record.archiveDirectory } : {}),
        ...(Array.isArray(record.archiveFiles) ? { archiveFiles: record.archiveFiles.map((file) => file.name || file.path || file) } : {}) }];
    });
    const nextAction = status === 'needs_confirmation'
      ? { action: jobs.some((job) => job.status === 'awaiting_source_change_confirmation') ? 'review_source_changes_in_desktop' : 'resolve',
          jobIds: jobs.filter((job) => String(job.status || '').startsWith('awaiting_')).map((job) => job.id) }
      : status === 'recovery_required' ? { action: 'inspect_recovery_evidence' }
        : isTerminalTaskStatus(status) ? null : { action: 'wait', suggestedTimeoutSeconds: 20 };
    const receipt = {
      schemaVersion: 1,
      ok: !['failed', 'recovery_required'].includes(status),
      task: {
        id: task.taskId || task.requestId,
        requestId: task.requestId,
        status,
        terminal: isTerminalTaskStatus(status),
        acceptedAt: task.acceptedAt || task.createdAt,
        updatedAt: task.updatedAt,
        jobIds: jobs.map((job) => job.id)
      },
      summary: summarizeJobs(jobs, task.failures || []),
      jobs: jobs.map(publicJob),
      results,
      failures: task.failures || [],
      warnings,
      nextAction
    };
    return responseVersion === 2 ? this.projectV2Receipt(task, jobs, receipt) : receipt;
  }

  projectV2Receipt(task, jobs, base) {
    const savedJobs = new Map((task.jobs || []).map((job) => [job.id, job]));
    const counts = { created: 0, updated: 0, reused: 0, skipped: 0, failed: (task.failures || []).length,
      cancelled: 0, pending: 0 };
    for (const job of jobs) {
      if (['completed', 'completed_cleanup_failed'].includes(job.status)) {
        if (job.sourceCatalogRecordId || job.taskKind === 'catalog_refresh' || job.taskKind === 'catalog_compress') counts.updated++;
        else counts.created++;
      } else if (job.status === 'skipped_duplicate') {
        if (job.automationDuplicatePolicy === 'use_existing') counts.reused++;
        else counts.skipped++;
      } else if (job.status === 'failed') counts.failed++;
      else if (job.status === 'cancelled') counts.cancelled++;
      else counts.pending++;
    }
    const requestedProjects = task.decision && !task.layoutPaths ? null
      : Object.values(counts).reduce((total, count) => total + count, 0);
    const waitingJob = jobs.find((job) => String(job.status || '').startsWith('awaiting_'));
    let decision = task.decision || null;
    if (!decision && waitingJob) {
      const duplicate = waitingJob.status === 'awaiting_duplicate_confirmation';
      const sourceChange = waitingJob.status === 'awaiting_source_change_confirmation';
      const anomaly = waitingJob.status === 'awaiting_anomaly_confirmation';
      const trashSafety = waitingJob.status === 'awaiting_trash_safety_confirmation';
      const trustedMatches = (waitingJob.exactProjectMatches || []).filter((match) => match?.id);
      decision = {
        id: waitingJob.id, revision: Number(waitingJob.duplicateDecisionRevision) || 1,
        kind: sourceChange ? 'source_change' : anomaly ? 'archive_anomaly'
          : trashSafety ? 'trash_safety' : duplicate ? 'duplicate' : 'confirmation',
        ...localizedQuestion(...(sourceChange
          ? ['Review changed source contents in the desktop application.', '请在桌面应用中检查来源内容的变化。']
          : anomaly ? ['Review the unusual archive size in the desktop application.', '请在桌面应用中检查异常的压缩包大小。']
            : trashSafety ? ['Review recycle-bin safety in the desktop application.', '请在桌面应用中检查回收站操作的安全性。']
              : duplicate ? ['An existing project may match. Reuse it, create another, or skip?', '可能存在相同项目。要复用、另建，还是跳过？']
                : ['Continue this task after reviewing its impact?', '检查影响后继续这个任务吗？'])),
        choices: sourceChange || anomaly || trashSafety ? [] : duplicate
          ? [...(trustedMatches.length ? [{ id: 'use_existing' }] : []), { id: 'create_new' }, { id: 'skip' }]
          : [{ id: 'continue' }, { id: 'skip' }],
        context: { jobId: waitingJob.id, trustedRecordIds: trustedMatches.map((match) => match.id),
          evidenceFingerprint: waitingJob.duplicateReviewFingerprint || null,
          sourceChangeReport: waitingJob.sourceChangeReport || null,
          confirmationReasons: waitingJob.confirmationReasons || [],
          sourceDisposition: waitingJob.mcpSourceDisposition || waitingJob.sourceDisposition || 'keep' }
      };
    }
    const nextAction = decision
      ? ['source_change', 'archive_anomaly', 'trash_safety', 'scope_too_large'].includes(decision.kind)
        ? { kind: decision.kind === 'scope_too_large' ? 'request_narrower_scope' : 'open_desktop_review',
            target: decision.context?.jobId || task.paths?.[0] || null }
        : { kind: 'request_user_choice', capability: 'task.resolve',
            input: { taskId: base.task.id, decisionId: decision.id, revision: decision.revision },
            userSuppliedField: 'choice',
            ...(decision.context?.rootFiles > 0 ? { additionalField: 'rootFiles',
              additionalChoices: [{ id: 'exclude',
                effect: { 'zh-CN': '明确排除根目录散落文件；原文件保持原位。',
                  'en-US': 'Explicitly exclude loose root files; leave originals in place.' } }] } : {}) }
      : base.task.status === 'recovery_required'
        ? { kind: 'inspect_recovery_evidence',
            target: jobs.find((job) => job.errorCode === 'SOURCE_DISPOSITION_COMMIT_FAILED')?.id || base.task.id }
        : base.task.terminal ? null : { kind: 'wait', capability: 'task.wait',
          input: { taskId: base.task.id, timeoutSeconds: 20 } };
    const results = base.results.map((result) => {
      const record = (this.manager.catalog || []).find((item) => item.id === result.recordId);
      const job = jobs.find((item) => item.id === result.jobId);
      return { ...result,
        action: result.action || (job?.sourceCatalogRecordId || ['catalog_refresh', 'catalog_compress'].includes(job?.taskKind)
          ? 'updated' : 'created'),
        archiveState: result.archiveState || record?.archiveState || 'unknown',
        archiveVerification: result.archiveVerification || (result.mode === 'inventory_only' ? 'not_applicable'
          : record?.verifiedAt ? 'verified' : 'unknown') };
    });
    const existingRecords = jobs.filter((job) => job.status === 'skipped_duplicate')
      .flatMap((job) => savedJobs.get(job.id)?.existingRecord ? [savedJobs.get(job.id).existingRecord] :
        (job.exactProjectMatches || []).filter((match) => match?.id).slice(0, 1)
        .map((match) => {
          const record = (this.manager.catalog || []).find((item) => item.id === match.id);
          return { recordId: match.id, archiveState: record?.archiveState || 'unknown',
            matchReason: match.verification || 'verified_duplicate_rule', sourceActionThisRun: 'none' };
        }));
    const outcome = base.task.terminal
      ? base.task.status === 'recovery_required' ? 'recovery_required'
        : base.task.status === 'cancelled' ? 'cancelled'
        : task.noChange ? 'no_change'
          : counts.failed || base.warnings.length || base.task.status === 'partial_failed'
            ? counts.created || counts.updated || counts.reused || counts.skipped ? 'partial_failed' : 'failed'
        : counts.cancelled ? 'cancelled' : counts.created ? 'created' : counts.updated ? 'updated'
          : counts.reused ? 'already_present' : counts.skipped ? 'skipped' : 'completed'
      : decision ? 'needs_input' : 'pending';
    return { ...base, schemaVersion: 2, outcome,
      runtime: { applicationRoot: this.manager.runtimeIdentity?.applicationRoot || null,
        userDataRoot: this.manager.runtimeIdentity?.userDataRoot || null,
        repositoryDirectory: this.manager.config.repositoryDirectory,
        instanceId: this.manager.runtimeIdentity?.instanceId || null },
      effectiveOptions: { mode: task.options?.mode || task.mode,
        sourceDisposition: task.options?.sourceDisposition || 'keep',
        layout: task.options?.layout || 'single', onDuplicate: task.options?.onDuplicate || 'ask' },
      summary: { requestedProjects, ...counts }, results, existingRecords,
      ...(task.rootExcluded?.length ? { excludedRootFiles: task.rootExcluded } : {}),
      decision, nextAction,
      evidence: base.task.terminal ? { receiptId: `${base.task.id}-attempt-${task.attempt || 1}`,
        persisted: false, asOf: null } : null };
  }

  async submitV2(input) {
    const rawPaths = normalizeInputPaths(input.paths);
    const requestId = String(input.requestId || '').trim() || `request-${crypto.randomUUID()}`;
    if (requestId.length > 128) throw codedError('INVALID_REQUEST_ID', 'requestId cannot exceed 128 characters.', 'prepare');
    const explicitFingerprint = explicitInputFingerprint(input, rawPaths);
    const accept = async () => {
      const existing = this.manager.findAutomationRequest?.(requestId);
      if (existing) {
        if (existing.explicitFingerprint !== explicitFingerprint) {
          throw codedError('REQUEST_ID_CONFLICT', 'This requestId is already bound to different explicit input.', 'prepare');
        }
        return { task: existing, replay: true };
      }
      const options = resolveIntakeOptions(input, savedIntakePreferences(this.manager.config));
      if (options.layout !== 'single' && rawPaths.length !== 1) {
        throw codedError('INVALID_LAYOUT', 'children and ask require exactly one source path.', 'prepare');
      }
      const task = await this.manager.recordAutomationRequest({
        requestId, taskId: `task-${crypto.randomUUID()}`, fingerprint: explicitFingerprint,
        explicitFingerprint, responseVersion: 2, mode: options.mode, paths: rawPaths,
        options, jobs: [], failures: [], acceptedAt: new Date().toISOString(),
        preparing: true, startAuthorized: true, attempt: 1, noChange: false,
        runtimeOptions: snapshotRuntimeOptions(this.manager.config),
        explicitInput: { paths: rawPaths, mode: input.mode, layout: options.layout, onDuplicate: options.onDuplicate }
      });
      return { task, replay: false };
    };
    const previous = this.v2AdmissionTail;
    let release;
    this.v2AdmissionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    let accepted;
    try { accepted = await accept(); }
    finally { release(); }
    const { task, replay } = accepted;
    if (!replay && !task.decision) this.beginV2Preparation(task);
    const waitMilliseconds = input.waitMilliseconds === undefined ? 0 : input.waitMilliseconds;
    if (waitMilliseconds > 0) return this.wait(task.taskId, Math.min(2_000, waitMilliseconds), 2);
    return this.receipt(task, 2);
  }

  beginV2Preparation(task) {
    if (this.findTask(task.taskId)?.cancellationRequested) return Promise.resolve();
    if (this.v2Preparations.has(task.taskId)) return this.v2Preparations.get(task.taskId);
    const operation = Promise.resolve().then(() => this.prepareV2(task)).catch(async (error) => {
      if (this.findTask(task.taskId)?.cancellationRequested) return;
      await this.manager.recordAutomationRequest({ ...task, jobs: this.jobsFor(task), preparing: false,
        recoveryRequired: true, asyncError: { code: error.code || 'INTAKE_PREPARATION_FAILED', message: error.message,
          at: new Date().toISOString() } });
    }).finally(() => this.v2Preparations.delete(task.taskId));
    this.v2Preparations.set(task.taskId, operation);
    return operation;
  }

  async saveV2Decision(task, layout, kind, revision = 1) {
    const wording = kind === 'scope_too_large'
      ? ['Choose a smaller source range and submit it as a new task.', '请选择更小的来源范围并提交新任务。']
      : kind === 'root_files'
        ? ['Root files would be left out. Use one project or explicitly exclude them?', '根目录散落文件将不计入子项目。要作为一个项目处理，还是明确排除这些文件？']
        : ['Catalog this source as one project or each child project?', '要把这个来源作为一个项目入库，还是把每个子项目分别入库？'];
    const decision = {
      id: task.decision?.id || `decision-${crypto.randomUUID()}`, revision, kind,
      ...localizedQuestion(...wording),
      choices: kind === 'scope_too_large' ? [] : [{ id: 'single', effect: {
        'zh-CN': '将整个来源作为一个项目，包括根目录文件。',
        'en-US': 'Treat the entire source as one project, including loose root files.' } },
        { id: 'children', effect: { 'zh-CN': '分别处理各子项目。', 'en-US': 'Handle each child project separately.' },
          ...(layout.rootFiles.length > 0 ? { requires: {
          field: 'rootFiles', choices: [{ id: 'exclude',
            effect: { 'zh-CN': '明确排除根目录散落文件；原文件保持原位。',
              'en-US': 'Explicitly exclude loose root files; leave originals in place.' } }] } } : {}) }],
      context: { childDirectories: layout.candidates.length, rootFiles: layout.rootFiles.length,
        rootFileNames: layout.rootFiles.slice(0, 20) },
      evidenceFingerprint: layout.fingerprint
    };
    const saved = await this.manager.recordAutomationRequest({ ...task, jobs: this.jobsFor(task),
      decision, preparing: false, recoveryRequired: false, asyncError: null });
    this.manager.emitState?.();
    return saved;
  }

  async prepareV2(task) {
    const cancellationRequested = () => this.findTask(task.taskId)?.cancellationRequested === true;
    if (cancellationRequested()) return;
    const options = task.options;
    let paths = task.layoutPaths;
    if (paths && task.layoutChoice === 'children' && !this.jobsFor(task).length) {
      const layout = await shallowSourceLayout(task.paths[0]);
      if (cancellationRequested()) return;
      if (layout.fingerprint !== task.layoutFingerprint) {
        const revision = (task.decisionHistory || []).at(-1)?.revision + 1 || 1;
        await this.saveV2Decision(task, layout, layout.candidates.length > 100 ? 'scope_too_large' : 'project_layout', revision);
        return;
      }
    }
    if (!paths) {
      if (options.layout === 'single') paths = task.paths;
      else {
      const layout = await shallowSourceLayout(task.paths[0]);
      if (cancellationRequested()) return;
      if (options.layout === 'ask' && layout.type === 'directory' && layout.candidates.length > 0) {
        await this.saveV2Decision(task, layout, layout.candidates.length > 100 ? 'scope_too_large' : 'project_layout');
        return;
      }
      if (options.layout === 'children') {
        if (layout.type !== 'directory') throw codedError('INVALID_LAYOUT', 'children requires a directory.', 'prepare');
        if (layout.candidates.length > 100) {
          await this.saveV2Decision(task, layout, 'scope_too_large'); return;
        }
        if (layout.rootFiles.length > 0 && !task.rootExcluded) {
          await this.saveV2Decision(task, layout, 'root_files'); return;
        }
        paths = layout.candidates;
      } else paths = task.paths;
      }
    }
    paths = paths.length ? await normalizePaths(paths) : [];
    if (cancellationRequested()) return;
    if (options.mode === 'archive') {
      const taskConfig = { ...this.manager.config, archiveOutputDirectory: options.archiveOutputDirectory,
        archiveStagingDirectory: options.archiveStagingDirectory,
        moveCompleted: options.sourceDisposition === 'move', autoTrashCompleted: options.sourceDisposition === 'trash',
        processedSourceDirectory: options.processedSourceDirectory };
      for (const sourcePath of paths) validatePathLayout(taskConfig, sourcePath);
    }
    const failures = [...(task.failures || [])];
    for (const sourcePath of paths) {
      if (cancellationRequested()) return;
      if ((this.manager.jobs || []).some((job) => job.mcpRequestId === task.requestId &&
          normalizeForComparison(job.sourcePath) === normalizeForComparison(sourcePath))) continue;
      try {
        await this.manager.addSingle(sourcePath, { requestId: task.requestId, taskId: task.taskId,
          explicit: true, startAuthorized: task.startAuthorized !== false,
          automationRuntimeOptions: task.runtimeOptions, ...options });
        if (cancellationRequested()) return;
      } catch (error) {
        if ((this.manager.jobs || []).some((job) => job.mcpRequestId === task.requestId &&
            normalizeForComparison(job.sourcePath) === normalizeForComparison(sourcePath))) throw error;
        failures.push({ source: sourcePath, code: error.code || 'INTAKE_FAILED', message: error.message });
      }
    }
    const jobs = (this.manager.jobs || []).filter((job) => job.mcpRequestId === task.requestId);
    if (cancellationRequested()) return;
    const saved = await this.manager.recordAutomationRequest({ ...task, paths, layoutPaths: paths,
      jobs, failures, preparing: false, noChange: !jobs.length && !failures.length,
      recoveryRequired: false, asyncError: null });
    if (jobs.length && saved.startAuthorized !== false) await this.schedule();
    this.manager.emitState?.();
  }

  async resolveV2Decision(task, input) {
    const decision = task.decision;
    const history = task.decisionHistory || [];
    if (history.some((entry) => entry.id === input.decisionId && entry.revision === input.revision &&
        entry.choice === input.choice && entry.rootFiles === (input.rootFiles || null))) {
      return this.receipt(task, 2);
    }
    if (input.decisionId !== decision.id || input.revision !== decision.revision) {
      throw codedError('STALE_DECISION', 'The decision has changed. Read the current task receipt.', 'resolve');
    }
    if (decision.kind === 'scope_too_large') {
      throw codedError('NARROWER_SCOPE_REQUIRED', 'Submit a smaller source range as a new task.', 'resolve');
    }
    if (!['single', 'children'].includes(input.choice)) {
      throw codedError('INVALID_RESOLUTION', 'choice must be single or children.', 'resolve');
    }
    const layout = await shallowSourceLayout(task.paths[0]);
    if (layout.fingerprint !== decision.evidenceFingerprint) {
      await this.saveV2Decision(task, layout, layout.candidates.length > 100 ? 'scope_too_large' : 'project_layout', decision.revision + 1);
      return this.receipt(task.taskId, 2);
    }
    if (input.choice === 'children' && layout.rootFiles.length > 0 && input.rootFiles !== 'exclude') {
      throw codedError('ROOT_FILES_DECISION_REQUIRED', 'Explicitly choose rootFiles exclude or select single.', 'resolve');
    }
    const paths = input.choice === 'single' ? task.paths : layout.candidates;
    const saved = await this.manager.recordAutomationRequest({ ...task, jobs: this.jobsFor(task),
      decision: null, decisionHistory: [...history, { id: decision.id, revision: decision.revision,
        choice: input.choice, rootFiles: input.rootFiles || null }],
      layoutPaths: paths, layoutChoice: input.choice, layoutFingerprint: layout.fingerprint,
      rootExcluded: input.choice === 'children' ? layout.rootFiles : [], preparing: true });
    this.beginV2Preparation(saved);
    return this.receipt(saved, 2);
  }

  async submit(input = {}) {
    if (input.responseVersion === 2) return this.submitV2(input);
    const rawPaths = normalizeInputPaths(input.paths);
    const requestId = String(input.requestId || '').trim() || `request-${crypto.randomUUID()}`;
    if (requestId.length > 128) throw codedError('INVALID_REQUEST_ID', 'requestId cannot exceed 128 characters.', 'prepare');
    const explicitFingerprint = explicitInputFingerprint(input, rawPaths);
    const savedRequest = this.manager.findAutomationRequest?.(requestId);
    if (savedRequest?.explicitFingerprint) {
      if (savedRequest.explicitFingerprint !== explicitFingerprint) {
        throw codedError('REQUEST_ID_CONFLICT', 'This requestId is already bound to different explicit input.', 'prepare', {
          requiredAction: 'use_new_request_id'
        });
      }
      return this.receipt(savedRequest);
    }
    const paths = await normalizePaths(rawPaths);
    const options = resolveIntakeOptions(input, savedIntakePreferences(this.manager.config));
    if (options.mode === 'archive') {
      const taskConfig = {
        ...this.manager.config,
        archiveOutputDirectory: options.archiveOutputDirectory,
        archiveStagingDirectory: options.archiveStagingDirectory,
        moveCompleted: options.sourceDisposition === 'move',
        autoTrashCompleted: options.sourceDisposition === 'trash',
        processedSourceDirectory: options.processedSourceDirectory
      };
      try {
        for (const sourcePath of paths) validatePathLayout(taskConfig, sourcePath);
      } catch (error) {
        throw codedError('INVALID_PATH_LAYOUT', error.message, 'prepare', { requiredAction: 'correct_path_layout' });
      }
    }
    const requestFingerprint = taskFingerprint(paths, options);

    const existingRequest = () => {
      const existing = this.manager.findAutomationRequest?.(requestId);
      if (!existing) return null;
      if (existing.explicitFingerprint) {
        if (existing.explicitFingerprint !== explicitFingerprint) {
          throw codedError('REQUEST_ID_CONFLICT', 'This requestId is already bound to different explicit input.', 'prepare', {
            requiredAction: 'use_new_request_id'
          });
        }
        return existing;
      }
      const compatibleFingerprint = existing.fingerprint === requestFingerprint ||
        existing.fingerprint === taskFingerprint(rawPaths, options) ||
        (!existing.taskId && [legacyTaskFingerprint(paths, options), legacyTaskFingerprint(rawPaths, options)]
          .includes(existing.fingerprint));
      if (!compatibleFingerprint) {
        throw codedError('REQUEST_ID_CONFLICT', 'This requestId is already bound to different input.', 'prepare', {
          requiredAction: 'use_new_request_id'
        });
      }
      return existing;
    };
    // Keep ledger acceptance and all job admissions in the same boundary as
    // catalog deletion. A saved requestId must never precede a competing delete.
    const accept = async (admissionHeld) => {
      // Idempotency is checked within the boundary so simultaneous replays cannot
      // register two accepted tasks.
      const existing = existingRequest();
      if (existing) return { task: existing, jobs: [], replay: true };

      const taskId = `task-${crypto.randomUUID()}`;
      let task = await this.manager.recordAutomationRequest({
        requestId, taskId, fingerprint: requestFingerprint, explicitFingerprint, mode: options.mode,
        paths, options, jobs: [], failures: [], acceptedAt: new Date().toISOString(),
        startAuthorized: input.startAuthorized !== false,
        recoveryRequired: true,
        asyncError: { code: 'INTAKE_LEDGER_PENDING', message: 'Intake did not finish. Inspect the task before retrying.' }
      });
      const failures = [];
      for (const sourcePath of paths) {
        try {
          const automation = { requestId, taskId, explicit: true,
            startAuthorized: input.startAuthorized !== false, ...options };
          if (admissionHeld) {
            await this.manager.addSingleUnlocked(sourcePath, automation, this.manager.running);
          } else await this.manager.addSingle(sourcePath, automation);
        } catch (error) {
          // A job may already be persisted when its ledger refresh fails. Keep the
          // provisional request for recovery instead of misreporting source failure.
          if ((this.manager.jobs || []).some((job) => job.mcpRequestId === requestId &&
              normalizeForComparison(job.sourcePath) === normalizeForComparison(sourcePath))) throw error;
          failures.push({ source: sourcePath, code: error.code || 'INTAKE_FAILED', message: error.message });
        }
      }
      const jobs = (this.manager.jobs || []).filter((job) => job.mcpRequestId === requestId);
      task = await this.manager.recordAutomationRequest({
        requestId, taskId, fingerprint: requestFingerprint, explicitFingerprint, mode: options.mode,
        paths, options, jobs, failures, acceptedAt: task.acceptedAt,
        startAuthorized: input.startAuthorized !== false,
        recoveryRequired: false, asyncError: null
      });
      return { task, jobs, replay: false };
    };
    const guarded = typeof this.manager.withIntakeAdmission === 'function' &&
      typeof this.manager.addSingleUnlocked === 'function';
    const { task, jobs, replay } = guarded
      ? await this.manager.withIntakeAdmission(() => accept(true))
      : await accept(false);
    if (replay) return this.receipt(task);
    const taskId = task.taskId;
    if (!jobs.length) return this.receipt(task);
    if (task.startAuthorized !== false) await this.schedule();
    if (input.waitMilliseconds !== 0) {
      const waitMilliseconds = Math.min(2_000, Math.max(0, Number(input.waitMilliseconds) || 1_500));
      return this.wait(taskId, waitMilliseconds);
    }
    return this.receipt(task);
  }

  get(taskId, responseVersion = 1) {
    return this.receipt(taskId, responseVersion);
  }

  async wait(taskId, timeoutMilliseconds = 20_000, responseVersion = 1, signal = null) {
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 0 || timeoutMilliseconds > 60_000) {
      throw codedError('INVALID_TIMEOUT', 'timeoutMilliseconds must be an integer from 0 to 60000.', 'wait');
    }
    const timeout = timeoutMilliseconds;
    const initial = this.receipt(taskId, responseVersion);
    const needsCaller = (receipt) => ['needs_input', 'needs_confirmation', 'recovery_required', 'paused'].includes(receipt.task.status);
    if (initial.task.terminal || needsCaller(initial) || timeout === 0 || signal?.aborted) return initial;
    return new Promise((resolve) => {
      let timer;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.manager.removeListener?.('state', changed);
        signal?.removeEventListener('abort', finish);
        resolve(this.receipt(taskId, responseVersion));
      };
      const changed = () => {
        const current = this.receipt(taskId, responseVersion);
        if (current.task.terminal || needsCaller(current)) finish();
      };
      timer = setTimeout(finish, timeout);
      timer.unref?.();
      this.manager.on?.('state', changed);
      signal?.addEventListener('abort', finish, { once: true });
      // A completion between the first receipt and listener registration must wake this waiter.
      changed();
    });
  }

  assertOwnedJob(task, jobId) {
    const ids = new Set(this.jobsFor(task).map((job) => job.id));
    if (!ids.has(jobId)) throw codedError('JOB_OUTSIDE_TASK', 'The selected job does not belong to this task.', 'resolve');
    return this.manager.findJob(jobId);
  }

  async resolve(taskId, input = {}) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    if (task.responseVersion === 2 && (task.decisionHistory || []).some((entry) =>
        entry.id === input.decisionId && entry.revision === input.revision &&
        entry.choice === input.choice && entry.rootFiles === (input.rootFiles || null))) {
      return this.receipt(task, 2);
    }
    if (task.responseVersion === 2 && task.decision) return this.resolveV2Decision(task, input);
    if (task.responseVersion === 2) {
      const previous = this.jobsFor(task).find((job) => job.id === input.decisionId &&
        (job.automationDecisionHistory || []).some((entry) =>
          entry.revision === input.revision && entry.choice === input.choice));
      if (previous) return this.receipt(task, 2);
      const job = this.assertOwnedJob(task, input.decisionId);
      if (!job || !String(job.status || '').startsWith('awaiting_')) {
        throw codedError('STALE_DECISION', 'This decision is no longer pending.', 'resolve');
      }
      if (input.revision !== (Number(job.duplicateDecisionRevision) || 1)) {
        throw codedError('STALE_DECISION', 'The decision evidence has changed.', 'resolve');
      }
      if (['awaiting_source_change_confirmation', 'awaiting_anomaly_confirmation',
        'awaiting_trash_safety_confirmation'].includes(job.status)) {
        throw codedError('DESKTOP_REVIEW_REQUIRED', 'Review this decision in the desktop application.', 'resolve');
      }
      const duplicate = job.status === 'awaiting_duplicate_confirmation';
      const allowed = duplicate ? ['use_existing', 'create_new', 'skip'] : ['continue', 'skip'];
      if (!allowed.includes(input.choice)) throw codedError('INVALID_RESOLUTION', 'Invalid choice for this decision.', 'resolve');
      if (input.choice === 'use_existing') {
        if (!(job.exactProjectMatches || []).some((match) => match?.id)) {
          throw codedError('UNVERIFIED_DUPLICATE', 'No verified existing project can be reused.', 'resolve');
        }
        // Re-run the normal duplicate check against the current source. A prior
        // review alone cannot authorize reuse after source contents change.
        job.automationDuplicatePolicy = 'use_existing';
        job.exactDuplicateOverrideAt = null;
        job.duplicateConfirmedManifestFingerprint = null;
        job.status = 'queued';
        job.stageText = '等待重新核验已有项目';
        await this.manager.persistJobs?.();
      } else if (input.choice === 'create_new' || input.choice === 'continue') {
        if (input.choice === 'create_new') job.automationDuplicatePolicy = 'create_new';
        await this.manager.confirmJob(job.id, { autoStart: false });
      } else await this.manager.cancelJob(job.id);
      job.automationDecisionHistory = [...(job.automationDecisionHistory || []),
        { revision: input.revision, choice: input.choice }];
      await this.manager.persistJobs?.();
      await this.schedule();
      return this.receipt(task, 2);
    }
    const jobs = this.jobsFor(task).filter((job) => String(job.status || '').startsWith('awaiting_'));
    const selected = input.jobId ? [this.assertOwnedJob(task, input.jobId)] : jobs;
    if (!selected.length) throw codedError('TASK_NOT_WAITING_FOR_CONFIRMATION', 'This task has no pending confirmation.', 'resolve');
    if (!['continue', 'skip'].includes(input.action)) {
      throw codedError('INVALID_RESOLUTION', 'action must be continue or skip.', 'resolve', {
        requiredAction: 'choose_resolution'
      });
    }
    if (input.action === 'continue' && selected.some((job) => job.status === 'awaiting_source_change_confirmation')) {
      throw codedError('SOURCE_CHANGE_REVIEW_REQUIRED', 'Review source changes and choose replace, independent item, or skip in the desktop application.', 'resolve', {
        requiredAction: 'review_source_changes_in_desktop'
      });
    }
    for (const job of selected) {
      if (input.action === 'continue') await this.manager.confirmJob(job.id, { autoStart: false });
      else await this.manager.cancelJob(job.id);
    }
    await this.schedule();
    return this.receipt(task);
  }

  async retry(taskId, input = {}) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    if (task.recoveryRequired || this.jobsFor(task).some((job) =>
      ['INTERRUPTED', 'SOURCE_DISPOSITION_COMMIT_FAILED'].includes(job.errorCode))) {
      throw codedError('RECOVERY_REVIEW_REQUIRED', 'Review recovery evidence before retrying this task.', 'retry');
    }
    const allJobs = this.jobsFor(task);
    const selectedIds = input.jobIds ? new Set(input.jobIds.map(String)) : null;
    if (selectedIds && [...selectedIds].some((id) => !allJobs.some((job) => job.id === id && job.status === 'failed'))) {
      throw codedError('INVALID_RETRY_SELECTION', 'Select only failed jobs owned by this task.', 'retry');
    }
    const jobs = allJobs.filter((job) => job.status === 'failed' && (!selectedIds || selectedIds.has(job.id)));
    const selectedSources = input.failureSources ? new Set(input.failureSources.map(normalizeForComparison)) : null;
    const failures = [...(task.failures || [])];
    if (selectedSources && [...selectedSources].some((source) =>
      !failures.some((failure) => normalizeForComparison(failure.source) === source))) {
      throw codedError('INVALID_RETRY_SELECTION', 'Select only recorded intake failures for this task.', 'retry');
    }
    if (!jobs.length && !selectedSources?.size) {
      throw codedError('NOTHING_TO_RETRY', 'This task has no selected failed items.', 'retry');
    }
    const started = await this.manager.recordAutomationRequest({ ...task, jobs: allJobs,
      attempt: (task.attempt || 1) + 1,
      attemptReceipts: [...(task.attemptReceipts || []), ...(task.terminalReceipts ? [task.terminalReceipts] : [])],
      terminalReceipts: null, recoveryRequired: true,
      asyncError: { code: 'RETRY_IN_PROGRESS', message: 'Retry was interrupted; inspect task evidence.' } });
    for (const job of jobs) await this.manager.retryJob(job.id);
    const remainingFailures = failures.filter((failure) =>
      !selectedSources?.has(normalizeForComparison(failure.source)));
    for (const failure of failures.filter((entry) => selectedSources?.has(normalizeForComparison(entry.source)))) {
      try {
        await this.manager.addSingle(failure.source, { requestId: task.requestId, taskId: task.taskId,
          explicit: true, startAuthorized: task.startAuthorized !== false,
          automationRuntimeOptions: task.runtimeOptions, ...task.options });
      } catch (error) {
        remainingFailures.push({ source: failure.source, code: error.code || 'INTAKE_FAILED', message: error.message });
      }
    }
    await this.manager.recordAutomationRequest({ ...started, jobs: this.jobsFor(this.findTask(taskId) || started),
      failures: remainingFailures, recoveryRequired: false, asyncError: null });
    await this.schedule();
    return this.receipt(taskId, task.responseVersion === 2 ? 2 : 1);
  }

  async cancel(taskId) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    if (task.responseVersion === 2) {
      if (this.receipt(task, 2).task.terminal && (!task.cancellationRequested || task.cancelFinalized)) {
        return this.receipt(task, 2);
      }
      // Signal synchronous intent first, before the ledger write yields. Any
      // in-flight admission then sees the flag before starting the queue. The
      // queue scheduler also reads job authorization without consulting tasks.
      task.cancellationRequested = true;
      task.startAuthorized = false;
      if (typeof this.manager.requestAutomationCancellation === 'function') {
        this.manager.requestAutomationCancellation(task.taskId);
      } else {
        for (const job of this.jobsFor(task)) job.automationStartAuthorized = false;
      }
      await this.manager.recordAutomationRequest({ ...task, jobs: this.jobsFor(task),
        cancellationRequested: true, startAuthorized: false });
      if (typeof this.manager.persistJobs === 'function') await this.manager.persistJobs();
      await this.v2Preparations.get(task.taskId);
      const current = this.findTask(taskId) || task;
      for (const job of this.jobsFor(current)) {
        if (!['completed', 'completed_cleanup_failed', 'skipped_duplicate', 'cancelled'].includes(job.status)) {
          await this.manager.cancelJob(job.id);
        }
      }
      const jobs = this.jobsFor(current);
      const saved = await this.manager.recordAutomationRequest({ ...current, jobs,
        decision: null, preparing: false, cancellationRequested: true,
        cancelFinalized: true,
        cancelled: jobs.length === 0 });
      this.manager.clearAutomationCancellation?.(task.taskId);
      return this.receipt(saved, 2);
    }
    for (const job of this.jobsFor(task)) {
      if (!['completed', 'completed_cleanup_failed', 'skipped_duplicate', 'cancelled'].includes(job.status)) {
        await this.manager.cancelJob(job.id);
      }
    }
    return this.receipt(task);
  }

  async start(taskId, responseVersion = 1) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    if (task.cancellationRequested) return this.receipt(task, responseVersion);
    if (task.startAuthorized !== false) return this.receipt(task, responseVersion);
    for (const job of this.jobsFor(task)) job.automationStartAuthorized = true;
    if (typeof this.manager.persistJobs === 'function') await this.manager.persistJobs();
    await this.manager.recordAutomationRequest({ ...task, startAuthorized: true, jobs: this.jobsFor(task) });
    await this.schedule();
    return this.receipt(taskId, responseVersion);
  }

  async schedule() {
    if (this.scheduling || this.manager.running || this.manager.scheduleWaiting || this.manager.safetyHalt) return;
    this.scheduling = true;
    try {
      const task = [...(this.manager.automationRequests || [])]
        .sort((left, right) => String(left.acceptedAt || left.createdAt).localeCompare(String(right.acceptedAt || right.createdAt)))
        .find((entry) => !entry.recoveryRequired &&
          !entry.cancellationRequested &&
          entry.startAuthorized !== false &&
          normalizeForComparison(entry.repositoryDirectory || this.manager.config.repositoryDirectory) ===
            normalizeForComparison(this.manager.config.repositoryDirectory) &&
          this.jobsFor(entry).some((job) => job.status === 'queued' && job.intakeModeSelected !== false));
      if (!task) return;
      const jobIds = this.jobsFor(task)
        .filter((job) => job.status === 'queued' && job.intakeModeSelected !== false)
        .map((job) => job.id);
      if (!jobIds.length) return;
      void this.manager.startQueue(jobIds).catch((error) => this.recordAsyncError(error, task));
    } finally {
      this.scheduling = false;
    }
  }

  async recordAsyncError(error, task = null) {
    const target = task || (this.manager.automationRequests || []).find((entry) =>
      this.jobsFor(entry).some((job) => ['inventorying', 'compressing', 'verifying', 'moving'].includes(job.status)));
    if (!target) return;
    target.recoveryRequired = true;
    target.asyncError = { code: error.code || 'AUTOMATION_ERROR', message: error.message, at: new Date().toISOString() };
    await this.manager.recordAutomationRequest({ ...target, jobs: this.jobsFor(target) });
  }
}

function getApplicationTaskService(manager) {
  let service = servicesByManager.get(manager);
  if (!service) {
    service = new ApplicationTaskService(manager);
    servicesByManager.set(manager, service);
  }
  return service;
}

module.exports = { ApplicationTaskService, getApplicationTaskService, legacyTaskFingerprint, normalizePaths, taskFingerprint };
