'use strict';

const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildManifest,
  createFingerprintPlan
} = require('../src/core/manifest');

test('large-folder planning selects a stable representative set of 200 files', () => {
  const files = Array.from({ length: 1000 }, (_, index) => ({
    relativePath: `group-${String(index).padStart(4, '0')}/file.bin`,
    size: index < 100 ? 10_000 - index : 100
  }));
  const plan = createFingerprintPlan(files, 'directory', {
    largeFolderSimplification: true,
    largeFolderFileThreshold: 800
  });

  assert.equal(plan.simplified, true);
  assert.equal(plan.selectedFiles.length, 200);
  assert.ok(files.slice(0, 100).every((file) => plan.selectedPaths.has(file.relativePath)));
  assert.ok(plan.selectedPaths.has(files[995].relativePath), 'the spread sample should cover the end of the directory');
});

test('tiny files are removed before filling representative sample slots', () => {
  const tiny = Array.from({ length: 250 }, (_, index) => ({ relativePath: `a-${index}`, size: 1 }));
  const eligible = Array.from({ length: 300 }, (_, index) => ({
    relativePath: `b-${index}`,
    size: (128 * 1024) + index
  }));
  const plan = createFingerprintPlan([...tiny, ...eligible], 'directory', {
    largeFolderSimplification: true,
    largeFolderFileThreshold: 300,
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes: 128 * 1024
  });

  assert.equal(plan.selectedFiles.length, 200);
  assert.equal(plan.tinyFileMd5ThresholdBytes, 128 * 1024);
  assert.ok(plan.selectedFiles.every((file) => file.size >= 128 * 1024));
});

test('skipping tiny MD5 keeps every file in the archive manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-manifest-tiny-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tinyFileMd5ThresholdBytes = 32 * 1024;
  await fs.writeFile(path.join(root, 'tiny.txt'), Buffer.alloc(1024));
  await fs.writeFile(path.join(root, 'content.bin'), Buffer.alloc(tinyFileMd5ThresholdBytes));

  const manifest = await buildManifest(root, 'directory', {
    skipTinyMd5Files: true,
    tinyFileMd5ThresholdBytes
  });
  assert.equal(manifest.length, 2);
  assert.equal(manifest.find((file) => file.name === 'tiny.txt').md5, undefined);
  assert.equal(manifest.find((file) => file.name === 'tiny.txt').md5SkippedReason, 'tiny-file');
  assert.match(manifest.find((file) => file.name === 'content.bin').md5, /^[a-f0-9]{32}$/);
});

test('manifest generation skips and records a file that becomes unreadable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-manifest-skip-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const firstPath = path.join(root, 'a-readable.bin');
  const removedPath = path.join(root, 'z-removed.bin');
  await fs.writeFile(firstPath, Buffer.alloc(1024));
  await fs.writeFile(removedPath, Buffer.alloc(1024));
  let removed = false;
  const skipped = [];
  const manifest = await buildManifest(root, 'directory', {
    onProgress: async () => {},
    onSkippedFile: (item) => skipped.push(item)
  });

  // The deterministic hook above verifies the normal path; explicitly confirm missing files are recorded
  // by deleting between collection and hashing in a second pass.
  await fs.writeFile(removedPath, Buffer.alloc(1024));
  const secondManifest = await buildManifest(root, 'directory', {
    onProgress: () => {
      if (!removed) {
        removed = true;
        fsSync.rmSync(removedPath, { force: true });
      }
    },
    onSkippedFile: (item) => skipped.push(item)
  });
  assert.equal(manifest.length, 2);
  assert.ok(secondManifest.length >= 1);
  assert.ok(skipped.some((item) => item.path === 'z-removed.bin'));
});
