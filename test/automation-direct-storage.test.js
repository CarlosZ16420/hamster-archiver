'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApplicationTaskService } = require('../src/core/application-task-service');
const { offlineTerminalReceipt } = require('../src/core/cli-request-store');
const { QueueManager } = require('../src/core/queue-manager');
const { AppStore } = require('../src/core/store');
const { makeUserDataLayout } = require('../src/core/storage-paths');

const sevenZipPath = path.resolve(__dirname, '..', 'tools', '7zip', '7z.exe');

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-store-'));
  const userDataRoot = path.join(root, 'userdata');
  const repositoryDirectory = path.join(root, 'warehouse');
  const store = new AppStore(makeUserDataLayout(root, null, userDataRoot));
  await store.saveSettings({ repositoryDirectory });
  const config = { repositoryDirectory, userDataDirectory: userDataRoot,
    archiveOutputDirectory: path.join(root, 'archives'),
    archiveStagingDirectory: path.join(root, 'staging'), smallItemFilter: false,
    similarityEnabled: false, ...options };
  const manager = new QueueManager(store, config);
  await manager.initialize();
  t.after(async () => {
    store.closeAll();
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await fs.rm(root, { recursive: true, force: true }); return; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY'].includes(error.code) || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });
  return { root, userDataRoot, repositoryDirectory, store, manager };
}

test('v2 preparation emits a complete queue state for an open desktop window', async (t) => {
  const { root, manager } = await setup(t);
  const askRoot = path.join(root, 'ask-root');
  const emptyRoot = path.join(root, 'empty-root');
  await fs.mkdir(path.join(askRoot, 'child'), { recursive: true });
  await fs.mkdir(emptyRoot);
  let emissions = 0;
  manager.on('state', (state) => {
    assert.ok(state && Array.isArray(state.catalog) && Array.isArray(state.jobs));
    emissions += 1;
  });
  const service = new ApplicationTaskService(manager);
  const ask = await service.submitV2({ responseVersion: 2, requestId: 'desktop-ask',
    paths: [askRoot], mode: 'inventory_only', layout: 'ask', waitMilliseconds: 0 });
  await service.v2Preparations.get(ask.task.id);
  assert.equal(service.receipt(ask.task.id, 2).task.status, 'needs_input');
  const empty = await service.submitV2({ responseVersion: 2, requestId: 'desktop-empty',
    paths: [emptyRoot], mode: 'inventory_only', layout: 'children', waitMilliseconds: 0 });
  await service.v2Preparations.get(empty.task.id);
  assert.equal(service.receipt(empty.task.id, 2).task.status, 'completed');
  assert.ok(emissions >= 2);
});

test('real Store persists an immutable terminal receipt readable without starting the app', async (t) => {
  const { root, userDataRoot, repositoryDirectory, store, manager } = await setup(t);
  const sourcePath = path.join(root, 'source');
  const job = { id: 'job-completed', mcpRequestId: 'request-completed', applicationTaskId: 'task-completed',
    sourcePath, displayName: 'source', processingMode: 'archive', status: 'completed',
    progress: 100, sourceDisposition: 'kept', archiveOutputDirectory: path.join(root, 'archives') };
  const record = { id: 'record-original', archiveJobId: job.id, archiveState: 'compressed',
    archiveDirectory: path.join(root, 'archives'), archiveFiles: [], sourceDisposition: 'kept',
    title: 'Original title', verifiedAt: new Date().toISOString() };
  manager.jobs = [job];
  manager.catalog = [record];
  await store.saveCatalog(repositoryDirectory, manager.catalog);
  await manager.persistJobs();
  const saved = await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'first', responseVersion: 2, mode: 'archive',
    options: { mode: 'archive', layout: 'single', onDuplicate: 'ask', sourceDisposition: 'keep' },
    paths: [sourcePath], jobs: [job], failures: [], acceptedAt: new Date().toISOString() });
  assert.equal(saved.terminalReceipts[2].summary.created, 1);
  assert.equal(saved.terminalReceipts[2].results[0].archiveVerification, 'verified');
  assert.equal(saved.terminalReceipts[2].evidence.persisted, true);
  record.title = 'Changed later';
  await store.saveCatalog(repositoryDirectory, manager.catalog);
  manager.jobs = [];
  await manager.persistJobs();
  assert.deepEqual(await offlineTerminalReceipt(userDataRoot, job.applicationTaskId, 2), saved.terminalReceipts[2]);
  store.closeAll();
  const restarted = new QueueManager(new AppStore(makeUserDataLayout(root, null, userDataRoot)), manager.config);
  try {
    await restarted.initialize();
    assert.deepEqual(new ApplicationTaskService(restarted).get(job.applicationTaskId, 2), saved.terminalReceipts[2]);
  } finally { restarted.store.closeAll(); }
});

test('anomaly move recovery survives queue clearing in the offline receipt', async (t) => {
  const { root, userDataRoot, manager } = await setup(t);
  const sourcePath = path.join(root, 'source', 'project');
  const destination = path.join(root, 'processed');
  const movedTo = path.join(destination, 'project');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.txt'), 'source moved once');
  const job = { id: 'anomaly-recovery-job', mcpRequestId: 'anomaly-recovery-request',
    applicationTaskId: 'anomaly-recovery-task', sourcePath, displayName: 'project',
    processingMode: 'archive', status: 'awaiting_anomaly_confirmation',
    pendingCatalogRecord: { id: 'anomaly-recovery-record', jobId: 'anomaly-recovery-job',
      archiveJobId: 'anomaly-recovery-job', title: 'project', displayName: 'project',
      recordType: 'archive', archiveState: 'compressed', manifest: [], archiveFiles: [],
      completionAction: 'move', completionDestination: destination,
      sourceDisposition: 'move_pending', completedAt: new Date().toISOString() } };
  manager.jobs = [job];
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'anomaly-recovery', responseVersion: 2, mode: 'archive',
    options: { mode: 'archive', layout: 'single', onDuplicate: 'ask', sourceDisposition: 'move' },
    paths: [sourcePath], jobs: [job], failures: [] });
  manager.services.validateSourceBeforeDisposition = async () => {};
  manager.moveCompletedItem = async () => {
    await fs.mkdir(destination, { recursive: true });
    await fs.rename(sourcePath, movedTo);
    return movedTo;
  };
  const saveCatalogRecords = manager.saveCatalogRecords.bind(manager);
  let catalogSaves = 0;
  manager.saveCatalogRecords = async (records) => {
    catalogSaves += 1;
    if (catalogSaves === 2) throw Object.assign(new Error('final catalog save denied'), { code: 'EACCES' });
    return saveCatalogRecords(records);
  };

  await manager.confirmAnomaly(job.id);
  assert.equal(job.errorCode, 'SOURCE_DISPOSITION_COMMIT_FAILED');
  await assert.rejects(fs.access(sourcePath), { code: 'ENOENT' });
  await fs.access(path.join(movedTo, 'source.txt'));
  await manager.clearQueue();
  assert.equal(manager.jobs.length, 0);
  const receipt = await offlineTerminalReceipt(userDataRoot, job.applicationTaskId, 2);
  const legacyReceipt = await offlineTerminalReceipt(userDataRoot, job.applicationTaskId, 1);
  assert.equal(receipt.task.status, 'recovery_required');
  assert.equal(receipt.evidence.persisted, true);
  assert.deepEqual(receipt.nextAction, { kind: 'inspect_recovery_evidence', target: job.id });
  assert.deepEqual(receipt.jobs[0].sourceDispositionRecovery, {
    action: 'move', sourceDisposition: 'moved', originalSourcePath: sourcePath,
    movedTo, trashedAt: ''
  });
  assert.equal(receipt.results[0].sourceDisposition, 'unknown');
  assert.deepEqual(legacyReceipt.nextAction, { action: 'inspect_recovery_evidence' });
  assert.equal(legacyReceipt.jobs[0].sourceDispositionRecovery.movedTo, movedTo);
});

test('each completed job keeps its own result while the rest of the task is still running', async (t) => {
  const { root, repositoryDirectory, manager, store } = await setup(t);
  const first = { id: 'first-job', mcpRequestId: 'multi-request', applicationTaskId: 'multi-task',
    sourcePath: path.join(root, 'first'), processingMode: 'inventory_only', status: 'completed' };
  const second = { id: 'second-job', mcpRequestId: 'multi-request', applicationTaskId: 'multi-task',
    sourcePath: path.join(root, 'second'), processingMode: 'inventory_only', status: 'queued' };
  manager.jobs = [first, second];
  manager.catalog = [{ id: 'first-record', archiveJobId: first.id, archiveState: 'uncompressed',
    sourceDisposition: 'kept', title: 'Before' }];
  await store.saveCatalog(repositoryDirectory, manager.catalog);
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: first.mcpRequestId, taskId: first.applicationTaskId,
    fingerprint: 'multi', responseVersion: 2, mode: 'inventory_only', paths: [first.sourcePath, second.sourcePath],
    options: { mode: 'inventory_only', layout: 'single' }, jobs: manager.jobs, failures: [] });
  const firstFact = manager.findAutomationRequest(first.mcpRequestId).jobs[0].terminalResult;
  assert.equal(firstFact.archiveState, 'uncompressed');
  manager.catalog[0].archiveState = 'compressed';
  manager.catalog[0].archiveDirectory = path.join(root, 'new-archive');
  manager.catalog.push({ id: 'second-record', archiveJobId: second.id, archiveState: 'uncompressed',
    sourceDisposition: 'kept' });
  second.status = 'completed';
  await store.saveCatalog(repositoryDirectory, manager.catalog);
  await manager.persistJobs();
  const terminal = manager.findAutomationRequest(first.mcpRequestId).terminalReceipts[2];
  assert.equal(terminal.results.find((item) => item.jobId === first.id).archiveState, 'uncompressed');
  assert.equal(terminal.results.find((item) => item.jobId === first.id).archiveDirectory, undefined);
  assert.equal(terminal.summary.created, 2);
});

test('catalog commit before job receipt reconciles without repeating source handling', async (t) => {
  const { root, repositoryDirectory, manager, store } = await setup(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const job = { id: 'committed-job', mcpRequestId: 'committed-request', applicationTaskId: 'committed-task',
    sourcePath: source, processingMode: 'archive', status: 'queued' };
  manager.jobs = [job];
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'committed', responseVersion: 2, mode: 'archive', paths: [source],
    options: { mode: 'archive', layout: 'single', sourceDisposition: 'move' }, jobs: [job], failures: [] });
  const record = { id: 'committed-record', archiveJobId: job.id, archiveState: 'compressed',
    completedAt: new Date().toISOString(), sourceDisposition: 'move_pending', archiveFiles: [] };
  manager.catalog = [record];
  await store.saveCatalog(repositoryDirectory, manager.catalog);
  let moved = 0;
  manager.services.moveCompletedItem = async () => { moved++; };
  await manager.runOne(job);
  assert.equal(moved, 0);
  assert.equal(job.status, 'completed_cleanup_failed');
  assert.equal(manager.findAutomationRequest(job.mcpRequestId).terminalReceipts[2].results[0].sourceDisposition, 'move_pending');
  assert.equal((await fs.stat(source)).isDirectory(), true);
});

test('real archive duplicate reuse and explicit new record leave the original intact', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const { root, manager } = await setup(t, { sevenZipPath, archivePassword: '',
    archiveVolumeEnabled: false, autoSkipExactDuplicates: false });
  manager.config.archiveOutputDirectory = path.join(root, 'archives');
  manager.config.archiveStagingDirectory = path.join(root, 'staging');
  await fs.mkdir(manager.config.archiveOutputDirectory, { recursive: true });
  await fs.mkdir(manager.config.archiveStagingDirectory, { recursive: true });
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const bytes = crypto.randomBytes(512 * 1024);
  await fs.writeFile(path.join(source, 'content.bin'), bytes);
  const service = new ApplicationTaskService(manager);
  const submit = async (requestId, sourcePath, onDuplicate) => {
    const accepted = await service.submit({ requestId, paths: [sourcePath], mode: 'archive',
      layout: 'single', onDuplicate, sourceDisposition: 'keep',
      archiveOutputDirectory: manager.config.archiveOutputDirectory,
      responseVersion: 2, waitMilliseconds: 0 });
    return service.wait(accepted.task.id, 30_000, 2);
  };
  const seeded = await submit('seed-archive', source, 'create_new');
  assert.equal(seeded.outcome, 'created', JSON.stringify(seeded));
  assert.equal(manager.catalog.length, 1);
  const oldRecord = structuredClone(manager.catalog[0]);
  const reused = await submit('reuse-archive', source, 'use_existing');
  assert.equal(reused.outcome, 'already_present', JSON.stringify(reused));
  assert.equal(reused.summary.created, 0);
  assert.equal(reused.existingRecords[0].recordId, oldRecord.id);
  assert.equal(reused.existingRecords[0].archiveState, 'compressed');
  assert.equal(manager.catalog.length, 1);
  const asked = await submit('ask-archive', source, 'ask');
  assert.equal(asked.task.status, 'needs_confirmation', JSON.stringify(asked));
  assert.equal(asked.decision.kind, 'duplicate');
  const newRecord = await service.resolve(asked.task.id, { decisionId: asked.decision.id,
    revision: asked.decision.revision, choice: 'create_new' });
  const completed = await service.wait(newRecord.task.id, 30_000, 2);
  assert.equal(completed.outcome, 'created', JSON.stringify(completed));
  assert.equal(manager.catalog.length, 2);
  assert.deepEqual(manager.catalog.find((record) => record.id === oldRecord.id), oldRecord);
  assert.equal(manager.config.autoSkipExactDuplicates, false);
  const different = path.join(root, 'different');
  await fs.mkdir(different);
  const changed = Buffer.from(bytes);
  changed[0] ^= 0xff;
  await fs.writeFile(path.join(different, 'content.bin'), changed);
  const unrelated = await submit('different-content', different, 'use_existing');
  assert.notEqual(unrelated.outcome, 'already_present', JSON.stringify(unrelated));
  assert.equal(unrelated.summary.reused, 0);
  if (manager.running) await new Promise((resolve) => manager.once('idle', resolve));
});

test('active requests survive 200-history retention and reject a new task at capacity', async (t) => {
  const { root, repositoryDirectory, store, manager } = await setup(t);
  const active = Array.from({ length: 201 }, (_, index) => ({
    requestId: `active-${index}`, taskId: `task-${index}`, repositoryDirectory,
    jobs: [{ id: `job-${index}`, status: 'queued' }], paths: [], failures: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }));
  await store.saveAutomationRequests(active);
  const restarted = new QueueManager(new AppStore(makeUserDataLayout(root, null, manager.config.userDataDirectory)), manager.config);
  await restarted.initialize();
  assert.equal(restarted.automationRequests.length, 201);
  await assert.rejects(restarted.recordAutomationRequest({ requestId: 'new', taskId: 'new-task',
    mode: 'inventory_only', paths: [], jobs: [], failures: [], fingerprint: 'new' }),
  { code: 'ACTIVE_TASK_LIMIT' });
  restarted.store.closeAll();
});

test('cancellation blocks a scheduled queue tick and a concurrent start before the ledger write finishes', async (t) => {
  const { root, manager } = await setup(t, { scheduleEnabled: true });
  const sourcePath = path.join(root, 'source');
  const job = { id: 'scheduled-job', mcpRequestId: 'scheduled-request', applicationTaskId: 'scheduled-task',
    sourcePath, displayName: 'source', processingMode: 'inventory_only', status: 'queued',
    intakeModeSelected: true, automationStartAuthorized: true };
  manager.jobs.push(job);
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'scheduled', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only', layout: 'single', sourceDisposition: 'keep' },
    paths: [sourcePath], jobs: [job], failures: [] });
  const service = new ApplicationTaskService(manager);
  const starts = [];
  manager.startQueue = async (jobIds) => { starts.push(jobIds); };
  manager.scheduleWindow = () => ({ active: true, startAt: new Date() });
  const persist = manager.persistJobs.bind(manager);
  let entered;
  let release;
  const inside = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  manager.persistJobs = async () => { entered(); await gate; return persist(); };
  const cancelling = service.cancel(job.applicationTaskId);
  await inside;
  assert.equal(job.automationStartAuthorized, false);
  await manager.handleScheduleTick();
  await service.start(job.applicationTaskId, 2);
  assert.deepEqual(starts, []);
  assert.equal(job.automationStartAuthorized, false);
  release();
  const final = await cancelling;
  assert.equal(final.task.status, 'cancelled');
  assert.deepEqual(starts, []);
});

test('admission finishing after cancellation keeps its new job unauthorized', async (t) => {
  const { root, manager } = await setup(t);
  const sourcePath = path.join(root, 'source');
  await fs.mkdir(sourcePath);
  const task = await manager.recordAutomationRequest({ requestId: 'late-request', taskId: 'late-task',
    fingerprint: 'late', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only', layout: 'single', sourceDisposition: 'keep' },
    paths: [sourcePath], jobs: [], failures: [], preparing: true });
  const queued = manager.isSourcePathQueued.bind(manager);
  let calls = 0;
  manager.isSourcePathQueued = async (...args) => {
    calls += 1;
    if (calls === 2) manager.requestAutomationCancellation(task.taskId);
    return queued(...args);
  };
  await manager.addSingle(sourcePath, { requestId: task.requestId, taskId: task.taskId,
    explicit: true, startAuthorized: true, mode: 'inventory_only', sourceDisposition: 'keep' });
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].automationStartAuthorized, false);
});

test('stale ledger refresh cannot erase an in-flight cancellation intent', async (t) => {
  const { root, store, manager } = await setup(t, { scheduleEnabled: true });
  const first = path.join(root, 'first');
  const job = { id: 'stale-job', mcpRequestId: 'stale-request', applicationTaskId: 'stale-task',
    sourcePath: first, displayName: 'first', processingMode: 'inventory_only', status: 'queued',
    intakeModeSelected: true, automationStartAuthorized: true };
  manager.jobs.push(job);
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'stale', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only', layout: 'single', sourceDisposition: 'keep' },
    paths: [first], jobs: [job], failures: [] });
  const service = new ApplicationTaskService(manager);
  const starts = [];
  manager.startQueue = async (jobIds) => { starts.push(jobIds); };
  manager.scheduleWindow = () => ({ active: true, startAt: new Date() });
  const save = store.saveAutomationRequests.bind(store);
  let saveCalls = 0;
  let enteredFirst;
  let enteredSecond;
  let releaseFirst;
  let releaseSecond;
  const firstSave = new Promise((resolve) => { enteredFirst = resolve; });
  const secondSave = new Promise((resolve) => { enteredSecond = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  store.saveAutomationRequests = async (...args) => {
    saveCalls += 1;
    if (saveCalls === 1) { enteredFirst(); await firstGate; }
    if (saveCalls === 2) { enteredSecond(); await secondGate; }
    return save(...args);
  };
  job.stageText = 'changed before cancellation';
  const staleRefresh = manager.refreshAutomationRequests();
  await firstSave;
  const cancelling = service.cancel(job.applicationTaskId);
  assert.equal(manager.automationCancellationIntents.has(job.applicationTaskId), true);
  releaseFirst();
  await secondSave;
  try {
    assert.equal(manager.automationCancellationIntents.has(job.applicationTaskId), true);
    assert.equal(service.findTask(job.applicationTaskId).cancellationRequested, true);
    assert.equal(job.automationStartAuthorized, false);
    await manager.handleScheduleTick();
    assert.deepEqual(starts, []);
  } finally { releaseSecond(); }
  await Promise.all([staleRefresh, cancelling]);
  assert.deepEqual(starts, []);
});

test('restart revokes queued jobs when cancellation was saved before job authorization', async (t) => {
  const { root, store, manager } = await setup(t);
  const job = { id: 'restart-job', mcpRequestId: 'restart-request', applicationTaskId: 'restart-task',
    sourcePath: path.join(root, 'source'), displayName: 'source', processingMode: 'inventory_only',
    status: 'queued', intakeModeSelected: true, automationStartAuthorized: true };
  manager.jobs.push(job);
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'restart', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only', layout: 'single', sourceDisposition: 'keep' },
    paths: [job.sourcePath], jobs: [job], failures: [], cancellationRequested: true });
  store.closeAll();
  const restartedStore = new AppStore(makeUserDataLayout(root, null, path.join(root, 'userdata')));
  try {
    const restarted = new QueueManager(restartedStore, manager.config);
    await restarted.initialize();
    assert.equal(restarted.jobs[0].automationStartAuthorized, false);
  } finally { restartedStore.closeAll(); }
});

test('cancelling an undecided empty task releases a real Store admission slot after restart', async (t) => {
  const { root, repositoryDirectory, store, manager } = await setup(t);
  const active = Array.from({ length: 200 }, (_, index) => ({
    requestId: `pending-${index}`, taskId: `task-pending-${index}`, repositoryDirectory,
    responseVersion: 2, mode: 'inventory_only', paths: [path.join(root, 'source')],
    options: { mode: 'inventory_only', layout: 'ask', onDuplicate: 'ask' },
    jobs: [], failures: [], preparing: false,
    decision: { id: `decision-${index}`, revision: 1, kind: 'project_layout',
      question: 'Choose layout', choices: [{ id: 'single' }, { id: 'children' }], context: {} },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }));
  await store.saveAutomationRequests(active);
  const restarted = new QueueManager(new AppStore(makeUserDataLayout(root, null, manager.config.userDataDirectory)), manager.config);
  try {
    await restarted.initialize();
    await assert.rejects(restarted.recordAutomationRequest({ requestId: 'new-slot', taskId: 'new-slot',
      mode: 'inventory_only', paths: [], jobs: [], failures: [], fingerprint: 'new-slot' }),
    { code: 'ACTIVE_TASK_LIMIT' });
    const cancelled = await new ApplicationTaskService(restarted).cancel('task-pending-0');
    assert.equal(cancelled.task.status, 'cancelled');
    assert.equal(cancelled.evidence.persisted, true);
    await restarted.recordAutomationRequest({ requestId: 'new-slot', taskId: 'new-slot',
      mode: 'inventory_only', paths: [], jobs: [], failures: [], fingerprint: 'new-slot' });
    assert.ok(restarted.findAutomationRequest('new-slot'));
  } finally { restarted.store.closeAll(); }
});

test('clearing queued automation jobs seals cancellation before deleting visible rows', async (t) => {
  const { repositoryDirectory, manager } = await setup(t);
  const job = { id: 'queued-to-clear', mcpRequestId: 'clear-request', applicationTaskId: 'clear-task',
    sourcePath: path.join(repositoryDirectory, 'input'), displayName: 'input',
    processingMode: 'inventory_only', status: 'queued', automationStartAuthorized: false };
  manager.jobs = [job];
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'clear', responseVersion: 2, mode: 'inventory_only', paths: [job.sourcePath],
    options: { mode: 'inventory_only', layout: 'single', onDuplicate: 'ask' }, jobs: [job], failures: [] });
  await manager.clearQueue();
  assert.equal(manager.jobs.length, 0);
  const saved = manager.findAutomationRequest('clear-request');
  assert.equal(saved.jobs[0].status, 'cancelled');
  assert.equal(saved.terminalReceipts[2].summary.cancelled, 1);
  assert.equal(saved.terminalReceipts[2].task.status, 'cancelled');
});

test('receipt write failure leaves a queued job visible for recovery', async (t) => {
  const { repositoryDirectory, manager, store } = await setup(t);
  const job = { id: 'save-failure', mcpRequestId: 'save-failure-request',
    applicationTaskId: 'save-failure-task', sourcePath: path.join(repositoryDirectory, 'input'),
    displayName: 'input', processingMode: 'inventory_only', status: 'queued' };
  manager.jobs = [job];
  await manager.persistJobs();
  await manager.recordAutomationRequest({ requestId: job.mcpRequestId, taskId: job.applicationTaskId,
    fingerprint: 'save-failure', responseVersion: 2, mode: 'inventory_only', paths: [job.sourcePath],
    options: { mode: 'inventory_only', layout: 'single', onDuplicate: 'ask' }, jobs: [job], failures: [] });
  const original = store.saveAutomationRequests.bind(store);
  store.saveAutomationRequests = async () => { throw Object.assign(new Error('injected persistence failure'), { code: 'EIO' }); };
  try { await assert.rejects(manager.clearQueue(), { code: 'EIO' }); }
  finally { store.saveAutomationRequests = original; }
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].status, 'cancelled');
  await manager.clearQueue();
  assert.equal(manager.findAutomationRequest(job.mcpRequestId).terminalReceipts[2].summary.cancelled, 1);
});

test('v2 recovery links a durable job when its request-ledger refresh fails', async (t) => {
  const { root, repositoryDirectory, userDataRoot, manager, store } = await setup(t);
  const source = path.join(root, 'ledger-gap-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'one.txt'), 'persist the job first');
  const originalSave = store.saveAutomationRequests.bind(store);
  let injected = false;
  store.saveAutomationRequests = async (requests) => {
    if (!injected && manager.jobs.some((job) => job.mcpRequestId === 'ledger-gap-request')) {
      injected = true;
      throw Object.assign(new Error('injected ledger refresh failure'), { code: 'EIO' });
    }
    return originalSave(requests);
  };
  const service = new ApplicationTaskService(manager);
  service.schedule = async () => {};
  const accepted = await service.submit({ requestId: 'ledger-gap-request', paths: [source],
    mode: 'inventory_only', layout: 'single', responseVersion: 2, waitMilliseconds: 0 });
  await service.v2Preparations.get(accepted.task.id);
  assert.equal(injected, true);
  assert.equal((await store.loadJobs(repositoryDirectory)).length, 1);
  const recovered = service.get(accepted.task.id, 2);
  assert.equal(recovered.task.status, 'recovery_required');
  assert.deepEqual(recovered.task.jobIds, [manager.jobs[0].id]);
  assert.equal(recovered.summary.pending, 1);
  assert.equal(manager.findAutomationRequest('ledger-gap-request').jobs[0].id, manager.jobs[0].id);

  store.closeAll();
  const restarted = new QueueManager(new AppStore(makeUserDataLayout(root, null, userDataRoot)), manager.config);
  try {
    await restarted.initialize();
    const afterRestart = new ApplicationTaskService(restarted).get(accepted.task.id, 2);
    assert.equal(afterRestart.task.status, 'recovery_required');
    assert.deepEqual(afterRestart.task.jobIds, [manager.jobs[0].id]);
    assert.equal(restarted.jobs.length, 1);
  } finally { restarted.store.closeAll(); }
});

test('v2 admission freezes execution settings before asynchronous source inspection', async (t) => {
  const { root, manager } = await setup(t);
  const source = path.join(root, 'small-source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'one.txt'), 'small explicit source');
  manager.config.compressionLevel = 1;
  manager.config.thumbnailLimit = 4;
  manager.config.archiveFormat = '7z';
  let entered;
  let release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const originalAddSingle = manager.addSingle.bind(manager);
  manager.addSingle = async (...args) => { entered(); await gate; return originalAddSingle(...args); };
  const service = new ApplicationTaskService(manager);
  service.schedule = async () => {};
  const accepted = await service.submit({ requestId: 'snapshot-request', paths: [source],
    mode: 'inventory_only', layout: 'single', responseVersion: 2, waitMilliseconds: 0 });
  assert.equal(accepted.task.status, 'preparing');
  await enteredPromise;
  manager.config.compressionLevel = 9;
  manager.config.thumbnailLimit = 120;
  manager.config.archiveFormat = 'zip';
  release();
  await service.v2Preparations.get(accepted.task.id);
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].compressionLevel, 1);
  assert.equal(manager.jobs[0].archiveFormat, '7z');
  assert.equal(manager.jobs[0].automationRuntimeOptions.thumbnailLimit, 4);
});

test('start false survives idle and schedule ticks until task.start authorizes only its jobs', async (t) => {
  const { root, manager } = await setup(t);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'one.txt'), 'data');
  const started = [];
  manager.startQueue = async (ids) => { started.push([...ids]); };
  manager.config.scheduleEnabled = true;
  manager.scheduleWindow = () => ({ active: true, startAt: new Date() });
  const service = new ApplicationTaskService(manager);
  const receipt = await service.submit({ requestId: 'held-request', paths: [source],
    mode: 'inventory_only', startAuthorized: false, waitMilliseconds: 0 });
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].automationStartAuthorized, false);
  manager.emit('idle');
  await new Promise((resolve) => setImmediate(resolve));
  await manager.handleScheduleTick();
  assert.equal(started.length, 0);
  await service.start(receipt.task.id, 1);
  assert.deepEqual(started, [[manager.jobs[0].id]]);
  assert.equal(manager.jobs[0].automationStartAuthorized, true);
});

test('selected retry preserves completed, cancelled, and unselected intake failures', async (t) => {
  const { root, manager } = await setup(t);
  const retrySource = path.join(root, 'retry-source');
  await fs.mkdir(retrySource);
  await fs.writeFile(path.join(retrySource, 'one.txt'), 'data');
  const requestId = 'mixed-request';
  const taskId = 'mixed-task';
  manager.jobs = ['completed', 'failed', 'cancelled'].map((status) => ({ id: `job-${status}`,
    sourcePath: path.join(root, status), displayName: status,
    mcpRequestId: requestId, applicationTaskId: taskId,
    processingMode: 'inventory_only', intakeModeSelected: true, status }));
  await manager.persistJobs();
  const task = await manager.recordAutomationRequest({ requestId, taskId, fingerprint: 'mixed',
    responseVersion: 2, mode: 'inventory_only', paths: [retrySource],
    options: { mode: 'inventory_only', layout: 'single', onDuplicate: 'ask', sourceDisposition: 'keep' },
    jobs: manager.jobs, failures: [
      { source: retrySource, code: 'FIRST_FAILURE', message: 'retry this' },
      { source: path.join(root, 'other-failure'), code: 'SECOND_FAILURE', message: 'keep this' }
    ] });
  assert.ok(task.terminalReceipts[2]);
  const service = new ApplicationTaskService(manager);
  service.schedule = async () => {};
  await assert.rejects(service.retry(taskId, { jobIds: ['job-cancelled'] }), { code: 'INVALID_RETRY_SELECTION' });
  const retried = await service.retry(taskId, { jobIds: ['job-failed'], failureSources: [retrySource] });
  assert.equal(retried.task.status, 'queued');
  assert.equal(manager.findJob('job-completed').status, 'completed');
  assert.equal(manager.findJob('job-cancelled').status, 'cancelled');
  assert.equal(manager.findJob('job-failed').status, 'queued');
  assert.equal(manager.jobs.length, 4);
  const saved = manager.findAutomationRequest(requestId);
  assert.equal(saved.attempt, 2);
  assert.equal(saved.attemptReceipts.length, 1);
  assert.equal(saved.attemptReceipts[0][2].summary.failed, 3);
  assert.equal(saved.failures.length, 1);
  assert.equal(saved.failures[0].code, 'SECOND_FAILURE');
});

test('the same request ID is isolated between two warehouses sharing one user-data root', async (t) => {
  const { root, userDataRoot, repositoryDirectory, manager: first } = await setup(t);
  const secondRepository = path.join(root, 'other-warehouse');
  await first.recordAutomationRequest({ requestId: 'shared-request', taskId: 'first-task',
    fingerprint: 'first', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only' }, paths: [], jobs: [], failures: [], noChange: true });
  const secondStore = new AppStore(makeUserDataLayout(root, null, userDataRoot));
  try {
  await secondStore.saveSettings({ repositoryDirectory: secondRepository });
  const second = new QueueManager(secondStore, { ...first.config, repositoryDirectory: secondRepository });
  await second.initialize();
  await second.recordAutomationRequest({ requestId: 'shared-request', taskId: 'second-task',
    fingerprint: 'second', responseVersion: 2, mode: 'inventory_only',
    options: { mode: 'inventory_only' }, paths: [], jobs: [], failures: [], noChange: true });
  assert.equal(first.findAutomationRequest('shared-request').taskId, 'first-task');
  assert.equal(second.findAutomationRequest('shared-request').taskId, 'second-task');
  assert.equal(new ApplicationTaskService(first).findTask('second-task'), null);
  assert.equal(new ApplicationTaskService(second).findTask('first-task'), null);
  const offline = await offlineTerminalReceipt(userDataRoot, 'second-task', 2);
  assert.equal(offline.task.id, 'second-task');
  assert.equal(offline.runtime.repositoryDirectory, secondRepository);
  assert.notEqual(repositoryDirectory, secondRepository);
  } finally { secondStore.closeAll(); }
});
