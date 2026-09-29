'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { LARGE_TASK_BYTES, isVideoFile } = require('./constants');
const { walkSourceMetadata } = require('./source-metadata');
const { performanceTrace } = require('./performance-trace');

async function inspectPath(sourcePath, sourceType, onProgress = () => {}, options = {}) {
  const startedAt = Date.now();
  let fileCount = 0;
  let totalBytes = 0;
  const skippedFiles = [];
  for await (const entry of walkSourceMetadata(sourcePath, sourceType, {
    onSkipped: ({ absolutePath, type, error }) => skippedFiles.push({ path: absolutePath,
      reason: error.message, code: error.code || (type === 'file' ? 'STAT_FAILED' : 'READ_FAILED'), type })
  })) {
    if (entry.type !== 'file') continue;
    fileCount += 1;
    totalBytes += entry.stats.size;
    if (sourceType !== 'video' && fileCount % 250 === 0) onProgress({ sourcePath, fileCount, totalBytes });
  }
  if (options.traceStage) performanceTrace.record({ stage: options.traceStage,
    elapsedMs: Date.now() - startedAt, fileCount, bytes: totalBytes });
  if (sourceType === 'video') return { fileCount, totalBytes };
  onProgress({ sourcePath, fileCount, totalBytes });
  return { fileCount, totalBytes, skippedFiles };
}

async function scanIntakeDirectory(intakeDirectory, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const minimumBytes = options.minimumBytes > 0 ? Number(options.minimumBytes) : 0;
  let stats;
  try {
    stats = await fs.stat(intakeDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const missing = new Error('所选目录已经不存在。');
    missing.code = 'SOURCE_NOT_FOUND';
    throw missing;
  }
  if (!stats.isDirectory()) {
    throw new Error('所选目录不是文件夹。');
  }

  let entries;
  try {
    entries = await fs.readdir(intakeDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const missing = new Error('所选目录已经不存在。');
    missing.code = 'SOURCE_NOT_FOUND';
    throw missing;
  }
  const candidates = [];
  const skippedRootFiles = [];

  for (const entry of entries) {
    const entryPath = path.join(intakeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      skippedRootFiles.push({ path: entryPath, name: entry.name, reason: '已跳过链接或重解析点' });
    } else if (entry.isDirectory()) {
      candidates.push({ sourcePath: entryPath, displayName: entry.name, sourceType: 'directory' });
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      candidates.push({ sourcePath: entryPath, displayName: entry.name, sourceType: 'video' });
    } else if (entry.isFile()) {
      try {
        const fileStats = await fs.stat(entryPath);
        skippedRootFiles.push({ path: entryPath, name: entry.name, size: fileStats.size, reason: '根级非视频文件' });
      } catch (error) {
        skippedRootFiles.push({ path: entryPath, name: entry.name, reason: `无法读取：${error.message}`, code: error.code || 'STAT_FAILED' });
      }
    }
  }

  const tasks = [];
  const filteredItems = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    onProgress({
      phase: 'candidate',
      index,
      total: candidates.length,
      displayName: candidate.displayName
    });
    let summary;
    try {
      summary = (await options.resolveExistingCandidate?.(candidate)) ||
        await inspectPath(candidate.sourcePath, candidate.sourceType, onProgress, { traceStage: 'intake-scan' });
    } catch (error) {
      skippedRootFiles.push({
        path: candidate.sourcePath,
        name: candidate.displayName,
        reason: `项目无法读取，已跳过：${error.message}`,
        code: error.code || 'INSPECT_FAILED'
      });
      continue;
    }
    if (!summary.sourceCatalogRecordId && minimumBytes > 0 && summary.totalBytes < minimumBytes) {
      filteredItems.push({ ...candidate, ...summary, reason: 'below_minimum_size' });
      continue;
    }
    tasks.push({
      ...candidate,
      ...summary,
      requiresConfirmation: summary.totalBytes > LARGE_TASK_BYTES
    });
  }

  return { tasks, skippedRootFiles, filteredItems };
}

module.exports = { inspectPath, scanIntakeDirectory };
