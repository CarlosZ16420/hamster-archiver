'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { CancelledError } = require('./archive-engine-errors');

async function runMediaProcess(executable, args, options = {}) {
  await options.pauseController?.waitIfPaused(options.signal);
  if (options.signal?.aborted) throw new CancelledError();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      options.pauseController?.detach(child.pid);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      child.kill();
      finish(new CancelledError());
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`媒体处理超时：${path.basename(executable)}`));
    }, options.timeoutMs || 90_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (settled) return;
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`${path.basename(executable)} 退出码 ${code}：${stderr.trim().slice(-1000)}`));
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(options.pauseController?.attach(child.pid)).catch((error) => {
      child.kill();
      finish(error);
    });
  });
}

function parseFfmpegProbeOutput(output) {
  const durationMatch = String(output).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const videoLines = String(output).split(/\r?\n/).filter((line) => /Stream #.*Video:/i.test(line));
  const videoLine = videoLines.find((line) => /(?:^|[\s,])(\d{2,6})x(\d{2,6})(?:[\s,\[]|$)/.test(line)) || videoLines[0] || '';
  const resolutionMatch = videoLine.match(/(?:^|[\s,])(\d{2,6})x(\d{2,6})(?:[\s,\[]|$)/);
  const codecMatch = videoLine.match(/Video:\s*([^\s,(]+)/i);
  const pixelFormatMatch = videoLine.match(/Video:\s*[^,]+,\s*([^\s,(]+)/i);
  const frameRateMatch = videoLine.match(/(\d+(?:\.\d+)?)\s+(?:fps|tbr)\b/i);
  const containerMatch = String(output).match(/Input #0,\s*(.+?),\s+from\s+/i);
  const durationSeconds = durationMatch
    ? (Number(durationMatch[1]) * 3600) + (Number(durationMatch[2]) * 60) + Number(durationMatch[3])
    : NaN;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !resolutionMatch) return null;
  return {
    durationSeconds,
    width: Number(resolutionMatch[1]) || null,
    height: Number(resolutionMatch[2]) || null,
    codec: codecMatch?.[1] || '',
    pixelFormat: pixelFormatMatch?.[1] || '',
    averageFrameRate: frameRateMatch?.[1] || '',
    container: containerMatch?.[1]?.trim() || ''
  };
}

async function probeVideo(sourcePath, config, options = {}) {
  const result = await runMediaProcess(config.ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'info',
    '-i', sourcePath,
    '-map', '0:v:0',
    '-frames:v', '0',
    '-f', 'null', '-'
  ], { ...options, timeoutMs: 30_000 });
  const output = `${result.stderr}\n${result.stdout}`;
  const parsed = parseFfmpegProbeOutput(output);
  if (!parsed) {
    options.onLog?.(`FFmpeg 探测失败：${path.basename(sourcePath)}；未能从固定版本输出中解析时长或分辨率。`, 'warning');
    throw new Error('FFmpeg 无法读取有效的视频时长或画面尺寸。');
  }
  const stats = await fs.stat(sourcePath);
  options.onLog?.(`FFmpeg 探测成功：${path.basename(sourcePath)} · ${parsed.width}×${parsed.height} · ${parsed.durationSeconds.toFixed(2)} 秒。`, 'info');
  return { ...parsed, bytes: stats.size };
}

async function extractVideoFrames(sourcePath, outputDirectory, outputStartIndex, requestedCount, config, options = {}) {
  const mediaInfo = await probeVideo(sourcePath, config, options);
  const count = Math.max(1, Math.min(20, Number(requestedCount) || 3));
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    await options.pauseController?.waitIfPaused(options.signal);
    const timeSeconds = mediaInfo.durationSeconds * ((index + 1) / (count + 1));
    const fileName = `${String(outputStartIndex + index + 1).padStart(3, '0')}.jpg`;
    const thumbnailPath = path.join(outputDirectory, fileName);
    await runMediaProcess(config.ffmpegPath, [
      '-v', 'error',
      '-ss', timeSeconds.toFixed(3),
      '-i', sourcePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', 'scale=360:240:force_original_aspect_ratio=decrease,pad=360:240:(ow-iw)/2:(oh-ih)/2:color=0x181715',
      '-q:v', '3',
      '-y', thumbnailPath
    ], options);
    const stats = await fs.stat(thumbnailPath);
    frames.push({
      thumbnailPath,
      size: stats.size,
      type: 'video-frame',
      frameIndex: index,
      timeSeconds,
      durationSeconds: mediaInfo.durationSeconds
    });
  }
  return { frames, mediaInfo };
}

module.exports = { extractVideoFrames, parseFfmpegProbeOutput, probeVideo, runMediaProcess };
