'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function normalizeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || normalized.split('/').includes('..')) {
    throw new Error(`完整性清单包含不安全路径：${value}`);
  }
  return normalized;
}

function resolveIntegrityPath(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`完整性清单路径超出程序目录：${relativePath}`);
  }
  return resolved;
}

async function hashFile(filePath, onChunk = null) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    onChunk?.(chunk.length);
  }
  return hash.digest('hex');
}

function serializeFileMetadata(stats) {
  return {
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
    birthtimeNs: stats.birthtimeNs.toString(),
    dev: stats.dev.toString(),
    ino: stats.ino.toString()
  };
}

async function readIntegrityFileMetadata(root, entry) {
  const relativePath = normalizeRelativePath(entry.path);
  const absolutePath = resolveIntegrityPath(root, relativePath);
  let stats;
  try {
    stats = await fsp.stat(absolutePath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`发行包缺少关键文件：${relativePath}`);
    throw error;
  }
  if (!stats.isFile() || stats.size !== BigInt(entry.bytes)) {
    throw new Error(`发行包关键文件大小不一致：${relativePath}`);
  }
  return {
    path: relativePath,
    bytes: entry.bytes,
    sha256: entry.sha256,
    metadata: serializeFileMetadata(stats)
  };
}

async function collectFileIntegrityMetadata(root, entries) {
  assertIntegrityEntries(entries);
  return Promise.all(entries.map((entry) => readIntegrityFileMetadata(root, entry)));
}

async function createFileIntegrityEntries(root, relativePaths) {
  const uniquePaths = [...new Set(relativePaths.map(normalizeRelativePath))].sort();
  return Promise.all(uniquePaths.map(async (relativePath) => {
    const absolutePath = resolveIntegrityPath(root, relativePath);
    const stats = await fsp.stat(absolutePath);
    if (!stats.isFile()) throw new Error(`完整性清单目标不是文件：${relativePath}`);
    return {
      path: relativePath,
      bytes: stats.size,
      sha256: await hashFile(absolutePath)
    };
  }));
}

function assertIntegrityEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('发行清单缺少关键文件完整性记录。');
  }
  const seen = new Set();
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(entry?.path);
    if (seen.has(relativePath)) throw new Error(`发行清单包含重复路径：${relativePath}`);
    seen.add(relativePath);
    if (!Number.isSafeInteger(entry?.bytes) || entry.bytes < 0) {
      throw new Error(`发行清单文件大小无效：${relativePath}`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(entry?.sha256 || ''))) {
      throw new Error(`发行清单 SHA-256 无效：${relativePath}`);
    }
  }
}

async function verifyFileIntegrityEntriesWithMetadata(root, entries, options = {}) {
  assertIntegrityEntries(entries);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let processedBytes = 0;
  const reportProgress = (relativePath) => options.onProgress?.({
    relativePath,
    processedBytes,
    totalBytes
  });
  const verified = [];
  for (const entry of entries) {
    const before = await readIntegrityFileMetadata(root, entry);
    const absolutePath = resolveIntegrityPath(root, before.path);
    const actualDigest = await hashFile(absolutePath, (chunkBytes) => {
      processedBytes += chunkBytes;
      reportProgress(before.path);
    });
    const after = await readIntegrityFileMetadata(root, entry);
    if (JSON.stringify(before.metadata) !== JSON.stringify(after.metadata)) {
      throw new Error(`发行包关键文件在校验期间发生变化：${before.path}`);
    }
    if (actualDigest !== entry.sha256) {
      throw new Error(`发行包关键文件 SHA-256 校验失败：${before.path}`);
    }
    verified.push(after);
  }
  return verified;
}

async function verifyFileIntegrityEntries(root, entries, options = {}) {
  await verifyFileIntegrityEntriesWithMetadata(root, entries, options);
  return true;
}

async function readAndVerifyReleaseManifest(applicationRoot) {
  const manifestPath = path.join(path.resolve(applicationRoot), 'release-manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 2) throw new Error('发行清单版本不受支持。');
  await verifyFileIntegrityEntries(applicationRoot, manifest.integrity?.files);
  return manifest;
}

module.exports = {
  assertIntegrityEntries,
  collectFileIntegrityMetadata,
  createFileIntegrityEntries,
  hashFile,
  normalizeRelativePath,
  readAndVerifyReleaseManifest,
  resolveIntegrityPath,
  verifyFileIntegrityEntries,
  verifyFileIntegrityEntriesWithMetadata
};
