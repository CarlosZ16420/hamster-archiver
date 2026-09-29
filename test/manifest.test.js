'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildManifest,
  compareSourceSnapshots,
  completeManifestMd5,
  createFingerprintPlan,
  scanSourceSnapshot,
  validateManifestUnchanged,
  verifyManifestMd5AgainstCompleteCandidates
} = require('../src/core/manifest');

test('existing compression validation detects newly added files and empty directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-source-set-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'old.txt'), 'old');
  const manifest = await buildManifest(root, 'directory');
  await validateManifestUnchanged(root, 'directory', manifest);
  await fs.writeFile(path.join(root, 'new.txt'), 'new');
  await assert.rejects(validateManifestUnchanged(root, 'directory', manifest), { code: 'SOURCE_CHANGED' });
  await fs.unlink(path.join(root, 'new.txt'));
  await fs.mkdir(path.join(root, 'empty'));
  await assert.rejects(validateManifestUnchanged(root, 'directory', manifest), { code: 'SOURCE_CHANGED' });
});

test('refresh does not fill historical MD5 gaps and keeps files when optional MD5 cannot be read', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-fingerprint-gap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'entry.txt'), 'entry');
  const snapshot = await scanSourceSnapshot(root, 'directory');
  const withoutMd5 = await buildManifest(root, 'directory', { preparedSnapshot: snapshot, reuseManifest: snapshot.files });
  assert.equal(withoutMd5.length, 1);
  assert.equal(withoutMd5[0].md5, undefined);
  await fs.unlink(path.join(root, 'entry.txt'));
  await assert.rejects(buildManifest(root, 'directory', { preparedSnapshot: snapshot }), { code: 'SOURCE_CHANGED' });
});

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

test('large-folder planning uses the user-selected representative file count', () => {
  const files = Array.from({ length: 1000 }, (_, index) => ({
    relativePath: `group-${String(index).padStart(4, '0')}/file.bin`,
    size: index + 1
  }));
  const plan = createFingerprintPlan(files, 'directory', {
    largeFolderSimplification: true,
    largeFolderFileThreshold: 500,
    largeFolderMd5SampleLimit: 37
  });

  assert.equal(plan.simplified, true);
  assert.equal(plan.sampleLimit, 37);
  assert.equal(plan.selectedFiles.length, 37);
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

test('metadata hook sees the complete file and directory tree before any MD5 is generated', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-manifest-metadata-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'empty', 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, 'content.bin'), Buffer.alloc(1024, 0x5a));
  const stop = new Error('stop-before-hash');
  let observed = false;

  await assert.rejects(buildManifest(root, 'directory', {
    onMetadataReady: async (manifest, directories) => {
      observed = true;
      assert.equal(manifest.length, 1);
      assert.equal(manifest[0].md5, undefined);
      assert.deepEqual(directories, ['empty', 'empty/nested']);
      throw stop;
    }
  }), (error) => error === stop);
  assert.equal(observed, true);
});

test('completing MD5 normalizes already hashed entries without retaining skip metadata', async () => {
  const [completed] = await completeManifestMd5('unused', 'directory', [{
    relativePath: 'already-hashed.bin',
    name: 'already-hashed.bin',
    size: 8,
    md5: 'ABCDEFABCDEFABCDEFABCDEFABCDEFAB',
    md5SkippedReason: 'tiny-file',
    similarityEligible: false
  }]);

  assert.equal(completed.md5, 'abcdefabcdefabcdefabcdefabcdefab');
  assert.equal('md5SkippedReason' in completed, false);
  assert.equal('similarityEligible' in completed, false);
});

test('exact candidate verification stops hashing as soon as every project candidate is eliminated', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-manifest-candidate-filter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, content] of [['a.bin', 'actual-a'], ['b.bin', 'actual-b-content'], ['c.bin', 'actual-c-content-longer']]) {
    await fs.writeFile(path.join(root, name), content);
  }
  const complete = await buildManifest(root, 'directory');
  const partial = complete.map(({ md5: _md5, ...file }) => ({ ...file, md5SkippedReason: 'large-folder-limit' }));
  const candidates = ['candidate-one', 'candidate-two'].map((id) => ({
    id,
    manifest: complete.map((file) => file.name === 'a.bin'
      ? { ...file, md5: 'ffffffffffffffffffffffffffffffff' }
      : { ...file })
  }));

  const result = await verifyManifestMd5AgainstCompleteCandidates(root, 'directory', partial, candidates);

  assert.equal(result.matches.length, 0);
  assert.equal(result.hashedFiles, 1);
  assert.match(result.manifest.find((file) => file.name === 'a.bin').md5, /^[a-f0-9]{32}$/);
  assert.equal(result.manifest.filter((file) => file.md5).length, 1);
});

test('a large partial historical candidate stops after the first differing current file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-partial-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const historical = path.join(root, 'historical');
  await fs.mkdir(current);
  await fs.mkdir(historical);
  for (let index = 0; index < 48; index += 1) {
    const name = `${String(index).padStart(2, '0')}.bin`;
    await fs.writeFile(path.join(current, name), `current-${index}`);
    await fs.writeFile(path.join(historical, name), index === 0 ? 'different' : `current-${index}`);
  }
  const options = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 1024 };
  const manifest = await buildManifest(current, 'directory', options);
  const candidateManifest = await buildManifest(historical, 'directory', options);
  let reads = 0;
  const original = fsSync.createReadStream;
  fsSync.createReadStream = (...args) => { reads += 1; return original(...args); };
  try {
    const result = await verifyManifestMd5AgainstCompleteCandidates(current, 'directory', manifest,
      [{ id: 'partial', sourceType: 'directory', manifest: candidateManifest }],
      { getCandidatePaths: () => [historical] });
    assert.equal(result.matches.length, 0);
    assert.equal(result.hashedFiles, 1);
    assert.equal(reads, 2, 'only the first current and historical files should be read');
    assert.equal(result.manifest.filter((file) => file.md5).length, 1);
  } finally {
    fsSync.createReadStream = original;
  }
});

test('a truly identical partial historical candidate verifies every required file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-match-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const historical = path.join(root, 'historical');
  await fs.mkdir(current);
  await fs.mkdir(historical);
  for (const name of ['a.bin', 'b.bin', 'c.bin']) {
    await fs.writeFile(path.join(current, name), `same-${name}`);
    await fs.writeFile(path.join(historical, name), `same-${name}`);
  }
  const options = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 1024 };
  const manifest = await buildManifest(current, 'directory', options);
  const candidateManifest = await buildManifest(historical, 'directory', options);
  candidateManifest[0].md5 = crypto.createHash('md5').update('same-a.bin').digest('hex');
  const result = await verifyManifestMd5AgainstCompleteCandidates(current, 'directory', manifest,
    [{ id: 'partial', sourceType: 'directory', manifest: candidateManifest }],
    { getCandidatePaths: () => [historical] });
  assert.deepEqual(result.matches.map((record) => record.id), ['partial']);
  assert.equal(result.hashedFiles, 3);
  assert.ok(result.manifest.every((file) => /^[a-f0-9]{32}$/.test(file.md5)));
});

test('multiple valid paths for one historical record use only the first path', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-paths-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = ['current', 'original', 'alternate'].map((name) => path.join(root, name));
  for (const directory of directories) {
    await fs.mkdir(directory);
    for (const name of ['a.bin', 'b.bin']) await fs.writeFile(path.join(directory, name), `same-${name}`);
  }
  const options = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 1024 };
  const manifest = await buildManifest(directories[0], 'directory', options);
  const candidateManifest = await buildManifest(directories[1], 'directory', options);
  const budget = { remainingFiles: 2, remainingBytes: 20 };
  let alternateReads = 0;
  const original = fsSync.createReadStream;
  fsSync.createReadStream = (...args) => {
    if (String(args[0]).startsWith(directories[2])) alternateReads += 1;
    return original(...args);
  };
  try {
    const result = await verifyManifestMd5AgainstCompleteCandidates(directories[0], 'directory', manifest,
      [{ id: 'two-paths', sourceType: 'directory', manifest: candidateManifest }],
      { getCandidatePaths: () => directories.slice(1), budget });
    assert.deepEqual(result.matches.map((record) => record.id), ['two-paths']);
    assert.equal(result.verificationIncomplete, false);
    assert.equal(alternateReads, 0);
  } finally {
    fsSync.createReadStream = original;
  }
});

test('an unavailable historical path does not consume the fallback read budget', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-fallback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const historical = path.join(root, 'historical');
  await fs.mkdir(current);
  await fs.mkdir(historical);
  for (const name of ['a.bin', 'b.bin']) {
    await fs.writeFile(path.join(current, name), `same-${name}`);
    await fs.writeFile(path.join(historical, name), `same-${name}`);
  }
  const options = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 1024 };
  const manifest = await buildManifest(current, 'directory', options);
  const candidateManifest = await buildManifest(historical, 'directory', options);
  const budget = { remainingFiles: 2, remainingBytes: 20 };
  const result = await verifyManifestMd5AgainstCompleteCandidates(current, 'directory', manifest,
    [{ id: 'fallback', sourceType: 'directory', manifest: candidateManifest }],
    { getCandidatePaths: () => [path.join(root, 'missing'), historical], budget });
  assert.deepEqual(result.matches.map((record) => record.id), ['fallback']);
  assert.equal(result.verificationIncomplete, false);
});

test('different historical paths cannot combine matching files into an exact duplicate', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-no-mix-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  for (const directory of [current, first, second]) await fs.mkdir(directory);
  for (const [directory, values] of [[current, ['A', 'B']], [first, ['A', 'X']], [second, ['X', 'B']]]) {
    await fs.writeFile(path.join(directory, 'a.bin'), values[0]);
    await fs.writeFile(path.join(directory, 'b.bin'), values[1]);
  }
  const options = { skipTinyMd5Files: true, tinyFileMd5ThresholdBytes: 1024 };
  const manifest = await buildManifest(current, 'directory', options);
  const candidateManifest = await buildManifest(first, 'directory', options);
  const result = await verifyManifestMd5AgainstCompleteCandidates(current, 'directory', manifest,
    [{ id: 'split', sourceType: 'directory', manifest: candidateManifest }],
    { getCandidatePaths: () => [first, second], budget: { remainingFiles: 4, remainingBytes: 4 } });
  assert.deepEqual(result.matches, []);
  assert.equal(result.verificationIncomplete, false);
});

test('multiple candidates are eliminated after two current hashes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-many-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ['a.bin', 'b.bin', 'c.bin', 'd.bin']) await fs.writeFile(path.join(root, name), name);
  const complete = await buildManifest(root, 'directory');
  const partial = complete.map(({ md5: _md5, ...file }) => file);
  const wrong = 'ffffffffffffffffffffffffffffffff';
  const candidates = ['A', 'B', 'C'].map((id) => ({
    id,
    manifest: complete.map((file) => ({ ...file,
      md5: ((id === 'A' || id === 'B') && file.name === 'a.bin') ||
        (id === 'C' && file.name === 'b.bin') ? wrong : file.md5 }))
  }));
  const result = await verifyManifestMd5AgainstCompleteCandidates(root, 'directory', partial, candidates);
  assert.equal(result.matches.length, 0);
  assert.equal(result.hashedFiles, 2);
  assert.equal(result.manifest.filter((file) => file.md5).length, 2);
});

test('complete fingerprints match without reading any source file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-progressive-complete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.bin'), 'same');
  const manifest = await buildManifest(root, 'directory');
  let reads = 0;
  const original = fsSync.createReadStream;
  fsSync.createReadStream = (...args) => { reads += 1; return original(...args); };
  try {
    const result = await verifyManifestMd5AgainstCompleteCandidates(root, 'directory', manifest,
      [{ id: 'complete', manifest }]);
    assert.deepEqual(result.matches.map((record) => record.id), ['complete']);
    assert.equal(result.hashedFiles, 0);
    assert.equal(reads, 0);
  } finally {
    fsSync.createReadStream = original;
  }
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

test('source snapshots report additions, modifications, deletions, and directory changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-source-snapshot-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'removed-directory'));
  await fs.writeFile(path.join(root, 'changed.txt'), 'before');
  await fs.writeFile(path.join(root, 'deleted.txt'), 'deleted');
  const before = await scanSourceSnapshot(root, 'directory');

  await fs.writeFile(path.join(root, 'changed.txt'), 'after with a different size');
  await fs.rm(path.join(root, 'deleted.txt'));
  await fs.rm(path.join(root, 'removed-directory'), { recursive: true });
  await fs.mkdir(path.join(root, 'added-directory'));
  await fs.writeFile(path.join(root, 'added.txt'), 'added');
  const after = await scanSourceSnapshot(root, 'directory');
  const difference = compareSourceSnapshots(before, after);

  assert.equal(difference.comparable, true);
  assert.equal(difference.changed, true);
  assert.equal(difference.onlyAdded, false);
  assert.deepEqual(difference.summary, {
    addedFiles: 1,
    modifiedFiles: 1,
    deletedFiles: 1,
    unchangedFiles: 0,
    addedDirectories: 1,
    deletedDirectories: 1
  });
});

test('manifest refresh reuses unchanged MD5 and preview metadata while hashing additions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-manifest-reuse-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'unchanged.txt'), 'same');
  const previous = await buildManifest(root, 'directory');
  previous[0].thumbnailPath = 'existing-preview.png';
  await fs.writeFile(path.join(root, 'added.txt'), 'new');
  const snapshot = await scanSourceSnapshot(root, 'directory');

  const refreshed = await buildManifest(root, 'directory', {
    preparedSnapshot: snapshot,
    reuseManifest: previous
  });
  const unchanged = refreshed.find((file) => file.name === 'unchanged.txt');
  const added = refreshed.find((file) => file.name === 'added.txt');

  assert.equal(unchanged.md5, previous[0].md5);
  assert.equal(unchanged.thumbnailPath, 'existing-preview.png');
  assert.equal(unchanged.sourceMetadataUnchanged, true);
  assert.match(added.md5, /^[a-f0-9]{32}$/);
  assert.equal(added.sourceMetadataUnchanged, undefined);
  assert.equal(refreshed.sourceSnapshot.snapshotId, snapshot.snapshotId);
});
