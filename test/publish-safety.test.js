'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('publish safety distinguishes export-ignored maintenance paths from public documentation', () => {
  const root = path.join(__dirname, '..');
  const checker = fs.readFileSync(path.join(root, 'scripts', 'check-publish-safety.js'), 'utf8');
  const publicDocuments = [
    fs.readFileSync(path.join(root, 'docs', 'DEVELOPMENT.md'), 'utf8'),
    fs.readFileSync(path.join(root, 'docs', 'RELEASE.md'), 'utf8')
  ];

  assert.match(checker, /check-attr[\s\S]*export-ignore/);
  assert.match(checker, /allowWhenExportIgnored: true/);
  assert.match(checker, /exportIgnoredPaths\.has\(normalized\)/);
  for (const document of publicDocuments) {
    assert.doesNotMatch(document, /[A-Za-z]:\\CodexWorkspace\\/i);
  }
});
