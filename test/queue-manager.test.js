'use strict';

const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const { QueueManager } = require('../src/core/queue-manager');
const { CancelledError, createArchivePublicationReceipt } = require('../src/core/archive-engine');
const { buildManifest } = require('../src/core/manifest');
const { AppStore } = require('../src/core/store');
const { LARGE_TASK_BYTES, MIB } = require('../src/core/constants');

class FakeStore {
  constructor() { this.pendingManifests = new Map(); }
  async loadJobs() { return []; }
  async loadCatalog() { return []; }
  async saveJobs(_library, jobs) { this.jobs = structuredClone(jobs); }
  async saveCatalog() {}
  async saveSettings(settings) { this.settings = structuredClone(settings); }
  async appendLog() {}
  async loadPendingManifest(_library, jobId) { return this.pendingManifests.get(jobId) || null; }
  async savePendingManifest(_library, jobId, manifest) { this.pendingManifests.set(jobId, structuredClone(manifest)); }
  async deletePendingManifest(_library, jobId) { this.pendingManifests.delete(jobId); }
}

function queuedJob(id) {
  return {
    id,
    sourcePath: `E:\\source\\${id}`,
    sourceType: 'directory',
    displayName: id,
    fileCount: 1,
    totalBytes: 1,
    status: 'queued',
    progress: 0,
    archiveBaseName: `${id}.7z`
  };
}

function blockingRunner(calls, started) {
  return async (job, _config, _hooks, signal) => {
    calls.push(job.id);
    started();
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    throw new CancelledError();
  };
}

test('shutdown cancels current job and does not start the next queued job', async () => {
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const calls = [];
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: blockingRunner(calls, signalStarted)
  });
  manager.jobs = [queuedJob('first'), queuedJob('second')];

  const running = manager.startQueue();
  await started;
  await manager.stopForShutdown();
  await running;

  assert.deepEqual(calls, ['first']);
  assert.equal(manager.jobs[0].status, 'cancelled');
  assert.equal(manager.jobs[1].status, 'queued');
  assert.equal(manager.running, false);
});

test('queue stops instead of repeating a job whose state did not advance', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  const job = queuedJob('stalled');
  manager.jobs = [job];
  let calls = 0;
  manager.runOne = async () => { calls += 1; };

  await manager.startQueue();

  assert.equal(calls, 1);
  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'QUEUE_STATE_STALLED');
});

test('confirming a duplicate while the queue runs does not start a concurrent queue', async () => {
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  let activeRunners = 0;
  let maxActiveRunners = 0;
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: async (job) => {
      calls.push(job.id);
      activeRunners += 1;
      maxActiveRunners = Math.max(maxActiveRunners, activeRunners);
      if (job.id === 'first') {
        markFirstStarted();
        await firstGate;
      }
      activeRunners -= 1;
      return {
        archiveFiles: [{ name: `${job.id}.7z`, size: 50 }],
        archiveTotalBytes: 50,
        manifest: [],
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        verifiedAt: new Date().toISOString()
      };
    }
  });
  manager.jobs = [
    { ...queuedJob('first'), totalBytes: 100, intakeModeSelected: true },
    {
      ...queuedJob('second'), totalBytes: 100, intakeModeSelected: true,
      status: 'awaiting_duplicate_confirmation'
    }
  ];

  const running = manager.startQueue();
  await firstStarted;
  await manager.confirmJob('second');
  assert.deepEqual(calls, ['first']);
  releaseFirst();
  await running;

  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(maxActiveRunners, 1);
  assert.equal(manager.jobs[1].status, 'completed');
});

test('failed resume aborts the current task and stops the queue', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  let aborted = false;
  manager.running = true;
  manager.paused = true;
  manager.jobs = [{ ...queuedJob('paused'), status: 'compressing' }];
  manager.pauseController = { resume: async () => {
    const error = new Error('PowerShell timeout');
    error.code = 'PROCESS_CONTROL_TIMEOUT';
    throw error;
  } };
  manager.abortController = { abort: () => { aborted = true; } };

  await assert.rejects(() => manager.resumeCurrent(), /已安全取消当前任务/);

  assert.equal(aborted, true);
  assert.equal(manager.stopRequested, true);
  assert.equal(manager.paused, false);
});

test('disk-space safety failure stops the whole queue before the next task', async () => {
  const calls = [];
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: async (job) => {
      calls.push(job.id);
      const error = new Error('暂存磁盘可用空间不足');
      error.code = 'INSUFFICIENT_DISK_SPACE';
      throw error;
    }
  });
  manager.jobs = [queuedJob('first'), queuedJob('second')];
  await manager.startQueue();
  assert.deepEqual(calls, ['first']);
  assert.equal(manager.jobs[0].status, 'failed');
  assert.equal(manager.jobs[1].status, 'queued');
  assert.match(manager.jobs[0].stageText, /磁盘空间安全停止/);
});

test('clear queue stops current work and removes every task', async () => {
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const calls = [];
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: blockingRunner(calls, signalStarted)
  });
  manager.jobs = [queuedJob('first'), queuedJob('second')];

  const running = manager.startQueue();
  await started;
  await manager.clearQueue();
  await running;

  assert.deepEqual(calls, ['first']);
  assert.deepEqual(manager.jobs, []);
  assert.equal(manager.running, false);
});

test('completed tasks can be cleared without touching active or failed tasks', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [
    { ...queuedJob('done'), status: 'completed' },
    { ...queuedJob('cleanup-warning'), status: 'completed_cleanup_failed' },
    { ...queuedJob('failed'), status: 'failed' }
  ];
  const result = await manager.clearCompletedJobs();
  assert.equal(result.removedCount, 2);
  assert.deepEqual(manager.jobs.map((job) => job.id), ['failed']);
});

test('compressing an uncompressed catalog record ignores its completed intake job', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [{
    id: 'uncompressed-record', title: '同一个项目', displayName: '同一个项目',
    archiveState: 'uncompressed', tags: ['未压缩'], manifest: [], directories: []
  }];
  manager.jobs = [{
    ...queuedJob('original-intake'),
    displayName: '同一个项目',
    status: 'completed'
  }];

  const upgrade = manager.createJob({
    sourceCatalogRecordId: 'uncompressed-record',
    sourcePath: 'E:\\source\\same-item',
    sourceType: 'directory',
    displayName: '同一个项目',
    fileCount: 1,
    totalBytes: 10,
    processingMode: 'archive_existing'
  });

  assert.deepEqual(upgrade.nameDuplicateMatches, []);
  assert.deepEqual(upgrade.similarMatches, []);
  assert.equal(upgrade.status, 'queued');
});

test('deleted catalog history cannot mark a new task as duplicate', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [{
    id: 'deleted-record', recordType: 'manual', title: '已经删除的项目', displayName: '已经删除的项目',
    notes: '测试', tags: [], rating: 0, manifest: [], directories: []
  }];
  manager.jobs = [{
    ...queuedJob('deleted-record-job'),
    displayName: '已经删除的项目',
    status: 'completed'
  }];

  await manager.deleteCatalogRecords(['deleted-record']);
  const replacement = manager.createJob({
    sourcePath: 'E:\\source\\replacement',
    sourceType: 'directory',
    displayName: '已经删除的项目',
    fileCount: 1,
    totalBytes: 10
  });

  assert.deepEqual(replacement.nameDuplicateMatches, []);
  assert.deepEqual(replacement.similarMatches, []);
  assert.equal(replacement.status, 'queued');
});

test('cancelled tasks can be cleared without touching failed or queued tasks', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [
    { ...queuedJob('cancelled'), status: 'cancelled' },
    { ...queuedJob('failed'), status: 'failed' },
    { ...queuedJob('queued'), status: 'queued' }
  ];
  const result = await manager.clearCancelledJobs();
  assert.equal(result.removedCount, 1);
  assert.deepEqual(manager.jobs.map((job) => job.id), ['failed', 'queued']);
});

test('possible duplicate tasks can be cleared with one action', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [
    { ...queuedJob('duplicate'), nameDuplicateMatches: [{ archiveId: 'old' }] },
    { ...queuedJob('unique'), nameDuplicateMatches: [] }
  ];
  const result = await manager.removePotentialDuplicateJobs();
  assert.equal(result.removedCount, 1);
  assert.deepEqual(manager.jobs.map((job) => job.id), ['unique']);
});

test('exact duplicate tasks can be cleared separately', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [
    { ...queuedJob('possible'), similarMatches: [{ id: 'old' }], exactDuplicateMatches: [] },
    { ...queuedJob('exact'), exactDuplicateMatches: [{ md5: 'abc' }] }
  ];
  const exactResult = await manager.removeExactDuplicateJobs();
  assert.equal(exactResult.removedCount, 1);
  assert.deepEqual(manager.jobs.map((job) => job.id), ['possible']);
});

test('terminal duplicate states discard delayed inventory progress', async () => {
  const manager = new QueueManager(new FakeStore(), { repositoryDirectory: 'E:\\warehouse' });
  const job = { ...queuedJob('late-progress'), status: 'inventorying', progress: 45 };
  manager.jobs = [job];
  const progressEvents = [];
  manager.on('progress', (progress) => progressEvents.push(progress));

  manager.emitProgressThrottled(job, 20);
  await manager.updateJob(job, {
    status: 'awaiting_duplicate_confirmation',
    stageText: '发现项目完全重复，已延后等待确认',
    progress: 0
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(progressEvents, []);
  assert.equal(job.status, 'awaiting_duplicate_confirmation');
});

test('name and similarity evidence is a nonblocking notice before MD5 work', () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    autoSkipExactDuplicates: true
  });
  manager.catalog = [{ id: 'existing', title: '相同项目', displayName: '相同项目', manifest: [] }];

  const normal = manager.createJob({
    sourcePath: 'E:\\source\\normal', sourceType: 'directory', displayName: '相同项目', fileCount: 1, totalBytes: 10
  });
  const large = manager.createJob({
    sourcePath: 'E:\\source\\large', sourceType: 'directory', displayName: '相同项目', fileCount: 1, totalBytes: LARGE_TASK_BYTES + 1
  });

  assert.equal(normal.status, 'queued');
  assert.match(normal.stageText, /名称存在仓库候选.*等待选择入库方式/);
  assert.equal(normal.similarityPreflightBlocking, false);
  assert.equal(normal.automaticDuplicateCheckPending, false);
  assert.equal(large.status, 'awaiting_confirmation');
  assert.ok(large.confirmationReasons.includes('large_task'));
  assert.match(large.stageText, /名称存在仓库候选.*等待手动确认/);
});

test('nonblocking preflight similarity notice still waits for the user to select an intake mode', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    autoSkipExactDuplicates: true
  });
  manager.catalog = [{ id: 'existing', title: '相同项目', displayName: '相同项目', manifest: [] }];
  const job = manager.createJob({
    sourcePath: 'E:\\source\\incoming', sourceType: 'directory', displayName: '相同项目', fileCount: 1, totalBytes: 10
  });
  manager.jobs = [job];

  assert.equal(job.status, 'queued');
  assert.equal(job.automaticDuplicateCheckPending, false);
  assert.equal(job.duplicateConfirmedAt, null);
  assert.equal(job.exactDuplicateOverrideAt, null);
  assert.equal(job.intakeModeSelected, false);
  assert.match(job.stageText, /名称存在仓库候选.*等待选择入库方式/);
  await assert.rejects(() => manager.confirmJob(job.id), /不处于等待确认状态/);
});

test('automatic exact-duplicate checking can keep the skipped queue item and persistent log', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-keep-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = [{ relativePath: 'same.txt', name: 'same.txt', size: 4, md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }];
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'staging'),
    repositoryDirectory: path.join(root, 'warehouse'),
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep'
  }, {
    archiveRunner: async (_job, _config, hooks) => hooks.onManifestReady(manifest)
  });
  manager.catalog = [{ id: 'existing', title: '已入库项目', displayName: '已入库项目', manifest }];
  manager.jobs = [queuedJob('incoming')];

  await manager.startQueue();

  assert.equal(manager.jobs[0].status, 'skipped_duplicate');
  assert.equal(manager.jobs[0].progress, 100);
  assert.deepEqual(manager.jobs[0].exactProjectMatches.map((match) => match.id), ['existing']);
  assert.ok(await manager.store.loadPendingManifest(manager.config.repositoryDirectory, manager.jobs[0].id));
  assert.ok(manager.logs.some((entry) => /源文件和仓库均未修改，队列项已保留/.test(entry.message)));
});

test('a name warning does not require preflight confirmation before automatic exact-duplicate skipping', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-after-name-confirm-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, '第3位女主角？（１８歲）');
  await fs.mkdir(sourcePath);
  await fs.writeFile(path.join(sourcePath, '1.jpg'), 'same-content');
  const manifest = await buildManifest(sourcePath, 'directory');
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'),
    archiveStagingDirectory: path.join(root, 'staging'),
    smallItemFilter: false,
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep'
  });
  manager.catalog = [{
    id: 'existing', title: '第3位女主角？（１８歲）', displayName: '第3位女主角？（１８歲）',
    sourceType: 'directory', manifest
  }];

  await manager.addSingle(sourcePath);
  const job = manager.jobs[0];
  assert.equal(job.status, 'queued');
  assert.match(job.stageText, /名称存在仓库候选/);
  assert.equal(job.duplicateConfirmedAt, null);
  assert.equal(job.exactDuplicateOverrideAt, null);

  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startInventoryOnlyQueue();
  await idle;

  assert.equal(job.status, 'skipped_duplicate');
  assert.equal(job.stageText, '与仓库内项目完全一致，已自动跳过');
});

test('scanning never auto-skips from historical metadata even when the source path is unchanged', async (t) => {
  for (const archiveState of ['uncompressed', 'compressed']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `hamster-auto-skip-reuse-${archiveState}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const sourcePath = path.join(root, 'same-project');
    await fs.mkdir(sourcePath);
    await fs.writeFile(path.join(sourcePath, 'same.txt'), 'same-content');
    const manifest = await buildManifest(sourcePath, 'directory');
    const manager = new QueueManager(new FakeStore(), {
      repositoryDirectory: path.join(root, 'warehouse'),
      archiveStagingDirectory: path.join(root, 'staging'),
      smallItemFilter: false,
      autoSkipExactDuplicates: true,
      autoSkipExactDuplicateAction: 'keep'
    });
    manager.catalog = [{
      id: `${archiveState}-existing`, title: 'same-project', displayName: 'same-project',
      archiveState, sourceDisposition: 'kept', sourceType: 'directory',
      sourcePath, originalSourcePath: sourcePath, manifest
    }];

    await manager.addSingle(sourcePath);

    assert.equal(manager.jobs[0].status, 'queued', archiveState);
    assert.match(manager.jobs[0].stageText, /名称存在仓库候选/, archiveState);
    assert.equal(manager.jobs[0].automaticDuplicateCheckPending, false, archiveState);
    assert.equal(manager.jobs[0].exactProjectMatches, undefined);
    assert.equal(await manager.store.loadPendingManifest(manager.config.repositoryDirectory, manager.jobs[0].id), null);
  }
});

test('same-source metadata without complete MD5 never reports an exact duplicate', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-partial-reuse-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'same-project');
  await fs.mkdir(sourcePath);
  await fs.writeFile(path.join(sourcePath, 'tiny-a.txt'), 'a');
  await fs.writeFile(path.join(sourcePath, 'tiny-b.txt'), 'b');
  const manifest = await buildManifest(sourcePath, 'directory', {
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes: 5 * 1024
  });
  assert.equal(manifest.filter((file) => file.md5).length, 0);
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'),
    smallItemFilter: false,
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep'
  });
  manager.catalog = [{
    id: 'partial-existing', title: 'same-project', displayName: 'same-project',
    archiveState: 'compressed', sourceDisposition: 'kept', sourceType: 'directory',
    sourcePath, originalSourcePath: sourcePath, manifest
  }];

  await manager.addSingle(sourcePath);

  assert.equal(manager.jobs[0].status, 'queued');
  assert.match(manager.jobs[0].stageText, /名称存在仓库候选/);
  assert.equal(manager.jobs[0].exactProjectMatches, undefined);
});

test('historical MD5 coverage is not reused as the current task fingerprint during scanning', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-best-snapshot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'same-project');
  await fs.mkdir(sourcePath);
  await fs.writeFile(path.join(sourcePath, 'a.txt'), 'same-a');
  await fs.writeFile(path.join(sourcePath, 'b.txt'), 'same-b');
  const completeManifest = await buildManifest(sourcePath, 'directory');
  const partialManifest = completeManifest.map(({ md5: _md5, ...file }) => ({
    ...file,
    md5SkippedReason: 'tiny-file'
  }));
  const store = new FakeStore();
  const manager = new QueueManager(store, {
    repositoryDirectory: path.join(root, 'warehouse'),
    smallItemFilter: false,
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep'
  });
  manager.catalog = [
    {
      id: 'partial-first', title: 'same-project', displayName: 'same-project',
      archiveState: 'compressed', sourceDisposition: 'kept', sourceType: 'directory',
      sourcePath, originalSourcePath: sourcePath, manifest: partialManifest
    },
    {
      id: 'complete-later', title: 'same-project', displayName: 'same-project',
      archiveState: 'compressed', sourceDisposition: 'kept', sourceType: 'directory',
      sourcePath, originalSourcePath: sourcePath, manifest: completeManifest
    }
  ];

  await manager.addSingle(sourcePath);

  assert.equal(manager.jobs[0].status, 'queued');
  assert.match(manager.jobs[0].stageText, /名称存在仓库候选/);
  const savedManifest = await store.loadPendingManifest(manager.config.repositoryDirectory, manager.jobs[0].id);
  assert.equal(savedManifest, null);
});

test('automatic exact verification fills safeguard MD5 gaps for a copied source when the original is available', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-partial-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const catalogSource = path.join(root, 'catalog-source');
  const incomingSource = path.join(root, 'incoming-copy');
  await fs.mkdir(catalogSource);
  await fs.mkdir(incomingSource);
  for (const name of ['tiny-a.txt', 'tiny-b.txt']) {
    await fs.writeFile(path.join(catalogSource, name), `same-${name}`);
    await fs.copyFile(path.join(catalogSource, name), path.join(incomingSource, name));
  }
  const manifest = await buildManifest(catalogSource, 'directory', {
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes: 5 * 1024
  });
  assert.equal(manifest.filter((file) => file.md5).length, 0);
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'),
    smallItemFilter: false,
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep',
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes: 5 * 1024
  });
  manager.catalog = [{
    id: 'partial-copy-existing', title: 'catalog-source', displayName: 'catalog-source',
    archiveState: 'compressed', sourceDisposition: 'kept', sourceType: 'directory',
    sourcePath: catalogSource, originalSourcePath: catalogSource, manifest
  }];

  await manager.addSingle(incomingSource);
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startInventoryOnlyQueue();
  await idle;

  assert.equal(manager.jobs[0].status, 'skipped_duplicate');
  assert.equal(manager.jobs[0].stageText, '与仓库内项目完全一致，已自动跳过');
});

test('automatic exact-duplicate checking hashes copied sources and skips matches against compressed and uncompressed records', async (t) => {
  for (const archiveState of ['uncompressed', 'compressed']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `hamster-auto-skip-runtime-${archiveState}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const catalogSource = path.join(root, 'catalog-source');
    const incomingSource = path.join(root, 'incoming-copy');
    await fs.mkdir(catalogSource);
    await fs.mkdir(incomingSource);
    await fs.writeFile(path.join(catalogSource, 'same.txt'), 'same-content');
    await fs.writeFile(path.join(incomingSource, 'same.txt'), 'same-content');
    const manifest = await buildManifest(catalogSource, 'directory');
    const manager = new QueueManager(new FakeStore(), {
      repositoryDirectory: path.join(root, 'warehouse'),
      smallItemFilter: false,
      autoSkipExactDuplicates: true,
      autoSkipExactDuplicateAction: 'keep'
    });
    manager.catalog = [{
      id: `${archiveState}-existing`, title: 'catalog-source', displayName: 'catalog-source',
      archiveState, sourceDisposition: 'kept', sourceType: 'directory',
      sourcePath: catalogSource, originalSourcePath: catalogSource, manifest
    }];

    await manager.addSingle(incomingSource);
    assert.equal(manager.jobs[0].status, 'queued', archiveState);
    const idle = new Promise((resolve) => manager.once('idle', resolve));
    await manager.startInventoryOnlyQueue();
    await idle;

    assert.equal(manager.jobs[0].status, 'skipped_duplicate', archiveState);
    assert.deepEqual(manager.jobs[0].exactProjectMatches.map((match) => match.id), [`${archiveState}-existing`]);
  }
});

test('cross-directory exact verification stops at one-project read budget and falls back to manual review', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-exact-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const incomingSource = path.join(root, 'incoming');
  const mismatchingSource = path.join(root, 'candidate-mismatch');
  const matchingSource = path.join(root, 'candidate-match');
  for (const directory of [incomingSource, mismatchingSource, matchingSource]) await fs.mkdir(directory);
  await fs.writeFile(path.join(incomingSource, 'a.bin'), 'same-a');
  await fs.writeFile(path.join(incomingSource, 'b.bin'), 'same-b');
  await fs.writeFile(path.join(mismatchingSource, 'a.bin'), 'same-a');
  await fs.writeFile(path.join(mismatchingSource, 'b.bin'), 'other!');
  await fs.copyFile(path.join(incomingSource, 'a.bin'), path.join(matchingSource, 'a.bin'));
  await fs.copyFile(path.join(incomingSource, 'b.bin'), path.join(matchingSource, 'b.bin'));

  const incomingManifest = await buildManifest(incomingSource, 'directory');
  const partialOptions = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 5 * 1024 };
  const mismatchingManifest = await buildManifest(mismatchingSource, 'directory', partialOptions);
  const matchingManifest = await buildManifest(matchingSource, 'directory', partialOptions);
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'),
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'keep'
  }, {
    archiveRunner: async (_job, _config, hooks) => hooks.onManifestReady(incomingManifest)
  });
  manager.catalog = [
    {
      id: 'mismatch-first', title: 'mismatch', displayName: 'mismatch', sourceType: 'directory',
      sourcePath: mismatchingSource, originalSourcePath: mismatchingSource, manifest: mismatchingManifest
    },
    {
      id: 'match-second', title: 'match', displayName: 'match', sourceType: 'directory',
      sourcePath: matchingSource, originalSourcePath: matchingSource, manifest: matchingManifest
    }
  ];

  manager.jobs = [{
    ...queuedJob('incoming-job'),
    sourcePath: incomingSource,
    sourceType: 'directory',
    fileCount: incomingManifest.length,
    totalBytes: incomingManifest.reduce((sum, file) => sum + file.size, 0)
  }];

  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startArchiveQueue();
  await idle;

  assert.equal(manager.jobs[0].status, 'awaiting_duplicate_confirmation');
  assert.match(manager.jobs[0].stageText, /内容完全一致候选待人工核对/);
  assert.ok(manager.logs.some((entry) => /达到读取预算/.test(entry.message)));
  const savedManifest = await manager.store.loadPendingManifest(manager.config.repositoryDirectory, 'incoming-job');
  assert.ok(savedManifest.every((file) => /^[a-f0-9]{32}$/.test(String(file.md5 || ''))));
});

test('queue similarity report summarizes exact files and linked warehouse projects', async () => {
  const store = new FakeStore();
  const manager = new QueueManager(store, {
    repositoryDirectory: 'E:\\warehouse',
    similarityReportEnabled: true
  });
  const manifest = [{
    relativePath: 'same.mp4', name: 'same.mp4', extension: '.mp4', size: 100,
    md5: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  }];
  manager.catalog = [{
    id: 'existing', title: '仓库中的相同项目', displayName: '仓库中的相同项目',
    sourceType: 'directory', directories: [], manifest
  }];
  manager.jobs = [{
    ...queuedJob('report-job'), sourceType: 'video', displayName: '待检查视频.mp4',
    exactDuplicateMatches: [{
      sourceRelativePath: 'same.mp4', previous: [{ archiveId: 'existing', relativePath: 'same.mp4' }]
    }]
  }];
  await store.savePendingManifest(manager.config.repositoryDirectory, 'report-job', manifest);

  const report = await manager.getQueueSimilarityReport('report-job');

  assert.equal(report.similarProjects.length, 1);
  assert.equal(report.similarProjects[0].id, 'existing');
  assert.equal(report.similarProjects[0].exactFileCount, 1);
  assert.ok(report.similarEntryMatches[0].exactRanges.length > 0);
  manager.config.similarityReportEnabled = false;
  await assert.rejects(() => manager.getQueueSimilarityReport('report-job'), /相似报告已关闭/);
});

test('queue similarity report asks once after fingerprinting and reuses the confirmed manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-report-exact-flow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, '相同项目');
  await fs.mkdir(sourcePath);
  await fs.writeFile(path.join(sourcePath, 'same.txt'), 'same-content');
  const manifest = await buildManifest(sourcePath, 'directory');
  const store = new FakeStore();
  const preparedManifests = [];
  let compressionStarts = 0;
  const manager = new QueueManager(store, {
    archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'staging'),
    repositoryDirectory: path.join(root, 'warehouse'),
    similarityReportEnabled: true,
    autoSkipExactDuplicates: false
  }, {
    archiveRunner: async (_job, _config, hooks) => {
      preparedManifests.push(hooks.preparedManifest);
      await hooks.onManifestReady(manifest);
      compressionStarts += 1;
      return {
        archiveFiles: [{ name: 'confirmed.7z', size: 6 }],
        archiveTotalBytes: 6,
        manifest,
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        verifiedAt: new Date().toISOString()
      };
    }
  });
  manager.catalog = [{
    id: 'existing', jobId: 'old-job', title: '相同项目', displayName: '相同项目',
    sourceType: 'directory', directories: [], manifest
  }];
  const job = manager.createJob({
    sourcePath, sourceType: 'directory', displayName: '相同项目',
    fileCount: manifest.length, totalBytes: manifest.reduce((sum, file) => sum + file.size, 0)
  });
  manager.jobs = [job];

  const reportBeforeInventory = await manager.getQueueSimilarityReport(job.id);
  assert.equal(reportBeforeInventory.fingerprintPending, true);
  assert.equal(reportBeforeInventory.manifest.filter((file) => file.md5).length, 0);
  assert.equal(reportBeforeInventory.similarProjects[0].exactFileCount, 0);
  assert.equal(await store.loadPendingManifest(manager.config.repositoryDirectory, job.id), null);

  assert.equal(job.status, 'queued');
  assert.equal(job.duplicateConfirmedAt, null);
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startArchiveQueue();
  await idle;

  assert.equal(job.status, 'awaiting_duplicate_confirmation');
  assert.equal(job.exactDuplicateOverrideAt, null);
  assert.ok(job.duplicateReviewFingerprint);
  const resumedIdle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.confirmJob(job.id);
  assert.ok(job.exactDuplicateOverrideAt);
  assert.equal(job.duplicateConfirmedManifestFingerprint, job.duplicateReviewFingerprint);
  await resumedIdle;

  assert.equal(job.status, 'completed');
  assert.equal(preparedManifests.length, 2);
  assert.equal(preparedManifests[0], null);
  assert.deepEqual(preparedManifests[1], manifest);
  assert.equal(compressionStarts, 1);
  const reportAfterInventory = await manager.getQueueSimilarityReport(job.id);
  assert.equal(reportAfterInventory.fingerprintPending, false);
  assert.equal(reportAfterInventory.similarProjects[0].exactFileCount, 1);
  assert.deepEqual(
    reportAfterInventory.similarEntryMatches.find((entry) => entry.kind === 'file').exactRanges,
    [[0, 'same.txt'.length]]
  );
  assert.ok(reportAfterInventory.similarProjects[0].reasons.includes('项目完全重复'));
  assert.ok(reportAfterInventory.similarProjects[0].reasons.includes('项目名称完全一致'));
  assert.ok(!reportAfterInventory.similarProjects[0].reasons.includes('标题相似'));
  assert.ok(!reportAfterInventory.similarProjects[0].reasons.includes('标题一致'));
});

test('queue similarity report waits for current-task MD5 even when an unchanged source has historical fingerprints', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-report-uncompressed-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, '未压缩项目');
  await fs.mkdir(sourcePath);
  const sourceFile = path.join(sourcePath, 'same.txt');
  await fs.writeFile(sourceFile, 'same-content');
  const manifest = await buildManifest(sourcePath, 'directory');
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'), similarityReportEnabled: true
  });
  manager.catalog = [{
    id: 'uncompressed-existing', jobId: 'old-job', title: '未压缩项目', displayName: '未压缩项目',
    recordType: 'archive', archiveState: 'uncompressed', sourceDisposition: 'kept',
    sourceType: 'directory', sourcePath, originalSourcePath: sourcePath, directories: [], manifest
  }];
  const job = manager.createJob({
    sourcePath, sourceType: 'directory', displayName: '未压缩项目',
    fileCount: manifest.length, totalBytes: manifest.reduce((sum, file) => sum + file.size, 0)
  });
  manager.jobs = [job];

  const unchangedReport = await manager.getQueueSimilarityReport(job.id);
  assert.equal(unchangedReport.fingerprintPending, true);
  assert.equal(unchangedReport.reusedFingerprintCount, 0);
  assert.equal(unchangedReport.manifest[0].md5, undefined);
  assert.equal(unchangedReport.similarProjects[0].exactFileCount, 0);
  assert.ok(!unchangedReport.similarProjects[0].reasons.includes('项目完全重复'));

  await fs.writeFile(sourceFile, 'changed-content-is-longer');
  const changedReport = await manager.getQueueSimilarityReport(job.id);
  assert.equal(changedReport.fingerprintPending, true);
  assert.equal(changedReport.reusedFingerprintCount, 0);
  assert.equal(changedReport.manifest[0].md5, undefined);
  assert.equal(changedReport.similarProjects[0].exactFileCount, 0);
});

test('completed queue report reuses the catalog manifest without matching the record against itself', async () => {
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: 'E:\\warehouse', similarityReportEnabled: true
  });
  const manifest = [{
    relativePath: 'same.txt', name: 'same.txt', extension: '.txt', size: 4,
    md5: 'ffffffffffffffffffffffffffffffff'
  }];
  manager.catalog = [
    { id: 'existing', title: '旧项目', displayName: '旧项目', sourceType: 'directory', directories: [], manifest },
    { id: 'completed-record', jobId: 'completed-job', title: '新项目', displayName: '新项目', sourceType: 'directory', directories: [], manifest }
  ];
  manager.jobs = [{
    ...queuedJob('completed-job'), displayName: '新项目', status: 'completed',
    exactDuplicateMatches: [{ sourceRelativePath: 'same.txt', previous: [{ archiveId: 'existing', relativePath: 'same.txt' }] }]
  }];

  const report = await manager.getQueueSimilarityReport('completed-job');

  const exactMatches = report.similarEntryMatches.flatMap((entry) => entry.matches)
    .filter((match) => match.reason === '文件内容完全一致');
  assert.ok(exactMatches.some((match) => match.recordId === 'existing'));
  assert.ok(exactMatches.every((match) => match.recordId !== 'completed-record'));
});

test('automatic exact-duplicate checking can remove only the queue item while retaining its log', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-remove-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = [{ relativePath: 'same.txt', name: 'same.txt', size: 4, md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }];
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'staging'),
    repositoryDirectory: path.join(root, 'warehouse'),
    autoSkipExactDuplicates: true,
    autoSkipExactDuplicateAction: 'remove'
  }, {
    archiveRunner: async (_job, _config, hooks) => hooks.onManifestReady(manifest)
  });
  manager.catalog = [{ id: 'existing', title: '已入库项目', displayName: '已入库项目', manifest }];
  manager.jobs = [queuedJob('incoming')];

  await manager.startQueue();

  assert.deepEqual(manager.jobs, []);
  assert.ok(manager.logs.some((entry) => /源文件和仓库均未修改，队列项已删除/.test(entry.message)));
});

test('name matches remain nonblocking until one post-fingerprint similarity review', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-auto-skip-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'staging'),
    repositoryDirectory: path.join(root, 'warehouse'),
    autoSkipExactDuplicates: true
  }, {
    archiveRunner: async (_job, _config, hooks) => hooks.onManifestReady([{
      relativePath: 'new.txt', name: 'new.txt', size: 4, md5: 'cccccccccccccccccccccccccccccccc'
    }])
  });
  manager.catalog = [{
    id: 'existing', title: '相同项目', displayName: '相同项目',
    manifest: [{ relativePath: 'old.txt', name: 'old.txt', size: 4, md5: 'dddddddddddddddddddddddddddddddd' }]
  }];
  manager.jobs = [manager.createJob({
    sourcePath: path.join(root, 'incoming'), sourceType: 'directory',
    displayName: '相同项目', fileCount: 1, totalBytes: 4
  })];

  assert.equal(manager.jobs[0].status, 'queued');
  assert.match(manager.jobs[0].stageText, /名称存在仓库候选.*等待选择入库方式/);
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startArchiveQueue();
  await idle;

  assert.equal(manager.jobs[0].status, 'awaiting_duplicate_confirmation');
  assert.equal(manager.jobs[0].duplicateReviewKind, 'similarity');
  assert.match(manager.jobs[0].stageText, /相似项目或视频.*延后等待确认/);
  assert.ok(await manager.store.loadPendingManifest(manager.config.repositoryDirectory, manager.jobs[0].id));
  assert.equal(manager.catalog.length, 1);
});

test('all duplicate and similar confirmations can be accepted in one action', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [
    { ...queuedJob('similar'), intakeModeSelected: false, status: 'awaiting_confirmation', confirmationReasons: ['similar_title'] },
    { ...queuedJob('exact'), intakeModeSelected: false, status: 'awaiting_duplicate_confirmation', confirmationReasons: [] },
    { ...queuedJob('unique'), intakeModeSelected: false, status: 'queued', confirmationReasons: [] },
    { ...queuedJob('large'), intakeModeSelected: false, status: 'awaiting_confirmation', confirmationReasons: ['large_task', 'name_match'] }
  ];
  const result = await manager.confirmAllDuplicateJobs();
  assert.equal(result.confirmedCount, 3);
  assert.ok(manager.jobs[0].confirmedAt);
  assert.ok(manager.jobs[0].duplicateConfirmedAt);
  assert.ok(manager.jobs[1].duplicateConfirmedAt);
  assert.equal(manager.jobs[2].duplicateConfirmedAt, undefined);
  assert.ok(manager.jobs[3].duplicateConfirmedAt);
  assert.equal(manager.jobs[3].confirmedAt, undefined);
  assert.equal(manager.jobs[3].status, 'awaiting_confirmation');
});

test('bulk duplicate confirmation resumes tasks whose intake mode is already selected', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: async (job) => ({
      archiveFiles: [{ name: `${job.id}.7z`, size: 50 }],
      archiveTotalBytes: 50,
      manifest: [],
      directories: [],
      skippedFiles: [],
      passwordScheme: 'none',
      hasPassword: false,
      verifiedAt: new Date().toISOString()
    })
  });
  manager.jobs = [{
    ...queuedJob('bulk-exact'), totalBytes: 100, intakeModeSelected: true,
    status: 'awaiting_duplicate_confirmation'
  }];
  const idle = new Promise((resolve) => manager.once('idle', resolve));

  const result = await manager.confirmAllDuplicateJobs();
  await idle;

  assert.equal(result.confirmedCount, 1);
  assert.equal(manager.jobs[0].status, 'completed');
});

test('each queued task keeps the password that was active when it was added', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    archivePassword: 'first-password'
  });
  const job = manager.createJob({
    sourcePath: 'E:\\source\\one',
    sourceType: 'directory',
    displayName: 'one',
    fileCount: 1,
    totalBytes: 1
  });
  await manager.updateConfig({ archivePassword: 'second-password' });
  manager.jobs = [job];

  assert.equal(job.archivePassword, 'first-password');
  assert.equal(manager.config.archivePassword, 'second-password');
  assert.equal(Object.hasOwn(manager.getState().jobs[0], 'archivePassword'), false);
  assert.equal(manager.getState().jobs[0].hasPassword, true);
});

test('each queued task snapshots configurable volume settings within safe bounds', async () => {
  const firstVolumeBytes = 512 * MIB;
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    archiveVolumeEnabled: true,
    archiveVolumeBytes: firstVolumeBytes
  });
  const job = manager.createJob({
    sourcePath: 'E:\\source\\volume-test',
    sourceType: 'directory',
    displayName: 'volume-test',
    fileCount: 1,
    totalBytes: 2 * 1024 ** 3
  });

  await manager.updateConfig({ archiveVolumeEnabled: false, archiveVolumeBytes: LARGE_TASK_BYTES });
  assert.equal(job.archiveVolumeEnabled, true);
  assert.equal(job.archiveVolumeBytes, firstVolumeBytes);
  assert.equal(manager.config.archiveVolumeEnabled, false);
  assert.equal(manager.config.archiveVolumeBytes, LARGE_TASK_BYTES);
  await assert.rejects(
    manager.updateConfig({ archiveVolumeEnabled: true, archiveVolumeBytes: (64 * MIB) - 1 }),
    /64 MiB—10 GiB/
  );
  await assert.rejects(
    manager.updateConfig({ archiveVolumeEnabled: true, archiveVolumeBytes: LARGE_TASK_BYTES + 1 }),
    /64 MiB—10 GiB/
  );
});

test('completed archives remember their task password without exposing it in warehouse summaries', async () => {
  let runnerPassword = null;
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    archivePassword: 'per-task-secret'
  }, {
    archiveRunner: async (_job, config) => {
      runnerPassword = config.archivePassword;
      return {
        archiveFiles: [{ name: 'one.7z', size: 1 }],
        archiveTotalBytes: 1,
        manifest: [{ relativePath: 'one.bin', name: 'one.bin', size: 1, md5: 'abc' }],
        directories: [],
        passwordScheme: 'configured-v1',
        hasPassword: true,
        verifiedAt: new Date().toISOString()
      };
    }
  });
  manager.jobs = [{ ...queuedJob('password-job'), archivePassword: 'per-task-secret', hasPassword: true }];
  await manager.startQueue();

  assert.equal(runnerPassword, 'per-task-secret');
  assert.equal(manager.getCatalogDetails(manager.catalog[0].id).archivePassword, 'per-task-secret');
  assert.equal(Object.hasOwn(manager.getState().catalog[0], 'archivePassword'), false);
  assert.equal(manager.getState().catalog[0].hasPassword, true);
});

test('password recording can be disabled without changing the password used for compression', async () => {
  let runnerPassword = null;
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    archivePassword: 'compression-only',
    recordArchivePassword: false
  }, {
    archiveRunner: async (_job, config) => {
      runnerPassword = config.archivePassword;
      return {
        archiveFiles: [{ name: 'private.7z', size: 1 }], archiveTotalBytes: 1,
        manifest: [{ relativePath: 'one.bin', name: 'one.bin', size: 1, md5: 'abc' }],
        directories: [], passwordScheme: 'configured-v1', hasPassword: true,
        verifiedAt: new Date().toISOString()
      };
    }
  });
  manager.jobs = [{
    ...queuedJob('unrecorded-password'),
    archivePassword: 'compression-only',
    recordArchivePassword: false
  }];
  await manager.startQueue();
  const record = manager.catalog[0];
  assert.equal(runnerPassword, 'compression-only');
  assert.equal(record.hasPassword, true);
  assert.equal(record.passwordRecorded, false);
  assert.equal(record.archivePassword, '');
});

test('legacy-shaped records are never backfilled from the current global password', async () => {
  const store = new FakeStore();
  store.loadCatalog = async () => [{
    id: 'legacy-record',
    recordType: 'archive',
    title: '旧记录',
    displayName: '旧记录',
    passwordScheme: 'configured-v1',
    tags: [],
    manifest: [],
    directories: []
  }];
  const manager = new QueueManager(store, {
    libraryDir: 'E:\\library',
    archivePassword: 'must-not-be-copied'
  });
  await manager.initialize();
  const record = manager.getCatalogDetails('legacy-record');
  assert.equal(record.archivePassword, '');
  assert.equal(record.passwordRecorded, false);
  assert.equal(record.hasPassword, false);
});

test('empty optional catalog fields normalize safely without null values', async () => {
  class NullCatalogStore extends FakeStore {
    async loadCatalog() {
      return [{
        id: 'null-fields', title: '空字段', displayName: '空字段', tags: null,
        notes: null, backupLocation: null, sourcePath: null, originalSourcePath: null,
        manifest: null, directories: null, archiveFiles: null, similarRecords: null
      }];
    }
  }
  const manager = new QueueManager(new NullCatalogStore(), { libraryDir: 'E:\\library' });
  await manager.initialize();
  const record = manager.getCatalogDetails('null-fields');
  assert.equal(record.backupLocation, '');
  assert.equal(record.sourcePath, '');
  assert.deepEqual(record.tags, []);
  assert.deepEqual(record.manifest, []);
  assert.deepEqual(record.directories, []);
});

test('thumbnail limit is configurable within a bounded range', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  await manager.updateConfig({ thumbnailLimit: 250 });
  assert.equal(manager.config.thumbnailLimit, 250);
  await assert.rejects(manager.updateConfig({ thumbnailLimit: 501 }), /1—500/);
});

test('custom archive staging directory is saved instead of being overwritten by the output path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-custom-staging-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FakeStore();
  const manager = new QueueManager(store, {
    archiveOutputDirectory: path.join(root, 'output'),
    archiveStagingDirectory: path.join(root, 'output-staging'),
    repositoryDirectory: path.join(root, 'warehouse'),
    moveCompleted: false
  });
  const customStaging = path.join(root, 'fast-disk-staging');

  await manager.updateConfig({
    archiveOutputDirectory: path.join(root, 'new-output'),
    archiveStagingDirectory: customStaging,
    moveCompleted: false,
    autoTrashCompleted: false
  });

  assert.equal(manager.config.archiveStagingDirectory, customStaging);
  assert.equal(store.settings.archiveStagingDirectory, customStaging);
  assert.equal((await fs.stat(customStaging)).isDirectory(), true);
});

test('disabled small-item filtering accepts tiny folders before output setup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-tiny-queue-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tinyFolder = path.join(root, 'tiny-folder');
  await fs.mkdir(tinyFolder);
  await fs.writeFile(path.join(tinyFolder, 'tiny.txt'), 'tiny');

  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: '',
    archiveStagingDirectory: '',
    repositoryDirectory: path.join(root, 'warehouse'),
    moveCompleted: false,
    smallItemFilter: true,
    minimumTaskBytes: 100 * 1024 * 1024
  });
  await manager.updateConfig({ smallItemFilter: false, minimumTaskBytes: 0 });
  await manager.addSingle(tinyFolder);

  assert.equal(manager.config.smallItemFilter, false);
  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].displayName, 'tiny-folder');
  assert.equal(manager.jobs[0].totalBytes, 4);

  const scanRepository = path.join(path.dirname(root), `${path.basename(root)}-warehouse`);
  const scanManager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: '',
    archiveStagingDirectory: '',
    repositoryDirectory: scanRepository,
    moveCompleted: false,
    smallItemFilter: false,
    minimumTaskBytes: 100 * 1024 * 1024
  });
  await scanManager.scanSource(root);
  assert.deepEqual(scanManager.jobs.map((job) => job.displayName), ['tiny-folder']);
  assert.deepEqual(scanManager.skippedRootFiles, []);
});

test('catalog fuzzy search ranks matches and supports time and filename sorting', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'older', title: '美女旅行到台湾', displayName: 'B项目', inventoryDate: '2025-01-01T08:30:00.000Z', tags: [], manifest: [], directories: [] },
    { id: 'newer', title: '台湾风景', displayName: 'A项目', inventoryDate: '2026-01-01T08:30:00.000Z', tags: [], manifest: [], directories: [] }
  ];
  assert.equal(manager.searchCatalog({ query: '美女台湾' })[0].id, 'older');
  assert.deepEqual(manager.searchCatalog({ sort: 'inventory_desc' }).map((item) => item.id), ['newer', 'older']);
  assert.deepEqual(manager.searchCatalog({ sort: 'name_asc' }).map((item) => item.id), ['newer', 'older']);
  assert.equal(manager.getCatalogSuggestions('美女台湾')[0].id, 'older');
});

test('catalog search does not create a second in-memory posting index', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = Array.from({ length: 5000 }, (_, index) => ({
    id: `bulk-${index}`,
    title: `普通库存编号${index}`,
    displayName: `普通库存编号${index}`,
    tags: [],
    manifest: [],
    directories: []
  }));
  manager.catalog.push({
    id: 'needle', title: '独角兽特别收藏', displayName: '独角兽特别收藏', tags: [], manifest: [], directories: []
  });
  assert.equal(manager.catalogSearchGramIndex, undefined);
  assert.equal(manager.searchCatalog({ query: '独角兽收藏' })[0].id, 'needle');
});

test('similar project links are stored symmetrically', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'a', title: '王佳乐北京旅行记录', displayName: '项目A', tags: [], manifest: [], directories: [] },
    { id: 'b', title: '北京王佳乐旅行纪录', displayName: '项目B', tags: [], manifest: [], directories: [] }
  ];
  await manager.rebuildAllSimilarityRelations();
  assert.equal(manager.catalog[0].similarRecords[0].id, 'b');
  assert.equal(manager.catalog[1].similarRecords[0].id, 'a');
  assert.equal(manager.catalog[0].possibleDuplicate, true);
});

test('similar project links can be recalculated and dismissed symmetrically', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'a', title: '王佳乐北京旅行记录', displayName: '项目A', tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: [] },
    { id: 'b', title: '北京王佳乐旅行纪录', displayName: '项目B', tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: [] }
  ];
  await manager.rebuildAllSimilarityRelations();
  await manager.recalculateCatalogSimilarity('a');
  assert.equal(manager.catalog[1].similarRecords.some((item) => item.id === 'a'), true);

  await manager.removeCatalogSimilarity('a', 'b');
  assert.deepEqual(manager.catalog[0].similarRecords, []);
  assert.deepEqual(manager.catalog[1].similarRecords, []);
  assert.deepEqual(manager.catalog[0].dismissedSimilarRecordIds, ['b']);
  assert.deepEqual(manager.catalog[1].dismissedSimilarRecordIds, ['a']);

  await manager.rebuildAllSimilarityRelations();
  assert.deepEqual(manager.catalog[0].similarRecords, []);
  assert.deepEqual(manager.catalog[1].similarRecords, []);
});

test('disabling similarity keeps old relations but skips new computations', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'a', title: '王佳乐北京旅行记录', displayName: '项目A', tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: [] },
    { id: 'b', title: '北京王佳乐旅行纪录', displayName: '项目B', tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: [] }
  ];
  await manager.rebuildAllSimilarityRelations();
  assert.equal(manager.catalog[0].similarRecords.length, 1);

  await manager.updateConfig({ similarityEnabled: false });
  assert.equal(manager.isSimilarityEnabled(), false);
  assert.equal(manager.catalog[0].similarRecords.length, 1);
  assert.equal(manager.catalog[1].similarRecords.length, 1);

  manager.catalog.push({
    id: 'c', title: '王佳乐北京旅行记录续篇', displayName: '项目C',
    tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: []
  });
  manager.refreshSimilarityForRecord(manager.catalog[2]);
  assert.deepEqual(manager.catalog[2].similarRecords, []);
  assert.equal(manager.catalog[0].similarRecords.length, 1);

  // 全局重算是显式操作，不受自动开关限制，并汇报进度事件。
  const events = [];
  manager.on('similarity-progress', (progress) => events.push(progress));
  await manager.recalculateAllSimilarity();
  const relatedIds = manager.catalog[0].similarRecords.map((item) => item.id);
  assert.ok(relatedIds.includes('b'));
  assert.ok(relatedIds.includes('c'));
  assert.ok(events.length >= 2);
  assert.equal(events[0].active, true);
  assert.equal(events.at(-1).active, false);
  assert.equal(events.at(-1).total, manager.catalog.length);
});

test('changing similarity strength keeps existing relations until an explicit rebuild', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'a', title: '项目A', displayName: '项目A', similarRecords: [{ id: 'b', score: 0.75 }] },
    { id: 'b', title: '项目B', displayName: '项目B', similarRecords: [{ id: 'a', score: 0.75 }] }
  ];
  manager.rebuildAndPersistSimilarityRelations = async () => {
    throw new Error('strength changes must not trigger a rebuild');
  };

  await manager.updateConfig({ similarityStrength: 'strict' });

  assert.equal(manager.similarityStrength, 'strict');
  assert.deepEqual(manager.catalog[0].similarRecords, [{ id: 'b', score: 0.75 }]);
  assert.deepEqual(manager.catalog[1].similarRecords, [{ id: 'a', score: 0.75 }]);
});

test('thumbnail service log levels preserve successful FFmpeg probes as info', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library', repositoryDirectory: 'E:\\warehouse'
  }, {
    archiveRunner: async () => ({
      archiveFiles: [{ name: 'probe-log.7z', size: 50 }],
      archiveTotalBytes: 50,
      manifest: [],
      directories: [],
      skippedFiles: [],
      passwordScheme: 'none',
      hasPassword: false,
      verifiedAt: new Date().toISOString()
    }),
    createThumbnails: async (_job, manifest, _config, options) => {
      options.onLog('FFmpeg 探测成功：sample.mp4 · 320×240 · 2.00 秒。', 'info');
      options.onLog('FFmpeg 视频抽帧失败，改用系统缩略图：sample.mp4');
      return manifest;
    }
  });
  manager.jobs = [{ ...queuedJob('probe-log'), totalBytes: 100, intakeModeSelected: true }];

  await manager.startQueue();

  assert.equal(manager.logs.find((entry) => entry.message.startsWith('FFmpeg 探测成功')).level, 'info');
  assert.equal(manager.logs.find((entry) => entry.message.startsWith('FFmpeg 视频抽帧失败')).level, 'warning');
});

test('each queued task snapshots performance safeguard settings', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    largeFolderSimplification: true,
    largeFolderFileThreshold: 800,
    largeFolderMd5SampleLimit: 240,
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes: 128 * 1024
  });
  const job = manager.createJob({
    sourcePath: 'E:\\source\\large-folder',
    sourceType: 'directory',
    displayName: 'large-folder',
    fileCount: 1000,
    totalBytes: 1000
  });

  await manager.updateConfig({
    largeFolderSimplification: false,
    largeFolderFileThreshold: 1200,
    largeFolderMd5SampleLimit: 320,
    skipTinyMd5Files: false,
    tinyFileMd5ThresholdBytes: 256 * 1024
  });
  assert.equal(job.largeFolderSimplification, true);
  assert.equal(job.largeFolderFileThreshold, 800);
  assert.equal(job.largeFolderMd5SampleLimit, 240);
  assert.equal(job.skipTinyMd5Files, true);
  assert.equal(job.tinyFileMd5ThresholdBytes, 128 * 1024);
  await assert.rejects(manager.updateConfig({ largeFolderFileThreshold: 0 }), /1—100000/);
  await assert.rejects(manager.updateConfig({ largeFolderMd5SampleLimit: 0 }), /1—100000/);
  await assert.rejects(manager.updateConfig({ tinyFileMd5ThresholdBytes: 0 }), /1 KB—1 GB/);
});

test('all settings are rejected consistently while the queue is running', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.running = true;

  await assert.rejects(
    manager.updateConfig({ similarityReportEnabled: false }),
    /队列运行期间不能修改设置/
  );
  assert.equal(manager.config.similarityReportEnabled, true);
});

test('adding a similarity whitelist term is serialized, normalized and does not rebuild relations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-similarity-whitelist-'));
  const termsPath = path.join(root, 'similarity-ignore-terms.txt');
  await fs.writeFile(termsPath, '# common terms\r\nExisting\r\n', 'utf8');
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    similarityIgnoreTermsPath: termsPath
  });
  manager.rebuildAllSimilarityRelations = async () => {
    throw new Error('adding a term must not trigger a relation rebuild');
  };

  try {
    const [first, duplicate] = await Promise.all([
      manager.addSimilarityIgnoreTerm('  常用词  '),
      manager.addSimilarityIgnoreTerm('常用词')
    ]);

    assert.equal(first.added, true);
    assert.equal(first.term, '常用词');
    assert.equal(duplicate.added, false);
    assert.deepEqual(manager.similarityIgnoreTerms, ['existing', '常用词']);
    assert.equal((await fs.readFile(termsPath, 'utf8')).match(/常用词/g)?.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('adding a similarity whitelist term rejects unsafe or meaningless text', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  await assert.rejects(() => manager.addSimilarityIgnoreTerm('line\nbreak'), /不能包含换行或控制字符/);
  await assert.rejects(() => manager.addSimilarityIgnoreTerm(' -- '), /至少包含一个文字或数字/);
  await assert.rejects(() => manager.addSimilarityIgnoreTerm('A'.repeat(201)), /不能超过 200 个字符/);
});

test('similarity rebuild clears every stale possible-duplicate label without a current relation', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    {
      id: 'stale', title: '阿尔法独有档案', displayName: '甲', tags: [], manifest: [], directories: [],
      duplicateEvidence: true, duplicateReasons: ['标题相似'], possibleDuplicate: true,
      similarRecords: [{ id: 'missing', score: 0.7 }], dismissedSimilarRecordIds: []
    },
    {
      id: 'exact', title: '银河深处冬眠', displayName: '乙', tags: [], manifest: [], directories: [],
      duplicateEvidence: true, duplicateReasons: ['存在内容完全一致的文件'], possibleDuplicate: true,
      similarRecords: [], dismissedSimilarRecordIds: []
    }
  ];

  await manager.rebuildAllSimilarityRelations();

  assert.deepEqual(manager.catalog[0].similarRecords, []);
  assert.equal(manager.catalog[0].possibleDuplicate, false);
  assert.equal(manager.catalog[1].possibleDuplicate, false);
});

test('manifest similarity confirmation uses the configured strength', () => {
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'src', 'core', 'queue-manager.js'), 'utf8');
  assert.match(source, /onManifestReady:[\s\S]*?findSimilarProjects\([\s\S]*?this\.similarityIgnoreTerms,\s*this\.similarityStrength\s*\)/);
});

test('new jobs skip similarity confirmation while detection is disabled', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'a', title: '王佳乐北京旅行记录 第一卷', displayName: '项目A', tags: [], manifest: [], directories: [], dismissedSimilarRecordIds: [] }
  ];
  const task = {
    sourcePath: 'E:\\source\\wjl',
    sourceType: 'directory',
    displayName: '王佳乐北京旅行记录 第二卷',
    fileCount: 1,
    totalBytes: 1
  };
  await manager.updateConfig({ similarityEnabled: false });
  const disabledJob = manager.createJob(task);
  assert.deepEqual(disabledJob.similarMatches, []);
  assert.equal(disabledJob.confirmationReasons.includes('similar_title'), false);

  await manager.updateConfig({ similarityEnabled: true });
  const enabledJob = manager.createJob(task);
  assert.ok(enabledJob.similarMatches.length > 0);
  assert.equal(enabledJob.confirmationReasons.includes('similar_title'), true);
});

test('similarity version upgrade removes stale domain-only FC2 relations', async () => {  class SimilarityUpgradeStore extends FakeStore {
    async loadCatalog() {
      return [
        {
          id: 'fc2-a', title: 'FC2-PPV-4768873', displayName: 'FC2-PPV-4768873',
          similarityVersion: 2, possibleDuplicate: true,
          similarRecords: [{ id: 'fc2-b', title: 'FC2-PPV-4723700', score: 0.827, reasons: ['包含标题相似的视频'] }],
          manifest: [{ name: 'hhd800.com@FC2-PPV-4768873.mp4', extension: '.mp4', size: 1001 }],
          directories: [], tags: []
        },
        {
          id: 'fc2-b', title: 'FC2-PPV-4723700', displayName: 'FC2-PPV-4723700',
          similarityVersion: 2, possibleDuplicate: true,
          similarRecords: [{ id: 'fc2-a', title: 'FC2-PPV-4768873', score: 0.827, reasons: ['包含标题相似的视频'] }],
          manifest: [{ name: 'hhd800.com@FC2-PPV-4723700.mp4', extension: '.mp4', size: 1002 }],
          directories: [], tags: []
        }
      ];
    }
    async saveCatalog(_directory, records) { this.catalog = structuredClone(records); }
  }
  const store = new SimilarityUpgradeStore();
  const manager = new QueueManager(store, { repositoryDirectory: 'E:\\library' });
  await manager.initialize();
  await manager.similarityMaintenanceTask;
  assert.deepEqual(manager.catalog.map((record) => record.similarRecords), [[], []]);
  assert.deepEqual(manager.catalog.map((record) => record.similarityVersion), ['6:standard', '6:standard']);
  assert.deepEqual(manager.catalog.map((record) => record.possibleDuplicate), [false, false]);
  assert.deepEqual(store.catalog.map((record) => record.similarRecords), [[], []]);
});

test('legacy catalog records receive an empty hidden original source location', async () => {
  class LegacyStore extends FakeStore {
    async loadCatalog() {
      return [{ id: 'legacy', title: '旧记录', displayName: '旧记录', sourcePath: 'E:\\old\\item', tags: [], manifest: [], directories: [] }];
    }
    async saveCatalog(_directory, records) { this.catalog = structuredClone(records); }
  }
  const store = new LegacyStore();
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  await manager.initialize();
  assert.equal(Object.hasOwn(manager.catalog[0], 'originalSourcePath'), true);
  assert.equal(manager.catalog[0].originalSourcePath, '');
  assert.equal(store.catalog[0].originalSourcePath, '');
});

test('completed source movement refuses collisions and preserves the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-source-move-'));
  try {
    const source = path.join(root, 'source', 'item');
    const destination = path.join(root, 'done');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'one.bin'), 'abc');
    await fs.mkdir(path.join(destination, 'item'), { recursive: true });
    const manager = new QueueManager(new FakeStore(), { libraryDir: path.join(root, 'library') });
    await assert.rejects(manager.moveCompletedItem({
      id: 'move', sourcePath: source, sourceType: 'directory', fileCount: 1, totalBytes: 3
    }, destination), /同名项目/);
    assert.equal((await fs.stat(source)).isDirectory(), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('finish next and pause runs one queued task only', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: async (job) => ({
      archiveFolder: null,
      archiveFiles: [{ name: `${job.id}.7z`, size: 1 }],
      archiveTotalBytes: 1,
      manifest: [{ relativePath: 'file.bin', name: 'file.bin', size: 1, md5: 'abc' }],
      directories: [],
      passwordScheme: 'fixed-v1',
      verifiedAt: new Date().toISOString()
    })
  });
  manager.jobs = [queuedJob('first'), queuedJob('second')];
  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.finishNextAndPause();
  await idle;
  assert.equal(manager.jobs[0].status, 'completed');
  assert.equal(manager.jobs[1].status, 'queued');
});

test('schedule refuses a task whose estimate exceeds the remaining window', () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library', scheduleEnabled: true, scheduleStart: '10:00', scheduleEnd: '10:10'
  });
  const decision = manager.canStartScheduledJob({ totalBytes: 20 * 1024 ** 3 }, new Date(2026, 7, 15, 10, 5));
  assert.equal(decision.allowed, false);
  assert.ok(decision.estimatedMs > decision.remainingMs);
});

test('a scanned task waits for an explicit intake mode and is ignored by the scheduler', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-scan-mode-selection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const item = path.join(root, '待入库项目');
  await fs.mkdir(item);
  await fs.writeFile(path.join(item, 'one.txt'), 'one');
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    smallItemFilter: false,
    scheduleEnabled: true,
    scheduleStart: '00:00',
    scheduleEnd: '23:59'
  });

  await manager.scanSource(root, 'scan-1');

  assert.equal(manager.jobs.length, 1);
  assert.equal(manager.jobs[0].status, 'queued');
  assert.equal(manager.jobs[0].intakeModeSelected, false);
  assert.equal(manager.jobs[0].stageText, '等待选择入库方式');
  let starts = 0;
  manager.startQueue = async () => { starts += 1; };
  await manager.handleScheduleTick(new Date(2026, 7, 15, 12, 0));
  assert.equal(starts, 0);
});

test('manual compressed-intake selection outside the schedule is recorded in the run log', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.jobs = [{
    ...queuedJob('scheduled'),
    intakeModeSelected: false,
    stageText: '等待选择入库方式'
  }];
  manager.canStartScheduledJob = () => ({ allowed: false, estimatedMs: 60_000, remainingMs: 0 });
  const idle = new Promise((resolve) => manager.once('idle', resolve));

  await manager.startArchiveQueue();
  await idle;

  assert.equal(manager.jobs[0].processingMode, 'archive');
  assert.equal(manager.jobs[0].intakeModeSelected, true);
  assert.equal(manager.scheduleWaiting, true);
  assert.ok(manager.logs.some((entry) => /已选择压缩入库/.test(entry.message)));
  assert.ok(manager.logs.some((entry) => /不在定时运行时段；已记录入库方式/.test(entry.message)));
  assert.ok(manager.logs.some((entry) => entry.message === '队列已进入定时等待。'));
});

test('compression estimates use persisted recent speed samples', async () => {
  const store = new FakeStore();
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  await manager.rememberCompressionSample(600 * 1024 ** 2, 30_000);
  const estimatedMs = manager.estimateJobDurationMs({ totalBytes: 1_200 * 1024 ** 2 });
  assert.equal(manager.config.compressionHistory.length, 1);
  assert.equal(estimatedMs, 120_000);
});

test('abnormal compression ratio waits for explicit inventory confirmation', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' }, {
    archiveRunner: async () => ({
      archiveFolder: null,
      archiveFiles: [{ name: 'odd.7z', size: 200 }],
      archiveTotalBytes: 200,
      manifest: [{ relativePath: 'file.bin', name: 'file.bin', size: 100, md5: 'abc' }],
      directories: [],
      passwordScheme: 'fixed-v1',
      verifiedAt: new Date().toISOString()
    })
  });
  manager.jobs = [{ ...queuedJob('odd'), totalBytes: 100 }];
  await manager.startQueue();
  assert.equal(manager.jobs[0].status, 'awaiting_anomaly_confirmation');
  assert.equal(manager.catalog.length, 0);
  await manager.confirmAnomaly('odd');
  assert.equal(manager.jobs[0].status, 'completed');
  assert.equal(manager.catalog.length, 1);
});

test('confirming an anomalous archive still activates the recycle-bin safety halt', async () => {
  const store = new FakeStore();
  const manager = new QueueManager(store, {
    repositoryDirectory: 'E:\\library',
    autoTrashCompleted: true
  }, {
    validateSourceBeforeDisposition: async () => {},
    trashItem: async () => {},
    isTrashItemPresent: async () => { throw new Error('recycle bin unavailable'); }
  });
  manager.jobs = [{
    ...queuedJob('odd-trash'),
    status: 'awaiting_anomaly_confirmation',
    pendingCatalogRecord: {
      id: 'odd-trash-record', jobId: 'odd-trash', title: '异常项目', displayName: '异常项目',
      recordType: 'archive', manifest: [], directories: [], archiveFiles: [{ name: 'odd.7z', size: 1 }],
      completionAction: 'trash', sourceDisposition: 'trash_pending', completedAt: new Date().toISOString()
    }
  }];

  await manager.confirmAnomaly('odd-trash');

  assert.equal(manager.config.autoTrashCompleted, false);
  assert.equal(manager.jobs[0].status, 'awaiting_trash_safety_confirmation');
  assert.equal(manager.safetyHalt?.type, 'trash_retention');
  assert.equal(manager.stopRequested, true);
});

test('normalization retains the most recent 200 dismissed similarity ids', async () => {
  class DismissalStore extends FakeStore {
    async loadCatalog() {
      return [{
        id: 'record', title: '记录', displayName: '记录', manifest: [], directories: [],
        similarityVersion: '5:standard', dismissedSimilarRecordIds: Array.from({ length: 205 }, (_, index) => `id-${index}`)
      }];
    }
  }
  const manager = new QueueManager(new DismissalStore(), {
    repositoryDirectory: 'E:\\library', similarityEnabled: false
  });
  await manager.initialize();
  assert.equal(manager.catalog[0].dismissedSimilarRecordIds.length, 200);
  assert.equal(manager.catalog[0].dismissedSimilarRecordIds[0], 'id-5');
  assert.equal(manager.catalog[0].dismissedSimilarRecordIds.at(-1), 'id-204');
});

test('BUG1 regression: a 0.789 percent archive ratio is held for review and discard preserves source', async (t) => {
  const originalBytes = 16_575_432_670;
  const archiveBytes = 130_838_769;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-bug1-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'BUG1-source');
  const libraryDir = path.join(root, 'output');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source-kept.txt'), 'source must remain');
  const trashed = [];
  const manager = new QueueManager(new FakeStore(), {
    libraryDir,
    warehouseDir: path.join(root, 'saves'),
    stagingDir: path.join(root, 'staging')
  }, {
    archiveRunner: async () => {
      await fs.mkdir(libraryDir, { recursive: true });
      await fs.writeFile(path.join(libraryDir, 'bug1.7z.001'), 'fake archive');
      return {
      archiveFolder: null,
      archiveFiles: [{ name: 'bug1.7z.001', size: archiveBytes }],
      archiveTotalBytes: archiveBytes,
      manifest: [{ relativePath: 'large.xltd', name: 'large.xltd', size: originalBytes, md5: 'bug1' }],
      directories: [],
      passwordScheme: 'fixed-v1',
      verifiedAt: new Date().toISOString()
      };
    },
    trashItem: async (targetPath) => {
      trashed.push(targetPath);
      await fs.rm(targetPath, { recursive: true, force: true });
    }
  });
  manager.jobs = [{ ...queuedJob('bug1'), sourcePath, totalBytes: originalBytes }];
  await manager.startQueue();
  assert.equal(manager.jobs[0].status, 'awaiting_anomaly_confirmation');
  assert.equal(manager.jobs[0].errorCode, 'ARCHIVE_SIZE_ANOMALY');
  assert.match(manager.jobs[0].stageText, /不足原始内容的 1%/);
  assert.ok(manager.logs.some((entry) => entry.level === 'error' && entry.message.includes('压缩体积异常')));
  assert.equal(manager.catalog.length, 0);
  await manager.discardAnomalousArchive('bug1');
  assert.equal(manager.jobs[0].status, 'cancelled');
  assert.equal(trashed.length, 1);
  await fs.access(path.join(sourcePath, 'source-kept.txt'));
  await assert.rejects(fs.access(path.join(libraryDir, 'bug1.7z.001')), /ENOENT/);
});

test('automatic trash runs only after archive metadata and thumbnails are saved', async () => {
  const events = [];
  const store = new FakeStore();
  store.saveCatalog = async () => { events.push('catalog'); };
  const manager = new QueueManager(store, {
    libraryDir: 'E:\\library',
    autoTrashCompleted: true,
    recordBackupLocation: true,
    backupLocation: '百度网盘'
  }, {
    archiveRunner: async () => {
      events.push('archive');
      return {
        archiveFolder: 'archive',
        archiveFiles: [{ name: 'archive.7z', size: 1 }],
        archiveTotalBytes: 1,
        manifest: [{ relativePath: 'image.jpg', name: 'image.jpg', size: 1, md5: 'abc' }],
        directories: [],
        passwordScheme: 'fixed-v1',
        verifiedAt: new Date().toISOString()
      };
    },
    createThumbnails: async (_job, manifest) => {
      events.push('thumbnails');
      return manifest;
    },
    validateSourceBeforeDisposition: async () => { events.push('source-check'); },
    trashItem: async () => { events.push('trash'); },
    isTrashItemPresent: async () => true
  });
  manager.jobs = [queuedJob('one')];

  await manager.startQueue();

  assert.equal(manager.jobs[0].status, 'completed');
  assert.equal(manager.catalog[0].sourceDisposition, 'trashed');
  assert.equal(manager.catalog[0].backupLocation, '百度网盘');
  assert.ok(events.indexOf('archive') < events.indexOf('thumbnails'));
  assert.ok(events.indexOf('thumbnails') < events.indexOf('catalog'));
  assert.ok(events.indexOf('catalog') < events.indexOf('trash'));
});

test('silent recycle-bin loss stops the queue until the user acknowledges the safety halt', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-trash-safety-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const firstSource = path.join(root, 'first');
  const secondSource = path.join(root, 'second');
  await fs.mkdir(firstSource, { recursive: true });
  await fs.mkdir(secondSource, { recursive: true });
  const calls = [];
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: path.join(root, 'library'),
    autoTrashCompleted: true
  }, {
    archiveRunner: async (job) => {
      calls.push(job.id);
      return {
        archiveFolder: null,
        archiveFiles: [{ name: `${job.id}.7z`, size: 1 }],
        archiveTotalBytes: 1,
        manifest: [{ relativePath: 'file.bin', name: 'file.bin', size: 1, md5: 'abc' }],
        directories: [],
        passwordScheme: 'configured-v1',
        verifiedAt: new Date().toISOString()
      };
    },
    validateSourceBeforeDisposition: async () => {},
    trashItem: async (targetPath) => { await fs.rm(targetPath, { recursive: true, force: true }); },
    isTrashItemPresent: async () => false
  });
  manager.jobs = [
    { ...queuedJob('first'), sourcePath: firstSource },
    { ...queuedJob('second'), sourcePath: secondSource }
  ];

  await manager.startQueue();

  assert.deepEqual(calls, ['first']);
  assert.equal(manager.running, false);
  assert.equal(manager.config.autoTrashCompleted, false);
  assert.equal(manager.jobs[0].status, 'awaiting_trash_safety_confirmation');
  assert.equal(manager.jobs[0].errorCode, 'TRASH_RETENTION_FAILED');
  assert.equal(manager.jobs[1].status, 'queued');
  assert.equal(manager.catalog[0].sourceDisposition, 'missing');
  assert.equal(manager.getState().safetyHalt.jobId, 'first');
  assert.equal(manager.config.pendingTrashSafetyHalt.jobId, 'first');
  await assert.rejects(fs.access(firstSource), /ENOENT/);
  await fs.access(secondSource);

  await manager.startQueue();
  assert.deepEqual(calls, ['first']);

  await manager.acknowledgeTrashSafetyHalt('first');
  assert.equal(manager.jobs[0].status, 'completed_cleanup_failed');
  assert.equal(manager.getState().safetyHalt, null);
  assert.equal(manager.config.pendingTrashSafetyHalt, undefined);
  await manager.startQueue();
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(manager.jobs[1].status, 'completed');
  assert.equal(manager.catalog[1].sourceDisposition, 'kept');
  await fs.access(secondSource);
});

test('recycle-bin safety halt survives an application restart', async () => {
  const store = new FakeStore();
  store.loadJobs = async () => [{
    ...queuedJob('lost-source'),
    status: 'awaiting_trash_safety_confirmation',
    errorMessage: '回收站没有保留原文件',
    sourceStillExists: false,
    safetyHaltAt: '2026-08-19T00:00:00.000Z'
  }];
  const pendingTrashSafetyHalt = {
    id: 'halt-one',
    type: 'trash_retention',
    jobId: 'lost-source',
    message: '回收站没有保留原文件',
    sourceStillExists: false,
    detectedAt: '2026-08-19T00:00:00.000Z'
  };
  const manager = new QueueManager(store, {
    libraryDir: 'E:\\library',
    autoTrashCompleted: true,
    pendingTrashSafetyHalt
  });

  await manager.initialize();

  assert.equal(manager.config.autoTrashCompleted, false);
  assert.equal(manager.getState().safetyHalt.id, 'halt-one');
  await manager.startQueue();
  assert.equal(manager.jobs[0].status, 'awaiting_trash_safety_confirmation');
});

test('obsolete historical recycle-bin audit halt is cleared on startup', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    autoTrashCompleted: false,
    pendingTrashSafetyHalt: {
      id: 'old-audit-halt',
      type: 'trash_retention_audit',
      recordId: 'historical-record',
      message: '旧项目已不在回收站',
      sourceStillExists: false,
      detectedAt: '2026-08-19T00:00:00.000Z'
    }
  });

  await manager.initialize();

  assert.equal(manager.getState().safetyHalt, null);
  assert.equal(manager.config.pendingTrashSafetyHalt, undefined);
});

test('catalog metadata supports defaults, editing, cover thumbnails and filters', async () => {
  const store = new FakeStore();
  const legacyRecord = {
    id: 'record-one',
    displayName: '原始项目名',
    sourcePath: 'E:\\source\\原始项目名',
    archiveBaseName: 'archive.7z',
    archiveDirectory: 'E:\\library',
    fileCount: 2,
    manifest: [
      { relativePath: 'cover.jpg', thumbnailPath: 'E:\\repository\\thumbnails\\job-one\\cover.png', md5: 'aaa' },
      { relativePath: 'notes.txt', md5: 'bbb' }
    ],
    directories: []
  };
  store.loadCatalog = async () => [legacyRecord];
  store.saveCatalog = async (_library, records) => { store.catalog = structuredClone(records); };
  const manager = new QueueManager(store, {
    archiveOutputDirectory: 'E:\\library', repositoryDirectory: 'E:\\repository'
  });

  await manager.initialize();
  assert.equal(manager.catalog[0].title, '原始项目名');
  assert.deepEqual(manager.catalog[0].tags, []);
  assert.equal(store.catalog[0].rating, 0);
  assert.ok(manager.catalog[0].inventoryDate);

  await manager.updateCatalogMetadata('record-one', {
    title: '北海道旅行',
    tags: ['摄影', '旅行', '摄影'],
    rating: 5,
    notes: '冬季照片，之后制作相册。',
    backupLocation: '家庭备份盘 A'
  });

  await manager.setCatalogCover('record-one', 'cover.jpg');
  const summary = manager.searchCatalog({
    query: '相册', tag: '旅行', backupLocation: '家庭备份盘 A', rating: 5
  });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].title, '北海道旅行');
  assert.deepEqual(summary[0].tags, ['摄影', '旅行']);
  assert.equal(summary[0].coverThumbnailPath, 'cover.jpg');
  assert.equal(summary[0].coverRelativePath, 'cover.jpg');
  assert.equal(summary[0].backupLocation, '家庭备份盘 A');
  assert.equal(manager.searchCatalog({ tag: '不存在' }).length, 0);
  manager.catalog[0].similarRecords = [{ id: 'record-two', score: 0.8 }];
  manager.catalog[0].possibleDuplicate = true;
  assert.deepEqual(manager.searchCatalog({ tag: '__possible_duplicate__' }).map((record) => record.id), ['record-one']);
  assert.equal(manager.searchCatalog({ backupLocation: '不存在' }).length, 0);
  await assert.rejects(manager.setCatalogCover('record-one', 'notes.txt'), /不能设为封面/);
  await assert.rejects(
    manager.updateCatalogMetadata('record-one', { title: '', rating: 5 }),
    /标题不能为空/
  );
});

test('backup location setting requires a text value when enabled', async () => {
  const manager = new QueueManager(new FakeStore(), {
    libraryDir: 'E:\\library',
    recordBackupLocation: false,
    backupLocation: ''
  });

  await assert.rejects(
    manager.updateConfig({ recordBackupLocation: true, backupLocation: '   ' }),
    /请填写备份位置/
  );
  const state = await manager.updateConfig({ recordBackupLocation: true, backupLocation: ' 移动硬盘 B ' });
  assert.equal(state.config.recordBackupLocation, true);
  assert.equal(state.config.backupLocation, '移动硬盘 B');
});

test('manual inventory requires only name and notes and records inventory date', async () => {
  const store = new FakeStore();
  store.saveCatalog = async (_library, records) => { store.catalog = structuredClone(records); };
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });

  const record = await manager.addManualCatalogRecord({ name: '纸质相册', notes: '存放在书柜第二层。' });

  assert.equal(record.recordType, 'manual');
  assert.equal(record.title, '纸质相册');
  assert.equal(record.notes, '存放在书柜第二层。');
  assert.ok(Number.isFinite(Date.parse(record.inventoryDate)));
  assert.deepEqual(record.archiveFiles, []);
  await assert.rejects(manager.addManualCatalogRecord({ name: '缺少备注' }), /备注不能为空/);
});

test('manual inventory accepts optional locations and can receive stored images', async () => {
  const warehouseDir = 'E:\\warehouse';
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library', warehouseDir }, {
    storeCatalogImage: async (recordId, input) => ({
      id: 'image-one',
      ref: 'manual-image:image-one',
      relativePath: input.name,
      name: input.name,
      thumbnailPath: path.join(warehouseDir, 'thumbnails', `manual-${recordId}`, 'image-one.png')
    })
  });
  const record = await manager.addManualCatalogRecord({
    name: '网络收藏',
    notes: '以后整理',
    tags: '网页, 待整理',
    sourcePath: 'https://example.com/item',
    backupLocation: '移动硬盘 A'
  });
  const updated = await manager.addCatalogImage(record.id, { name: '封面.png', dataUrl: 'data:image/png;base64,AA==' });
  assert.deepEqual(updated.tags, ['网页', '待整理']);
  assert.equal(updated.sourcePath, 'https://example.com/item');
  assert.equal(updated.backupLocation, '移动硬盘 A');
  assert.equal(updated.manualImages.length, 1);
  assert.equal(updated.manualImages[0].thumbnailPath, `manual-${record.id}/image-one.png`);
  assert.equal(updated.coverThumbnailRef, 'manual-image:image-one');
  assert.equal(manager.summarizeCatalogRecord(updated).thumbnailCount, 1);
});

test('bulk tags append without replacing existing tags', async () => {
  const store = new FakeStore();
  store.saveCatalog = async (_library, records) => { store.catalog = structuredClone(records); };
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'one', title: '一', tags: ['原标签'] },
    { id: 'two', title: '二', tags: [] }
  ];

  await manager.addTagsToCatalogRecords(['one', 'two'], '旅行，摄影');

  assert.deepEqual(manager.catalog[0].tags, ['原标签', '旅行', '摄影']);
  assert.deepEqual(manager.catalog[1].tags, ['旅行', '摄影']);
});

test('bulk backup location and metadata changes can be undone up to the previous snapshot', async () => {
  const store = new FakeStore();
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  manager.catalog = [{
    id: 'one', recordType: 'manual', displayName: '一', title: '一', notes: '备注', tags: [], rating: 0,
    backupLocation: '', manifest: [], directories: []
  }];
  await manager.updateBackupLocationForCatalogRecords(['one'], '移动硬盘 A');
  assert.equal(manager.catalog[0].backupLocation, '移动硬盘 A');
  assert.equal(manager.getState().undoDepth, 1);
  await manager.undoCatalogAction();
  assert.equal(manager.catalog[0].backupLocation, '');
});

test('bulk backup undo does not recalculate similarity for every record', async () => {
  const store = new FakeStore();
  let subsetWrites = 0;
  store.saveCatalogRecords = async () => { subsetWrites += 1; };
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  manager.catalog = Array.from({ length: 161 }, (_, index) => ({
    id: `record-${index}`, recordType: 'manual', displayName: `项目 ${index}`, title: `项目 ${index}`,
    notes: '备注', tags: [], rating: 0, backupLocation: '', manifest: [], directories: [], similarRecords: []
  }));
  let similarityCalls = 0;
  manager.refreshSimilarityForRecord = () => { similarityCalls += 1; };
  await manager.updateBackupLocationForCatalogRecords(manager.catalog.map((record) => record.id), '移动硬盘 A');
  await manager.undoCatalogAction();
  assert.equal(similarityCalls, 0);
  assert.equal(subsetWrites, 2);
  assert.ok(manager.catalog.every((record) => record.backupLocation === ''));
});

test('single archive password changes only through explicit metadata editing', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'archive-a', recordType: 'archive', title: 'A', displayName: 'A', tags: [], manifest: [], directories: [], archivePassword: '', hasPassword: false },
    { id: 'manual-b', recordType: 'manual', title: 'B', displayName: 'B', tags: [], manifest: [], directories: [] }
  ];
  await manager.updateCatalogMetadata('archive-a', { archivePassword: 'shared-secret', passwordRecorded: true });
  assert.equal(manager.catalog[0].archivePassword, 'shared-secret');
  assert.equal(manager.catalog[0].passwordRecorded, true);
  assert.equal(manager.catalog[1].archivePassword, undefined);
  await manager.undoCatalogAction();
  assert.equal(manager.catalog[0].archivePassword, '');
  assert.equal(manager.catalog[0].hasPassword, false);
});

test('warehouse undo history is capped at ten actions', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [{
    id: 'one', recordType: 'manual', displayName: '一', title: '一', notes: '备注', tags: [], rating: 0,
    backupLocation: '', manifest: [], directories: []
  }];
  for (let index = 0; index < 12; index += 1) {
    await manager.updateBackupLocationForCatalogRecords(['one'], `位置 ${index}`);
  }
  assert.equal(manager.getState().undoDepth, 10);
  assert.ok(manager.logs.some((entry) => entry.message.includes('撤销记录已达到上限')));
});

test('deleting one catalog record does not erase unrelated undo history', async () => {
  const store = new FakeStore();
  store.saveCatalog = async () => {};
  const manager = new QueueManager(store, { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'edited', recordType: 'manual', title: '编辑项', displayName: '编辑项', notes: '', tags: [], rating: 0 },
    { id: 'deleted', recordType: 'manual', title: '删除项', displayName: '删除项', notes: '', tags: [], rating: 0 }
  ];
  await manager.updateCatalogMetadata('edited', { notes: '先前修改' });
  await manager.deleteCatalogRecords(['deleted']);
  await manager.undoCatalogAction();
  assert.equal(manager.catalog.find((record) => record.id === 'edited').notes, '');
});

test('imported warehouse records keep external archive paths and deletion does not trash them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-import-external-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const external = path.join(root, 'external-repository');
  const archiveDirectory = path.join(root, 'external-archives');
  const target = path.join(root, 'target-repository');
  await fs.mkdir(external, { recursive: true });
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(external, 'warehouse.sqlite'), 'sqlite');
  await fs.writeFile(path.join(archiveDirectory, 'outside.7z'), 'archive');
  const store = new FakeStore();
  store.loadCatalog = async () => [{
    id: 'external-record', recordType: 'archive', title: '外部归档', displayName: '外部归档',
    archiveDirectory, archiveFiles: [{ name: 'outside.7z' }], tags: [], manifest: [], directories: []
  }];
  store.closeRepository = () => {};
  store.saveCatalog = async (_library, records) => { store.catalog = structuredClone(records); };
  const trashed = [];
  const manager = new QueueManager(store, {
    repositoryDirectory: target,
    archiveOutputDirectory: path.join(root, 'local-archives'),
    archiveStagingDirectory: path.join(root, 'local-staging')
  }, { trashItem: async (value) => trashed.push(value) });

  await manager.importWarehouseFromDirectory(external);
  assert.equal(manager.catalog[0].archiveDirectory, archiveDirectory);
  assert.equal(manager.catalog[0].importedFrom, external);
  const result = await manager.deleteCatalogRecords(['external-record']);
  assert.deepEqual(result.deletedIds, ['external-record']);
  assert.deepEqual(trashed, []);
  await fs.access(path.join(archiveDirectory, 'outside.7z'));
});

test('bulk tag input rejects punctuation outside the tag rules', async () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [{
    id: 'one', recordType: 'manual', displayName: '一', title: '一', notes: '备注', tags: [], rating: 0,
    backupLocation: '', manifest: [], directories: []
  }];
  await assert.rejects(manager.addTagsToCatalogRecords(['one'], '合法标签, 不合格!'), /标签只能使用/);
});

test('catalog deletion quarantines archive volumes atomically and rejects paths outside the warehouse', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-atomic-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archiveDirectory = path.join(root, 'library');
  const repositoryDirectory = path.join(root, 'repository');
  const stagingDirectory = path.join(root, 'staging');
  await fs.mkdir(path.join(repositoryDirectory, 'thumbnails', 'job-safe'), { recursive: true });
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.writeFile(path.join(archiveDirectory, 'arc_safe.7z'), 'archive');
  const trashed = [];
  const store = new FakeStore();
  store.saveCatalog = async (_library, records) => { store.catalog = structuredClone(records); };
  const manager = new QueueManager(store, {
    archiveOutputDirectory: archiveDirectory, repositoryDirectory, archiveStagingDirectory: stagingDirectory
  }, {
    trashItem: async (targetPath) => { trashed.push(targetPath); }
  });
  manager.catalog = [
    {
      id: 'archive', title: '归档项目', recordType: 'archive',
      archiveDirectory, archiveFiles: [{ name: 'arc_safe.7z' }], jobId: 'job-safe'
    },
    {
      id: 'manual', title: '手动项目', recordType: 'manual',
      jobId: null
    },
    {
      id: 'unsafe', title: '越界项目', recordType: 'archive',
      archiveDirectory, archiveFiles: [{ name: '..\\outside' }], jobId: null
    }
  ];

  const result = await manager.deleteCatalogRecords(['archive', 'manual', 'unsafe']);

  assert.deepEqual(result.deletedIds.sort(), ['archive', 'manual']);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /无效路径|不在允许的仓库子目录/);
  assert.equal(manager.catalog.length, 1);
  assert.equal(trashed.length, 2);
  assert.ok(trashed.some((targetPath) => targetPath.includes('delete-quarantine')));
  assert.ok(trashed.some((targetPath) => targetPath.endsWith('thumbnails\\job-safe')));
});

test('catalog deletion can restore a moved original before removing the archive record', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-restore-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const originalPath = path.join(root, 'source', 'item');
  const movedPath = path.join(root, 'processed', 'item');
  const archiveDirectory = path.join(root, 'archives');
  const repositoryDirectory = path.join(root, 'repository');
  const stagingDirectory = path.join(root, 'staging');
  await fs.mkdir(movedPath, { recursive: true });
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.writeFile(path.join(movedPath, 'one.bin'), 'abc');
  await fs.writeFile(path.join(archiveDirectory, 'item.7z'), 'archive');
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: archiveDirectory, repositoryDirectory, archiveStagingDirectory: stagingDirectory
  }, { trashItem: async () => {} });
  manager.catalog = [{
    id: 'restore', jobId: null, title: '复原项目', recordType: 'archive', sourceType: 'directory',
    originalSourcePath: originalPath, sourceDisposition: 'moved', movedTo: movedPath,
    fileCount: 1, originalBytes: 3, archiveDirectory, archiveFiles: [{ name: 'item.7z' }]
  }];

  const result = await manager.deleteCatalogRecords(['restore'], { restoreOriginalSources: true });
  assert.deepEqual(result.deletedIds, ['restore']);
  assert.equal((await fs.stat(originalPath)).isDirectory(), true);
  await assert.rejects(fs.access(movedPath), /ENOENT/);
});

test('catalog source restore keeps the warehouse record and updates its current location', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-open-restore-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const originalPath = path.join(root, 'source', 'item');
  const movedPath = path.join(root, 'processed', 'item');
  await fs.mkdir(movedPath, { recursive: true });
  await fs.writeFile(path.join(movedPath, 'one.bin'), 'abc');
  const store = new FakeStore();
  const manager = new QueueManager(store, { repositoryDirectory: path.join(root, 'repository') });
  manager.catalog = [{
    id: 'restore-and-open', jobId: null, title: '复原后打开', recordType: 'archive', sourceType: 'directory',
    originalSourcePath: originalPath, sourceDisposition: 'moved', movedTo: movedPath,
    fileCount: 1, originalBytes: 3, archiveFiles: []
  }];

  const result = await manager.restoreCatalogSource('restore-and-open');
  assert.equal(result.path, originalPath);
  assert.equal(result.record.sourceDisposition, 'kept');
  assert.equal(result.record.movedTo, '');
  assert.equal(manager.catalog.length, 1);
  assert.equal((await fs.stat(path.join(originalPath, 'one.bin'))).size, 3);
  await assert.rejects(fs.access(movedPath), /ENOENT/);
});

test('failed original restoration keeps both archive and warehouse record', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-restore-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archiveDirectory = path.join(root, 'archives');
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.writeFile(path.join(archiveDirectory, 'item.7z'), 'archive');
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: archiveDirectory,
    repositoryDirectory: path.join(root, 'repository'),
    archiveStagingDirectory: path.join(root, 'staging')
  }, { trashItem: async () => {} });
  manager.catalog = [{
    id: 'restore-failure', jobId: null, title: '复原失败', recordType: 'archive', sourceType: 'directory',
    originalSourcePath: path.join(root, 'source', 'item'), sourceDisposition: 'moved', movedTo: path.join(root, 'missing', 'item'),
    fileCount: 1, originalBytes: 3, archiveDirectory, archiveFiles: [{ name: 'item.7z' }]
  }];

  const result = await manager.deleteCatalogRecords(['restore-failure'], { restoreOriginalSources: true });
  assert.equal(result.deletedIds.length, 0);
  assert.match(result.failures[0].message, /已找不到原文件/);
  await fs.access(path.join(archiveDirectory, 'item.7z'));
  assert.equal(manager.catalog.length, 1);
});

test('new flat multi-volume records are moved to one quarantine before deletion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-flat-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archiveDirectory = path.join(root, 'library');
  const stagingDirectory = path.join(root, 'staging');
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.writeFile(path.join(archiveDirectory, 'arc_flat.7z.001'), 'one');
  await fs.writeFile(path.join(archiveDirectory, 'arc_flat.7z.002'), 'two');
  const trashed = [];
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: archiveDirectory, repositoryDirectory: path.join(root, 'repository'), archiveStagingDirectory: stagingDirectory
  }, {
    trashItem: async (targetPath) => { trashed.push(targetPath); }
  });
  manager.catalog = [{
    id: 'flat', title: '平铺分卷', recordType: 'archive', archiveDirectory, jobId: null,
    archiveFiles: [{ name: 'arc_flat.7z.001' }, { name: 'arc_flat.7z.002' }]
  }];
  const result = await manager.deleteCatalogRecords(['flat']);
  assert.deepEqual(result.deletedIds, ['flat']);
  assert.equal(trashed.length, 1);
  assert.ok(trashed[0].includes('delete-quarantine'));
});

test('multi-volume deletion rolls every part back when recycle-bin removal fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-delete-rollback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archiveDirectory = path.join(root, 'library');
  await fs.mkdir(archiveDirectory, { recursive: true });
  for (const name of ['rollback.7z.001', 'rollback.7z.002']) await fs.writeFile(path.join(archiveDirectory, name), name);
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: archiveDirectory,
    repositoryDirectory: path.join(root, 'repository'),
    archiveStagingDirectory: path.join(root, 'staging')
  }, {
    trashItem: async () => { throw new Error('模拟回收站失败'); }
  });
  manager.catalog = [{
    id: 'rollback', title: '回滚测试', recordType: 'archive', archiveDirectory, jobId: null,
    archiveFiles: [{ name: 'rollback.7z.001' }, { name: 'rollback.7z.002' }]
  }];
  const result = await manager.deleteCatalogRecords(['rollback']);
  assert.equal(result.deletedIds.length, 0);
  assert.match(result.failures[0].message, /已回滚/);
  await fs.access(path.join(archiveDirectory, 'rollback.7z.001'));
  await fs.access(path.join(archiveDirectory, 'rollback.7z.002'));
  assert.equal(manager.catalog.length, 1);
});

test('warehouse insights calculate inventory, unique tags and GB activity', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    {
      id: 'today', title: '今天入库', tags: ['旅行', '摄影'], originalBytes: 2_000_000_000,
      inventoryDate: new Date(2026, 7, 15, 10).toISOString(), manifest: [], directories: []
    },
    {
      id: 'last-year', title: '去年今日', tags: ['旅行'], originalBytes: 1_000_000_000,
      inventoryDate: new Date(2025, 7, 15, 10).toISOString(), manifest: [], directories: []
    },
    {
      id: 'manual', title: '手动库存', tags: ['纸质'], originalBytes: 0,
      inventoryDate: new Date(2026, 7, 14, 10).toISOString(), manifest: [], directories: []
    }
  ];

  const insights = manager.getWarehouseInsights(new Date(2026, 7, 15, 12));

  assert.equal(insights.inventoryCount, 3);
  assert.equal(insights.uniqueTagCount, 3);
  assert.equal(insights.totalOriginalBytes, 3_000_000_000);
  assert.equal(insights.activity.length, 112);
  assert.equal(insights.activity.find((entry) => entry.date === '2026-08-15').inventoryCount, 1);
  assert.equal(insights.activity.find((entry) => entry.date === '2026-08-15').originalBytes, 2_000_000_000);
});

test('startup upgrades stale absolute thumbnail paths after the warehouse was moved manually', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-thumbnail-reconnect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const warehouse = path.join(root, 'warehouse-current');
  const currentThumbnail = path.join(warehouse, 'thumbnails', 'job-one', 'cover.png');
  await fs.mkdir(path.dirname(currentThumbnail), { recursive: true });
  await fs.writeFile(currentThumbnail, 'image');
  const staleThumbnail = path.join(root, 'warehouse-before-move', 'thumbnails', 'job-one', 'cover.png');
  const store = new AppStore(path.join(root, 'user-data'));
  await store.saveCatalog(warehouse, [{
    id: 'record-one', title: '已移动仓库', displayName: '已移动仓库', recordType: 'archive',
    tags: [], manifest: [{
      relativePath: 'cover.jpg', ref: 'cover.jpg', thumbnailPath: staleThumbnail
    }], directories: []
  }]);
  await store.saveJobs(warehouse, []);

  const manager = new QueueManager(store, {
    repositoryDirectory: warehouse,
    archiveOutputDirectory: path.join(root, 'archives'),
    similarityEnabled: false
  });
  await manager.initialize();

  assert.equal(manager.catalog[0].manifest[0].thumbnailPath, 'job-one/cover.png');
  assert.equal(manager.getThumbnailPath('record-one', 'cover.jpg'), currentThumbnail);
  const persisted = await store.loadCatalog(warehouse);
  assert.equal(persisted[0].manifest[0].thumbnailPath, 'job-one/cover.png');
  store.closeAll();
});

test('deleting and undoing a thumbnail still works after automatic path upgrade', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-thumbnail-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const warehouse = path.join(root, 'warehouse-current');
  const currentThumbnail = path.join(warehouse, 'thumbnails', 'job-one', 'cover.png');
  await fs.mkdir(path.dirname(currentThumbnail), { recursive: true });
  await fs.writeFile(currentThumbnail, 'image');
  const store = new AppStore(path.join(root, 'user-data'));
  await store.saveCatalog(warehouse, [{
    id: 'record-one', title: '删除测试', displayName: '删除测试', recordType: 'archive',
    tags: [], manifest: [{
      relativePath: 'cover.jpg', ref: 'cover.jpg',
      thumbnailPath: path.join(root, 'old', 'thumbnails', 'job-one', 'cover.png'),
      thumbnails: [{
        ref: 'cover.jpg', relativePath: 'cover.jpg',
        thumbnailPath: path.join(root, 'old', 'thumbnails', 'job-one', 'cover.png')
      }]
    }], directories: []
  }]);
  await store.saveJobs(warehouse, []);
  const manager = new QueueManager(store, {
    repositoryDirectory: warehouse,
    archiveOutputDirectory: path.join(root, 'archives'),
    similarityEnabled: false
  });
  await manager.initialize();

  await manager.deleteCatalogThumbnail('record-one', 'cover.jpg::frame:0');
  await assert.rejects(fs.access(currentThumbnail), (error) => error.code === 'ENOENT');
  await manager.undoCatalogAction();
  await fs.access(currentThumbnail);
  assert.equal(manager.catalog[0].manifest[0].thumbnailPath, 'job-one/cover.png');
  store.closeAll();
});

test('warehouse location change copies metadata and rewrites owned thumbnail paths without deleting the old warehouse', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-warehouse-move-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldWarehouse = path.join(root, 'warehouse-old');
  const newWarehouse = path.join(root, 'warehouse-new');
  const thumbnailPath = path.join(oldWarehouse, 'thumbnails', 'manual-record', 'image.png');
  await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
  await fs.writeFile(thumbnailPath, 'image');
  const store = new AppStore(path.join(root, 'user-data'));
  await store.saveCatalog(oldWarehouse, [{
    id: 'record', title: '迁移库存', displayName: '迁移库存', recordType: 'manual', notes: '备注',
    tags: [], manifest: [], directories: [], manualImages: [{
      id: 'image', ref: 'manual-image:image', relativePath: 'image.png', thumbnailPath
    }]
  }]);
  await store.saveJobs(oldWarehouse, []);
  const manager = new QueueManager(store, {
    sourceDir: path.join(root, 'source'),
    stagingDir: path.join(root, 'staging'),
    libraryDir: path.join(root, 'output'),
    warehouseDir: oldWarehouse,
    moveCompleted: false
  });
  await manager.initialize();
  const result = await manager.changeWarehouseDirectory(newWarehouse);
  assert.equal(result.copied, true);
  assert.equal(manager.config.repositoryDirectory, newWarehouse);
  assert.equal(manager.catalog[0].manualImages[0].thumbnailPath, 'manual-record/image.png');
  assert.equal(
    manager.getThumbnailPath('record', 'manual-image:image'),
    path.join(newWarehouse, 'thumbnails', 'manual-record', 'image.png')
  );
  await fs.access(path.join(newWarehouse, 'thumbnails', 'manual-record', 'image.png'));
  await fs.access(thumbnailPath);
  store.closeAll();
});

test('random warehouse recommendation avoids the active item when alternatives exist', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = [
    { id: 'active', title: '当前', manifest: [], directories: [] },
    { id: 'other', title: '其他', manifest: [], directories: [] }
  ];

  assert.equal(manager.getRandomCatalogRecord('active').id, 'other');
  assert.equal(manager.getRandomCatalogRecord('other').id, 'active');
});

test('random warehouse recommendation visits every item before reshuffling', () => {
  const manager = new QueueManager(new FakeStore(), { libraryDir: 'E:\\library' });
  manager.catalog = Array.from({ length: 8 }, (_, index) => ({
    id: `record-${index}`, title: `库存 ${index}`, manifest: [], directories: []
  }));
  const firstCycle = Array.from({ length: 8 }, () => manager.getRandomCatalogRecord().id);
  assert.equal(new Set(firstCycle).size, 8);
});

test('inventory-only queue stores a verified manifest without creating an archive or moving the source', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-inventory-only-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source-item');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'one.txt'), 'inventory only');
  let archiveRunnerCalled = false;
  let thumbnailsCalled = false;
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse'),
    archiveOutputDirectory: path.join(root, 'archives'),
    archiveStagingDirectory: path.join(root, 'staging'),
    moveCompleted: true,
    processedSourceDirectory: path.join(root, 'processed')
  }, {
    archiveRunner: async () => { archiveRunnerCalled = true; throw new Error('must not run'); },
    createThumbnails: async (_job, manifest) => { thumbnailsCalled = true; return manifest; }
  });
  manager.jobs = [manager.createJob({
    sourcePath,
    sourceType: 'directory',
    displayName: '直接入库示例',
    fileCount: 1,
    totalBytes: 14
  })];

  const idle = new Promise((resolve) => manager.once('idle', resolve));
  await manager.startInventoryOnlyQueue();
  await idle;

  assert.equal(archiveRunnerCalled, false);
  assert.equal(thumbnailsCalled, true);
  assert.equal(manager.jobs[0].status, 'completed');
  assert.equal(manager.catalog.length, 1);
  assert.equal(manager.catalog[0].archiveState, 'uncompressed');
  assert.equal(manager.catalog[0].archiveTotalBytes, 0);
  assert.deepEqual(manager.catalog[0].archiveFiles, []);
  assert.equal(manager.catalog[0].tags[0], '未压缩');
  assert.equal(manager.catalog[0].sourceDisposition, 'kept');
  assert.equal((await fs.stat(sourcePath)).isDirectory(), true);
});

test('warehouse compression refuses an uncompressed record whose original manifest changed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-existing-changed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source-item');
  await fs.mkdir(sourcePath, { recursive: true });
  const sourceFile = path.join(sourcePath, 'one.txt');
  await fs.writeFile(sourceFile, 'before');
  const manifest = await buildManifest(sourcePath, 'directory');
  await fs.writeFile(sourceFile, 'content changed after intake');
  const manager = new QueueManager(new FakeStore(), {
    repositoryDirectory: path.join(root, 'warehouse')
  });
  manager.catalog = [{
    id: 'uncompressed-changed',
    jobId: 'original-job',
    title: '已变化项目',
    displayName: '已变化项目',
    recordType: 'archive',
    archiveState: 'uncompressed',
    tags: ['未压缩'],
    sourceType: 'directory',
    sourcePath,
    originalSourcePath: sourcePath,
    sourceDisposition: 'kept',
    originalBytes: 6,
    manifest,
    directories: []
  }];

  const result = await manager.queueCatalogRecordsForCompression(['uncompressed-changed']);

  assert.equal(result.queuedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(manager.jobs.length, 0);
  assert.match(result.failures[0].reason, /源文件发生变化/);
});

test('warehouse compression upgrades the same uncompressed record and removes its system label', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-existing-upgrade-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source-item');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'one.txt'), '1234567890');
  const manifest = await buildManifest(sourcePath, 'directory');
  const store = new FakeStore();
  const manager = new QueueManager(store, {
    repositoryDirectory: path.join(root, 'warehouse'),
    archiveOutputDirectory: path.join(root, 'archives'),
    archiveStagingDirectory: path.join(root, 'staging'),
    moveCompleted: false,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: true
  }, {
    archiveRunner: async (_job, _config, hooks) => {
      await hooks.onManifestReady(manifest);
      await hooks.onStage('compressing', '正在压缩');
      await hooks.onProgress(100);
      await hooks.onStage('verifying', '正在校验');
      return {
        archiveFiles: [{ name: 'upgraded.7z', size: 5 }],
        archiveTotalBytes: 5,
        manifest,
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        verifiedAt: new Date().toISOString()
      };
    }
  });
  manager.catalog = [{
    id: 'uncompressed-upgrade',
    jobId: 'original-job',
    title: '保留自定义标题',
    displayName: '原始名称',
    recordType: 'archive',
    archiveState: 'uncompressed',
    tags: ['未压缩', '旅行'],
    rating: 4,
    notes: '保留备注',
    sourceType: 'directory',
    sourcePath,
    originalSourcePath: sourcePath,
    sourceDisposition: 'kept',
    originalBytes: 10,
    manifest,
    directories: [],
    archiveFiles: []
  }, {
    id: 'other-exact-record',
    jobId: 'other-job',
    title: '原始名称',
    displayName: '原始名称',
    recordType: 'archive',
    archiveState: 'compressed',
    sourceDisposition: 'kept',
    sourceType: 'directory',
    sourcePath,
    originalSourcePath: sourcePath,
    originalBytes: 10,
    manifest,
    directories: [],
    archiveFiles: [{ name: 'existing.7z', size: 5 }]
  }];

  const queued = await manager.queueCatalogRecordsForCompression(['uncompressed-upgrade']);
  assert.equal(queued.queuedCount, 1);
  assert.equal(manager.jobs[0].sourceCatalogRecordId, 'uncompressed-upgrade');
  assert.equal(manager.jobs[0].stageText, '库内项目压缩 · 等待压缩');
  assert.deepEqual(manager.jobs[0].nameDuplicateMatches, []);
  assert.deepEqual(manager.jobs[0].similarMatches, []);
  assert.equal(manager.jobs[0].automaticDuplicateCheckPending, false);
  await manager.startQueue();

  assert.equal(manager.jobs[0].status, 'completed');
  assert.equal(manager.catalog.length, 2);
  assert.equal(manager.catalog[0].id, 'uncompressed-upgrade');
  assert.equal(manager.catalog[0].archiveState, 'compressed');
  assert.equal(manager.catalog[0].tags.includes('未压缩'), false);
  assert.equal(manager.catalog[0].tags.includes('旅行'), true);
  assert.equal(manager.catalog[0].title, '保留自定义标题');
  assert.equal(manager.catalog[0].notes, '保留备注');
  assert.deepEqual(manager.catalog[0].archiveFiles, [{ name: 'upgraded.7z', size: 5 }]);
});

test('catalog commit failure rolls back memory and recovers task-owned output while preserving source', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-catalog-commit-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  const repository = path.join(root, 'repository');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.bin'), 'source remains intact');
  const sourceStats = await fs.stat(path.join(sourcePath, 'source.bin'));
  const store = new FakeStore();
  store.saveCatalog = async () => {
    const error = new Error('simulated repository access denied');
    error.code = 'EACCES';
    throw error;
  };
  let sourceDispositionCalls = 0;
  const manager = new QueueManager(store, {
    archiveOutputDirectory: output,
    archiveStagingDirectory: staging,
    repositoryDirectory: repository,
    autoTrashCompleted: true,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  }, {
    archiveRunner: async (job) => {
      await fs.mkdir(output, { recursive: true });
      const archivePath = path.join(output, job.archiveBaseName);
      await fs.writeFile(archivePath, 'verified archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 16 }],
        archiveTotalBytes: 16,
        manifest: [{ relativePath: 'source.bin', name: 'source.bin', size: sourceStats.size, md5: 'abc' }],
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName]),
        verifiedAt: new Date().toISOString()
      };
    },
    createThumbnails: async (job, manifest, config) => {
      const thumbnailDirectory = path.join(config.repositoryDirectory, 'thumbnails', job.id);
      await fs.mkdir(thumbnailDirectory, { recursive: true });
      await fs.writeFile(path.join(thumbnailDirectory, '001.png'), 'thumbnail');
      return manifest;
    },
    trashItem: async () => { sourceDispositionCalls += 1; },
    isTrashItemPresent: async () => true
  });
  const job = {
    ...queuedJob('catalog-commit-failure'),
    sourcePath,
    totalBytes: sourceStats.size,
    archiveBaseName: 'catalog-commit-failure.7z'
  };
  manager.jobs = [job];

  await manager.startQueue();

  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'EACCES');
  assert.equal(manager.catalog.length, 0);
  assert.equal(sourceDispositionCalls, 0);
  await fs.access(path.join(sourcePath, 'source.bin'));
  await assert.rejects(fs.access(path.join(output, job.archiveBaseName)), /ENOENT/);
  await assert.rejects(fs.access(path.join(repository, 'thumbnails', job.id)), /ENOENT/);
  assert.equal(job.catalogRecovery.archiveState, 'recovered_to_staging');
  assert.equal(job.catalogRecovery.recoveryRequired, false);
  assert.equal(job.catalogRecovery.recoveredFiles.length, 1);
  assert.equal(await fs.readFile(job.catalogRecovery.recoveredFiles[0].recoveryPath, 'utf8'), 'verified archive');
  const recoveryManifest = JSON.parse(await fs.readFile(
    path.join(job.catalogRecovery.recoveryDirectory, 'recovery.json'),
    'utf8'
  ));
  assert.equal(recoveryManifest.ownerJobId, job.id);
  assert.equal(recoveryManifest.files[0].recoveryPath, job.catalogRecovery.recoveredFiles[0].recoveryPath);
  assert.match(job.errorMessage, /内存仓库未提交/);
  assert.match(job.errorMessage, /恢复目录/);
  assert.ok(manager.logs.some((entry) => entry.level === 'error' && entry.message.includes(job.catalogRecovery.recoveryDirectory)));
});

test('catalog commit compensation failure leaves explicit recovery diagnostics and never touches source', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-catalog-recovery-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  const repository = path.join(root, 'repository');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.bin'), 'source remains intact');
  const sourceStats = await fs.stat(path.join(sourcePath, 'source.bin'));
  const store = new FakeStore();
  store.saveCatalog = async () => {
    const error = new Error('simulated repository access denied');
    error.code = 'EACCES';
    throw error;
  };
  let archivePath;
  const recoveryDirectory = path.join(staging, 'recovery', 'manual-attention');
  const manager = new QueueManager(store, {
    archiveOutputDirectory: output,
    archiveStagingDirectory: staging,
    repositoryDirectory: repository,
    moveCompleted: false,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  }, {
    archiveRunner: async (job) => {
      await fs.mkdir(output, { recursive: true });
      archivePath = path.join(output, job.archiveBaseName);
      await fs.writeFile(archivePath, 'verified archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 16 }],
        archiveTotalBytes: 16,
        manifest: [{ relativePath: 'source.bin', name: 'source.bin', size: sourceStats.size, md5: 'abc' }],
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName]),
        verifiedAt: new Date().toISOString()
      };
    },
    recoverPublishedArchiveFiles: async () => {
      const error = new Error('simulated recovery device failure');
      error.code = 'EIO';
      error.recoveryDirectory = recoveryDirectory;
      error.unrecoveredPaths = [archivePath];
      throw error;
    }
  });
  const job = {
    ...queuedJob('catalog-recovery-failure'),
    sourcePath,
    totalBytes: sourceStats.size,
    archiveBaseName: 'catalog-recovery-failure.7z'
  };
  manager.jobs = [job];

  await manager.startQueue();

  assert.equal(job.status, 'failed');
  assert.equal(manager.catalog.length, 0);
  await fs.access(path.join(sourcePath, 'source.bin'));
  await fs.access(archivePath);
  assert.equal(job.catalogRecovery.recoveryRequired, true);
  assert.equal(job.catalogRecovery.archiveState, 'manual_recovery_required');
  assert.deepEqual(job.catalogRecovery.unrecoveredPaths, [archivePath]);
  assert.match(job.errorMessage, /自动补偿未完成/);
  assert.match(job.errorMessage, new RegExp(archivePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(manager.logs.some((entry) => entry.level === 'error' && entry.message.includes('simulated recovery device failure')));
});

test('successful catalog commit keeps the published archive and does not create recovery state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-catalog-commit-success-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  const repository = path.join(root, 'repository');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.bin'), 'source remains intact');
  const sourceStats = await fs.stat(path.join(sourcePath, 'source.bin'));
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: output,
    archiveStagingDirectory: staging,
    repositoryDirectory: repository,
    moveCompleted: false,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  }, {
    archiveRunner: async (job) => {
      await fs.mkdir(output, { recursive: true });
      const archivePath = path.join(output, job.archiveBaseName);
      await fs.writeFile(archivePath, 'verified archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 16 }],
        archiveTotalBytes: 16,
        manifest: [{ relativePath: 'source.bin', name: 'source.bin', size: sourceStats.size, md5: 'abc' }],
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName]),
        verifiedAt: new Date().toISOString()
      };
    }
  });
  const job = {
    ...queuedJob('catalog-commit-success'),
    sourcePath,
    totalBytes: sourceStats.size,
    archiveBaseName: 'catalog-commit-success.7z'
  };
  manager.jobs = [job];

  await manager.startQueue();

  assert.equal(job.status, 'completed');
  assert.equal(manager.catalog.length, 1);
  assert.equal(job.catalogRecovery, undefined);
  await fs.access(path.join(output, job.archiveBaseName));
  await fs.access(path.join(sourcePath, 'source.bin'));
  assert.equal(await pathExistsForTest(path.join(staging, 'recovery')), false);
});

test('anomaly confirmation restores the in-memory catalog when persistence fails', async () => {
  const store = new FakeStore();
  store.saveCatalog = async () => {
    const error = new Error('simulated anomaly catalog denial');
    error.code = 'EACCES';
    throw error;
  };
  const manager = new QueueManager(store, {
    repositoryDirectory: 'E:\\warehouse',
    similarityEnabled: false
  });
  const existing = {
    id: 'existing-record',
    title: 'existing',
    displayName: 'existing',
    recordType: 'archive',
    manifest: [],
    similarRecords: []
  };
  manager.catalog = [existing];
  const catalogBeforeCommit = structuredClone(manager.catalog);
  manager.refreshSimilarityForRecord = () => {
    manager.catalog[0].possibleDuplicate = true;
    manager.catalog[0].similarRecords.push({ id: 'pending-record', score: 1 });
  };
  const pendingRecord = {
    id: 'pending-record',
    jobId: 'anomaly-commit-failure',
    title: 'pending',
    displayName: 'pending',
    recordType: 'archive',
    manifest: [],
    similarRecords: [],
    archiveFiles: [{ name: 'pending.7z', size: 10 }],
    sourceDisposition: 'kept',
    completedAt: new Date().toISOString()
  };
  const job = {
    ...queuedJob('anomaly-commit-failure'),
    status: 'awaiting_anomaly_confirmation',
    pendingCatalogRecord: pendingRecord
  };
  manager.jobs = [job];

  await assert.rejects(manager.confirmAnomaly(job.id), (error) => error.code === 'EACCES');

  assert.deepEqual(manager.catalog, catalogBeforeCommit);
  assert.equal(job.status, 'awaiting_anomaly_confirmation');
  assert.equal(job.pendingCatalogRecord.id, pendingRecord.id);
});

test('cancelling during thumbnails recovers the published archive and does not commit the catalog', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-cancel-after-publication-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  const repository = path.join(root, 'repository');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.bin'), 'source remains intact');
  const sourceStats = await fs.stat(path.join(sourcePath, 'source.bin'));
  const manager = new QueueManager(new FakeStore(), {
    archiveOutputDirectory: output,
    archiveStagingDirectory: staging,
    repositoryDirectory: repository,
    moveCompleted: false,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  }, {
    archiveRunner: async (job) => {
      await fs.mkdir(output, { recursive: true });
      const archivePath = path.join(output, job.archiveBaseName);
      await fs.writeFile(archivePath, 'verified archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 16 }],
        archiveTotalBytes: 16,
        manifest: [{ relativePath: 'source.bin', name: 'source.bin', size: sourceStats.size, md5: 'abc' }],
        directories: [],
        skippedFiles: [],
        passwordScheme: 'none',
        hasPassword: false,
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName]),
        verifiedAt: new Date().toISOString()
      };
    },
    createThumbnails: async () => {
      manager.abortController.abort();
      throw new CancelledError();
    }
  });
  const job = {
    ...queuedJob('cancel-after-publication'),
    sourcePath,
    totalBytes: sourceStats.size,
    archiveBaseName: 'cancel-after-publication.7z'
  };
  manager.jobs = [job];

  await manager.startQueue();

  assert.equal(job.status, 'cancelled');
  assert.equal(manager.catalog.length, 0);
  assert.equal(job.catalogRecovery.archiveState, 'recovered_to_staging');
  assert.equal(job.catalogRecovery.recoveryRequired, false);
  await assert.rejects(fs.access(path.join(output, job.archiveBaseName)), /ENOENT/);
  await fs.access(job.catalogRecovery.recoveredFiles[0].recoveryPath);
  await fs.access(path.join(sourcePath, 'source.bin'));
});

test('source disposition commit failure is reported without falsely claiming that the move failed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-disposition-commit-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'project');
  const processed = path.join(root, 'processed');
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  const repository = path.join(root, 'repository');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'source.bin'), 'source will be moved');
  const sourceStats = await fs.stat(path.join(sourcePath, 'source.bin'));
  const store = new FakeStore();
  let catalogSaveCalls = 0;
  store.saveCatalog = async (_directory, records) => {
    catalogSaveCalls += 1;
    if (catalogSaveCalls === 1) {
      store.catalog = structuredClone(records);
      return;
    }
    const error = new Error('simulated second catalog denial');
    error.code = 'EACCES';
    throw error;
  };
  const manager = new QueueManager(store, {
    archiveOutputDirectory: output,
    archiveStagingDirectory: staging,
    repositoryDirectory: repository,
    processedSourceDirectory: processed,
    moveCompleted: true,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  }, {
    archiveRunner: async (job) => {
      await fs.mkdir(output, { recursive: true });
      const archivePath = path.join(output, job.archiveBaseName);
      await fs.writeFile(archivePath, 'verified archive');
      return {
        archiveFiles: [{ name: job.archiveBaseName, size: 16 }],
        archiveTotalBytes: 16,
        manifest: [{ relativePath: 'source.bin', name: 'source.bin', size: sourceStats.size, md5: 'abc' }],
        directories: [], skippedFiles: [], passwordScheme: 'none', hasPassword: false,
        archivePublication: await createArchivePublicationReceipt(job.id, output, staging, [job.archiveBaseName]),
        verifiedAt: new Date().toISOString()
      };
    },
    validateSourceBeforeDisposition: async () => {}
  });
  const job = {
    ...queuedJob('disposition-commit-failure'),
    sourcePath,
    totalBytes: sourceStats.size,
    archiveBaseName: 'disposition-commit-failure.7z'
  };
  manager.jobs = [job];

  await manager.startQueue();

  const movedTo = path.join(processed, path.basename(sourcePath));
  assert.equal(job.status, 'completed_cleanup_failed');
  assert.equal(job.errorCode, 'SOURCE_DISPOSITION_COMMIT_FAILED');
  assert.match(job.stageText, /源文件后处理已完成/);
  assert.doesNotMatch(job.stageText, /移动源项目失败/);
  assert.equal(job.sourceDispositionRecovery.movedTo, movedTo);
  assert.equal(manager.catalog[0].sourceDisposition, 'moved');
  assert.equal(store.catalog[0].sourceDisposition, 'move_pending');
  await assert.rejects(fs.access(sourcePath), /ENOENT/);
  await fs.access(path.join(movedTo, 'source.bin'));
  await fs.access(path.join(output, job.archiveBaseName));
  assert.ok(manager.logs.some((entry) => entry.level === 'error' && entry.message.includes('请勿重试归档')));
});

async function pathExistsForTest(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
