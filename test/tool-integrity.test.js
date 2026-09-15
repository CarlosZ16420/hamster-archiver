'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createFileIntegrityEntries,
  normalizeRelativePath,
  readAndVerifyReleaseManifest,
  verifyFileIntegrityEntries
} = require('../src/core/tool-integrity');
const { verifyReleaseManifestAtStartup } = require('../src/core/startup-integrity');

test('release integrity entries detect changed and missing bundled files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'tools'), { recursive: true });
  await fs.writeFile(path.join(root, 'tools', 'tool.exe'), 'locked tool');
  const entries = await createFileIntegrityEntries(root, ['tools/tool.exe']);
  assert.equal(entries.length, 1);
  assert.match(entries[0].sha256, /^[a-f0-9]{64}$/);
  await verifyFileIntegrityEntries(root, entries);

  await fs.writeFile(path.join(root, 'tools', 'tool.exe'), 'changed tool');
  await assert.rejects(() => verifyFileIntegrityEntries(root, entries), /大小不一致|SHA-256 校验失败/);
  await fs.rm(path.join(root, 'tools', 'tool.exe'));
  await assert.rejects(() => verifyFileIntegrityEntries(root, entries), /缺少关键文件/);
});

test('release manifest verification checks schema and file hashes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-release-manifest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'HamsterArchiver.exe'), 'portable executable fixture');
  const files = await createFileIntegrityEntries(root, ['HamsterArchiver.exe']);
  await fs.writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    version: '4.5.0',
    integrity: { algorithm: 'sha256', files }
  }));
  assert.equal((await readAndVerifyReleaseManifest(root)).version, '4.5.0');
});

test('integrity paths reject absolute paths and traversal', () => {
  assert.throws(() => normalizeRelativePath('../tool.exe'), /不安全路径/);
  assert.throws(() => normalizeRelativePath('C:/tool.exe'), /不安全路径/);
  assert.equal(normalizeRelativePath('tools\\7zip\\7z.exe'), 'tools/7zip/7z.exe');
});

test('startup integrity cache skips unchanged content and invalidates on file changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-startup-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executablePath = path.join(root, 'HamsterArchiver.exe');
  const cachePath = path.join(root, 'userdata', 'cache', 'release-integrity-v1.json');
  await fs.writeFile(executablePath, 'verified executable');
  const files = await createFileIntegrityEntries(root, ['HamsterArchiver.exe']);
  await fs.writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    version: '4.6.7',
    commit: 'fixture-commit',
    integrity: { algorithm: 'sha256', files }
  }));

  const first = await verifyReleaseManifestAtStartup({ applicationRoot: root, cachePath });
  assert.equal(first.cacheHit, false);
  assert.equal(first.cacheWritten, true);

  const second = await verifyReleaseManifestAtStartup({ applicationRoot: root, cachePath });
  assert.equal(second.cacheHit, true);

  const forced = await verifyReleaseManifestAtStartup({
    applicationRoot: root,
    cachePath,
    forceFullVerification: true
  });
  assert.equal(forced.cacheHit, false);

  await fs.writeFile(executablePath, 'modified executable');
  await assert.rejects(
    () => verifyReleaseManifestAtStartup({ applicationRoot: root, cachePath }),
    /SHA-256 校验失败/
  );
});

test('startup integrity cache corruption safely falls back to full verification', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-startup-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cachePath = path.join(root, 'cache', 'release-integrity-v1.json');
  await fs.writeFile(path.join(root, 'HamsterArchiver.exe'), 'verified executable');
  const files = await createFileIntegrityEntries(root, ['HamsterArchiver.exe']);
  await fs.writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    version: '4.6.7',
    commit: 'fixture-commit',
    integrity: { algorithm: 'sha256', files }
  }));
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, '{not-json', 'utf8');

  const result = await verifyReleaseManifestAtStartup({ applicationRoot: root, cachePath });
  assert.equal(result.cacheHit, false);
  assert.equal(result.cacheWritten, true);
  assert.equal(JSON.parse(await fs.readFile(cachePath, 'utf8')).commit, 'fixture-commit');
});

test('startup integrity cache write failures do not block a successful verification', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-startup-cache-write-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'HamsterArchiver.exe'), 'verified executable');
  const files = await createFileIntegrityEntries(root, ['HamsterArchiver.exe']);
  await fs.writeFile(path.join(root, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2,
    version: '4.6.7',
    commit: 'fixture-commit',
    integrity: { algorithm: 'sha256', files }
  }));
  const occupiedParent = path.join(root, 'occupied');
  await fs.writeFile(occupiedParent, 'not a directory');

  const result = await verifyReleaseManifestAtStartup({
    applicationRoot: root,
    cachePath: path.join(occupiedParent, 'release-integrity-v1.json')
  });
  assert.equal(result.cacheHit, false);
  assert.equal(result.cacheWritten, false);
  assert.ok(result.cacheWriteError);
});
