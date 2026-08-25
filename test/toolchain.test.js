'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const packageLock = require('../package-lock.json');
const {
  dependencyLock,
  isExactPackageVersion,
  isSupportedNodeVersion,
  isSupportedNpmVersion,
  verifyDependencyMetadata
} = require('../scripts/verify-toolchain');

test('runtime ranges stay synchronized while dependencies and third-party sources stay exactly locked', () => {
  const report = verifyDependencyMetadata();
  assert.equal(report.node, process.versions.node);
  assert.equal(report.supportedNode, '^22.12.0 || ^24.0.0');
  assert.equal(report.supportedNpm, '^10.0.0 || ^11.0.0');
  assert.equal(report.packages.electron, '43.4.0');
  assert.equal(report.packages.resedit, '3.0.2');
  for (const tool of Object.values(dependencyLock.bundledTools)) {
    assert.match(tool.source.sha256, /^[a-f0-9]{64}$/);
    assert.match(tool.source.url, /^https:\/\//);
    assert.ok(tool.files.includes(tool.executable));
    assert.ok(tool.fileIntegrity[tool.executable]);
    for (const file of Object.keys(tool.fileIntegrity)) {
      assert.ok(tool.files.includes(file));
      assert.equal(Number.isSafeInteger(tool.fileIntegrity[file].bytes), true);
      assert.match(tool.fileIntegrity[file].sha256, /^[a-f0-9]{64}$/);
    }
  }
  assert.equal(dependencyLock.packageArtifacts.electron.path, 'node_modules/electron/dist/electron.exe');
  assert.match(dependencyLock.packageArtifacts.electron.sha256, /^[a-f0-9]{64}$/);
  for (const [packagePath, metadata] of Object.entries(packageLock.packages)) {
    if (!packagePath) continue;
    assert.equal(new URL(metadata.resolved).origin, 'https://registry.npmjs.org');
    assert.match(metadata.integrity, /^sha512-/);
  }
});

test('project accepts the supported Node.js and npm major lines', () => {
  assert.equal(isSupportedNodeVersion('22.12.0'), true);
  assert.equal(isSupportedNodeVersion('22.23.3'), true);
  assert.equal(isSupportedNodeVersion('24.19.0'), true);
  assert.equal(isSupportedNodeVersion('24.99.0'), true);
  assert.equal(isSupportedNodeVersion('22.11.0'), false);
  assert.equal(isSupportedNodeVersion('23.11.1'), false);
  assert.equal(isSupportedNodeVersion('25.0.0'), false);
  assert.equal(isSupportedNpmVersion('11.0.0'), true);
  assert.equal(isSupportedNpmVersion('11.17.0'), true);
  assert.equal(isSupportedNpmVersion('10.9.8'), true);
  assert.equal(isSupportedNpmVersion('12.0.0'), false);
});

test('floating npm dependency ranges are rejected by the lock policy', () => {
  assert.equal(isExactPackageVersion('43.4.0'), true);
  assert.equal(isExactPackageVersion('1.2.3-beta.1'), true);
  assert.equal(isExactPackageVersion('^43.4.0'), false);
  assert.equal(isExactPackageVersion('~3.0.2'), false);
  assert.equal(isExactPackageVersion('>=22'), false);
});
