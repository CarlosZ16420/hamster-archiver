'use strict';

const TERMINAL_JOB_STATUSES = new Set([
  'completed',
  'completed_cleanup_failed',
  'skipped_duplicate',
  'failed',
  'cancelled'
]);

const ACTIVE_JOB_STATUSES = new Set([
  'inventorying',
  'compressing',
  'verifying',
  'moving'
]);

const CONFIRMATION_JOB_STATUSES = new Set([
  'awaiting_confirmation',
  'awaiting_duplicate_confirmation',
  'awaiting_source_change_confirmation',
  'awaiting_anomaly_confirmation',
  'awaiting_trash_safety_confirmation'
]);

function codedError(code, message, stage = 'request', options = {}) {
  const error = new Error(message);
  error.code = code;
  error.stage = stage;
  error.retryable = options.retryable === true;
  error.requiredAction = options.requiredAction || null;
  return error;
}

function errorEnvelope(error, fallbackStage = 'request') {
  const code = String(error?.code || 'HAMSTER_ERROR');
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      stage: String(error?.stage || fallbackStage),
      message: String(error?.message || error || 'Hamster Archiver operation failed.'),
      retryable: error?.retryable === true,
      requiredAction: error?.requiredAction || null
    }
  };
}

function taskStatus(jobs, task = {}) {
  if (task.recoveryRequired) return 'recovery_required';
  if (!jobs.length) return task.failures?.length ? 'failed' : 'accepted';
  if (jobs.some((job) => ['INTERRUPTED', 'SOURCE_DISPOSITION_COMMIT_FAILED'].includes(job.errorCode))) {
    return 'recovery_required';
  }
  if (jobs.some((job) => CONFIRMATION_JOB_STATUSES.has(job.status))) return 'needs_confirmation';
  if (jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) return 'running';
  if (jobs.some((job) => job.status === 'queued')) return 'queued';
  if (jobs.some((job) => job.status === 'cancelling')) return 'cancelling';
  const completed = jobs.filter((job) => job.status === 'completed' || job.status === 'skipped_duplicate').length;
  const warnings = jobs.filter((job) => job.status === 'completed_cleanup_failed').length;
  const failed = jobs.filter((job) => job.status === 'failed').length + (task.failures?.length || 0);
  const cancelled = jobs.filter((job) => job.status === 'cancelled').length;
  if (failed || warnings) return completed || warnings ? 'partial_failed' : 'failed';
  if (cancelled) return completed ? 'partial_failed' : 'cancelled';
  return jobs.every((job) => TERMINAL_JOB_STATUSES.has(job.status)) ? 'completed' : 'preparing';
}

function isTerminalTaskStatus(status) {
  return ['completed', 'completed_with_warnings', 'partial_failed', 'failed', 'cancelled', 'recovery_required'].includes(status);
}

function summarizeJobs(jobs, failures = []) {
  const succeeded = jobs.filter((job) => ['completed', 'completed_cleanup_failed'].includes(job.status)).length;
  const skipped = jobs.filter((job) => job.status === 'skipped_duplicate').length;
  const failed = jobs.filter((job) => ['failed', 'cancelled'].includes(job.status)).length + failures.length;
  return { requested: jobs.length + failures.length, succeeded, skipped, failed };
}

module.exports = {
  ACTIVE_JOB_STATUSES,
  CONFIRMATION_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  codedError,
  errorEnvelope,
  isTerminalTaskStatus,
  summarizeJobs,
  taskStatus
};
