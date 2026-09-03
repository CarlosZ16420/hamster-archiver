'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanIntakeDirectory } = require('../src/core/scanner');

test('scanner creates tasks only for direct folders and root videos', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-scan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, 'album', 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, 'album', 'cover.jpg'), Buffer.alloc(10));
  await fs.writeFile(path.join(root, 'album', 'nested', 'clip.mp4'), Buffer.alloc(20));
  await fs.writeFile(path.join(root, 'standalone.mp4'), Buffer.alloc(30));
  await fs.writeFile(path.join(root, 'loose.png'), Buffer.alloc(40));

  const result = await scanIntakeDirectory(root);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.skippedRootFiles.length, 1);

  const album = result.tasks.find((task) => task.displayName === 'album');
  const video = result.tasks.find((task) => task.displayName === 'standalone.mp4');
  assert.deepEqual(
    { sourceType: album.sourceType, fileCount: album.fileCount, totalBytes: album.totalBytes },
    { sourceType: 'directory', fileCount: 2, totalBytes: 30 }
  );
  assert.deepEqual(
    { sourceType: video.sourceType, fileCount: video.fileCount, totalBytes: video.totalBytes },
    { sourceType: 'video', fileCount: 1, totalBytes: 30 }
  );
});

test('scanner reports candidates below the configured size threshold', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-filter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'small-folder'));
  await fs.writeFile(path.join(root, 'small-folder', 'file.bin'), Buffer.alloc(10));
  await fs.writeFile(path.join(root, 'large.mp4'), Buffer.alloc(200));
  const result = await scanIntakeDirectory(root, { minimumBytes: 100 });
  assert.deepEqual(result.tasks.map((task) => task.displayName), ['large.mp4']);
  assert.deepEqual(result.filteredItems.map((item) => item.displayName), ['small-folder']);
});

test('scanner wraps a missing intake directory in a user-facing error', async () => {
  const missingPath = path.join(os.tmpdir(), `hamster-missing-${Date.now()}-${process.pid}`);

  await assert.rejects(
    () => scanIntakeDirectory(missingPath),
    (error) => error.code === 'SOURCE_NOT_FOUND' && error.message === '所选目录已经不存在。'
  );
});
