'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApplicationTaskService } = require('../src/core/application-task-service');
const { JOB_STATUS_VALUES, TASK_OUTCOME_VALUES, TASK_STATUS_VALUES } = require('../src/core/automation-definitions');
const { resolveIntakeOptions } = require('../src/core/intake-options');
const { parse, reserveResultFile, writeResultFile } = require('../src/core/hamster-cli');
const receiptSchema = require('../docs/AI-TASK-RECEIPT-v2.schema.json');

class RecordingManager extends EventEmitter {
  constructor(root) {
    super();
    this.config = { repositoryDirectory: path.join(root, 'warehouse'), archiveOutputDirectory: path.join(root, 'archives'),
      autoSkipExactDuplicates: false };
    this.jobs = [];
    this.catalog = [];
    this.automationRequests = [];
    this.started = [];
  }
  findAutomationRequest(requestId) {
    return this.automationRequests.find((entry) => entry.requestId === requestId &&
      entry.repositoryDirectory === this.config.repositoryDirectory) || null;
  }
  async recordAutomationRequest(input) {
    const previous = this.findAutomationRequest(input.requestId);
    const entry = { ...previous, ...input, repositoryDirectory: this.config.repositoryDirectory,
      jobIds: input.jobs.map((job) => job.id), updatedAt: new Date().toISOString() };
    this.automationRequests = this.automationRequests.filter((candidate) => candidate !== previous);
    this.automationRequests.push(entry);
    this.emit('state');
    return entry;
  }
  async addSingle(sourcePath, automation) {
    if (this.jobs.some((job) => job.sourcePath === sourcePath)) {
      const error = new Error('Already queued'); error.code = 'SOURCE_ALREADY_QUEUED'; throw error;
    }
    this.jobs.push({ id: `job-${this.jobs.length + 1}`, sourcePath, displayName: path.basename(sourcePath),
      mcpRequestId: automation.requestId, applicationTaskId: automation.taskId,
      processingMode: automation.mode, status: 'queued', intakeModeSelected: true,
      automationDuplicatePolicy: automation.onDuplicate });
    this.emit('state');
  }
  async startQueue(jobIds) { this.started.push([...jobIds]); this.running = true; }
  findJob(id) { return this.jobs.find((job) => job.id === id); }
  async cancelJob(id) { this.findJob(id).status = 'cancelled'; }
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('v2 inventory rejects contradictory handling and archive defaults to keep', () => {
  const output = path.resolve('archive-output');
  assert.throws(() => resolveIntakeOptions({ responseVersion: 2, mode: 'inventory_only',
    sourceDisposition: 'trash' }), { code: 'CONFLICTING_INTAKE_OPTIONS' });
  const archive = resolveIntakeOptions({ responseVersion: 2, mode: 'archive' }, {
    archiveOutputDirectory: output, sourceDisposition: 'trash' });
  assert.equal(archive.sourceDisposition, 'keep');
  assert.equal(archive.archiveOutputDirectory, output);
  assert.equal(resolveIntakeOptions({ mode: 'inventory_only', sourceDisposition: 'trash' }).sourceDisposition, 'keep');
});

test('ten same-key v2 submissions accept once even after saved preferences change', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const input = { responseVersion: 2, requestId: 'same-key', paths: [source], mode: 'inventory_only',
    layout: 'single', waitMilliseconds: 0 };
  const receipts = await Promise.all(Array.from({ length: 10 }, () => service.submitV2(input)));
  assert.equal(new Set(receipts.map((receipt) => receipt.task.id)).size, 1);
  await service.v2Preparations.get(receipts[0].task.id);
  assert.equal(manager.jobs.length, 1);
  manager.config.archiveOutputDirectory = path.join(root, 'changed-archive');
  assert.equal((await service.submitV2(input)).task.id, receipts[0].task.id);
  await assert.rejects(service.submitV2({ ...input, paths: [path.join(root, 'other')] }),
    { code: 'REQUEST_ID_CONFLICT' });
});

test('v2 volume confirmation preference is frozen before asynchronous source preparation', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const manager = new RecordingManager(root);
  manager.config.archiveVolumeConfirmation = true;
  const add = manager.addSingle.bind(manager);
  let submittedOptions;
  manager.addSingle = async (sourcePath, options) => {
    submittedOptions = options.automationRuntimeOptions;
    return add(sourcePath, options);
  };
  const service = new ApplicationTaskService(manager);
  const receipt = await service.submitV2({ responseVersion: 2, requestId: 'frozen-volumes',
    paths: [source], mode: 'archive', layout: 'single', waitMilliseconds: 0, start: false });
  manager.config.archiveVolumeConfirmation = false;
  await service.v2Preparations.get(receipt.task.id);
  assert.equal(manager.findAutomationRequest('frozen-volumes').runtimeOptions.archiveVolumeConfirmation, true);
  assert.equal(submittedOptions.archiveVolumeConfirmation, true);
  assert.deepEqual(manager.started, []);
});

test('v1 same-key replay uses the saved explicit intent before current preferences', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const input = { requestId: 'v1-replay', paths: [source], mode: 'archive',
    archiveOutputDirectory: manager.config.archiveOutputDirectory,
    sourceDisposition: 'keep', waitMilliseconds: 0, startAuthorized: false };
  const first = await service.submit(input);
  assert.equal(manager.jobs.length, 1);
  manager.config.archiveOutputDirectory = path.join(root, 'different-output');
  assert.equal((await service.submit(input)).task.id, first.task.id);
  assert.equal(manager.jobs.length, 1);
  await assert.rejects(service.submit({ ...input, paths: [path.join(root, 'other')] }),
    { code: 'REQUEST_ID_CONFLICT' });
});

test('layout choice holds work, accounts for loose files and invalidates changed source', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  for (const name of ['a', 'b', 'c']) await fs.mkdir(path.join(source, name));
  await fs.writeFile(path.join(source, 'loose.txt'), 'one');
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const first = await service.submitV2({ responseVersion: 2, requestId: 'layout', paths: [source],
    mode: 'inventory_only', layout: 'ask', waitMilliseconds: 0 });
  await service.v2Preparations.get(first.task.id);
  const pending = service.receipt(first.task.id, 2);
  assert.equal(pending.task.status, 'needs_input');
  assert.equal(pending.summary.requestedProjects, null);
  assert.equal(manager.jobs.length, 0);
  const children = pending.decision.choices.find((choice) => choice.id === 'children');
  assert.equal(children.requires.field, 'rootFiles');
  const rootFileChoice = children.requires.choices.find((choice) => choice.id === 'exclude');
  assert.ok(rootFileChoice.effect['zh-CN']);
  assert.ok(rootFileChoice.effect['en-US']);
  assert.equal(pending.nextAction.additionalChoices[0].id, rootFileChoice.id);
  assert.ok(pending.decision.questionLocalized['zh-CN']);
  await assert.rejects(service.resolve(first.task.id, { decisionId: pending.decision.id,
    revision: pending.decision.revision, choice: 'children' }), { code: 'ROOT_FILES_DECISION_REQUIRED' });
  await fs.mkdir(path.join(source, 'd'));
  const changed = await service.resolve(first.task.id, { ...pending.nextAction.input,
    choice: children.id, rootFiles: rootFileChoice.id });
  assert.equal(changed.decision.revision, 2);
  assert.equal(manager.jobs.length, 0);
  await assert.rejects(service.resolve(first.task.id, { decisionId: pending.decision.id,
    revision: pending.decision.revision, choice: 'single' }), { code: 'STALE_DECISION' });
  await service.resolve(first.task.id, { ...changed.nextAction.input,
    choice: changed.decision.choices.find((choice) => choice.id === 'children').id,
    rootFiles: changed.nextAction.additionalChoices[0].id });
  await service.v2Preparations.get(first.task.id);
  const final = service.receipt(first.task.id, 2);
  assert.equal(manager.jobs.length, 4);
  assert.deepEqual(final.excludedRootFiles, ['loose.txt']);
  assert.equal(final.summary.requestedProjects, 4);
});

test('more than one hundred child candidates are never silently truncated', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await Promise.all(Array.from({ length: 101 }, (_, index) =>
    fs.mkdir(path.join(source, `project-${String(index).padStart(3, '0')}`))));
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const accepted = await service.submitV2({ responseVersion: 2, requestId: 'wide-layout', paths: [source],
    mode: 'inventory_only', layout: 'ask', waitMilliseconds: 0 });
  await service.v2Preparations.get(accepted.task.id);
  const pending = service.receipt(accepted.task.id, 2);
  assert.equal(pending.decision.kind, 'scope_too_large');
  assert.equal(pending.decision.context.childDirectories, 101);
  assert.equal(pending.nextAction.kind, 'request_narrower_scope');
  assert.equal(manager.jobs.length, 0);
  const cancelled = await service.cancel(accepted.task.id);
  assert.equal(cancelled.task.status, 'cancelled');
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(service.receipt(accepted.task.id, 2).task.status, 'cancelled');
});

test('a changed child set after the answer returns to a revised decision before admitting jobs', async (t) => {
  const root = await temporaryRoot(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.mkdir(path.join(source, 'first'));
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const accepted = await service.submitV2({ responseVersion: 2, requestId: 'changed-after-answer',
    paths: [source], mode: 'inventory_only', layout: 'ask', waitMilliseconds: 0 });
  await service.v2Preparations.get(accepted.task.id);
  const decision = service.receipt(accepted.task.id, 2);
  const begin = service.beginV2Preparation.bind(service);
  let deferred;
  service.beginV2Preparation = (task) => { deferred = task; return Promise.resolve(); };
  await service.resolve(accepted.task.id, { ...decision.nextAction.input, choice: 'children' });
  await fs.mkdir(path.join(source, 'second'));
  service.beginV2Preparation = begin;
  await service.beginV2Preparation(deferred);
  const revised = service.receipt(accepted.task.id, 2);
  assert.equal(revised.task.status, 'needs_input');
  assert.equal(revised.decision.revision, 2);
  assert.equal(revised.decision.context.childDirectories, 2);
  assert.equal(manager.jobs.length, 0);
});

test('cancelling during an in-flight preparation seals only after admissions stop', async (t) => {
  const root = await temporaryRoot(t);
  const sources = [path.join(root, 'first'), path.join(root, 'second')];
  await Promise.all(sources.map((source) => fs.mkdir(source)));
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  const admit = manager.addSingle.bind(manager);
  let entered;
  let release;
  const inside = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  manager.addSingle = async (...args) => { entered(); await gate; return admit(...args); };
  const submitted = await service.submitV2({ responseVersion: 2, requestId: 'cancel-preparing',
    paths: sources, mode: 'inventory_only', waitMilliseconds: 0 });
  await inside;
  const cancelling = service.cancel(submitted.task.id);
  assert.equal(service.receipt(submitted.task.id, 2).task.status, 'cancelling');
  release();
  const final = await cancelling;
  assert.equal(final.task.status, 'cancelled');
  assert.equal(final.task.terminal, true);
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].status, 'cancelled');
  assert.deepEqual(manager.started, []);
  assert.equal(service.receipt(submitted.task.id, 2).task.status, 'cancelled');
});

test('zero wait returns immediately and v2 counts reuse without claiming creation', async (t) => {
  const root = await temporaryRoot(t);
  const manager = new RecordingManager(root);
  manager.jobs.push({ id: 'reuse', status: 'skipped_duplicate', sourcePath: path.join(root, 'source'),
    exactProjectMatches: [{ id: 'existing', verification: 'md5' }], automationDuplicatePolicy: 'use_existing' });
  manager.catalog.push({ id: 'existing', archiveState: 'compressed' });
  const service = new ApplicationTaskService(manager);
  const task = await manager.recordAutomationRequest({ requestId: 'reused', taskId: 'task-reused',
    mode: 'archive', options: { mode: 'archive', sourceDisposition: 'keep' },
    paths: [path.join(root, 'source')], jobs: manager.jobs, failures: [] });
  const started = performance.now();
  const receipt = await service.wait(task.taskId, 0, 2);
  assert.ok(performance.now() - started < 100);
  assert.equal(receipt.outcome, 'already_present');
  assert.equal(receipt.summary.created, 0);
  assert.equal(receipt.summary.reused, 1);
  assert.equal(receipt.existingRecords[0].recordId, 'existing');
});

test('zero wait leaves pending work queued and invalid service timeouts fail explicitly', async (t) => {
  const root = await temporaryRoot(t);
  const manager = new RecordingManager(root);
  const job = { id: 'pending-job', sourcePath: root, processingMode: 'inventory_only', status: 'queued' };
  manager.jobs.push(job);
  const service = new ApplicationTaskService(manager);
  const task = await manager.recordAutomationRequest({ requestId: 'pending-request', taskId: 'pending-task',
    mode: 'inventory_only', options: { mode: 'inventory_only' }, paths: [root], jobs: [job], failures: [] });
  const receipt = await Promise.race([
    service.wait(task.taskId, 0, 2),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('zero wait blocked')), 250))
  ]);
  assert.equal(receipt.task.status, 'queued');
  assert.equal(receipt.task.terminal, false);
  assert.equal(job.status, 'queued');
  assert.equal(manager.listenerCount('state'), 0);
  for (const value of [-1, 60_001, 1.5, NaN, '0', null]) {
    await assert.rejects(service.wait(task.taskId, value, 2), { code: 'INVALID_TIMEOUT' });
  }
  assert.equal(job.status, 'queued');
});

test('one hundred waits release listeners and a completion in the subscription gap is observed', async (t) => {
  const root = await temporaryRoot(t);
  const manager = new RecordingManager(root);
  const job = { id: 'wait-job', sourcePath: root, processingMode: 'inventory_only', status: 'queued' };
  manager.jobs.push(job);
  const service = new ApplicationTaskService(manager);
  const task = await manager.recordAutomationRequest({ requestId: 'wait-request', taskId: 'wait-task',
    mode: 'inventory_only', options: { mode: 'inventory_only' }, paths: [root], jobs: [job], failures: [] });
  for (let index = 0; index < 100; index++) {
    const waiting = service.wait(task.taskId, 1_000, 2);
    job.status = 'completed';
    manager.emit('state');
    assert.equal((await waiting).task.status, 'completed');
    assert.equal(manager.listenerCount('state'), 0);
    job.status = 'queued';
  }
  const original = service.receipt.bind(service);
  let reads = 0;
  service.receipt = (...args) => {
    const result = original(...args);
    if (++reads === 1) job.status = 'completed';
    return result;
  };
  assert.equal((await service.wait(task.taskId, 1_000, 2)).task.status, 'completed');
  assert.equal(manager.listenerCount('state'), 0);
});

test('aborting a wait releases its listener without cancelling the task', async (t) => {
  const root = await temporaryRoot(t);
  const manager = new RecordingManager(root);
  const job = { id: 'abort-job', sourcePath: root, processingMode: 'inventory_only', status: 'queued' };
  manager.jobs.push(job);
  const service = new ApplicationTaskService(manager);
  const task = await manager.recordAutomationRequest({ requestId: 'abort-request', taskId: 'abort-task',
    mode: 'inventory_only', options: { mode: 'inventory_only' }, paths: [root], jobs: [job], failures: [] });
  const controller = new AbortController();
  const waiting = service.wait(task.taskId, 60_000, 2, controller.signal);
  assert.equal(manager.listenerCount('state'), 1);
  controller.abort();
  assert.equal((await waiting).task.status, 'queued');
  assert.equal(manager.listenerCount('state'), 0);
  assert.equal(job.status, 'queued');
});

test('CLI exposes versioned intent and result files refuse existing targets', async (t) => {
  const root = await temporaryRoot(t);
  const parsed = parse(['intake', path.join(root, 'source'), '--inventory', '--layout', 'ask',
    '--on-duplicate', 'use_existing', '--result-file', path.join(root, 'receipt.json'), '--json']);
  assert.equal(parsed.input.responseVersion, 2);
  assert.equal(parsed.input.layout, 'ask');
  assert.equal(parsed.input.onDuplicate, 'use_existing');
  assert.equal(parse(['task', 'resolve', 'task-1', '--decision', 'decision-1', '--revision', '2',
    '--choice', 'children', '--root-files', 'exclude']).input.rootFiles, 'exclude');
  const target = path.join(root, 'receipt.json');
  const reservation = await reserveResultFile(target);
  await assert.rejects(reserveResultFile(target), { code: 'EEXIST' });
  await writeResultFile(reservation, { schemaVersion: 2, ok: true });
  assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).ok, true);
});

test('v2 receipt buckets partition requested projects across terminal and waiting states', async (t) => {
  const root = await temporaryRoot(t);
  const service = new ApplicationTaskService(new RecordingManager(root));
  const cases = [
    { jobs: [{ status: 'completed' }, { status: 'failed' }], status: 'partial_failed', outcome: 'partial_failed' },
    { jobs: [{ status: 'completed_cleanup_failed' }], status: 'partial_failed', outcome: 'partial_failed' },
    { jobs: [{ status: 'completed' }, { status: 'cancelled' }], status: 'partial_failed', outcome: 'partial_failed' },
    { jobs: [{ status: 'cancelled' }], status: 'cancelled', outcome: 'cancelled' },
    { jobs: [{ status: 'skipped_duplicate' }], status: 'completed', outcome: 'skipped' },
    { jobs: [{ status: 'queued' }], status: 'queued', outcome: 'pending' },
    { jobs: [], noChange: true, status: 'completed', outcome: 'no_change' },
    { jobs: [], recoveryRequired: true, status: 'recovery_required', outcome: 'recovery_required' }
  ];
  for (const [index, item] of cases.entries()) {
    const jobs = item.jobs.map((job, number) => ({ id: `${index}-${number}`, sourcePath: root,
      processingMode: 'inventory_only', ...job }));
    const task = { taskId: `task-${index}`, requestId: `request-${index}`, responseVersion: 2,
      repositoryDirectory: service.manager.config.repositoryDirectory, paths: [root],
      mode: 'inventory_only', options: { mode: 'inventory_only', sourceDisposition: 'keep' },
      jobs, jobIds: jobs.map((job) => job.id), failures: [],
      noChange: item.noChange, recoveryRequired: item.recoveryRequired };
    const v1 = service.receipt(task, 1);
    const v2 = service.receipt(task, 2);
    for (const field of receiptSchema.required) assert.ok(Object.hasOwn(v2, field), `missing ${field}`);
    assert.ok(receiptSchema.properties.task.properties.status.enum.includes(v2.task.status));
    assert.ok(receiptSchema.properties.outcome.enum.includes(v2.outcome));
    assert.ok(v2.jobs.every((job) => receiptSchema.properties.jobs.items.properties.status.enum.includes(job.status)));
    assert.equal(v1.schemaVersion, 1);
    assert.equal(v2.schemaVersion, 2);
    assert.equal(v2.task.status, item.status);
    assert.equal(v2.outcome, item.outcome);
    assert.equal(v2.summary.requestedProjects, ['created', 'updated', 'reused', 'skipped',
      'failed', 'cancelled', 'pending'].reduce((sum, key) => sum + v2.summary[key], 0));
  }
});

test('published v2 schema enums match the capability manifest values', () => {
  assert.deepEqual(receiptSchema.properties.task.properties.status.enum, TASK_STATUS_VALUES);
  assert.deepEqual(receiptSchema.properties.jobs.items.properties.status.enum, JOB_STATUS_VALUES);
  assert.deepEqual(receiptSchema.properties.outcome.enum, TASK_OUTCOME_VALUES);
});

test('duplicate decision wording tracks available evidence including historical jobs', async (t) => {
  const root = await temporaryRoot(t);
  const manager = new RecordingManager(root);
  const service = new ApplicationTaskService(manager);
  for (const evidence of [null, { completeContentFingerprint: false, md5SkippedReasons: ['large-folder'] },
    { completeContentFingerprint: true, md5SkippedReasons: [] }]) {
    const job = { id: 'decision-job', status: 'awaiting_duplicate_confirmation',
      processingMode: 'inventory_only', exactProjectMatches: [], duplicateMatchEvidence: evidence };
    const task = { taskId: 'decision-task', jobIds: [job.id], jobs: [job], failures: [],
      options: { mode: 'inventory_only' } };
    const receipt = service.receipt(task, 2);
    assert.deepEqual(receipt.decision.choices.map((choice) => choice.id), ['create_new', 'skip']);
    assert.doesNotMatch(receipt.decision.question, /Reuse it/);
    assert.ok(receipt.decision.context.reuseUnavailableReason);
    assert.ok(receipt.decision.questionLocalized['zh-CN']);
    assert.ok(receipt.decision.choices.every((choice) => choice.effect['zh-CN'] && choice.effect['en-US']));
    assert.equal(receipt.summary.created, 0);
    assert.equal(receipt.summary.reused, 0);
  }
});
