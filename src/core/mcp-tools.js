'use strict';

const { createCapabilityService, intakePreferences, jobSummary } = require('./mcp-capabilities');
const { getApplicationTaskService } = require('./application-task-service');

const text = { type: 'string', minLength: 1, maxLength: 4096 };
const pagination = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } };
const schema = (properties, required = [], additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties });

const definitions = [
  { name: 'hamster_discover', description: 'Discover Hamster Archiver capabilities by domain or search text. Known routine actions should call their stable capability directly.', inputSchema: schema({ domain: { type: 'string', enum: ['settings', 'intake', 'task', 'queue', 'catalog', 'warehouse', 'similarity', 'app', 'update', 'user_data'] }, query: { type: 'string', maxLength: 128 }, ...pagination }), annotations: { readOnlyHint: true } },
  { name: 'hamster_describe', description: 'Describe one discovered capability, including its input schema, availability and confirmation risk.', inputSchema: schema({ capability: { type: 'string', minLength: 1, maxLength: 128 } }, ['capability']), annotations: { readOnlyHint: true } },
  { name: 'hamster_call', description: 'Call one described capability. Risky calls first return an impact preview and one-time confirmationToken; repeat the exact call with that token after user authorization.', inputSchema: schema({ capability: { type: 'string', minLength: 1, maxLength: 128 }, input: { type: 'object', additionalProperties: true }, confirmationToken: { type: 'string', minLength: 1, maxLength: 128 } }, ['capability']), annotations: { readOnlyHint: false } }
];

// Hidden aliases keep old clients working without advertising all schemas in tools/list.
const legacyDefinitions = [
  { name: 'hamster_search', inputSchema: schema({ query: { type: 'string', maxLength: 512 }, tag: { type: 'string', maxLength: 200 }, ...pagination }) },
  { name: 'hamster_project', inputSchema: schema({ recordId: text, ...pagination }, ['recordId']) },
  { name: 'hamster_batch_import', inputSchema: schema({ requestId: { type: 'string', minLength: 1, maxLength: 128 }, paths: { type: 'array', minItems: 1, maxItems: 100, items: text }, mode: { type: 'string', enum: ['archive', 'inventory_only'] }, archiveOutputDirectory: text, archiveStagingDirectory: text, sourceDisposition: { type: 'string', enum: ['keep', 'trash', 'move'] }, processedSourceDirectory: text }, ['requestId', 'paths', 'mode']) },
  { name: 'hamster_jobs', inputSchema: schema({ requestId: text, ...pagination }) },
  { name: 'hamster_decide', inputSchema: schema({ jobId: text, decisionToken: text, action: { type: 'string', enum: ['continue', 'skip', 'retry'] } }, ['jobId', 'decisionToken', 'action']) }
];

function validate(value, spec, label = 'arguments') {
  if (spec.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    if (spec.additionalProperties !== true) for (const key of Object.keys(value)) if (!Object.hasOwn(spec.properties || {}, key)) throw new Error(`Unknown argument: ${key}`);
    for (const key of spec.required || []) if (!Object.hasOwn(value, key)) throw new Error(`Missing argument: ${key}`);
    for (const [key, entry] of Object.entries(value)) if (spec.properties?.[key]) validate(entry, spec.properties[key], key);
  } else if (spec.type === 'string') {
    if (typeof value !== 'string' || value.length < (spec.minLength || 0) || value.length > (spec.maxLength || Infinity) || (spec.enum && !spec.enum.includes(value))) throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (spec.minimum ?? Number.MIN_SAFE_INTEGER) || value > (spec.maximum ?? Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (spec.minimum ?? -Infinity) || value > (spec.maximum ?? Infinity)) throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`);
  } else if (spec.type === 'array') {
    if (!Array.isArray(value) || value.length < (spec.minItems || 0) || value.length > (spec.maxItems || Infinity)) throw new Error(`Invalid ${label}`);
    for (const entry of value) validate(entry, spec.items, label);
  }
}

function page(items, args) {
  const offset = args.offset || 0, limit = args.limit || 50;
  return { total: items.length, offset, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
}

function projectSummary(record) {
  return Object.fromEntries(['id', 'title', 'displayName', 'recordType', 'fileCount', 'originalBytes', 'archiveState', 'inventoryDate', 'rating', 'tags', 'backupLocation'].map((key) => [key, record[key]]));
}

function createMcpTools(manager, services = {}) {
  let mutating = false;
  const capabilityService = createCapabilityService(manager, {
    ...services,
    tasks: services.tasks || getApplicationTaskService(manager)
  });
  return {
    definitions,
    async call(name, args = {}) {
      const definition = definitions.find((tool) => tool.name === name) || legacyDefinitions.find((tool) => tool.name === name);
      if (!definition) throw new Error('Unknown tool');
      validate(args, definition.inputSchema);
      let described = null;
      if (name === 'hamster_call') {
        described = capabilityService.describe(args.capability);
        validate(args.input || {}, described.inputSchema, 'input');
      }
      const readOnly = ['hamster_discover', 'hamster_describe', 'hamster_search', 'hamster_project', 'hamster_jobs'].includes(name) || described?.readOnly === true;
      if (!readOnly && mutating) throw new Error('BUSY: another AI operation is running. Poll state before retrying.');
      if (!readOnly) mutating = true;
      try {
        if (name === 'hamster_discover') return capabilityService.discover(args);
        if (name === 'hamster_describe') return capabilityService.describe(args.capability);
        if (name === 'hamster_call') {
          return await capabilityService.call(args.capability, args.input || {}, args.confirmationToken || '');
        }
        if (name === 'hamster_search') return page(manager.searchCatalog({ query: args.query || '', tag: args.tag || '' }).map(projectSummary), args);
        if (name === 'hamster_project') {
          const record = manager.catalog.find((item) => item.id === args.recordId);
          if (!record) throw new Error('PROJECT_NOT_FOUND');
          return { ...projectSummary(record), files: page((record.manifest || []).map((file) => ({ relativePath: file.relativePath, size: file.size, md5: file.md5, extension: file.extension })), args) };
        }
        if (name === 'hamster_jobs') return { running: manager.running, paused: manager.paused, scheduleWaiting: manager.scheduleWaiting, safetyHalt: Boolean(manager.safetyHalt), ...page(manager.jobs.filter((job) => !args.requestId || job.mcpRequestId === args.requestId).map(jobSummary), args) };
        if (name === 'hamster_batch_import') {
          const preferences = intakePreferences(manager);
          if (!preferences.configured && !(args.archiveOutputDirectory && args.sourceDisposition)) return preferences;
          return await capabilityService.call('intake.add_batch', { ...args, start: true });
        }
        const job = manager.findJob(args.jobId);
        if (!job.mcpRequestId) throw new Error('AI decisions are limited to AI-created jobs');
        if (jobSummary(job).decisionToken !== args.decisionToken) throw new Error('STALE_DECISION: read hamster_jobs again');
        if (!jobSummary(job).possibleActions.includes(args.action)) throw new Error('Action is not valid for this job state');
        if (manager.running) throw new Error('QUEUE_RUNNING: wait until the queue is idle before deciding');
        await manager.log('info', `MCP: ${args.action}`, job.id);
        if (args.action === 'continue') await manager.confirmJob(job.id, { jobIds: [job.id] });
        if (args.action === 'skip') await manager.cancelJob(job.id);
        if (args.action === 'retry') {
          await manager.retryJob(job.id);
          void manager.startQueue([job.id]).catch((error) => manager.emit('automation-error', error));
        }
        return jobSummary(job);
      } finally {
        if (!readOnly) mutating = false;
      }
    }
  };
}

module.exports = { createMcpTools, definitions, jobSummary, legacyDefinitions };
