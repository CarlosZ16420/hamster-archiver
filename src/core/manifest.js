'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CancelledError } = require('./archive-engine-errors');
const { isImageFile, isVideoFile } = require('./constants');

const DEFAULT_LARGE_FOLDER_FILE_THRESHOLD = 500;
const DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT = 200;
const MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT = 1;
const MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT = 100000;
// 保留旧导出名，避免仍在使用固定默认值的外部调用立即失效。
const LARGE_FOLDER_MD5_SAMPLE_LIMIT = DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT;
const DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES = 5 * 1024;
const MIN_TINY_FILE_MD5_THRESHOLD_BYTES = 1024;
const MAX_TINY_FILE_MD5_THRESHOLD_BYTES = 1024 ** 3;
const TINY_FILE_MD5_MIN_BYTES = DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES;

function selectRepresentativeFiles(files, limit = LARGE_FOLDER_MD5_SAMPLE_LIMIT) {
  if (files.length <= limit) return [...files];
  const largeFileQuota = Math.ceil(limit / 2);
  const largest = [...files]
    .sort((left, right) => right.size - left.size || left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    .slice(0, largeFileQuota);
  const selectedPaths = new Set(largest.map((file) => file.relativePath));
  const remaining = files.filter((file) => !selectedPaths.has(file.relativePath));
  const spreadQuota = limit - selectedPaths.size;
  for (let index = 0; index < spreadQuota; index += 1) {
    const position = Math.min(
      remaining.length - 1,
      Math.floor(((index + 0.5) * remaining.length) / spreadQuota)
    );
    selectedPaths.add(remaining[position].relativePath);
  }
  // 始终按完整清单的稳定路径顺序计算，确保同一目录每次得到相同样本。
  return files.filter((file) => selectedPaths.has(file.relativePath));
}

function createFingerprintPlan(files, sourceType, options = {}) {
  const threshold = Number.isInteger(Number(options.largeFolderFileThreshold))
    ? Number(options.largeFolderFileThreshold)
    : DEFAULT_LARGE_FOLDER_FILE_THRESHOLD;
  const tinyFileMd5ThresholdBytes = Number.isInteger(Number(options.tinyFileMd5ThresholdBytes)) &&
      Number(options.tinyFileMd5ThresholdBytes) >= MIN_TINY_FILE_MD5_THRESHOLD_BYTES &&
      Number(options.tinyFileMd5ThresholdBytes) <= MAX_TINY_FILE_MD5_THRESHOLD_BYTES
    ? Number(options.tinyFileMd5ThresholdBytes)
    : DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES;
  const sampleLimit = Number.isInteger(Number(options.largeFolderMd5SampleLimit)) &&
      Number(options.largeFolderMd5SampleLimit) >= MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT &&
      Number(options.largeFolderMd5SampleLimit) <= MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT
    ? Number(options.largeFolderMd5SampleLimit)
    : DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT;
  const skipTinyMd5Files = options.skipTinyMd5Files === true;
  const simplified = sourceType === 'directory' && options.largeFolderSimplification === true && files.length > threshold;
  const md5Candidates = files.filter((file) => !skipTinyMd5Files || file.size >= tinyFileMd5ThresholdBytes);
  const selectedFiles = simplified
    ? selectRepresentativeFiles(md5Candidates, sampleLimit)
    : md5Candidates;
  return {
    md5Candidates,
    selectedFiles,
    selectedPaths: new Set(selectedFiles.map((file) => file.relativePath)),
    simplified,
    sampleLimit,
    tinyFileMd5ThresholdBytes,
    threshold
  };
}

async function hashFileMd5(filePath, signal, pauseController) {
  const hash = crypto.createHash('md5');
  const stream = fsSync.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
  try {
    for await (const chunk of stream) {
      await pauseController?.waitIfPaused(signal);
      if (signal?.aborted) {
        stream.destroy();
        throw new CancelledError();
      }
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

function portableRelativePath(value) {
  return value.split(path.sep).join('/');
}

async function collectFiles(sourcePath, sourceType, options = {}) {
  const { signal, pauseController, onSkippedFile = () => {} } = options;
  if (sourceType === 'video') {
    const stats = await fs.stat(sourcePath);
    return [{
      absolutePath: sourcePath,
      relativePath: path.basename(sourcePath),
      name: path.basename(sourcePath),
      extension: path.extname(sourcePath).toLowerCase(),
      size: stats.size,
      modifiedAtMs: stats.mtimeMs,
      modifiedAt: stats.mtime.toISOString(),
      mediaType: 'video'
    }];
  }

  const files = [];
  const pending = [sourcePath];
  while (pending.length > 0) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const current = pending.pop();
    let directory;
    try {
      directory = await fs.opendir(current);
    } catch (error) {
      onSkippedFile({ path: portableRelativePath(path.relative(sourcePath, current)) || '.', reason: error.message, code: error.code || 'READ_FAILED', type: 'directory' });
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        let stats;
        try {
          stats = await fs.stat(entryPath);
        } catch (error) {
          onSkippedFile({ path: portableRelativePath(path.relative(sourcePath, entryPath)), reason: error.message, code: error.code || 'STAT_FAILED', type: 'file' });
          continue;
        }
        files.push({
          absolutePath: entryPath,
          relativePath: portableRelativePath(path.relative(sourcePath, entryPath)),
          name: entry.name,
          extension: path.extname(entry.name).toLowerCase(),
          size: stats.size,
          modifiedAtMs: stats.mtimeMs,
          modifiedAt: stats.mtime.toISOString(),
          mediaType: isVideoFile(entry.name) ? 'video' : isImageFile(entry.name) ? 'image' : 'file'
        });
      }
    }
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
  return files;
}

async function buildManifest(sourcePath, sourceType, options = {}) {
  const {
    signal,
    pauseController,
    onProgress = () => {},
    onSkippedFile = () => {},
    onPlan = () => {}
  } = options;
  const skippedFiles = [];
  const recordSkipped = (item) => {
    skippedFiles.push(item);
    onSkippedFile(item);
  };
  const files = await collectFiles(sourcePath, sourceType, { signal, pauseController, onSkippedFile: recordSkipped });
  const skipTinyMd5Files = options.skipTinyMd5Files === true;
  const plan = createFingerprintPlan(files, sourceType, options);
  const { md5Candidates, selectedFiles, selectedPaths, simplified, sampleLimit, tinyFileMd5ThresholdBytes, threshold } = plan;
  const totalBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  let processedBytes = 0;
  let processedFiles = 0;
  const manifest = [];

  onPlan({
    totalFiles: files.length,
    md5Files: selectedFiles.length,
    tinyFilesSkipped: files.length - md5Candidates.length,
    sampleLimit,
    tinyFileMd5ThresholdBytes,
    threshold,
    simplified
  });

  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) throw new CancelledError();
    const file = files[index];
    const selectedForMd5 = selectedPaths.has(file.relativePath);
    let md5;
    let afterStats;
    if (selectedForMd5) {
      try {
        md5 = await hashFileMd5(file.absolutePath, signal, pauseController);
        afterStats = await fs.stat(file.absolutePath);
      } catch (error) {
        if (error instanceof CancelledError || error.code === 'TASK_CANCELLED' || error.code === 'SOURCE_CHANGED') throw error;
        recordSkipped({ path: file.relativePath, reason: error.message, code: error.code || 'READ_FAILED', type: 'file', size: file.size });
        processedBytes += file.size;
        processedFiles += 1;
        continue;
      }
      if (afterStats.size !== file.size || afterStats.mtimeMs !== file.modifiedAtMs) {
        const error = new Error(`散列期间源文件发生变化：${file.relativePath}`);
        error.code = 'SOURCE_CHANGED';
        throw error;
      }
      processedBytes += file.size;
      processedFiles += 1;
    }
    manifest.push({
      relativePath: file.relativePath,
      name: file.name,
      extension: file.extension,
      size: file.size,
      modifiedAt: file.modifiedAt,
      modifiedAtMs: file.modifiedAtMs,
      mediaType: file.mediaType,
      ...(md5 ? { md5 } : {}),
      ...(!selectedForMd5 ? {
        md5SkippedReason: skipTinyMd5Files && file.size < tinyFileMd5ThresholdBytes
          ? 'tiny-file'
          : 'large-folder-limit'
      } : {}),
    });
    if (selectedForMd5) {
      onProgress({
        currentFile: file.relativePath,
        processedFiles,
        totalFiles: selectedFiles.length,
        processedBytes,
        totalBytes,
        percent: totalBytes === 0 ? 100 : Math.floor((processedBytes / totalBytes) * 100)
      });
    }
  }

  if (selectedFiles.length === 0) {
    onProgress({ processedFiles: 0, totalFiles: 0, processedBytes: 0, totalBytes: 0, percent: 100 });
  }
  Object.defineProperty(manifest, 'skippedFiles', { value: skippedFiles, enumerable: false });
  return manifest;
}

async function completeManifestMd5(sourcePath, sourceType, manifest, options = {}) {
  const { signal, pauseController, onProgress = () => {} } = options;
  const missing = (manifest || []).filter((file) => !/^[a-f0-9]{32}$/i.test(String(file?.md5 || '')));
  let processedFiles = 0;
  const completed = [];
  for (const file of manifest || []) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    if (/^[a-f0-9]{32}$/i.test(String(file?.md5 || ''))) {
      const { md5SkippedReason: _md5SkippedReason, similarityEligible: _similarityEligible, ...entry } = file;
      completed.push({ ...entry, md5: String(file.md5).toLocaleLowerCase('en-US') });
      continue;
    }
    const absolutePath = sourceType === 'video'
      ? sourcePath
      : path.join(sourcePath, ...String(file.relativePath || '').split('/'));
    const beforeStats = await fs.stat(absolutePath);
    const expectedModifiedAtMs = Number.isFinite(Number(file.modifiedAtMs))
      ? Number(file.modifiedAtMs)
      : Date.parse(String(file.modifiedAt || ''));
    if (beforeStats.size !== Number(file.size) || !Number.isFinite(expectedModifiedAtMs) ||
        Math.abs(beforeStats.mtimeMs - expectedModifiedAtMs) >= 1) {
      const changed = new Error(`内容完全一致核验前源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
    const md5 = await hashFileMd5(absolutePath, signal, pauseController);
    const afterStats = await fs.stat(absolutePath);
    if (afterStats.size !== beforeStats.size || Math.abs(afterStats.mtimeMs - beforeStats.mtimeMs) >= 1) {
      const changed = new Error(`内容完全一致核验期间源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
    processedFiles += 1;
    const { md5SkippedReason: _md5SkippedReason, similarityEligible: _similarityEligible, ...entry } = file;
    completed.push({ ...entry, md5 });
    onProgress({
      currentFile: file.relativePath,
      processedFiles,
      totalFiles: missing.length,
      percent: missing.length === 0 ? 100 : Math.round((processedFiles / missing.length) * 100)
    });
  }
  return completed;
}

async function verifyManifestMd5AgainstCompleteCandidates(sourcePath, sourceType, manifest, candidates, options = {}) {
  const { signal, pauseController, onProgress = () => {} } = options;
  const normalizePath = (value) => String(value || '').replace(/\\/g, '/')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN');
  const workingManifest = (manifest || []).map((file) => ({ ...file }));
  let remaining = (candidates || []).map((record) => {
    const files = new Map();
    for (const file of record?.manifest || []) {
      const relativePath = normalizePath(file?.relativePath || file?.name);
      const md5 = String(file?.md5 || '').trim().toLocaleLowerCase('en-US');
      if (!relativePath || files.has(relativePath) || !/^[a-f0-9]{32}$/.test(md5)) return null;
      files.set(relativePath, { size: Number(file?.size), md5 });
    }
    return files.size === workingManifest.length ? { record, files } : null;
  }).filter(Boolean);
  if (remaining.length === 0) {
    return { manifest: workingManifest, matches: [], hashedFiles: 0, hashedBytes: 0 };
  }

  const knownFiles = workingManifest.filter((file) => /^[a-f0-9]{32}$/i.test(String(file?.md5 || '')));
  for (const file of knownFiles) {
    const relativePath = normalizePath(file.relativePath || file.name);
    const md5 = String(file.md5).toLocaleLowerCase('en-US');
    remaining = remaining.filter(({ files }) => {
      const candidate = files.get(relativePath);
      return candidate && candidate.size === Number(file.size) && candidate.md5 === md5;
    });
    if (remaining.length === 0) return { manifest: workingManifest, matches: [], hashedFiles: 0, hashedBytes: 0 };
  }

  const missing = workingManifest.filter((file) => !/^[a-f0-9]{32}$/i.test(String(file?.md5 || '')));
  missing.sort((left, right) => {
    const distinctMd5Count = (file) => {
      const relativePath = normalizePath(file.relativePath || file.name);
      return new Set(remaining.map(({ files }) => files.get(relativePath)?.md5).filter(Boolean)).size;
    };
    return distinctMd5Count(right) - distinctMd5Count(left) ||
      Number(left.size) - Number(right.size) ||
      String(left.relativePath).localeCompare(String(right.relativePath), 'zh-CN');
  });

  let hashedFiles = 0;
  let hashedBytes = 0;
  const totalBytes = missing.reduce((sum, file) => sum + Number(file.size || 0), 0);
  for (const file of missing) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const absolutePath = sourceType === 'video'
      ? sourcePath
      : path.join(sourcePath, ...String(file.relativePath || '').split('/'));
    const beforeStats = await fs.stat(absolutePath);
    const expectedModifiedAtMs = Number.isFinite(Number(file.modifiedAtMs))
      ? Number(file.modifiedAtMs)
      : Date.parse(String(file.modifiedAt || ''));
    if (beforeStats.size !== Number(file.size) || !Number.isFinite(expectedModifiedAtMs) ||
        Math.abs(beforeStats.mtimeMs - expectedModifiedAtMs) >= 1) {
      const changed = new Error(`内容完全一致核验前源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
    const md5 = await hashFileMd5(absolutePath, signal, pauseController);
    const afterStats = await fs.stat(absolutePath);
    if (afterStats.size !== beforeStats.size || Math.abs(afterStats.mtimeMs - beforeStats.mtimeMs) >= 1) {
      const changed = new Error(`内容完全一致核验期间源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
    delete file.md5SkippedReason;
    delete file.similarityEligible;
    file.md5 = md5;
    hashedFiles += 1;
    hashedBytes += Number(file.size || 0);
    const relativePath = normalizePath(file.relativePath || file.name);
    remaining = remaining.filter(({ files }) => {
      const candidate = files.get(relativePath);
      return candidate && candidate.size === Number(file.size) && candidate.md5 === md5;
    });
    onProgress({
      currentFile: file.relativePath,
      processedFiles: hashedFiles,
      totalFiles: missing.length,
      processedBytes: hashedBytes,
      totalBytes,
      percent: totalBytes === 0 ? 100 : Math.round((hashedBytes / totalBytes) * 100)
    });
    if (remaining.length === 0) break;
  }
  return {
    manifest: workingManifest,
    matches: remaining.map(({ record }) => record),
    hashedFiles,
    hashedBytes
  };
}

// Verify a partial historical manifest without materializing every candidate MD5.
// The caller owns one shared budget, so several shape-only candidates cannot each
// trigger an unbounded full-tree read.
async function verifyManifestMd5AgainstReference(sourcePath, sourceType, candidateManifest, referenceManifest, options = {}) {
  const { signal, pauseController, onProgress = () => {}, budget = {} } = options;
  if (!Array.isArray(candidateManifest) || !Array.isArray(referenceManifest) ||
      candidateManifest.length !== referenceManifest.length || candidateManifest.length === 0) {
    return { matches: false, budgetExceeded: false, hashedFiles: 0, hashedBytes: 0 };
  }

  const referenceFiles = new Map();
  for (const file of referenceManifest) {
    const relativePath = String(file?.relativePath || '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
    const md5 = String(file?.md5 || '').toLocaleLowerCase('en-US');
    if (!relativePath || referenceFiles.has(relativePath) || !/^[a-f0-9]{32}$/.test(md5)) {
      return { matches: false, budgetExceeded: false, hashedFiles: 0, hashedBytes: 0 };
    }
    referenceFiles.set(relativePath, { ...file, md5 });
  }

  const missing = [];
  const seenPaths = new Set();
  for (const file of candidateManifest) {
    const relativePath = String(file?.relativePath || '').replace(/\\/g, '/').toLocaleLowerCase('en-US');
    const reference = referenceFiles.get(relativePath);
    if (!relativePath || seenPaths.has(relativePath) || !reference || Number(file?.size) !== Number(reference.size)) {
      return { matches: false, budgetExceeded: false, hashedFiles: 0, hashedBytes: 0 };
    }
    seenPaths.add(relativePath);
    const md5 = String(file?.md5 || '').toLocaleLowerCase('en-US');
    if (/^[a-f0-9]{32}$/.test(md5)) {
      if (md5 !== reference.md5) {
        return { matches: false, budgetExceeded: false, hashedFiles: 0, hashedBytes: 0 };
      }
    } else {
      missing.push({ file, reference });
    }
  }

  missing.sort((left, right) =>
    Number(left.file.size) - Number(right.file.size) ||
    String(left.file.relativePath).localeCompare(String(right.file.relativePath), 'zh-CN'));
  const requiredFiles = missing.length;
  const requiredBytes = missing.reduce((sum, item) => sum + Number(item.file.size || 0), 0);
  const remainingFiles = Number.isFinite(Number(budget.remainingFiles))
    ? Math.max(0, Number(budget.remainingFiles))
    : Number.POSITIVE_INFINITY;
  const remainingBytes = Number.isFinite(Number(budget.remainingBytes))
    ? Math.max(0, Number(budget.remainingBytes))
    : Number.POSITIVE_INFINITY;
  if (requiredFiles > remainingFiles || requiredBytes > remainingBytes) {
    return {
      matches: false,
      budgetExceeded: true,
      requiredFiles,
      requiredBytes,
      hashedFiles: 0,
      hashedBytes: 0
    };
  }

  let hashedFiles = 0;
  let hashedBytes = 0;
  for (const { file, reference } of missing) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const absolutePath = sourceType === 'video'
      ? sourcePath
      : path.join(sourcePath, ...String(file.relativePath || '').split('/'));
    const beforeStats = await fs.stat(absolutePath);
    const expectedModifiedAtMs = Number.isFinite(Number(file.modifiedAtMs))
      ? Number(file.modifiedAtMs)
      : Date.parse(String(file.modifiedAt || ''));
    if (beforeStats.size !== Number(file.size) || !Number.isFinite(expectedModifiedAtMs) ||
        Math.abs(beforeStats.mtimeMs - expectedModifiedAtMs) >= 1) {
      const changed = new Error(`内容完全一致核验前源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }

    if (Number.isFinite(remainingFiles)) budget.remainingFiles = Math.max(0, Number(budget.remainingFiles) - 1);
    if (Number.isFinite(remainingBytes)) budget.remainingBytes = Math.max(0, Number(budget.remainingBytes) - Number(file.size));
    hashedFiles += 1;
    hashedBytes += Number(file.size);
    const md5 = await hashFileMd5(absolutePath, signal, pauseController);
    const afterStats = await fs.stat(absolutePath);
    if (afterStats.size !== beforeStats.size || Math.abs(afterStats.mtimeMs - beforeStats.mtimeMs) >= 1) {
      const changed = new Error(`内容完全一致核验期间源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
    onProgress({
      currentFile: file.relativePath,
      processedFiles: hashedFiles,
      totalFiles: missing.length,
      processedBytes: hashedBytes,
      totalBytes: requiredBytes,
      percent: requiredBytes === 0 ? 100 : Math.round((hashedBytes / requiredBytes) * 100)
    });
    if (md5 !== reference.md5) {
      return { matches: false, budgetExceeded: false, hashedFiles, hashedBytes };
    }
  }
  return { matches: true, budgetExceeded: false, hashedFiles, hashedBytes };
}

async function validateManifestUnchanged(sourcePath, sourceType, manifest, signal, pauseController) {
  for (const file of manifest) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const absolutePath = sourceType === 'video'
      ? sourcePath
      : path.join(sourcePath, ...file.relativePath.split('/'));
    let stats;
    try {
      stats = await fs.stat(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        const changed = new Error(`压缩期间源文件消失：${file.relativePath}`);
        changed.code = 'SOURCE_CHANGED';
        throw changed;
      }
      throw error;
    }
    if (stats.size !== file.size || stats.mtimeMs !== file.modifiedAtMs) {
      const changed = new Error(`压缩期间源文件发生变化：${file.relativePath}`);
      changed.code = 'SOURCE_CHANGED';
      throw changed;
    }
  }
}

async function collectDirectories(sourcePath, sourceType, options = {}) {
  if (sourceType === 'video') return [];
  const { signal, pauseController } = options;
  const directories = [];
  const pending = [sourcePath];
  while (pending.length > 0) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const current = pending.pop();
    let directory;
    try {
      directory = await fs.opendir(current);
    } catch (error) {
      options.onSkippedFile?.({ path: portableRelativePath(path.relative(sourcePath, current)) || '.', reason: error.message, code: error.code || 'READ_FAILED', type: 'directory' });
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const entryPath = path.join(current, entry.name);
      directories.push(portableRelativePath(path.relative(sourcePath, entryPath)));
      pending.push(entryPath);
    }
  }
  return directories.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

module.exports = {
  DEFAULT_LARGE_FOLDER_FILE_THRESHOLD,
  DEFAULT_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  DEFAULT_TINY_FILE_MD5_THRESHOLD_BYTES,
  LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  MAX_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  MAX_TINY_FILE_MD5_THRESHOLD_BYTES,
  MIN_LARGE_FOLDER_MD5_SAMPLE_LIMIT,
  MIN_TINY_FILE_MD5_THRESHOLD_BYTES,
  TINY_FILE_MD5_MIN_BYTES,
  buildManifest,
  completeManifestMd5,
  collectDirectories,
  collectFiles,
  createFingerprintPlan,
  hashFileMd5,
  selectRepresentativeFiles,
  validateManifestUnchanged,
  verifyManifestMd5AgainstCompleteCandidates,
  verifyManifestMd5AgainstReference
};
