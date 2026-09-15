'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  assertIntegrityEntries,
  collectFileIntegrityMetadata
} = require('./tool-integrity');

const CACHE_SCHEMA_VERSION = 1;
const CACHE_POLICY_VERSION = 1;

function normalizedRoot(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function sameFiles(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    JSON.stringify(left) === JSON.stringify(right);
}

function runIntegrityWorker(applicationRoot, entries, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'integrity-worker.js'), {
      workerData: { applicationRoot, entries }
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    worker.on('message', (message) => {
      if (message?.type === 'progress') onProgress?.(message.progress);
      if (message?.type === 'complete') finish(resolve, message.files);
      if (message?.type === 'error') {
        const error = new Error(message.error?.message || '发行包完整性校验失败。');
        if (message.error?.code) error.code = message.error.code;
        if (message.error?.stack) error.stack = message.error.stack;
        finish(reject, error);
      }
    });
    worker.on('error', (error) => finish(reject, error));
    worker.on('exit', (code) => {
      if (code !== 0) finish(reject, new Error(`发行包完整性校验线程异常退出 (${code})。`));
    });
  });
}

async function verifyReleaseManifestAtStartup({ applicationRoot, cachePath, onProgress, forceFullVerification = false }) {
  const resolvedRoot = path.resolve(applicationRoot);
  const manifestPath = path.join(resolvedRoot, 'release-manifest.json');
  const manifestSource = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource);
  if (manifest.schemaVersion !== 2) throw new Error('发行清单版本不受支持。');
  const entries = manifest.integrity?.files;
  assertIntegrityEntries(entries);

  const manifestDigest = crypto.createHash('sha256').update(manifestSource).digest('hex');
  const files = await collectFileIntegrityMetadata(resolvedRoot, entries);
  const cache = await readJsonOrNull(cachePath);
  const cacheHit = !forceFullVerification && cache?.schemaVersion === CACHE_SCHEMA_VERSION &&
    cache?.policyVersion === CACHE_POLICY_VERSION &&
    cache?.applicationRoot === normalizedRoot(resolvedRoot) &&
    cache?.manifestDigest === manifestDigest &&
    cache?.version === manifest.version &&
    cache?.commit === manifest.commit &&
    sameFiles(cache.files, files);

  if (cacheHit) return { manifest, cacheHit: true, cacheWritten: true };

  const verifiedFiles = await runIntegrityWorker(resolvedRoot, entries, onProgress);
  const nextCache = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    policyVersion: CACHE_POLICY_VERSION,
    applicationRoot: normalizedRoot(resolvedRoot),
    manifestDigest,
    version: manifest.version,
    commit: manifest.commit,
    verifiedAt: new Date().toISOString(),
    files: verifiedFiles
  };
  let cacheWritten = true;
  let cacheWriteError = null;
  try {
    await writeJsonAtomic(cachePath, nextCache);
  } catch (error) {
    cacheWritten = false;
    cacheWriteError = error;
  }
  return { manifest, cacheHit: false, cacheWritten, cacheWriteError };
}

module.exports = {
  CACHE_POLICY_VERSION,
  CACHE_SCHEMA_VERSION,
  verifyReleaseManifestAtStartup
};
