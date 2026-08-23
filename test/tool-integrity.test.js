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
