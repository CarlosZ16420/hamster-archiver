'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { QueueManager } = require('../src/core/queue-manager');
const { AppStore } = require('../src/core/store');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SEVEN_ZIP_PATH = process.env.HAMSTER_TEST_7ZIP_PATH || path.join(PROJECT_ROOT, 'tools', '7zip', '7z.exe');

function makeCatalogRecords(warehouseDir) {
  return [
    {
      id: 'rec-manual-001',
      title: '手动记录 - 测试图片集',
      displayName: '手动记录 - 测试图片集',
      recordType: 'manual',
      notes: '这是一条手动创建的测试记录',
      tags: ['测试', '手动', '导入导出'],
      starRating: 4,
      backupLocation: 'D:\\backup\\test001',
      archivePassword: '',
      manifest: [],
      directories: [],
      manualImages: [
        {
          id: 'img-001',
          ref: 'manual-rec-manual-001:thumb-001',
          relativePath: 'thumb-001.png',
          thumbnailPath: path.join(warehouseDir, 'thumbnails', 'rec-manual-001', 'thumb-001.png')
        },
        {
          id: 'img-002',
          ref: 'manual-rec-manual-001:thumb-002',
          relativePath: 'thumb-002.png',
          thumbnailPath: path.join(warehouseDir, 'thumbnails', 'rec-manual-001', 'thumb-002.png')
        }
      ]
    },
    {
      id: 'rec-archive-002',
      title: '归档记录 - 视频合集',
      displayName: '归档记录 - 视频合集',
      recordType: 'archive',
      notes: '从下载目录归档的视频文件',
      tags: ['视频', '已归档'],
      starRating: 5,
      backupLocation: '',
      archivePassword: 'secret-pass-123',
      manifest: [
        { path: 'video-001.mp4', size: 104857600, isVideo: true },
        { path: 'video-002.mp4', size: 52428800, isVideo: true }
      ],
      directories: ['subfolder-001'],
      manualImages: []
    },
    {
      id: 'rec-manual-003',
      title: '空记录 - 无缩略图',
      displayName: '空记录 - 无缩略图',
      recordType: 'manual',
      notes: '',
      tags: [],
      starRating: 0,
      backupLocation: '',
      archivePassword: '',
      manifest: [],
      directories: [],
      manualImages: []
    }
  ];
}

async function createThumbnails(warehouseDir) {
  const thumbDir = path.join(warehouseDir, 'thumbnails', 'rec-manual-001');
  await fs.mkdir(thumbDir, { recursive: true });
  await fs.writeFile(path.join(thumbDir, 'thumb-001.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02, 0x03, 0x04]));
  await fs.writeFile(path.join(thumbDir, 'thumb-002.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xAA, 0xBB, 0xCC, 0xDD]));
}

function makeTestEnv(t) {
  const stores = [];
  const root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-ie-test-'));
  const env = {
    stores,
    root: null,
    addStore: (s) => { stores.push(s); return s; },
    closeAll: () => { for (const s of stores) s.closeAll(); stores.length = 0; }
  };
  t.after(async () => {
    env.closeAll();
    const r = await root;
    if (r) await fs.rm(r, { recursive: true, force: true }).catch(() => {});
  });
  return env;
}

async function makeManager(store, warehouseDir, extraConfig = {}) {
  const manager = new QueueManager(store, {
    intakeDirectory: path.join(warehouseDir, '..', 'source'),
    archiveStagingDirectory: path.join(warehouseDir, '..', 'staging'),
    archiveOutputDirectory: path.join(warehouseDir, '..', 'output'),
    repositoryDirectory: warehouseDir,
    sevenZipPath: SEVEN_ZIP_PATH,
    moveCompleted: false,
    ...extraConfig
  });
  await manager.initialize();
  return manager;
}

test('4.1.1 dist: export warehouse to ZIP creates a valid archive with sqlite and thumbnails', async (t) => {
  assert.ok(fss.existsSync(SEVEN_ZIP_PATH), '7z.exe not found in 4.1.1 dist');
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-export-test-'));
  const root = await env.root;
  const warehouseA = path.join(root, 'warehouse-A');
  const userData = path.join(root, 'user-data');
  const exportZip = path.join(root, 'export', 'test-export.zip');

  const store = env.addStore(new AppStore(userData));
  const records = makeCatalogRecords(warehouseA);
  await store.saveCatalog(warehouseA, records);
  await store.saveJobs(warehouseA, []);
  await createThumbnails(warehouseA);

  const manager = await makeManager(store, warehouseA);
  const result = await manager.exportWarehouseToFile(exportZip);

  assert.ok(result.path, 'export result should include path');
  assert.equal(result.path, exportZip);
  const stat = await fs.stat(exportZip);
  assert.ok(stat.size > 0, 'exported ZIP must not be empty');

  const listing = execFileSync(SEVEN_ZIP_PATH, ['l', '-ba', exportZip], { encoding: 'utf8' });
  assert.ok(listing.includes('warehouse.sqlite'), 'ZIP must contain warehouse.sqlite');
  assert.ok(listing.includes('thumb-001.png'), 'ZIP must contain thumbnail thumb-001.png');
  assert.ok(listing.includes('thumb-002.png'), 'ZIP must contain thumbnail thumb-002.png');
});

test('4.1.1 dist: import exported ZIP into a fresh warehouse preserves all records', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-import-test-'));
  const root = await env.root;
  const warehouseA = path.join(root, 'warehouse-A');
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const exportZip = path.join(root, 'export', 'test-export.zip');

  // Phase 1: set up source warehouse and export
  const storeA = env.addStore(new AppStore(userData));
  const records = makeCatalogRecords(warehouseA);
  await storeA.saveCatalog(warehouseA, records);
  await storeA.saveJobs(warehouseA, []);
  await createThumbnails(warehouseA);
  const managerA = await makeManager(storeA, warehouseA);
  await managerA.exportWarehouseToFile(exportZip);

  // Phase 2: import into fresh warehouse B
  const storeB = env.addStore(new AppStore(userData));
  const managerB = await makeManager(storeB, warehouseB);
  const importResult = await managerB.importWarehouseFromArchiveOrDirectory(exportZip);

  assert.equal(importResult.importedCount, 3, 'all 3 records should be imported');
  assert.equal(importResult.skippedCount, 0, 'no records should be skipped on first import');

  // Verify the imported catalog
  const imported = managerB.catalog;
  assert.equal(imported.length, 3, 'warehouse B should have 3 records after import');

  const byId = Object.fromEntries(imported.map((r) => [r.id, r]));
  assert.ok(byId['rec-manual-001'], 'manual record 001 should exist');
  assert.ok(byId['rec-archive-002'], 'archive record 002 should exist');
  assert.ok(byId['rec-manual-003'], 'manual record 003 should exist');

  // Verify field preservation
  assert.equal(byId['rec-manual-001'].title, '手动记录 - 测试图片集');
  assert.deepEqual(byId['rec-manual-001'].tags, ['测试', '手动', '导入导出']);
  assert.equal(byId['rec-manual-001'].starRating, 4);
  assert.equal(byId['rec-manual-001'].notes, '这是一条手动创建的测试记录');

  assert.equal(byId['rec-archive-002'].title, '归档记录 - 视频合集');
  assert.equal(byId['rec-archive-002'].archivePassword, 'secret-pass-123');
  assert.equal(byId['rec-archive-002'].manifest.length, 2);
  assert.equal(byId['rec-archive-002'].manifest[0].path, 'video-001.mp4');
  assert.equal(byId['rec-archive-002'].manifest[0].size, 104857600);

  assert.equal(byId['rec-manual-003'].title, '空记录 - 无缩略图');
  assert.equal(byId['rec-manual-003'].manualImages.length, 0);
});

test('4.1.1 dist: imported thumbnails are copied to the target warehouse', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-thumb-test-'));
  const root = await env.root;
  const warehouseA = path.join(root, 'warehouse-A');
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const exportZip = path.join(root, 'export', 'test-export.zip');

  const store = env.addStore(new AppStore(userData));
  const records = makeCatalogRecords(warehouseA);
  await store.saveCatalog(warehouseA, records);
  await store.saveJobs(warehouseA, []);
  await createThumbnails(warehouseA);
  const managerA = await makeManager(store, warehouseA);
  await managerA.exportWarehouseToFile(exportZip);

  const storeB = env.addStore(new AppStore(userData));
  const managerB = await makeManager(storeB, warehouseB);
  await managerB.importWarehouseFromArchiveOrDirectory(exportZip);

  const thumb1 = path.join(warehouseB, 'thumbnails', 'rec-manual-001', 'thumb-001.png');
  const thumb2 = path.join(warehouseB, 'thumbnails', 'rec-manual-001', 'thumb-002.png');
  await fs.access(thumb1);
  await fs.access(thumb2);
  const buf1 = await fs.readFile(thumb1);
  const buf2 = await fs.readFile(thumb2);
  assert.equal(buf1[8], 0x01, 'thumbnail 1 content should match');
  assert.equal(buf2[8], 0xAA, 'thumbnail 2 content should match');
});

test('4.1.1 dist: importing the same ZIP twice skips duplicate records', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-dup-test-'));
  const root = await env.root;
  const warehouseA = path.join(root, 'warehouse-A');
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const exportZip = path.join(root, 'export', 'test-export.zip');

  const store = env.addStore(new AppStore(userData));
  const records = makeCatalogRecords(warehouseA);
  await store.saveCatalog(warehouseA, records);
  await store.saveJobs(warehouseA, []);
  await createThumbnails(warehouseA);
  const managerA = await makeManager(store, warehouseA);
  await managerA.exportWarehouseToFile(exportZip);

  const storeB = env.addStore(new AppStore(userData));
  const managerB = await makeManager(storeB, warehouseB);

  // First import
  const first = await managerB.importWarehouseFromArchiveOrDirectory(exportZip);
  assert.equal(first.importedCount, 3);
  assert.equal(first.skippedCount, 0);

  // Second import of the same ZIP
  const second = await managerB.importWarehouseFromArchiveOrDirectory(exportZip);
  assert.equal(second.importedCount, 0, 'second import should add no new records');
  assert.equal(second.skippedCount, 3, 'second import should skip all 3 duplicates');
});

test('4.1.1 dist: importing an invalid ZIP (no warehouse.sqlite) throws a clear error', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-err-test-'));
  const root = await env.root;
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const fakeZip = path.join(root, 'not-a-warehouse.zip');

  // Create a valid ZIP that has no warehouse.sqlite inside
  await fs.mkdir(path.join(root, 'fake-content'), { recursive: true });
  await fs.writeFile(path.join(root, 'fake-content', 'dummy.txt'), 'hello');
  execFileSync(SEVEN_ZIP_PATH, ['a', '-tzip', fakeZip, 'dummy.txt'], {
    cwd: path.join(root, 'fake-content'),
    stdio: 'ignore',
    windowsHide: true
  });

  const store = env.addStore(new AppStore(userData));
  const manager = await makeManager(store, warehouseB);
  await assert.rejects(
    () => manager.importWarehouseFromArchiveOrDirectory(fakeZip),
    /warehouse\.sqlite/,
    'should reject ZIP without warehouse.sqlite'
  );
});

test('4.1.1 dist: importing a non-zip file is rejected', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-nonzip-test-'));
  const root = await env.root;
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const fakeFile = path.join(root, 'not-a-zip.txt');
  await fs.writeFile(fakeFile, 'this is not a zip');

  const store = env.addStore(new AppStore(userData));
  const manager = await makeManager(store, warehouseB);
  await assert.rejects(
    () => manager.importWarehouseFromArchiveOrDirectory(fakeFile),
    /\.zip/i,
    'should reject non-zip files'
  );
});

test('4.1.1 dist: export then import round-trip preserves manifest and directory structures', async (t) => {
  const env = makeTestEnv(t);
  env.root = fs.mkdtemp(path.join(os.tmpdir(), 'hamster-roundtrip-test-'));
  const root = await env.root;
  const warehouseA = path.join(root, 'warehouse-A');
  const warehouseB = path.join(root, 'warehouse-B');
  const userData = path.join(root, 'user-data');
  const exportZip = path.join(root, 'export', 'test-export.zip');

  const store = env.addStore(new AppStore(userData));
  const records = makeCatalogRecords(warehouseA);
  await store.saveCatalog(warehouseA, records);
  await store.saveJobs(warehouseA, []);
  await createThumbnails(warehouseA);
  const managerA = await makeManager(store, warehouseA);
  await managerA.exportWarehouseToFile(exportZip);

  const storeB = env.addStore(new AppStore(userData));
  const managerB = await makeManager(storeB, warehouseB);
  await managerB.importWarehouseFromArchiveOrDirectory(exportZip);

  const archiveRecord = managerB.catalog.find((r) => r.id === 'rec-archive-002');
  assert.ok(archiveRecord, 'archive record should exist after import');
  assert.equal(archiveRecord.manifest.length, 2, 'manifest entries should be preserved');
  assert.equal(archiveRecord.manifest[0].path, 'video-001.mp4');
  assert.equal(archiveRecord.manifest[0].size, 104857600);
  assert.equal(archiveRecord.manifest[0].isVideo, true);
  assert.deepEqual(archiveRecord.directories, ['subfolder-001']);
});
