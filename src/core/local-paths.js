'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { isPathInside, normalizeForComparison } = require('./paths');

const LOCAL_ROOT_NAME = 'HamsterArchiver-Local';

function resolveLocalRoot(projectRoot = path.resolve(__dirname, '..', '..'), env = process.env) {
  const configured = String(env.HAMSTER_LOCAL_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  const source = path.resolve(projectRoot);
  for (let cursor = source; cursor !== path.dirname(cursor); cursor = path.dirname(cursor)) {
    if (path.basename(cursor).toLowerCase() === LOCAL_ROOT_NAME.toLowerCase()) return cursor;
  }
  const dotGit = path.join(source, '.git');
  try {
    if (fs.statSync(dotGit).isFile()) {
      const pointer = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m)?.[1];
      if (pointer) {
        const gitDir = path.resolve(source, pointer);
        if (path.basename(path.dirname(gitDir)) === 'worktrees' &&
            path.basename(path.dirname(path.dirname(gitDir))) === '.git') {
          const primary = path.dirname(path.dirname(path.dirname(gitDir)));
          return path.join(path.dirname(primary), LOCAL_ROOT_NAME);
        }
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path.join(path.dirname(source), LOCAL_ROOT_NAME);
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
    installerRoot: path.join(root, 'builds', 'installers'),
    installerStagingRoot: path.join(root, 'builds', 'installer-staging'),
    releaseRunsRoot: path.join(root, 'builds', 'release-runs'),
    historyRoot: path.join(root, 'builds', 'history'),
    productionData: path.join(root, 'data', 'production'),
    developmentData: path.join(root, 'data', 'development'),
    publicSnapshot: path.join(root, 'public-snapshot'),
    worktreesRoot: path.join(root, 'development', 'worktrees'),
    taskBuildsRoot: path.join(root, 'builds', 'tasks'),
    previewDataRoot: path.join(root, 'data', 'previews'),
    coordinationRoot: path.join(root, 'coordination')
  };
}

module.exports = {
  LOCAL_ROOT_NAME,
  assertPathInsideLocalRoot,
  isPathInside,
  makeLocalLayout,
  resolveLocalRoot
};
