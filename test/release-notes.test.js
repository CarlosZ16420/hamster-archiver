'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  compactReleaseNotesPayload,
  formatReleaseNotes,
  selectLocalizedReleaseNotes
} = require('../src/core/release-notes');

test('release notes select the requested packaged language', () => {
  const notes = {
    'zh-CN': ['新增手动更新说明。'],
    'en-US': ['Added manual update notes.']
  };
  assert.deepEqual(selectLocalizedReleaseNotes(notes, 'zh-CN'), ['新增手动更新说明。']);
  assert.deepEqual(selectLocalizedReleaseNotes(notes, 'en-US'), ['Added manual update notes.']);
  assert.match(formatReleaseNotes(notes, 'zh-CN'), /本次更新内容：\n• 新增手动更新说明。/);
  assert.match(formatReleaseNotes(notes, 'en-US'), /What's new:\n• Added manual update notes\./);
});

test('GitHub markdown release notes are converted to safe native-dialog text', () => {
  const markdown = [
    '# Hamster Archiver 4.6.0',
    '## 简体中文',
    '- **新增** [更新说明](https://example.test/notes)。',
    '- 修复升级提示。',
    '## English',
    '- **Added** release notes.',
    '- Fixed the update prompt.'
  ].join('\n');
  assert.deepEqual(selectLocalizedReleaseNotes(markdown, 'zh-CN'), ['新增 更新说明。', '修复升级提示。']);
  assert.deepEqual(selectLocalizedReleaseNotes(markdown, 'en-US'), ['Added release notes.', 'Fixed the update prompt.']);
  assert.doesNotMatch(formatReleaseNotes(markdown, 'zh-CN'), /https?:|\*\*|##/);
});

test('missing release notes degrade without blocking an older ZIP update', () => {
  assert.equal(compactReleaseNotesPayload(null), null);
  assert.match(formatReleaseNotes(null, 'zh-CN'), /未附带更新说明/);
  assert.match(formatReleaseNotes(null, 'en-US'), /does not include release notes/);
});

test('version verification permits an explicit README deferral while enforcing release identity and both languages', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-version-notes-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'docs', 'releases'), { recursive: true });
  const version = '4.8.5';
  const summaryPath = path.join(root, 'docs', 'releases', `release-summary-v${version}.json`);
  const summary = { schemaVersion: 1, version, readmeVersion: '4.8.4', notes: { 'zh-CN': ['更新'], 'en-US': ['Update'] } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
  await fs.writeFile(path.join(root, 'CHANGELOG.md'), `## ${version}\n`);
  await fs.writeFile(path.join(root, 'docs', 'releases', `release-notes-v${version}.md`), '## 中文\n更新\n## English\nUpdate\n');
  for (const name of ['README.md', 'README.en.md']) await fs.writeFile(path.join(root, name), 'version-4.8.4-test\nHamsterArchiver-v4.8.4-win-x64/');
  const verify = () => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'verify-version.js')], {
    env: { ...process.env, HAMSTER_CHECK_SOURCE_ROOT: root }, encoding: 'utf8'
  });
  await fs.writeFile(summaryPath, JSON.stringify(summary));
  assert.equal(verify().status, 0);
  await fs.writeFile(summaryPath, JSON.stringify({ ...summary, readmeVersion: '' }));
  assert.notEqual(verify().status, 0, 'Malformed deferrals must not bypass the README check');
  await fs.writeFile(summaryPath, JSON.stringify({ ...summary, readmeVersion: undefined }));
  assert.notEqual(verify().status, 0, 'README synchronization remains the default');
  await fs.writeFile(summaryPath, JSON.stringify({ ...summary, notes: { 'zh-CN': ['更新'], 'en-US': [] } }));
  assert.notEqual(verify().status, 0, 'Deferrals cannot skip bilingual release notes');
  await fs.writeFile(summaryPath, JSON.stringify(summary));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '4.8.4', packages: { '': { version } } }));
  assert.notEqual(verify().status, 0, 'Deferrals cannot hide package and lockfile drift');
});
