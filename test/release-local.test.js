'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('local release retries only transient Windows rename failures and keeps rollback paths guarded', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');

  assert.match(source, /async function renameWithRetry/);
  assert.match(source, /\['EPERM', 'EACCES', 'EBUSY'\]\.includes\(error\.code\)/);
  assert.match(source, /process\.platform !== 'win32'\) throw error/);
  assert.match(source, /HAMSTER_RENAME_SOURCE: sourcePath/);
  assert.match(source, /HAMSTER_RENAME_DESTINATION: destinationPath/);
  assert.match(source, /Move-Item -LiteralPath \$env:HAMSTER_RENAME_SOURCE -Destination \$env:HAMSTER_RENAME_DESTINATION/);
  assert.match(source, /renameWithRetry\(previousCurrent, layout\.currentBuild\)/);
  assert.match(source, /renameWithRetry\(priorZip, finalZip\)/);
  assert.match(source, /renameWithRetry\(priorSha, finalSha\)/);
});
