'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { LARGE_TASK_BYTES, isVideoFile } = require('./constants');

async function inspectPath(sourcePath, sourceType, onProgress = () => {}) {
  if (sourceType === 'video') {
    const stats = await fs.stat(sourcePath);
    return { fileCount: 1, totalBytes: stats.size };
  }

  let fileCount = 0;
  let totalBytes = 0;
  const skippedFiles = [];
  const pending = [sourcePath];

  while (pending.length > 0) {
    const current = pending.pop();
    let directory;
    try {
      directory = await fs.opendir(current);
    } catch (error) {
      skippedFiles.push({ path: current, reason: error.message, code: error.code || 'READ_FAILED', type: 'directory' });
      continue;
    }

    for await (const entry of directory) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (!entry.isFile()) continue;
      let stats;
      try {
        stats = await fs.stat(entryPath);
      } catch (error) {
        skippedFiles.push({ path: entryPath, reason: error.message, code: error.code || 'STAT_FAILED', type: 'file' });
        continue;
      }
      fileCount += 1;
      totalBytes += stats.size;

      if (fileCount % 250 === 0) {
        onProgress({ sourcePath, fileCount, totalBytes });
      }
    }
  }

  onProgress({ sourcePath, fileCount, totalBytes });
  return { fileCount, totalBytes, skippedFiles };
}

async function scanIntakeDirectory(intakeDirectory, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const minimumBytes = options.minimumBytes > 0 ? Number(options.minimumBytes) : 0;
  const stats = await fs.stat(intakeDirectory);
  if (!stats.isDirectory()) {
    throw new Error('所选目录不是文件夹。');
  }

  const entries = await fs.readdir(intakeDirectory, { withFileTypes: true });
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
      summary = await inspectPath(candidate.sourcePath, candidate.sourceType, onProgress);
    } catch (error) {
      skippedRootFiles.push({
        path: candidate.sourcePath,
        name: candidate.displayName,
        reason: `项目无法读取，已跳过：${error.message}`,
        code: error.code || 'INSPECT_FAILED'
      });
      continue;
    }
    if (minimumBytes > 0 && summary.totalBytes < minimumBytes) {
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
