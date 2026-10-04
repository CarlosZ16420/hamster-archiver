'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const packageMetadata = require('../../package.json');
const { normalizeForComparison } = require('./paths');
const { resolveDevelopmentUserDataRoot } = require('./development-paths');
const { makeUserDataLayout, resolveUserDataRoot, resolveUserDataRootFromLocationFile } = require('./storage-paths');

const projectRoot = path.resolve(__dirname, '..', '..');

function cliUserDataRoot(env = process.env, executable = process.execPath) {
  if (env.HAMSTER_CLI_USER_DATA_DIR) return path.resolve(env.HAMSTER_CLI_USER_DATA_DIR);
  if (['node', 'node.exe'].includes(path.basename(executable).toLowerCase())) return resolveDevelopmentUserDataRoot(projectRoot, env);
  if (packageMetadata.distributionMode === 'installed') {
    const electronRoot = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', packageMetadata.productName || 'Hamster Archiver')
      : path.join(env.APPDATA || '', packageMetadata.productName || 'Hamster Archiver');
    if (!path.isAbsolute(electronRoot)) throw new Error('Installed user data path is unavailable.');
    return resolveUserDataRootFromLocationFile(path.join(electronRoot, 'user-data-location.json'), electronRoot);
  }
  return resolveUserDataRoot(path.dirname(executable));
}

function requestDirectory(userDataRoot) {
  return path.join(userDataRoot, 'automation', 'cli-requests');
}

async function currentRepositoryDirectory(userDataRoot) {
  const layout = makeUserDataLayout(projectRoot, null, userDataRoot);
  let settings;
  try { settings = JSON.parse(await fs.readFile(layout.settingsPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path.resolve(settings?.repositoryDirectory || layout.repositoryDirectory);
}

function sameRepository(left, right) {
  return normalizeForComparison(left || '') === normalizeForComparison(right || '');
}

async function createRequestFile(userDataRoot, request) {
  const directory = requestDirectory(userDataRoot);
  await fs.mkdir(directory, { recursive: true });
  await reconcileTerminalRequests(userDataRoot).catch(() => {});
  const file = path.join(directory, `${crypto.randomUUID()}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...request,
      status: 'prepared', createdAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  return file;
}

async function readRequestFile(file) {
  const resolved = path.resolve(file);
  const value = JSON.parse(await fs.readFile(resolved, 'utf8'));
  if (value?.schemaVersion !== 1 || !value.requestId || !value.repositoryDirectory ||
      !value.input || value.input.requestId !== value.requestId || value.input.responseVersion !== 2) {
    const error = new Error('The request file is incomplete or damaged.');
    error.code = 'REQUEST_FILE_INVALID';
    throw error;
  }
  return { file: resolved, value };
}

async function updateRequestFile(file, update, options = {}) {
  const { value } = await readRequestFile(file);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ ...value, ...update,
      updatedAt: new Date().toISOString() }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  if (TERMINAL_REQUEST_STATUSES.has(update.status) && options.prune !== false) {
    await pruneTerminalRequests(path.dirname(file)).catch(() => {});
  }
}

const TERMINAL_REQUEST_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const RETAIN_TERMINAL_REQUESTS = 256;

async function scanRequestFiles(directory) {
  let names;
  try { names = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = names.filter((entry) => /^[a-zA-Z0-9_-]+\.json$/.test(entry));
  const found = [];
  // Bound open files while examining every entry. A terminal file must never
  // hide a newer unknown request simply because it sorts first.
  for (let index = 0; index < files.length; index += 64) {
    const batch = await Promise.all(files.slice(index, index + 64).map(async (name) => {
      const file = path.join(directory, name);
      try { return { file, value: (await readRequestFile(file)).value }; }
      catch { return { file, value: null }; }
    }));
    found.push(...batch);
  }
  return found;
}

async function pruneTerminalRequests(directory) {
  const terminal = (await scanRequestFiles(directory))
    .filter(({ value }) => value && TERMINAL_REQUEST_STATUSES.has(value.status))
    .sort((left, right) => String(right.value.updatedAt || right.value.createdAt || '')
      .localeCompare(String(left.value.updatedAt || left.value.createdAt || '')) ||
      right.file.localeCompare(left.file));
  for (const { file } of terminal.slice(RETAIN_TERMINAL_REQUESTS)) {
    await fs.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function reconcileTerminalRequests(userDataRoot, entries = null) {
  const directory = requestDirectory(userDataRoot);
  const found = entries || await scanRequestFiles(directory);
  if (!found.some(({ value }) => value?.status === 'accepted')) return found;
  let ledger;
  try { ledger = JSON.parse(await fs.readFile(path.join(userDataRoot, 'automation', 'mcp-requests.json'), 'utf8')); }
  catch { return found; }
  if (!Array.isArray(ledger)) return found;
  const repositoryDirectory = await currentRepositoryDirectory(userDataRoot);
  const terminal = new Map(ledger.filter((task) =>
    sameRepository(task.repositoryDirectory, repositoryDirectory) && task.terminalReceipts?.[2])
    .map((task) => [task.requestId, task]));
  let changed = false;
  for (const entry of found) {
    if (entry.value?.status !== 'accepted') continue;
    const task = terminal.get(entry.value.requestId);
    if (!task || entry.value.taskId && entry.value.taskId !== task.taskId) continue;
    const status = ['failed', 'cancelled'].includes(task.terminalReceipts[2]?.task?.status)
      ? task.terminalReceipts[2].task.status : 'completed';
    await updateRequestFile(entry.file, { status, taskId: task.taskId }, { prune: false });
    entry.value = { ...entry.value, status, taskId: task.taskId };
    changed = true;
  }
  if (changed) await pruneTerminalRequests(directory);
  return found;
}

async function pendingRequests(userDataRoot) {
  const directory = requestDirectory(userDataRoot);
  const result = [];
  for (const { file, value } of await reconcileTerminalRequests(userDataRoot)) {
    if (!value) result.push({ requestFile: file, status: 'damaged' });
    else if (!TERMINAL_REQUEST_STATUSES.has(value.status)) {
      result.push({ requestFile: file, requestId: value.requestId, taskId: value.taskId || null,
        repositoryDirectory: value.repositoryDirectory, status: value.status, createdAt: value.createdAt });
    }
  }
  return result.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
    left.requestFile.localeCompare(right.requestFile));
}

async function offlineTerminalReceipt(userDataRoot, taskId, responseVersion = 2) {
  const ledgerPath = path.join(userDataRoot, 'automation', 'mcp-requests.json');
  let ledger;
  try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const repositoryDirectory = await currentRepositoryDirectory(userDataRoot);
  const task = Array.isArray(ledger) ? ledger.find((entry) =>
    (entry.taskId === taskId || entry.requestId === taskId) &&
    sameRepository(entry.repositoryDirectory, repositoryDirectory)) : null;
  return task?.terminalReceipts?.[responseVersion] || null;
}

module.exports = { cliUserDataRoot, createRequestFile, currentRepositoryDirectory,
  offlineTerminalReceipt, pendingRequests, readRequestFile, reconcileTerminalRequests,
  sameRepository, updateRequestFile };
