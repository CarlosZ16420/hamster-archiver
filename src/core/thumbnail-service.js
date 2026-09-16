'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { IMAGE_EXTENSIONS, isVideoFile } = require('./constants');
const { CancelledError } = require('./archive-engine-errors');
const { extractVideoFrames } = require('./media-service');

async function createThumbnails(job, manifest, config, options = {}, nativeImage) {
  const thumbnailDir = path.join(config.repositoryDirectory, 'thumbnails', job.id);
  await fs.mkdir(thumbnailDir, { recursive: true });
  const limit = Math.max(1, Math.min(500, Number(config.thumbnailLimit) || 100));
  const candidates = manifest.filter((file) => IMAGE_EXTENSIONS.has(file.extension) || isVideoFile(file.name));
  const attemptLimit = Math.max(30, limit * 3);
  let outputCount = 0;
  let processed = 0;
  let nextFileIndex = 0;
  const report = (file, frame, frameCount) => options.onProgress?.({
    processed, total: Math.min(candidates.length, attemptLimit), outputCount,
    name: file?.name || '', frame, frameCount
  });
  const check = async () => {
    await options.pauseController?.waitIfPaused(options.signal);
    if (options.signal?.aborted) throw new CancelledError();
  };
  const processFile = async (file, startIndex, frameCount = 0) => {
    await check();
    report(file);
    const sourcePath = job.sourceType === 'video' ? job.sourcePath
      : path.join(job.sourcePath, ...file.relativePath.split('/'));
    try {
      if (frameCount) {
        let extracted = { frames: [], mediaInfo: null };
        try {
          extracted = await extractVideoFrames(sourcePath, thumbnailDir, startIndex, frameCount, config, {
            ...options, onFrameProgress: (frame, count) => report(file, frame, count)
          });
        } catch (error) {
          if (error instanceof CancelledError || options.signal?.aborted) throw error;
          options.onLog?.(`FFmpeg 视频抽帧失败，改用系统缩略图：${path.basename(sourcePath)} · ${error.message}`);
        }
        file.mediaInfo = extracted.mediaInfo;
        file.thumbnails = extracted.frames.map((frame) => ({ ...frame, videoGroup: file.relativePath }));
        if (file.thumbnails.length) {
          file.thumbnailPath = file.thumbnails[0].thumbnailPath;
          return file.thumbnails.length;
        }
      }
      await check();
      const startedAt = Date.now();
      try {
        const thumbnail = await nativeImage.createThumbnailFromPath(sourcePath, { width: 360, height: 240 });
        if (options.signal?.aborted) throw new CancelledError();
        if (thumbnail.isEmpty()) return 0;
        const thumbnailPath = path.join(thumbnailDir, `${String(startIndex + 1).padStart(3, '0')}.png`);
        await fs.writeFile(thumbnailPath, thumbnail.toPNG());
        file.thumbnailPath = thumbnailPath;
        file.thumbnails = [{ thumbnailPath, type: 'image', frameIndex: null }];
        return 1;
      } finally {
        options.onTiming?.('system-thumbnail', Date.now() - startedAt);
      }
    } catch (error) {
      if (error instanceof CancelledError || options.signal?.aborted) throw error;
      options.onLog?.(`已跳过无法生成预览的媒体：${path.basename(sourcePath)} · ${error.message}`);
      return 0;
    }
  };

  // Reserve names and output slots before dispatch. Drain both image tasks even
  // on cancellation so rollback cannot race a pending thumbnail write.
  await check();
  for (let cursor = 0; cursor < candidates.length && processed < attemptLimit && outputCount < limit;) {
    await check();
    const batch = [];
    do {
      const file = candidates[cursor];
      const video = isVideoFile(file.name) && config.videoFrameBackup;
      if (video && batch.length) break;
      const frameCount = video ? Math.max(1, Math.min(20, Number(config.videoFrameCount) || 6, limit - outputCount)) : 0;
      const startIndex = nextFileIndex;
      nextFileIndex += frameCount || 1;
      batch.push(processFile(file, startIndex, frameCount));
      cursor += 1;
      if (video) break;
    } while (batch.length < Math.min(2, limit - outputCount, attemptLimit - processed) && cursor < candidates.length);
    const results = await Promise.allSettled(batch);
    processed += batch.length;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    await check();
    outputCount += results.reduce((sum, result) => sum + result.value, 0);
    report();
  }
  if (processed >= attemptLimit && processed < candidates.length && outputCount < limit) {
    options.onLog?.(`缩略图尝试达到上限，保留已生成的预览：${processed}/${candidates.length}`, 'warning');
  }
  return manifest;
}

module.exports = { createThumbnails };
