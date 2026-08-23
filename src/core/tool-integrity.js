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

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
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

async function verifyFileIntegrityEntries(root, entries) {
  assertIntegrityEntries(entries);
  for (const entry of entries) {
    const absolutePath = resolveIntegrityPath(root, entry.path);
    let stats;
    try {
      stats = await fsp.stat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`发行包缺少关键文件：${entry.path}`);
      throw error;
    }
    if (!stats.isFile() || stats.size !== entry.bytes) {
      throw new Error(`发行包关键文件大小不一致：${entry.path}`);
    }
    if (await hashFile(absolutePath) !== entry.sha256) {
      throw new Error(`发行包关键文件 SHA-256 校验失败：${entry.path}`);
    }
  }
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
  createFileIntegrityEntries,
  hashFile,
  normalizeRelativePath,
  readAndVerifyReleaseManifest,
  resolveIntegrityPath,
  verifyFileIntegrityEntries
};
