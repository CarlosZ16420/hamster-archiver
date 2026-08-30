'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('installer build stays outside the repository and uses per-user safe defaults', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-installer.js'), 'utf8');
  const release = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build-release.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(script, /layout\.installerRoot/);
  assert.match(script, /--config\.nsis\.perMachine=false/);
  assert.match(script, /--config\.nsis\.deleteAppDataOnUninstall=false/);
  assert.match(release, /distributionMode === 'portable'/);
  assert.match(release, /distributionMode === 'installed'/);
  assert.match(main, /isInstalledDistribution/);
  assert.match(main, /resolveUserDataRootFromLocationFile/);
});
