'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planUploads, parseArgs } = require('../scripts/release-publish');
const { optionsFrom, findRequest } = require('../scripts/release');

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
