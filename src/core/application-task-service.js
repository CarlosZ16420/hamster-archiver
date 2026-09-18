'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
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

function normalizePaths(paths) {
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
    const normalized = path.normalize(value);
    return [normalizeForComparison(normalized), normalized];
  })).values()];
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

function publicJob(job) {
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
    error: job.errorCode || job.errorMessage
      ? { code: job.errorCode || 'TASK_FAILED', message: job.errorMessage || job.stageText || 'Task failed.' }
      : null
  };
}

class ApplicationTaskService {
  constructor(manager) {
    if (!manager) throw new Error('ApplicationTaskService requires QueueManager.');
    this.manager = manager;
    this.scheduling = false;
    this.manager.on?.('idle', () => { void this.schedule().catch((error) => this.recordAsyncError(error)); });
  }

  findTask(taskId) {
    const value = String(taskId || '').trim();
    return (this.manager.automationRequests || []).find((entry) =>
      entry.taskId === value || entry.requestId === value) || null;
  }

  jobsFor(task) {
    const ids = new Set(task?.jobIds || (task?.jobs || []).map((job) => job.id));
    const live = (this.manager.jobs || []).filter((job) => ids.has(job.id));
    const liveIds = new Set(live.map((job) => job.id));
    return [...live, ...(task?.jobs || []).filter((job) => !liveIds.has(job.id))];
  }

  receipt(taskOrId) {
    const task = typeof taskOrId === 'string' ? this.findTask(taskOrId) : taskOrId;
    if (!task) throw codedError('TASK_NOT_FOUND', 'The requested Hamster task does not exist.', 'lookup', {
      requiredAction: 'check_task_id'
    });
    const jobs = this.jobsFor(task);
    let status = taskStatus(jobs, task);
    if (this.manager.paused && status === 'running') status = 'paused';
    const records = (this.manager.catalog || []).filter((record) =>
      jobs.some((job) => record.archiveJobId === job.id || record.jobId === job.id ||
        (job.status === 'completed' && job.taskKind === 'catalog_refresh' && job.sourceCatalogRecordId === record.id)));
    const warnings = [];
    for (const job of jobs) {
      if (job.status === 'completed_cleanup_failed') warnings.push({
        code: job.errorCode || 'SOURCE_DISPOSITION_FAILED',
        message: job.errorMessage || job.stageText || 'The archive was saved but source handling did not finish.',
        jobId: job.id
      });
    }
    const results = records.map((record) => ({
      recordId: record.id,
      jobId: jobs.find((job) => record.archiveJobId === job.id || record.jobId === job.id ||
        (job.status === 'completed' && job.taskKind === 'catalog_refresh' && job.sourceCatalogRecordId === record.id))?.id,
      mode: record.archiveState === 'uncompressed' ? 'inventory_only' : 'archive',
      catalogCommitted: true,
      sourceDisposition: record.sourceDisposition || 'kept',
      archiveVerification: record.archiveState === 'uncompressed' ? 'not_applicable' : 'verified',
      ...(record.archiveDirectory ? { archiveDirectory: record.archiveDirectory } : {}),
      ...(Array.isArray(record.archiveFiles) ? { archiveFiles: record.archiveFiles.map((file) => file.name || file.path || file) } : {})
    }));
    const nextAction = status === 'needs_confirmation'
      ? { action: jobs.some((job) => job.status === 'awaiting_source_change_confirmation') ? 'review_source_changes_in_desktop' : 'resolve',
          jobIds: jobs.filter((job) => String(job.status || '').startsWith('awaiting_')).map((job) => job.id) }
      : status === 'recovery_required' ? { action: 'inspect_recovery_evidence' }
        : isTerminalTaskStatus(status) ? null : { action: 'wait', suggestedTimeoutSeconds: 20 };
    return {
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
  }

  async submit(input = {}) {
    const paths = normalizePaths(input.paths);
    const requestId = String(input.requestId || '').trim() || `request-${crypto.randomUUID()}`;
    if (requestId.length > 128) throw codedError('INVALID_REQUEST_ID', 'requestId cannot exceed 128 characters.', 'prepare');
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

    // Idempotency is deliberately checked before queue state. A retry of an accepted
    // request always returns the original task, even while unrelated work is running.
    const existing = this.manager.findAutomationRequest?.(requestId);
    if (existing) {
      const compatibleFingerprint = existing.fingerprint === requestFingerprint ||
        (!existing.taskId && existing.fingerprint === legacyTaskFingerprint(paths, options));
      if (!compatibleFingerprint) {
        throw codedError('REQUEST_ID_CONFLICT', 'This requestId is already bound to different input.', 'prepare', {
          requiredAction: 'use_new_request_id'
        });
      }
      return this.receipt(existing);
    }

    const taskId = `task-${crypto.randomUUID()}`;
    let task = await this.manager.recordAutomationRequest({
      requestId,
      taskId,
      fingerprint: requestFingerprint,
      mode: options.mode,
      paths,
      options,
      jobs: [],
      failures: [],
      acceptedAt: new Date().toISOString()
    });
    const failures = [];
    for (const sourcePath of paths) {
      try {
        await this.manager.addSingle(sourcePath, {
          requestId,
          taskId,
          explicit: true,
          ...options
        });
      } catch (error) {
        failures.push({
          source: sourcePath,
          code: error.code || 'INTAKE_FAILED',
          message: error.message
        });
      }
    }
    const jobs = (this.manager.jobs || []).filter((job) => job.mcpRequestId === requestId);
    task = await this.manager.recordAutomationRequest({
      requestId,
      taskId,
      fingerprint: requestFingerprint,
      mode: options.mode,
      paths,
      options,
      jobs,
      failures,
      acceptedAt: task.acceptedAt
    });
    if (!jobs.length) return this.receipt(task);
    await this.schedule();
    if (input.waitMilliseconds !== 0) {
      const waitMilliseconds = Math.min(2_000, Math.max(0, Number(input.waitMilliseconds) || 1_500));
      return this.wait(taskId, waitMilliseconds);
    }
    return this.receipt(task);
  }

  get(taskId) {
    return this.receipt(taskId);
  }

  async wait(taskId, timeoutMilliseconds = 20_000) {
    const timeout = Math.min(60_000, Math.max(0, Number(timeoutMilliseconds) || 20_000));
    const initial = this.receipt(taskId);
    if (initial.task.terminal || initial.task.status === 'needs_confirmation' || timeout === 0) return initial;
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
      this.manager.removeListener?.('state', changed);
        resolve(this.receipt(taskId));
      };
      const changed = () => {
        const current = this.receipt(taskId);
        if (current.task.terminal || current.task.status === 'needs_confirmation') finish();
      };
      this.manager.on?.('state', changed);
      timer = setTimeout(finish, timeout);
      timer.unref?.();
    });
  }

  assertOwnedJob(task, jobId) {
    const ids = new Set(task.jobIds || (task.jobs || []).map((job) => job.id));
    if (!ids.has(jobId)) throw codedError('JOB_OUTSIDE_TASK', 'The selected job does not belong to this task.', 'resolve');
    return this.manager.findJob(jobId);
  }

  async resolve(taskId, input = {}) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
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

  async retry(taskId) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    const jobs = this.jobsFor(task).filter((job) => ['failed', 'cancelled'].includes(job.status));
    if (!jobs.length) throw codedError('NOTHING_TO_RETRY', 'This task has no failed or cancelled jobs.', 'retry');
    for (const job of jobs) await this.manager.retryJob(job.id);
    task.recoveryRequired = false;
    await this.manager.recordAutomationRequest({ ...task, jobs: this.jobsFor(task), failures: [] });
    await this.schedule();
    return this.receipt(task);
  }

  async cancel(taskId) {
    const task = this.findTask(taskId);
    if (!task) return this.receipt(taskId);
    for (const job of this.jobsFor(task)) {
      if (!['completed', 'completed_cleanup_failed', 'skipped_duplicate', 'cancelled'].includes(job.status)) {
        await this.manager.cancelJob(job.id);
      }
    }
    return this.receipt(task);
  }

  async schedule() {
    if (this.scheduling || this.manager.running || this.manager.scheduleWaiting || this.manager.safetyHalt) return;
    this.scheduling = true;
    try {
      const task = [...(this.manager.automationRequests || [])]
        .sort((left, right) => String(left.acceptedAt || left.createdAt).localeCompare(String(right.acceptedAt || right.createdAt)))
        .find((entry) => this.jobsFor(entry).some((job) => job.status === 'queued' && job.intakeModeSelected !== false));
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
