'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { isPathInside, normalizeForComparisonForPlatform } = require('../src/core/paths');
const { createAutomationManifest } = require('../src/core/automation-definitions');

test('Mac task paths preserve case, normalize Unicode, and reject ambiguous layout aliases', () => {
  const parent = path.join(process.cwd(), 'Volumes', 'Archive', 'Café');
  const alias = path.join(process.cwd(), 'volumes', 'archive', 'Cafe\u0301');
  assert.notEqual(normalizeForComparisonForPlatform(parent, 'darwin'), normalizeForComparisonForPlatform(alias, 'darwin'));
  assert.equal(normalizeForComparisonForPlatform(parent, 'darwin'),
    normalizeForComparisonForPlatform(path.join(process.cwd(), 'Volumes', 'Archive', 'Cafe\u0301'), 'darwin'));
  assert.equal(isPathInside(parent, path.join(alias, 'nested'), 'darwin'), true);
  assert.equal(isPathInside(parent, `${alias}-other`, 'darwin'), false);
  assert.notEqual(normalizeForComparisonForPlatform(parent, 'linux'), normalizeForComparisonForPlatform(alias, 'linux'));
});

test('Mac capability manifest names the bundled universal launchers', () => {
  const manifest = createAutomationManifest('4.8.0-beta.mac.2', {
    platform: 'darwin-universal', launchers: { cli: 'hamster', mcp: 'HamsterArchiver-MCP' }
  });
  assert.equal(manifest.platform, 'darwin-universal');
  assert.deepEqual(manifest.launchers, { cli: 'hamster', mcp: 'HamsterArchiver-MCP' });
});
