'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('programmatic quit waits for a running queue before closing stores', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(source, /app\.on\('before-quit', \(event\) =>/);
  assert.match(source, /queueManager\?\.running[\s\S]*event\.preventDefault\(\)[\s\S]*stopForShutdown\(\)[\s\S]*appStore\?\.closeAll\(\)/);
});

test('recycle-bin restore never falls back to an arbitrary shell verb', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'recycle-bin.js'), 'utf8');
  assert.doesNotMatch(source, /\$restoreVerb\s*=\s*\$verbs\[0\]/);
  assert.match(source, /RESTORE_VERB_MISSING/);
});

test('local path helpers share the application path containment contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'local-paths.js'), 'utf8');
  assert.match(source, /require\('\.\/paths'\)/);
  assert.doesNotMatch(source, /function isPathInside/);
  assert.match(source, /isPathInside\(localRoot, targetPath\)/);
});
