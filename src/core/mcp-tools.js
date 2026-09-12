'use strict';

const path = require('node:path');

const text = { type: 'string', minLength: 1, maxLength: 4096 };
const pagination = {
  offset: { type: 'integer', minimum: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100 }
};
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = [
  { name: 'hamster_search', description: 'Search local warehouse projects by title, tag or file name. Returns paginated metadata, never passwords or media.', inputSchema: schema({ query: { type: 'string', maxLength: 512 }, tag: { type: 'string', maxLength: 200 }, ...pagination }), annotations: { readOnlyHint: true } },
  { name: 'hamster_project', description: 'Read project metadata and a page of its stored file manifest. Does not read original media or recalculate similarity.', inputSchema: schema({ recordId: text, ...pagination }, ['recordId']), annotations: { readOnlyHint: true } },
  { name: 'hamster_batch_import', description: 'Add up to 100 absolute folder/video paths and automatically start intake. Use a stable requestId when retrying the same batch. mode is archive or inventory_only. Original sources are always kept. Returns job IDs; poll hamster_jobs for completion, errors and decisions. Uses the existing queue and schedule; refuses to start unrelated selected work.', inputSchema: schema({ requestId: { type: 'string', minLength: 1, maxLength: 128 }, paths: { type: 'array', minItems: 1, maxItems: 100, items: text }, mode: { type: 'string', enum: ['archive', 'inventory_only'] } }, ['requestId', 'paths', 'mode']), annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'hamster_jobs', description: 'Poll paginated job status, percentage, errors and similarity evidence. Select requestId to follow an import. possibleActions lists valid next calls to hamster_decide. A returned submission is not completion.', inputSchema: schema({ requestId: text, ...pagination }), annotations: { readOnlyHint: true } },
  { name: 'hamster_decide', description: 'Resolve an AI-created job: continue after reviewing current confirmation evidence; skip cancels a pending job without deleting sources; retry retries a failed/cancelled job. Supply the decisionToken from hamster_jobs so stale decisions are rejected. Safety/anomaly stops require the desktop UI.', inputSchema: schema({ jobId: text, decisionToken: text, action: { type: 'string', enum: ['continue', 'skip', 'retry'] } }, ['jobId', 'decisionToken', 'action']), annotations: { readOnlyHint: false, destructiveHint: false } }
];

function validate(value, spec, label = 'arguments') {
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value)) if (!Object.hasOwn(spec.properties, key)) throw new Error(`Unknown argument: ${key}`);
    for (const key of spec.required || []) if (!Object.hasOwn(value, key)) throw new Error(`Missing argument: ${key}`);
    for (const [key, entry] of Object.entries(value)) validate(entry, spec.properties[key], key);
  } else if (spec.type === 'string') {
    if (typeof value !== 'string' || value.length < (spec.minLength || 0) || value.length > (spec.maxLength || Infinity) || (spec.enum && !spec.enum.includes(value))) throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (spec.minimum || 0) || value > (spec.maximum || Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'array') {
    if (!Array.isArray(value) || value.length < spec.minItems || value.length > spec.maxItems) throw new Error(`Invalid ${label}`);
    for (const entry of value) validate(entry, spec.items, label);
  }
}

function page(items, args) {
  const offset = args.offset || 0;
  const limit = args.limit || 50;
  return { total: items.length, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}

function projectSummary(record) {
  return Object.fromEntries(['id', 'title', 'displayName', 'recordType', 'fileCount', 'originalBytes', 'archiveState', 'inventoryDate', 'rating', 'tags', 'backupLocation'].map((key) => [key, record[key]]));
}

function decisionToken(job) {
  return require('node:crypto').createHash('sha256').update(JSON.stringify([
    job.id, job.status, job.duplicateReviewFingerprint, job.errorCode, job.errorMessage, job.startedAt, job.confirmedAt
  ])).digest('hex');
}

function jobSummary(job) {
  const possibleActions = !job.mcpRequestId ? []
    : ['awaiting_confirmation', 'awaiting_duplicate_confirmation'].includes(job.status) ? ['continue', 'skip']
      : ['failed', 'cancelled'].includes(job.status) ? ['retry']
        : job.status === 'queued' ? ['skip'] : [];
  return {
    id: job.id, requestId: job.mcpRequestId, displayName: job.displayName, status: job.status,
    progress: job.progress, stageText: job.stageText, errorCode: job.errorCode, errorMessage: job.errorMessage,
    confirmationReasons: job.confirmationReasons, duplicateReviewKind: job.duplicateReviewKind,
    similarMatches: (job.similarMatches || []).slice(0, 20),
    exactProjectMatches: (job.exactProjectMatches || []).slice(0, 20),
    exactDuplicateMatches: (job.exactDuplicateMatches || []).slice(0, 20),
    nameDuplicateMatches: (job.nameDuplicateMatches || []).slice(0, 20),
    possibleActions, decisionToken: decisionToken(job),
    needsDesktop: String(job.status).includes('confirmation') && possibleActions.length === 0
  };
}

function createMcpTools(manager) {
  let mutating = false;
  const noUnrelatedWork = () => {
    if (manager.jobs.some((job) => !job.mcpRequestId && job.intakeModeSelected && job.status === 'queued')) {
      throw new Error('UNRELATED_QUEUE_WORK: finish or pause the selected desktop jobs before AI intake.');
    }
  };
  const start = () => {
    void manager.startQueue().catch((error) => manager.emit('automation-error', error));
  };
  return {
    definitions,
    async call(name, args = {}) {
      const definition = definitions.find((tool) => tool.name === name);
      if (!definition) throw new Error('Unknown tool');
      validate(args, definition.inputSchema);
      const mutation = !definition.annotations.readOnlyHint;
      if (mutation && mutating) throw new Error('BUSY: another AI operation is running. Poll jobs before retrying.');
      if (mutation) mutating = true;
      try {
        if (name === 'hamster_search') return page(manager.searchCatalog({ query: args.query || '', tag: args.tag || '' }).map(projectSummary), args);
        if (name === 'hamster_project') {
          const record = manager.catalog.find((item) => item.id === args.recordId);
          if (!record) throw new Error('PROJECT_NOT_FOUND');
          return { ...projectSummary(record), files: page((record.manifest || []).map((file) => ({ relativePath: file.relativePath, size: file.size, md5: file.md5, extension: file.extension })), args) };
        }
        if (name === 'hamster_jobs') return {
          running: manager.running, paused: manager.paused, scheduleWaiting: manager.scheduleWaiting,
          safetyHalt: Boolean(manager.safetyHalt),
          ...page(manager.jobs.filter((job) => !args.requestId || job.mcpRequestId === args.requestId).map(jobSummary), args)
        };
        if (name === 'hamster_batch_import') {
          const paths = [...new Set(args.paths.map((entry) => {
            if (!path.isAbsolute(entry) || entry.includes('\0')) throw new Error('Each source must be an absolute local path');
            return path.normalize(entry);
          }))];
          const previous = manager.jobs.filter((job) => job.mcpRequestId === args.requestId);
          if (previous.some((job) => job.processingMode !== args.mode || !paths.includes(job.sourcePath))) throw new Error('REQUEST_ID_CONFLICT: use a new requestId for a different batch');
          const missing = paths.filter((source) => !previous.some((job) => job.sourcePath === source));
          if (!missing.length) return { jobs: previous.map(jobSummary), failures: [], reused: true };
          if (manager.running) throw new Error('QUEUE_RUNNING: poll jobs and retry once idle');
          noUnrelatedWork();
          const failures = [];
          for (const source of missing) {
            try { await manager.addSingle(source, { requestId: args.requestId, mode: args.mode }); }
            catch (error) { failures.push({ source, code: error.code || 'INTAKE_FAILED', message: error.message }); }
          }
          const jobs = manager.jobs.filter((job) => job.mcpRequestId === args.requestId);
          if (jobs.length) start();
          return { jobs: jobs.map(jobSummary), failures, reused: false };
        }
        if (name === 'hamster_decide') {
          const job = manager.findJob(args.jobId);
          if (!job.mcpRequestId) throw new Error('AI decisions are limited to AI-created jobs');
          if (decisionToken(job) !== args.decisionToken) throw new Error('STALE_DECISION: read hamster_jobs again');
          if (!jobSummary(job).possibleActions.includes(args.action)) throw new Error('Action is not valid for this job state');
          if (manager.running) throw new Error('QUEUE_RUNNING: wait until the queue is idle before deciding');
          noUnrelatedWork();
          await manager.log('info', `MCP: ${args.action}`, job.id);
          if (args.action === 'continue') await manager.confirmJob(job.id);
          if (args.action === 'skip') await manager.cancelJob(job.id);
          if (args.action === 'retry') { await manager.retryJob(job.id); start(); }
          return jobSummary(job);
        }
      } finally { if (mutation) mutating = false; }
    }
  };
}

module.exports = { createMcpTools, definitions, jobSummary };
