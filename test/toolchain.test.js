'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dependencyLock,
  isExactPackageVersion,
  verifyDependencyMetadata
} = require('../scripts/verify-toolchain');

test('direct dependencies, Node.js and third-party sources are exactly locked', () => {
  const report = verifyDependencyMetadata();
  assert.equal(report.node, dependencyLock.node);
  assert.equal(report.npm, '10.9.8');
  assert.equal(report.packages.electron, '43.4.0');
  assert.equal(report.packages.resedit, '3.0.2');
  for (const tool of Object.values(dependencyLock.bundledTools)) {
    assert.match(tool.source.sha256, /^[a-f0-9]{64}$/);
    assert.match(tool.source.url, /^https:\/\//);
    assert.ok(tool.files.includes(tool.executable));
  }
});

test('floating npm dependency ranges are rejected by the lock policy', () => {
  assert.equal(isExactPackageVersion('43.4.0'), true);
  assert.equal(isExactPackageVersion('1.2.3-beta.1'), true);
  assert.equal(isExactPackageVersion('^43.4.0'), false);
  assert.equal(isExactPackageVersion('~3.0.2'), false);
  assert.equal(isExactPackageVersion('>=22'), false);
});
