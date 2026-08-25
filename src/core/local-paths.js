'use strict';

const path = require('node:path');
const { isPathInside, normalizeForComparison } = require('./paths');

const LOCAL_ROOT_NAME = 'HamsterArchiver-Local';

function resolveLocalRoot(projectRoot = path.resolve(__dirname, '..', '..'), env = process.env) {
  const configured = String(env.HAMSTER_LOCAL_ROOT || '').trim();
  return configured
    ? path.resolve(configured)
    : path.join(path.dirname(path.resolve(projectRoot)), LOCAL_ROOT_NAME);
}

function assertPathInsideLocalRoot(targetPath, localRoot, label = '本地目标') {
  if (normalizeForComparison(targetPath) === normalizeForComparison(localRoot)) {
    throw new Error(`${label}不能直接使用本地资料根目录。`);
  }
  if (!isPathInside(localRoot, targetPath)) {
    throw new Error(`${label}必须位于本地资料根目录内：${targetPath}`);
  }
}

function makeLocalLayout(projectRoot = path.resolve(__dirname, '..', '..'), env = process.env) {
  const root = resolveLocalRoot(projectRoot, env);
  return {
    root,
    buildRoot: path.join(root, 'builds'),
    stagingRoot: path.join(root, 'builds', 'staging'),
    currentBuild: path.join(root, 'builds', 'current'),
    packageRoot: path.join(root, 'builds', 'packages'),
    historyRoot: path.join(root, 'builds', 'history'),
    productionData: path.join(root, 'data', 'production'),
    developmentData: path.join(root, 'data', 'development'),
    publicSnapshot: path.join(root, 'public-snapshot')
  };
}

module.exports = {
  LOCAL_ROOT_NAME,
  assertPathInsideLocalRoot,
  isPathInside,
  makeLocalLayout,
  resolveLocalRoot
};
