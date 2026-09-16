'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createMcpTools, jobSummary } = require('../src/core/mcp-tools');
const { createRpcHandler, startMcpServer } = require('../src/core/mcp-server');
const { QueueManager } = require('../src/core/queue-manager');
const { AppStore } = require('../src/core/store');
const { createArchivePublicationReceipt } = require('../src/core/archive-engine');
const {
  MCP_CLIENT_RUNTIME_SWITCHES,
  EXPECTED_MCP_TOOLS,
  isUnexpectedLaunchExit,
  main: runMcpClient,
  parseCli,
  readJsonArguments,
  reserveOutputFile,
  validateDoctorResults,
  waitForReady
} = require('../src/core/mcp-client');
const {
  createDesktopLaunchRequest,
  takeDesktopLaunchRequest
} = require('../src/core/mcp-launch');

function fakeManager() {
  return {
    config: {
      archiveOutputDirectory: path.resolve('output'),
      intakePreferences: { version: 1, archiveOutputDirectory: path.resolve('output'), sourceDisposition: 'keep', processedSourceDirectory: '', source: 'desktop' }
    },
    jobs: [], catalog: [{ id: 'r1', title: 'sample', archivePassword: 'secret', manifest: [{ relativePath: 'image.jpg', size: 4, thumbnailPath: 'private' }] }],
    searchCatalog() { return this.catalog; },
    async addSingle(sourcePath, automation) { this.jobs.push({ id: String(this.jobs.length), sourcePath, mcpRequestId: automation.requestId, processingMode: automation.mode, status: 'queued', intakeModeSelected: true }); },
    async startQueue() { this.starts = (this.starts || 0) + 1; },
    findJob(id) { return this.jobs.find((job) => job.id === id); },
    async log() {},
    async confirmJob(id) { this.findJob(id).status = 'queued'; },
    async cancelJob(id) { this.findJob(id).status = 'cancelled'; },
    async retryJob(id) { this.findJob(id).status = 'queued'; },
    emit() {}
  };
}

test('MCP launcher keeps the native graphics profile and launch failures do not wait for timeout', async () => {
  assert.deepEqual(MCP_CLIENT_RUNTIME_SWITCHES, ['--disable-crash-reporter', '--disable-breakpad']);
  assert.equal(parseCli(['describe', ...MCP_CLIENT_RUNTIME_SWITCHES]).command, 'describe');
  const launcher = await fs.readFile(path.resolve(__dirname, '..', 'scripts', 'HamsterArchiver-MCP.cmd'), 'utf8');
  assert.equal(launcher.includes('--disable-gpu'), false);
  assert.equal(parseCli([]).command, 'stdio');
  assert.throws(() => parseCli(['doctor-please']), /Unknown command/);
  assert.equal(isUnexpectedLaunchExit(0), false);
  assert.equal(isUnexpectedLaunchExit(1), true);
  const startedAt = Date.now();
  await assert.rejects(
    waitForReady(path.join(os.tmpdir(), 'hamster-mcp-ready-missing.json'), 1_000, () => new Error('restricted child process')),
    /restricted child process/
  );
  assert.ok(Date.now() - startedAt < 500, 'known launch failures should be reported immediately');
});

test('desktop launch requests are bound to the intended executable and consumed once', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-launch-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'HamsterArchiver.exe');
  const readyFile = path.join(root, `hamster-mcp-ready-${process.pid}-${crypto.randomBytes(16).toString('hex')}.json`);
  const diagnosticFile = path.join(root, `hamster-mcp-diagnostic-${process.pid}-${crypto.randomBytes(16).toString('hex')}.json`);
  await createDesktopLaunchRequest({ applicationExecutable: executable, readyFile, diagnosticFile, showUi: true, tempDirectory: root });
  assert.equal(takeDesktopLaunchRequest({ applicationExecutable: path.join(root, 'Other.exe'), tempDirectory: root }), null);
  assert.deepEqual(takeDesktopLaunchRequest({ applicationExecutable: executable, tempDirectory: root }), {
    readyFile,
    diagnosticFile,
    showUi: true
  });
  assert.equal(takeDesktopLaunchRequest({ applicationExecutable: executable, tempDirectory: root }), null);
});

test('MCP reads are paginated and do not expose passwords or thumbnail paths', async () => {
  const service = createMcpTools(fakeManager());
  const result = await service.call('hamster_project', { recordId: 'r1', limit: 1 });
  assert.equal(result.files.total, 1);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal((await service.call('hamster_search', { offset: 1 })).items.length, 0);
  await assert.rejects(service.call('hamster_search', { limit: 101 }), /Invalid limit/);
  await assert.rejects(service.call('hamster_search', { surprise: true }), /Unknown argument/);
});

test('AI intake starts automatically, handles partial failures and reuses persistent job request IDs', async () => {
  const manager = fakeManager();
  const original = manager.addSingle;
  manager.addSingle = async function (source, automation) {
    if (source.endsWith('bad')) throw new Error('unreadable');
    return original.call(this, source, automation);
  };
  const args = { requestId: 'batch-one', mode: 'inventory_only', paths: [path.resolve('good'), path.resolve('bad')] };
  const first = await createMcpTools(manager).call('hamster_batch_import', args);
  assert.equal(first.jobs.length, 1);
  assert.equal(first.failures.length, 1);
  assert.equal(manager.starts, 1);
  manager.addSingle = original;
  const second = await createMcpTools(manager).call('hamster_batch_import', args);
  assert.equal(second.jobs.length, 2);
  assert.equal(manager.jobs.length, 2);
  const third = await createMcpTools(manager).call('hamster_batch_import', args);
  assert.equal(third.reused, true);
  assert.equal(manager.jobs.length, 2);
  await assert.rejects(createMcpTools(manager).call('hamster_batch_import', { ...args, mode: 'archive' }), /CONFLICT/);
});

test('AI refuses unrelated queued work, concurrent mutations and stale confirmations', async () => {
  const manager = fakeManager();
  const service = createMcpTools(manager);
  manager.jobs.push({ id: 'desktop', status: 'queued', intakeModeSelected: true });
  const args = { requestId: 'batch', mode: 'archive', paths: [path.resolve('sample')] };
  await assert.rejects(service.call('hamster_batch_import', args), /UNRELATED/);
  manager.jobs = [];
  let release;
  manager.addSingle = () => new Promise((resolve) => { release = resolve; });
  const pending = service.call('hamster_batch_import', args);
  await assert.rejects(service.call('hamster_batch_import', args), /BUSY/);
  release();
  await pending;
  const job = { id: 'ai', mcpRequestId: 'batch', status: 'awaiting_duplicate_confirmation', duplicateReviewFingerprint: 'old' };
  manager.jobs = [job];
  const token = jobSummary(job).decisionToken;
  job.duplicateReviewFingerprint = 'new';
  await assert.rejects(service.call('hamster_decide', { jobId: 'ai', action: 'continue', decisionToken: token }), /STALE/);
  await service.call('hamster_decide', { jobId: 'ai', action: 'continue', decisionToken: jobSummary(job).decisionToken });
  assert.equal(job.status, 'queued');
  job.status = 'awaiting_anomaly_confirmation';
  assert.equal(jobSummary(job).needsDesktop, true);
  await assert.rejects(service.call('hamster_decide', { jobId: 'ai', action: 'continue', decisionToken: jobSummary(job).decisionToken }), /not valid/);
});

test('MCP protocol negotiates initialization and reports tool errors', async () => {
  const dispatch = createRpcHandler(createMcpTools(fakeManager()), 'test');
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).result.protocolVersion, '2025-06-18');
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, 3);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'unknown' } })).result.isError, true);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 4, method: 'unknown' })).error.code, -32601);
  assert.equal((await dispatch([])).error.code, -32600);
});

test('doctor requires the expected protocol, instance and all three tools', () => {
  const connection = { instanceId: 'instance-one', version: 'test' };
  const initialized = { result: { protocolVersion: '2025-11-25', serverInfo: { name: 'hamster-archiver', version: 'test' } } };
  const runtime = { result: { instanceId: 'instance-one', version: 'test' } };
  const tools = { result: { tools: EXPECTED_MCP_TOOLS.map((name) => ({ name })) } };
  assert.deepEqual(validateDoctorResults(initialized, runtime, tools, connection).names, EXPECTED_MCP_TOOLS);
  assert.throws(() => validateDoctorResults(initialized, runtime, { result: { tools: [] } }, connection), /missing required tools/);
  assert.throws(() => validateDoctorResults(initialized, { error: { message: 'runtime failed' } }, tools, connection), /runtime failed/);
  assert.throws(() => validateDoctorResults(initialized, { result: { instanceId: 'other' } }, tools, connection), /does not match/);
});

test('local MCP rejects unauthorized/browser access and works through the actual stdio adapter', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-'));
  const sessionCounts = [];
  const server = await startMcpServer(fakeManager(), root, 'test', {
    onSessionCountChanged: (count) => sessionCounts.push(count)
  });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const connection = JSON.parse(await fs.readFile(server.connectionFile));
  assert.equal(connection.schemaVersion, 2);
  assert.match(connection.instanceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(Date.parse(connection.startedAt));
  assert.equal(connection.version, 'test');
  assert.equal((await fetch(connection.url)).status, 403);
  assert.equal((await fetch(connection.url, { headers: { Authorization: `Bearer ${connection.token}`, Origin: 'https://example.com' } })).status, 403);
  const child = spawn(process.execPath, [path.resolve('src/core/mcp-client.js'), '--connection', server.connectionFile], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hamster_search', arguments: {} } }
  ].map((message) => JSON.stringify(message)).join('\n') + '\n');
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(code, 0, errors);
  const messages = output.trim().split('\n').map(JSON.parse);
  assert.equal(messages.length, 3);
  assert.equal(messages[2].result.structuredContent.items[0].id, 'r1');
  assert.equal(server.sessionCount, 0);
  const doctor = spawn(process.execPath, [path.resolve('src/core/mcp-client.js'), 'doctor', '--connection', server.connectionFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let doctorOutput = '', doctorErrors = '';
  doctor.stdout.on('data', (chunk) => { doctorOutput += chunk; });
  doctor.stderr.on('data', (chunk) => { doctorErrors += chunk; });
  const doctorCode = await new Promise((resolve) => doctor.once('exit', resolve));
  assert.equal(doctorCode, 0, doctorErrors);
  const doctorResult = JSON.parse(doctorOutput);
  assert.equal(doctorResult.ok, true);
  assert.deepEqual(doctorResult.tools, EXPECTED_MCP_TOOLS);
  assert.equal(server.sessionCount, 0);
  assert.deepEqual(sessionCounts, [1, 0, 1, 0]);
});

test('AI batch uses the real inventory queue, persists automation identity and keeps original files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-intake-'));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'sample.txt'), 'synthetic test content');
  const store = new AppStore(path.join(root, 'userdata'));
  t.after(async () => { store.closeAll(); await fs.rm(root, { recursive: true, force: true }); });
  const manager = new QueueManager(store, {
    repositoryDirectory: path.join(root, 'warehouse'), archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'staging'), smallItemFilter: false, similarityEnabled: false,
    autoTrashCompleted: true, scheduleEnabled: false
  });
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  const result = await createMcpTools(manager).call('hamster_batch_import', { requestId: 'real-test', paths: [source], mode: 'inventory_only' });
  assert.equal(result.failures.length, 0);
  await idle;
  assert.equal(manager.jobs[0].status.startsWith('completed'), true, manager.jobs[0].errorMessage);
  assert.equal(manager.catalog.length, 1);
  assert.equal(await fs.readFile(path.join(source, 'sample.txt'), 'utf8'), 'synthetic test content');
  assert.equal((await store.loadJobs(manager.config.repositoryDirectory))[0].mcpRequestId, 'real-test');
  await manager.clearCompletedJobs();
  const replay = await createMcpTools(manager).call('hamster_batch_import', { requestId: 'real-test', paths: [source], mode: 'inventory_only' });
  assert.equal(replay.reused, true);
  assert.equal(replay.retained, true);
  assert.equal(manager.jobs.length, 0);
  const receipt = await createMcpTools(manager).call('hamster_call', {
    capability: 'queue.request', input: { requestId: 'real-test' }
  });
  assert.equal(receipt.jobs[0].status.startsWith('completed'), true);
});

test('intake planning is read-only and inventory-only mode needs no archive preferences', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-plan-'));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = fakeManager();
  manager.config = { repositoryDirectory: path.join(root, 'warehouse') };
  const service = createMcpTools(manager);
  const plan = await service.call('hamster_call', {
    capability: 'intake.plan', input: { paths: [source], mode: 'inventory_only' }
  });
  assert.equal(plan.ready, true);
  assert.equal(plan.sideEffects, 'none');
  assert.equal(manager.jobs.length, 0);
  const result = await service.call('hamster_call', {
    capability: 'intake.add_batch', input: { requestId: 'inventory-no-prefs', paths: [source], mode: 'inventory_only' }
  });
  assert.equal(result.jobs.length, 1);
});

test('one-shot CLI accepts BOM-prefixed JSON files without shell quoting', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-json-'));
  const inputFile = path.join(root, 'input.json');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(inputFile, '\uFEFF{"capability":"settings.get","input":{}}', 'utf8');
  assert.deepEqual(JSON.parse(await readJsonArguments({ jsonFile: inputFile })), {
    capability: 'settings.get', input: {}
  });
  assert.throws(() => parseCli(['call', 'hamster_call', '--json-file', inputFile, '--json', '{"a":1}']), /either/);
  assert.throws(() => parseCli(['call', 'hamster_call', '--json-file', inputFile, '--json', '{}']), /either/);
});

test('one-shot output is reserved before any operation can run', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-output-'));
  const outputFile = path.join(root, 'result.json');
  const failureFile = path.join(root, 'failure.json');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.equal(await reserveOutputFile(outputFile), true);
  assert.equal(JSON.parse(await fs.readFile(outputFile, 'utf8')).code, 'OPERATION_PENDING');
  await assert.rejects(reserveOutputFile(outputFile), /EEXIST/);
  await assert.rejects(runMcpClient(['doctor', '--connection', path.join(root, 'missing-connection.json'), '--output', failureFile]), /ENOENT/);
  const failure = JSON.parse(await fs.readFile(failureFile, 'utf8'));
  assert.equal(failure.ok, false);
  assert.equal(failure.code, 'ENOENT');
});

test('request identity is checked before inline archive preferences are saved', async () => {
  const manager = fakeManager();
  manager.automationRequests = [];
  manager.findAutomationRequest = function (requestId) {
    return this.automationRequests.find((entry) => entry.requestId === requestId) || null;
  };
  manager.recordAutomationRequest = async function (entry) {
    const saved = { ...entry, repositoryDirectory: this.config.repositoryDirectory || path.resolve('warehouse') };
    this.automationRequests = [saved];
    return saved;
  };
  manager.updateConfig = async function (config) {
    this.config = {
      ...config,
      intakePreferences: {
        version: 1,
        archiveOutputDirectory: config.archiveOutputDirectory,
        sourceDisposition: config.moveCompleted ? 'move' : config.autoTrashCompleted ? 'trash' : 'keep',
        processedSourceDirectory: config.processedSourceDirectory || ''
      }
    };
    return { config: this.config };
  };
  const service = createMcpTools(manager);
  const source = path.resolve('identity-source');
  const firstOutput = path.resolve('identity-output-one');
  const secondOutput = path.resolve('identity-output-two');
  await service.call('hamster_call', {
    capability: 'intake.add_batch',
    input: { requestId: 'identity-one', paths: [source], mode: 'archive', archiveOutputDirectory: firstOutput, sourceDisposition: 'keep' }
  });
  await assert.rejects(service.call('hamster_call', {
    capability: 'intake.add_batch',
    input: { requestId: 'identity-one', paths: [source], mode: 'archive', archiveOutputDirectory: secondOutput, sourceDisposition: 'keep' }
  }), /REQUEST_ID_CONFLICT/);
  assert.equal(manager.config.archiveOutputDirectory, firstOutput);
});

test('automation receipts refresh only inside the active warehouse', async () => {
  let saves = 0;
  const currentRepository = path.resolve('warehouse-current');
  const otherRepository = path.resolve('warehouse-other');
  const manager = {
    config: { repositoryDirectory: currentRepository },
    jobs: [{ id: 'current-job', mcpRequestId: 'shared-id', status: 'completed' }],
    automationRequests: [{ requestId: 'shared-id', repositoryDirectory: otherRepository, jobs: [] }],
    store: { async saveAutomationRequests() { saves += 1; } },
    automationJobSnapshot: QueueManager.prototype.automationJobSnapshot
  };
  await QueueManager.prototype.refreshAutomationRequests.call(manager);
  assert.deepEqual(manager.automationRequests[0].jobs, []);
  assert.equal(saves, 0);
});

test('AI compressed intake snapshots the explicit trash post-processing preference', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-archive-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  await fs.mkdir(source);
  await fs.mkdir(output);
  await fs.writeFile(path.join(source, 'sample.txt'), 'synthetic content');
  const sourceStats = await fs.stat(path.join(source, 'sample.txt'));
  const store = new AppStore(path.join(root, 'userdata'));
  t.after(async () => { store.closeAll(); await fs.rm(root, { recursive: true, force: true }); });
  let trashed = false;
  const manager = new QueueManager(store, {
    repositoryDirectory: path.join(root, 'warehouse'), archiveOutputDirectory: output,
    archiveStagingDirectory: staging, smallItemFilter: false, similarityEnabled: false,
    autoTrashCompleted: true, scheduleEnabled: false
  }, {
    trashItem: async (target) => { trashed = true; await fs.rm(target, { recursive: true, force: true }); },
    isTrashItemPresent: async () => true,
    archiveRunner: async (job) => {
      await fs.writeFile(path.join(output, job.archiveBaseName), 'test archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 12 }], archiveTotalBytes: 12,
        manifest: [{ relativePath: 'sample.txt', name: 'sample.txt', size: 17, modifiedAtMs: sourceStats.mtimeMs, md5: crypto.createHash('md5').update('synthetic content').digest('hex') }],
        directories: [], skippedFiles: [], verifiedAt: new Date().toISOString(),
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName])
      };
    }
  });
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await createMcpTools(manager).call('hamster_batch_import', { requestId: 'compressed-test', paths: [source], mode: 'archive' });
  await idle;
  assert.equal(manager.jobs[0].status, 'completed', manager.jobs[0].errorMessage);
  assert.equal(trashed, true);
  assert.equal(manager.config.autoTrashCompleted, true);
  assert.equal(manager.catalog[0].completionAction, 'trash');
  await assert.rejects(fs.access(path.join(source, 'sample.txt')), /ENOENT/);
});

test('generic discovery is compact, paginated, and exposes schemas only on describe', async () => {
  const service = createMcpTools(fakeManager());
  assert.deepEqual(service.definitions.map((tool) => tool.name), ['hamster_discover', 'hamster_describe', 'hamster_call']);
  assert.ok(Buffer.byteLength(JSON.stringify(service.definitions)) < 2000);
  const discovered = await service.call('hamster_discover', { domain: 'settings', limit: 2 });
  assert.equal(discovered.items.length, 2);
  assert.equal(Object.hasOwn(discovered.items[0], 'inputSchema'), false);
  const described = await service.call('hamster_describe', { capability: 'settings.intake_preferences' });
  assert.equal(described.inputSchema.required.includes('sourceDisposition'), true);
});

test('first AI archive returns missing preferences and never queues work', async () => {
  const manager = fakeManager();
  manager.config = { archiveOutputDirectory: path.resolve('output'), autoTrashCompleted: false, moveCompleted: false };
  const result = await createMcpTools(manager).call('hamster_batch_import', {
    requestId: 'first-run', paths: [path.resolve('source')], mode: 'archive'
  });
  assert.deepEqual(result.missingPreferences, ['archiveOutputDirectory', 'sourceDisposition']);
  assert.equal(manager.jobs.length, 0);
});

test('settings are redacted and destructive preferences require exact one-time confirmation', async () => {
  const manager = fakeManager();
  manager.config.archivePassword = 'do-not-return';
  manager.config.autoTrashCompleted = false;
  manager.config.moveCompleted = false;
  manager.updateConfig = async function (config, context) {
    this.config = { ...config };
    if (context.recordIntakePreferences) this.config.intakePreferences = {
      version: 1, archiveOutputDirectory: config.archiveOutputDirectory,
      sourceDisposition: config.autoTrashCompleted ? 'trash' : config.moveCompleted ? 'move' : 'keep',
      processedSourceDirectory: config.processedSourceDirectory || '', source: 'mcp'
    };
    return { config: this.config };
  };
  const service = createMcpTools(manager);
  const settings = await service.call('hamster_call', { capability: 'settings.get' });
  assert.equal(JSON.stringify(settings).includes('do-not-return'), false);
  assert.equal(settings.settings.passwordConfigured, true);
  const input = { archiveOutputDirectory: path.resolve('output-two'), sourceDisposition: 'trash' };
  const preview = await service.call('hamster_call', { capability: 'settings.intake_preferences', input });
  assert.equal(preview.requiresConfirmation, true);
  assert.match(preview.confirmation.impact, /recycled/);
  const applied = await service.call('hamster_call', { capability: 'settings.intake_preferences', input, confirmationToken: preview.confirmation.token });
  assert.equal(applied.intakePreferences.sourceDisposition, 'trash');
  await assert.rejects(service.call('hamster_call', { capability: 'settings.intake_preferences', input, confirmationToken: preview.confirmation.token }), /INVALID_CONFIRMATION/);
});

test('confirmation token is bound to product state and app capabilities report runtime availability', async () => {
  const manager = fakeManager();
  manager.undoStack = [];
  const service = createMcpTools(manager);
  const input = { targetDirectory: path.resolve('warehouse-two') };
  const preview = await service.call('hamster_call', { capability: 'warehouse.change_directory', input });
  manager.jobs.push({ id: 'changed', status: 'queued' });
  await assert.rejects(service.call('hamster_call', { capability: 'warehouse.change_directory', input, confirmationToken: preview.confirmation.token }), /STALE_CONFIRMATION/);
  const app = await service.call('hamster_describe', { capability: 'app.set_theme' });
  assert.equal(app.available, false);
  assert.deepEqual(app.inputSchema.properties.theme.enum, ['classic', 'day', 'night', 'forest', 'twilight']);
});

test('current three-tool intake refuses unrelated desktop work and starts only its own job ids', async () => {
  const manager = fakeManager();
  const service = createMcpTools(manager);
  manager.jobs.push({ id: 'desktop', sourcePath: path.resolve('desktop'), status: 'queued', intakeModeSelected: true });
  await assert.rejects(service.call('hamster_call', {
    capability: 'intake.add_batch',
    input: { requestId: 'mcp-only', paths: [path.resolve('source')], mode: 'inventory_only' }
  }), /UNRELATED_QUEUE_WORK/);

  manager.jobs = [];
  manager.startQueue = async function (jobIds) { this.startedJobIds = jobIds; };
  const result = await service.call('hamster_call', {
    capability: 'intake.add_batch',
    input: { requestId: 'mcp-only', paths: [path.resolve('source')], mode: 'inventory_only' }
  });
  assert.deepEqual(manager.startedJobIds, [result.jobs[0].id]);
});

test('queue.state filters and paginates without returning a duplicate full jobs array', async () => {
  const manager = fakeManager();
  manager.jobs = Array.from({ length: 120 }, (_, index) => ({
    id: `job-${index}`, mcpRequestId: index < 3 ? 'small-batch' : 'large-batch',
    displayName: `sample-${index}`, status: 'queued', progress: 0
  }));
  const service = createMcpTools(manager);
  const first = await service.call('hamster_call', {
    capability: 'queue.state', input: { requestId: 'large-batch', limit: 1 }
  });
  assert.equal(first.totalJobs, 120);
  assert.equal(first.total, 117);
  assert.equal(first.items.length, 1);
  assert.equal(Object.hasOwn(first, 'jobs'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 2000);

  const exact = await service.call('hamster_call', {
    capability: 'queue.state', input: { jobId: 'job-2' }
  });
  assert.equal(exact.total, 1);
  assert.equal(exact.items[0].id, 'job-2');
});

test('catalog.insights is compact by default and returns only non-empty activity when requested', async () => {
  const manager = fakeManager();
  manager.getWarehouseInsights = () => ({
    inventoryCount: 2,
    uniqueTagCount: 3,
    totalOriginalBytes: 4489,
    year: 2026,
    activity: Array.from({ length: 371 }, (_, index) => ({
      date: `2026-day-${index + 1}`,
      inventoryCount: index === 100 ? 2 : 0,
      originalBytes: index === 100 ? 4489 : 0,
      future: index > 255,
      outsideYear: false
    }))
  });
  const service = createMcpTools(manager);
  const described = await service.call('hamster_describe', { capability: 'catalog.insights' });
  assert.equal(described.inputSchema.properties.includeActivity.type, 'boolean');

  const summary = await service.call('hamster_call', { capability: 'catalog.insights', input: {} });
  assert.equal(summary.inventoryCount, 2);
  assert.equal(Object.hasOwn(summary, 'activity'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 200);

  const detailed = await service.call('hamster_call', {
    capability: 'catalog.insights', input: { includeActivity: true }
  });
  assert.equal(detailed.activity.length, 1);
  assert.equal(detailed.activity[0].inventoryCount, 2);
});

test('common settings schema is explicit, rejects repository bypass, and never returns passwords', async () => {
  const manager = fakeManager();
  manager.updateConfig = async function (config) { this.config = { ...config }; return { config: this.config }; };
  const service = createMcpTools(manager);
  const described = await service.call('hamster_describe', { capability: 'settings.patch' });
  const properties = described.inputSchema.properties.patch.properties;
  for (const key of ['archivePassword', 'archiveNamingMode', 'archiveFormat', 'videoFrameBackup', 'videoFrameCount', 'thumbnailLimit', 'smallItemFilter', 'minimumTaskBytes', 'autoSkipExactDuplicates', 'autoSkipExactDuplicateAction']) {
    assert.ok(Object.hasOwn(properties, key), `missing settings field ${key}`);
  }
  assert.equal(Object.hasOwn(properties, 'repositoryDirectory'), false);
  await assert.rejects(service.call('hamster_call', {
    capability: 'settings.patch', input: { patch: { repositoryDirectory: path.resolve('bypass') } }
  }), /Unknown argument/);

  const input = { patch: { archivePassword: 'private-test-password', recordArchivePassword: false, archiveNamingMode: 'original', videoFrameCount: 5 } };
  const preview = await service.call('hamster_call', { capability: 'settings.patch', input });
  assert.equal(preview.requiresConfirmation, true);
  const applied = await service.call('hamster_call', {
    capability: 'settings.patch', input, confirmationToken: preview.confirmation.token
  });
  assert.equal(applied.settings.passwordConfigured, true);
  assert.equal(applied.settings.recordArchivePassword, false);
  assert.equal(applied.settings.archiveNamingMode, 'original');
  assert.equal(applied.settings.videoFrameCount, 5);
  assert.equal(JSON.stringify(applied).includes('private-test-password'), false);
});

test('new queue decisions require current evidence and a concrete confirmation', async () => {
  const manager = fakeManager();
  const job = { id: 'review', mcpRequestId: 'batch', status: 'awaiting_duplicate_confirmation', duplicateReviewFingerprint: 'first' };
  manager.jobs = [job];
  const service = createMcpTools(manager);
  const state = await service.call('hamster_call', { capability: 'queue.state', input: { jobId: job.id } });
  const input = { jobId: job.id, decisionToken: state.items[0].decisionToken };
  const preview = await service.call('hamster_call', { capability: 'queue.confirm', input });
  assert.equal(preview.requiresConfirmation, true);
  job.duplicateReviewFingerprint = 'changed';
  await assert.rejects(service.call('hamster_call', {
    capability: 'queue.confirm', input, confirmationToken: preview.confirmation.token
  }), /STALE_DECISION/);

  const refreshed = await service.call('hamster_call', { capability: 'queue.state', input: { jobId: job.id } });
  const currentInput = { jobId: job.id, decisionToken: refreshed.items[0].decisionToken };
  const currentPreview = await service.call('hamster_call', { capability: 'queue.confirm', input: currentInput });
  const result = await service.call('hamster_call', {
    capability: 'queue.confirm', input: currentInput, confirmationToken: currentPreview.confirmation.token
  });
  assert.equal(result.job.status, 'queued');
});

test('warehouse capabilities require confirmation and return compact verifiable results', async () => {
  const manager = fakeManager();
  manager.config.repositoryDirectory = path.resolve('warehouse-one');
  manager.changeWarehouseDirectory = async function (target) {
    const previous = this.config.repositoryDirectory;
    this.config.repositoryDirectory = target;
    return { copied: true, previous, state: { catalog: Array(200).fill({ large: true }) } };
  };
  manager.exportWarehouseToFile = async (target) => ({ path: target, state: { catalog: Array(200).fill({ large: true }) } });
  manager.importWarehouseFromArchiveOrDirectory = async () => ({ importedCount: 2, skippedCount: 1, state: { catalog: Array(200).fill({ large: true }) } });
  const service = createMcpTools(manager);

  const changeInput = { targetDirectory: path.resolve('warehouse-two') };
  const changePreview = await service.call('hamster_call', { capability: 'warehouse.change_directory', input: changeInput });
  const changed = await service.call('hamster_call', { capability: 'warehouse.change_directory', input: changeInput, confirmationToken: changePreview.confirmation.token });
  assert.equal(changed.copied, true);
  assert.equal(changed.warehouseDirectory, path.resolve('warehouse-two'));
  assert.equal(Object.hasOwn(changed, 'state'), false);

  const exportInput = { targetFile: path.resolve('warehouse-export.zip') };
  const exportPreview = await service.call('hamster_call', { capability: 'warehouse.export', input: exportInput });
  const exported = await service.call('hamster_call', { capability: 'warehouse.export', input: exportInput, confirmationToken: exportPreview.confirmation.token });
  assert.equal(exported.path, exportInput.targetFile);
  assert.equal(Object.hasOwn(exported, 'state'), false);

  const importInput = { sourcePath: path.resolve('warehouse-import.zip') };
  const importPreview = await service.call('hamster_call', { capability: 'warehouse.import', input: importInput });
  const imported = await service.call('hamster_call', { capability: 'warehouse.import', input: importInput, confirmationToken: importPreview.confirmation.token });
  assert.deepEqual({ imported: imported.importedCount, skipped: imported.skippedCount }, { imported: 2, skipped: 1 });
  assert.equal(Object.hasOwn(imported, 'state'), false);
});
