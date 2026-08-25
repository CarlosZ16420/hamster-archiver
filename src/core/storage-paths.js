'use strict';

const fs = require('node:fs');
const path = require('node:path');

const USER_DATA_LOCATION_FILENAME = 'user-data-location.json';

function userDataLocationPath(applicationRoot) {
  if (!applicationRoot) throw new Error('软件主目录不能为空。');
  return path.join(path.resolve(applicationRoot), USER_DATA_LOCATION_FILENAME);
}

function userDataLocationError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function resolveUserDataRoot(
  applicationRoot,
  readFileSync = fs.readFileSync,
  pathExists = fs.existsSync
) {
  const resolvedApplicationRoot = path.resolve(applicationRoot);
  const defaultRoot = path.join(resolvedApplicationRoot, 'userdata');
  let source;
  try {
    source = readFileSync(userDataLocationPath(resolvedApplicationRoot), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultRoot;
    throw error;
  }

  let saved;
  try {
    saved = JSON.parse(source);
  } catch (error) {
    throw userDataLocationError(
      'USER_DATA_LOCATION_INVALID',
      '用户数据位置文件已损坏，请恢复 user-data-location.json 后再启动。',
      error
    );
  }
  const configured = String(saved?.userDataDirectory || '').trim();
  if (!configured) {
    throw userDataLocationError(
      'USER_DATA_LOCATION_INVALID',
      '用户数据位置文件没有配置有效目录，请恢复 user-data-location.json 后再启动。'
    );
  }
  const resolved = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(resolvedApplicationRoot, configured);
  if (path.parse(resolved).root === resolved) {
    throw userDataLocationError(
      'USER_DATA_LOCATION_INVALID',
      '用户数据位置不能直接指向磁盘根目录。'
    );
  }
  if (!pathExists(resolved)) {
    throw userDataLocationError(
      'USER_DATA_LOCATION_MISSING',
      `用户数据位置不存在：${resolved}。请恢复或修正该目录，不会自动创建空仓库。`
    );
  }
  return resolved;
}

function makeUserDataLayout(applicationRoot, legacyElectronUserDataRoot = null, userDataRoot = null) {
  if (!applicationRoot) throw new Error('软件主目录不能为空。');
  const root = path.resolve(userDataRoot || path.join(path.resolve(applicationRoot), 'userdata'));
  const configDirectory = path.join(root, 'config');
  const logDirectory = path.join(root, 'logs');
  return {
    root,
    electronRuntimeDirectory: path.join(root, 'electron'),
    configDirectory,
    settingsPath: path.join(configDirectory, 'settings.json'),
    legacySettingsPath: legacyElectronUserDataRoot
      ? path.join(path.resolve(legacyElectronUserDataRoot), 'settings.json')
      : null,
    similarityIgnoreTermsPath: path.join(configDirectory, 'similarity-ignore-terms.txt'),
    repositoryDirectory: path.join(root, 'warehouse'),
    processedSourceDirectory: path.join(root, 'processed'),
    logDirectory,
    logPath: path.join(logDirectory, 'app.log')
  };
}

module.exports = {
  USER_DATA_LOCATION_FILENAME,
  makeUserDataLayout,
  resolveUserDataRoot,
  userDataLocationPath
};
