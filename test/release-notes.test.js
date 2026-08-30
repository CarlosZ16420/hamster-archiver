'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
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
