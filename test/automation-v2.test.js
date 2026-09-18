'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApplicationTaskService, legacyTaskFingerprint } = require('../src/core/application-task-service');
const { createAutomationManifest } = require('../src/core/automation-definitions');
const { parse, exitCodeFor } = require('../src/core/hamster-cli');
const { IntegrationManager, OWNED_BEGIN, OWNED_END } = require('../src/core/integration-manager');
const { QueueManager } = require('../src/core/queue-manager');
const { taskStatus } = require('../src/core/task-contracts');

class TaskManager extends EventEmitter {
  constructor() {
    super();
    this.config = { repositoryDirectory: path.resolve('warehouse') };
    this.jobs = [];
    this.catalog = [];
    this.automationRequests = [];
    this.started = [];
    this.automationInputs = [];
  }

  findAutomationRequest(requestId) {
    return this.automationRequests.find((entry) => entry.requestId === requestId) || null;
  }

  async recordAutomationRequest(input) {
    const previous = this.findAutomationRequest(input.requestId);
    const entry = {
      ...(previous || {}),
      ...input,
      jobIds: input.jobs.map((job) => job.id),
      updatedAt: new Date().toISOString()
    };
    this.automationRequests = this.automationRequests.filter((item) => item !== previous);
    this.automationRequests.push(entry);
    return entry;
  }

  async addSingle(sourcePath, automation) {
    this.automationInputs.push({ sourcePath, ...automation });
    this.jobs.push({
      id: `job-${this.jobs.length + 1}`,
      mcpRequestId: automation.requestId,
      applicationTaskId: automation.taskId,
      sourcePath,
      displayName: path.basename(sourcePath),
      processingMode: automation.mode,
      status: 'queued',
      intakeModeSelected: true
    });
  }

  async startQueue(jobIds) {
    this.running = true;
    this.started.push([...jobIds]);
  }

  findJob(jobId) {
    return this.jobs.find((job) => job.id === jobId);
  }
}

test('application task intake is immutable, idempotent before busy, and task-scoped', async () => {
  const manager = new TaskManager();
  manager.jobs.push({ id: 'desktop-job', status: 'queued', intakeModeSelected: true });
  const service = new ApplicationTaskService(manager);
  const source = path.resolve('small explicit source');
  const first = await service.submit({
    requestId: 'same-request',
    paths: [source],
    mode: 'inventory_only',
    waitMilliseconds: 0
  });

  assert.equal(first.task.status, 'queued');
  assert.equal(manager.automationInputs[0].explicit, true);
  assert.deepEqual(manager.started, [['job-2']]);
  assert.equal(manager.config.archiveOutputDirectory, undefined);

  const replay = await service.submit({
    requestId: 'same-request',
    paths: [source],
    mode: 'inventory_only',
    waitMilliseconds: 0
  });
  assert.equal(replay.task.id, first.task.id);
  assert.equal(manager.jobs.length, 2);
  await assert.rejects(service.submit({
    requestId: 'same-request',
    paths: [path.resolve('changed source')],
    mode: 'inventory_only',
    waitMilliseconds: 0
  }), (error) => error.code === 'REQUEST_ID_CONFLICT');
});

test('task contract reports source cleanup warnings as partial failures', () => {
  assert.equal(taskStatus([{ status: 'completed_cleanup_failed' }]), 'partial_failed');
  assert.equal(taskStatus([{ status: 'completed' }, { status: 'failed' }]), 'partial_failed');
  assert.equal(taskStatus([{ status: 'awaiting_confirmation' }]), 'needs_confirmation');
  assert.equal(taskStatus([{ status: 'awaiting_source_change_confirmation' }]), 'needs_confirmation');
});

test('automation source changes expose a report reference and cannot be implicitly continued', async () => {
  const manager = new TaskManager();
  const service = new ApplicationTaskService(manager);
  manager.jobs = [{ id: 'source-review', status: 'awaiting_source_change_confirmation',
    sourceChangeReport: { snapshotId: 'snapshot', targetRecord: { id: 'target' }, summary: { deletedFiles: 1 } } }];
  await manager.recordAutomationRequest({ requestId: 'review-request', taskId: 'review-task', jobs: manager.jobs, failures: [] });
  const receipt = service.receipt('review-task');
  assert.equal(receipt.task.status, 'needs_confirmation');
  assert.equal(receipt.nextAction.action, 'review_source_changes_in_desktop');
  assert.equal(receipt.jobs[0].sourceChangeReport.snapshotId, 'snapshot');
  assert.equal(receipt.jobs[0].sourceChangeReport.needsDesktop, true);
  await assert.rejects(service.resolve('review-task', { action: 'continue' }), { code: 'SOURCE_CHANGE_REVIEW_REQUIRED' });
  assert.equal(manager.jobs[0].status, 'awaiting_source_change_confirmation');
});

test('legacy retained request fingerprints remain idempotent', async () => {
  const manager = new TaskManager();
  const source = path.resolve('legacy source');
  manager.automationRequests.push({
    requestId: 'legacy-request',
    fingerprint: legacyTaskFingerprint([source], {
      mode: 'inventory_only', archiveOutputDirectory: '', archiveStagingDirectory: '',
      sourceDisposition: 'keep', processedSourceDirectory: ''
    }),
    mode: 'inventory_only', paths: [source], jobs: [], failures: [], createdAt: new Date().toISOString()
  });
  const receipt = await new ApplicationTaskService(manager).submit({
    requestId: 'legacy-request', paths: [source], mode: 'inventory_only', waitMilliseconds: 0
  });
  assert.equal(receipt.task.id, 'legacy-request');
  assert.equal(manager.jobs.length, 0);
});

test('formal CLI preserves Unicode arguments and validates bounded waits', () => {
  const intake = parse(['intake', 'D:\\资料\\Project A', '--archive', '--output', 'E:\\归档', '--staging', 'E:\\暂存', '--source', 'keep', '--json']);
  assert.equal(intake.input.paths[0], 'D:\\资料\\Project A');
  assert.equal(intake.input.archiveStagingDirectory, 'E:\\暂存');
  assert.equal(parse(['task', 'wait', 'task-1', '--timeout', '60', '--json']).input.timeoutSeconds, 60);
  assert.throws(() => parse(['task', 'wait', 'task-1', '--timeout', '61']), /0 to 60/);
  assert.equal(exitCodeFor({ code: 'CLI_USAGE' }), 2);
  assert.equal(exitCodeFor({ code: 'CONNECTION_STALE' }), 3);
});

test('automation manifest comes from the central stable definition', () => {
  const manifest = createAutomationManifest('9.9.9');
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.launchers.cli, 'hamster.cmd');
  assert.ok(manifest.stableCapabilities.includes('intake.submit'));
  assert.ok(manifest.taskStatuses.includes('recovery_required'));
});

test('scheduled continuation starts one application task without desktop jobs', async () => {
  const manager = {
    config: { scheduleEnabled: true },
    running: false,
    paused: false,
    jobs: [
      { id: 'desktop', status: 'queued', intakeModeSelected: true },
      { id: 'task-a-1', applicationTaskId: 'task-a', status: 'queued', intakeModeSelected: true },
      { id: 'task-a-2', applicationTaskId: 'task-a', status: 'queued', intakeModeSelected: true },
      { id: 'task-b-1', applicationTaskId: 'task-b', status: 'queued', intakeModeSelected: true }
    ],
    async waitForCatalogReady() {},
    scheduleWindow() { return { active: true }; },
    async startQueue(jobIds) { this.started = jobIds; },
    getState() { return {}; }
  };
  await QueueManager.prototype.handleScheduleTick.call(manager);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.started, ['task-a-1', 'task-a-2']);
});

test('integration ownership protects user edits and repairs missing managed files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-integrations-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const userData = path.join(root, 'userdata');
  const manager = new IntegrationManager({
    applicationRoot: path.resolve(__dirname, '..'),
    userDataRoot: userData,
    homeDirectory: home
  });

  await manager.install('codex-skill', { explicitOnly: true });
  const skill = path.join(home, '.agents', 'skills', 'hamster-archiver', 'SKILL.md');
  assert.equal((await manager.status('codex-skill')).enabled, true);
  await fs.rm(skill);
  assert.equal((await manager.status('codex-skill')).missing, true);
  await manager.repair('codex-skill', { explicitOnly: true });
  assert.equal((await manager.status('codex-skill')).missing, false);

  await fs.appendFile(skill, '\nuser note\n');
  await assert.rejects(manager.uninstall('codex-skill'), (error) => error.code === 'INTEGRATION_USER_MODIFIED');
  assert.match(await fs.readFile(skill, 'utf8'), /user note/);

  const codexConfig = path.join(home, '.codex', 'config.toml');
  await fs.mkdir(path.dirname(codexConfig), { recursive: true });
  await fs.writeFile(codexConfig, '[model]\nname = "example"\n', 'utf8');
  await manager.install('codex-mcp');
  const installed = await fs.readFile(codexConfig, 'utf8');
  assert.match(installed, new RegExp(OWNED_BEGIN));
  assert.match(installed, /name = "example"/);
  await manager.uninstall('codex-mcp');
  const removed = await fs.readFile(codexConfig, 'utf8');
  assert.doesNotMatch(removed, new RegExp(OWNED_END));
  assert.match(removed, /name = "example"/);
});
