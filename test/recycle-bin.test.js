'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { QueueManager } = require('../src/core/queue-manager');
const { findTrashItems, isTrashItemPresent, restoreTrashItem } = require('../src/core/recycle-bin');

const execFileAsync = promisify(execFile);

test('Windows deletion undo finds Unicode paths beyond the first query batch and preserves occupied originals', {
  skip: process.platform !== 'win32' || process.env.HAMSTER_TEST_RECYCLE_BIN !== '1'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-recycle-undo-'));
  const archiveDirectory = path.join(root, '中文压缩包');
  const repositoryDirectory = path.join(root, '中文仓库');
  const archivePath = path.join(archiveDirectory, 'synthetic.7z');
  const thumbnailDirectory = path.join(repositoryDirectory, 'thumbnails', 'synthetic-job');
  const recycledPaths = new Set();
  t.after(async () => {
    for (const target of recycledPaths) {
      if (await isTrashItemPresent(target)) assert.equal(await restoreTrashItem(target), true);
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(archiveDirectory, { recursive: true });
  await fs.mkdir(thumbnailDirectory, { recursive: true });
  await fs.writeFile(archivePath, 'synthetic archive bytes');
  await fs.writeFile(path.join(thumbnailDirectory, 'cover.png'), 'synthetic cover bytes');
  const manager = new QueueManager({
    saveCatalog: async () => {}, saveJobs: async () => {}, appendLog: async () => {}
  }, {
    archiveOutputDirectory: archiveDirectory, repositoryDirectory,
    archiveStagingDirectory: path.join(root, '中文暂存'), similarityEnabled: false
  }, {
    findTrashItems, restoreTrashItem,
    trashItem: async (target) => {
      const relative = path.relative(root, target);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:HAMSTER_TEST_RECYCLE_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')
`], { windowsHide: true, timeout: 20_000, env: { ...process.env, HAMSTER_TEST_RECYCLE_PATH: target } });
      recycledPaths.add(target);
    }
  });
  manager.catalog = [{
    id: 'synthetic-record', jobId: 'synthetic-job', title: '虚构压缩项目', displayName: '虚构压缩项目',
    recordType: 'archive', archiveDirectory, archiveFiles: [{ name: 'synthetic.7z' }],
    tags: ['fixture'], notes: 'preserved', manifest: [], directories: [], similarRecords: []
  }];

  assert.deepEqual((await manager.deleteCatalogRecords(['synthetic-record'])).deletedIds, ['synthetic-record']);
  assert.equal(manager.catalog.length, 0);
  const missingPaths = Array.from({ length: 100 }, (_, index) => path.join(root, `never-recycled-${index}`));
  const found = await findTrashItems([...missingPaths, ...recycledPaths]);
  assert.deepEqual(new Set(found), recycledPaths);
  assert.equal(found.some(value => value.includes('\uFFFD')), false);

  await fs.writeFile(archivePath, 'occupied original');
  await assert.rejects(manager.undoCatalogAction(), /已经存在同名内容/);
  assert.equal(await fs.readFile(archivePath, 'utf8'), 'occupied original');
  assert.equal(manager.undoStack.length, 1);
  for (const target of recycledPaths) assert.equal(await isTrashItemPresent(target), true);
  await fs.unlink(archivePath);

  await manager.undoCatalogAction();
  assert.equal(await fs.readFile(archivePath, 'utf8'), 'synthetic archive bytes');
  assert.equal(await fs.readFile(path.join(thumbnailDirectory, 'cover.png'), 'utf8'), 'synthetic cover bytes');
  assert.equal(manager.catalog[0].notes, 'preserved');
  assert.deepEqual(manager.catalog[0].tags, ['fixture']);
  assert.equal(manager.undoStack.length, 0);
});
