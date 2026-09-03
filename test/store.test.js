'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProjectFingerprint, similarityCandidateKeys } = require('../src/core/duplicate-check');
const { AppStore, readJson, writeJsonAtomic } = require('../src/core/store');
const { makeUserDataLayout, resolveUserDataRoot } = require('../src/core/storage-paths');
const { WAREHOUSE_INITIALIZED_MARKER } = require('../src/core/sqlite-repository');

test('JSON state can be atomically created and replaced', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'nested', 'state.json');

  await writeJsonAtomic(filePath, { value: 1 });
  assert.deepEqual(await readJson(filePath, null), { value: 1 });
  await writeJsonAtomic(filePath, { value: 2 });
  assert.deepEqual(await readJson(filePath, null), { value: 2 });
});

test('SQLite repository persists catalog, jobs and pending manifests incrementally', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-sqlite-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryDirectory = path.join(root, 'saves');
  const store = new AppStore(path.join(root, 'user-data'));
  const record = {
    id: 'record-one', title: '测试库存', displayName: '测试库存', rating: 4,
    tags: ['视频', '旅行'], inventoryDate: '2026-08-15T10:30:00.000Z',
    manifest: [{ relativePath: 'movie.mp4', name: 'movie.mp4', size: 123, md5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mediaType: 'video' }]
  };
  const job = { id: 'job-one', displayName: '测试任务', sourcePath: 'E:\\input', status: 'queued' };

  await store.saveCatalog(repositoryDirectory, [record]);
  await store.saveJobs(repositoryDirectory, [job]);
  await store.savePendingManifest(repositoryDirectory, job.id, record.manifest);
  assert.deepEqual(await store.loadCatalog(repositoryDirectory), [record]);
  assert.deepEqual(await store.loadJobs(repositoryDirectory), [job]);
  assert.deepEqual(await store.loadPendingManifest(repositoryDirectory, job.id), record.manifest);
  assert.equal(await store.verifyRepository(repositoryDirectory), true);
  assert.deepEqual(store.findCatalogIdsBySearchTerms(repositoryDirectory, ['char:测']), ['record-one']);
  assert.deepEqual(store.findCatalogIdsByExactName(repositoryDirectory, '测试库存'), ['record-one']);
  const fingerprint = createProjectFingerprint(record.manifest);
  assert.deepEqual(store.findCatalogIdsByProjectShape(repositoryDirectory, fingerprint), ['record-one']);
  assert.deepEqual(store.findCatalogIdsByProjectContent(repositoryDirectory, fingerprint), ['record-one']);
  assert.equal(store.findExactFileMatches(repositoryDirectory, record.manifest)[0].previous[0].archiveId, 'record-one');
  const lateExactManifest = [
    ...Array.from({ length: 120 }, (_, index) => ({
      relativePath: `unmatched-${index}.bin`, size: index + 1,
      md5: index.toString(16).padStart(32, '0')
    })),
    record.manifest[0]
  ];
  assert.equal(
    store.findExactFileMatches(repositoryDirectory, lateExactManifest, 1)[0].sourceRelativePath,
    'movie.mp4'
  );

  await store.saveCatalog(repositoryDirectory, [{ ...record, notes: '只更新这一条' }]);
  assert.equal((await store.loadCatalog(repositoryDirectory))[0].notes, '只更新这一条');
  const second = { ...record, id: 'record-two', title: '第二条', displayName: '第二条', manifest: [] };
  await store.saveCatalog(repositoryDirectory, [{ ...record, notes: '保留' }, second]);
  await store.saveCatalogRecords(repositoryDirectory, [{ ...second, backupLocation: '移动硬盘 B' }], [{ ...record, notes: '保留' }, second]);
  const afterSubsetUpdate = await store.loadCatalog(repositoryDirectory);
  assert.equal(afterSubsetUpdate.length, 2);
  assert.equal(afterSubsetUpdate.find((item) => item.id === 'record-one').notes, '保留');
  assert.equal(afterSubsetUpdate.find((item) => item.id === 'record-two').backupLocation, '移动硬盘 B');
  await store.deletePendingManifest(repositoryDirectory, job.id);
  assert.equal(await store.loadPendingManifest(repositoryDirectory, job.id), null);
  const similarityKeys = similarityCandidateKeys(record, []);
  assert.deepEqual(store.findCatalogIdsBySimilarityKeys(repositoryDirectory, similarityKeys), ['record-one']);
  await store.saveCatalog(repositoryDirectory, []);
  assert.deepEqual(store.findCatalogIdsBySimilarityKeys(repositoryDirectory, similarityKeys), []);
  assert.deepEqual(store.findCatalogIdsByExactName(repositoryDirectory, '测试库存'), []);
  assert.deepEqual(store.findCatalogIdsByProjectShape(repositoryDirectory, fingerprint), []);
  assert.deepEqual(store.findCatalogIdsByProjectContent(repositoryDirectory, fingerprint), []);
  assert.equal(store.findExactFileMatches(repositoryDirectory, record.manifest).length, 0);
  store.closeAll();
});

test('concurrent JSON writes stay valid and preserve invocation order', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-store-concurrent-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'settings.json');

  for (let round = 0; round < 5; round += 1) {
    const writes = Array.from({ length: 20 }, (_, index) => writeJsonAtomic(filePath, {
      round,
      index,
      padding: 'x'.repeat(40 + (index * 37))
    }));
    await Promise.all(writes);
    assert.deepEqual(await readJson(filePath, null), {
      round,
      index: 19,
      padding: 'x'.repeat(40 + (19 * 37))
    });
  }
  assert.deepEqual((await fs.readdir(root)).filter((name) => name.endsWith('.tmp')), []);
});

test('a first-time zero-byte SQLite file is initialized', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-empty-sqlite-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryDirectory = path.join(root, 'warehouse');
  const databasePath = path.join(repositoryDirectory, 'warehouse.sqlite');
  await fs.mkdir(repositoryDirectory, { recursive: true });
  await fs.writeFile(databasePath, '');
  const store = new AppStore(path.join(root, 'user-data'));

  assert.deepEqual(await store.loadCatalog(repositoryDirectory), []);
  assert.equal((await fs.stat(databasePath)).size > 0, true);
  assert.equal(await fs.readFile(path.join(repositoryDirectory, WAREHOUSE_INITIALIZED_MARKER), 'utf8').then(Boolean), true);
  store.closeAll();
});

test('a previously initialized zero-byte SQLite repository is rejected without modification', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-empty-sqlite-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryDirectory = path.join(root, 'warehouse');
  const databasePath = path.join(repositoryDirectory, 'warehouse.sqlite');
  const initialStore = new AppStore(path.join(root, 'user-data'));
  await initialStore.loadCatalog(repositoryDirectory);
  initialStore.closeAll();
  await fs.writeFile(databasePath, '');
  const store = new AppStore(path.join(root, 'user-data-recovery'));

  assert.throws(
    () => store.getRepository(repositoryDirectory),
    (error) => error.code === 'REPOSITORY_DATABASE_EMPTY' && /请恢复 warehouse\.sqlite/.test(error.message)
  );
  assert.equal((await fs.stat(databasePath)).size, 0);
});

test('project shape lookup returns every candidate instead of truncating before a later exact match', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-project-fingerprint-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repositoryDirectory = path.join(root, 'saves');
  const store = new AppStore(path.join(root, 'user-data'));
  const records = Array.from({ length: 25 }, (_, index) => ({
    id: `record-${index}`,
    title: `项目 ${index}`,
    displayName: `项目 ${index}`,
    manifest: [{
      relativePath: 'same.bin', name: 'same.bin', size: 100,
      md5: index.toString(16).padStart(32, '0')
    }]
  }));
  await store.saveCatalog(repositoryDirectory, records);
  const targetFingerprint = createProjectFingerprint(records.at(-1).manifest);

  assert.equal(store.findCatalogIdsByProjectShape(repositoryDirectory, targetFingerprint).length, 25);
  assert.deepEqual(store.findCatalogIdsByProjectContent(repositoryDirectory, targetFingerprint), ['record-24']);
  store.closeAll();
});

test('user data layout keeps settings, warehouse and one log under one root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-user-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const layout = makeUserDataLayout(root);
  assert.equal(layout.root, path.join(root, 'userdata'));
  assert.equal(layout.processedSourceDirectory, path.join(root, 'userdata', 'processed'));
  const store = new AppStore(layout);
  await store.saveSettings({ archivePassword: '' });
  await store.appendLog(path.join(root, 'first-warehouse'), { message: 'first' });
  await store.appendLog(path.join(root, 'second-warehouse'), { message: 'second' });

  assert.equal(layout.settingsPath.startsWith(layout.root), true);
  assert.equal(layout.repositoryDirectory.startsWith(layout.root), true);
  assert.deepEqual(await readJson(layout.settingsPath, null), { archivePassword: '' });
  const lines = (await fs.readFile(layout.logPath, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal((await fs.readdir(path.join(root, 'first-warehouse')).catch(() => [])).length, 0);
});

test('saved user data location becomes the root for every durable data path', () => {
  const applicationRoot = path.resolve('E:\\HamsterArchiver');
  const selectedRoot = path.resolve('D:\\HamsterData');
  const resolved = resolveUserDataRoot(applicationRoot, () => JSON.stringify({
    userDataDirectory: selectedRoot
  }), () => true, () => true);
  const layout = makeUserDataLayout(applicationRoot, null, resolved);

  assert.equal(resolved, selectedRoot);
  assert.equal(layout.root, selectedRoot);
  assert.equal(layout.settingsPath, path.join(selectedRoot, 'config', 'settings.json'));
  assert.equal(layout.repositoryDirectory, path.join(selectedRoot, 'warehouse'));
  assert.throws(
    () => resolveUserDataRoot(applicationRoot, () => '{bad json'),
    (error) => error.code === 'USER_DATA_LOCATION_INVALID'
  );
  assert.throws(
    () => resolveUserDataRoot(applicationRoot, () => JSON.stringify({
      userDataDirectory: 'D:\\missing-user-data'
    }), () => false),
    (error) => error.code === 'USER_DATA_LOCATION_MISSING' && /不会自动创建空仓库/.test(error.message)
  );
});

test('user data pointers reject ambiguous or non-directory targets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-user-data-pointer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pointerPath = path.join(root, 'user-data-location.json');
  const fileTarget = path.join(root, 'not-a-directory');
  await fs.writeFile(fileTarget, 'file');

  assert.throws(() => resolveUserDataRoot(''), /软件主目录不能为空/);
  for (const userDataDirectory of ['E:', 123, { path: fileTarget }]) {
    fsSync.writeFileSync(pointerPath, JSON.stringify({ userDataDirectory }), 'utf8');
    assert.throws(
      () => resolveUserDataRoot(root),
      (error) => error.code === 'USER_DATA_LOCATION_INVALID'
    );
  }
  fsSync.writeFileSync(pointerPath, JSON.stringify({ userDataDirectory: fileTarget }), 'utf8');
  assert.throws(
    () => resolveUserDataRoot(root),
    (error) => error.code === 'USER_DATA_LOCATION_INVALID' && /必须指向目录/.test(error.message)
  );
});
