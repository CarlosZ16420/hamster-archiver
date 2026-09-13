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

test('local MCP rejects unauthorized/browser access and works through the actual stdio adapter', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-'));
  const sessionCounts = [];
  const server = await startMcpServer(fakeManager(), root, 'test', {
    onSessionCountChanged: (count) => sessionCounts.push(count)
  });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  const connection = JSON.parse(await fs.readFile(server.connectionFile));
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
  assert.deepEqual(sessionCounts, [1, 0]);
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
