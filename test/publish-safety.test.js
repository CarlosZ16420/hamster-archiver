'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('publish safety requires internal automation to remain export-ignored', () => {
  const root = path.join(__dirname, '..');
  const checker = fs.readFileSync(path.join(root, 'scripts', 'check-publish-safety.js'), 'utf8');
  const readPublicDocument = (name) => {
    const template = path.join(root, 'docs', `${name}.public.md`);
    const normalized = path.join(root, 'docs', `${name}.md`);
    return fs.readFileSync(fs.existsSync(template) ? template : normalized, 'utf8');
  };
  const publicArchitecture = readPublicDocument('ARCHITECTURE');
  const publicDevelopment = readPublicDocument('DEVELOPMENT');

  assert.match(checker, /check-attr[\s\S]*export-ignore/);
  assert.match(checker, /allowWhenExportIgnored: true/);
  assert.match(checker, /exportIgnoredPaths\.has\(normalized\)/);
  assert.match(checker, /publicSourceClassification/);
  assert.match(checker, /私有或未分类的开发资产缺少 export-ignore/);
  assert.doesNotMatch(publicArchitecture, /hamster-data-safety|RELEASE\.md|QA_RELEASE_ARCHITECTURE|发行 skill/i);
  assert.doesNotMatch(publicDevelopment, /task-flow|qa-plan|release:local|CodexWorkspace/i);
});
