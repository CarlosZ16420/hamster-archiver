'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findReleaseByTag, planUploads, parseArgs } = require('../scripts/release-publish');
const { optionsFrom, findRequest } = require('../scripts/release');
const { readReleaseNotes, assertDraftNotes } = require('../scripts/release-publish');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('public releases cannot fall back to latest private patch notes or empty translations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-public-notes-'));
  try {
    const directory = path.join(root, 'docs', 'releases');
    await fs.mkdir(directory, { recursive: true });
    const privateBody = '## 中文\n单版本。\n## English\nSingle patch.';
    await fs.writeFile(path.join(directory, 'release-notes-v1.0.0.md'), privateBody);
    assert.equal((await readReleaseNotes('CarlosZ16420/hamster-archive', 'v1.0.0', root)).body, privateBody);
    await assert.rejects(readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root), { code: 'ENOENT' });
    const publicPath = path.join(directory, 'public-release-notes-v1.0.0.md');
    await fs.writeFile(publicPath, '## 中文\n完整范围。\n## English\n');
    await assert.rejects(readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root), /non-empty/);
    const publicBody = '## 中文\n完整范围。\n## English\nCumulative changes.';
    await fs.writeFile(publicPath, publicBody);
    assert.equal((await readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root)).body, publicBody);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('draft continuation and read-back reject stale release text', () => {
  assert.throws(() => assertDraftNotes({ body: 'Old patch notes' }, 'Cumulative notes'), /Draft notes differ/);
  assert.doesNotThrow(() => assertDraftNotes({ body: '## 中文\r\n说明\r\n' }, '## 中文\n说明\n'));
});

test('release lookup matches exact tags, including drafts', () => {
  const releases = [
    { tag_name: 'v4.5.18', draft: false },
    { tag_name: 'v4.6.0', draft: true, id: 7 },
    { tag_name: 'v4.60', draft: true, id: 8 }
  ];
  assert.equal(findReleaseByTag(releases, 'v4.6.0').id, 7);
  assert.equal(findReleaseByTag(releases, 'v4.6.1'), undefined);
});

test('draft resume skips identical assets and uploads only missing files', () => {
  const zip = { name: 'app.zip', size: 42, digest: 'sha256:abc' };
  const exe = { name: 'app.exe', size: 50, digest: 'sha256:def' };
  assert.deepEqual(planUploads([zip, exe], [zip]), [exe]);
});

test('draft resume refuses conflicting or unverifiable files without overwriting', () => {
  const asset = { name: 'app.zip', size: 42, digest: 'sha256:abc' };
  for (const remote of [{ ...asset, size: 43 }, { ...asset, digest: 'sha256:other' }, { name: asset.name, size: 42 }]) {
    assert.throws(() => planUploads([asset], [remote]), /no file was overwritten/);
  }
});

test('cloud launcher uses exact request identity rather than another run of the same version', () => {
  const runs = [{ id: 1, display_title: 'Windows release v1.0.0 / earlier' }, { id: 2, display_title: 'Windows release v1.0.0 / current' }];
  assert.equal(findRequest(runs, { tag: 'v1.0.0', id: 'current' }).id, 2);
  assert.equal(findRequest(runs, { tag: 'v1.0.0', id: 'missing' }), undefined);
});

test('release mode and polling are explicit and bounded', () => {
  assert.equal(optionsFrom([]).mode, 'cloud');
  assert.equal(optionsFrom(['--mode', 'local']).mode, 'local');
  for (const value of ['NaN', '0', '1000']) assert.throws(() => optionsFrom(['--wait-minutes', value]));
  assert.throws(() => optionsFrom(['--mode', 'auto']));
  assert.throws(() => parseArgs(['upload', '--repo']));
});
