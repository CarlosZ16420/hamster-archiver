'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { extractVideoFrames, parseFfmpegProbeOutput, probeVideo } = require('../src/core/media-service');

test('FFmpeg probe parser tolerates extra stream metadata and tbr frame rates', () => {
  const parsed = parseFfmpegProbeOutput([
    "Input #0, matroska,webm, from 'sample.mkv':",
    '  Duration: 01:02:03.45, start: 0.000000, bitrate: 5000 kb/s',
    '  Stream #0:2(jpn): Video: hevc (Main 10), yuv420p10le(tv), 1920x1080 [SAR 1:1 DAR 16:9], 23.98 tbr'
  ].join('\n'));
  assert.equal(parsed.width, 1920);
  assert.equal(parsed.height, 1080);
  assert.equal(parsed.codec, 'hevc');
  assert.equal(parsed.averageFrameRate, '23.98');
  assert.ok(parsed.durationSeconds > 3723);
});

const ffmpegPath = path.resolve(__dirname, '..', 'tools', 'ffmpeg', 'ffmpeg.exe');

test('portable FFmpeg probes video metadata and extracts evenly spaced JPEG thumbnails', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(ffmpegPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'sample.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-t', '4', '-pix_fmt', 'yuv420p', '-y', videoPath
  ], { windowsHide: true, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);

  const config = { ffmpegPath };
  const logs = [];
  const info = await probeVideo(videoPath, config, {
    onLog: (message, level) => logs.push({ message, level })
  });
  assert.equal(info.width, 640);
  assert.equal(info.height, 360);
  assert.ok(info.durationSeconds >= 3.9);
  assert.ok(logs.some((entry) => entry.level === 'info' && entry.message.startsWith('FFmpeg 探测成功')));
  const result = await extractVideoFrames(videoPath, root, 0, 3, config);
  assert.equal(result.frames.length, 3);
  assert.ok(result.frames[0].timeSeconds < result.frames[1].timeSeconds);
  assert.ok(result.frames[1].timeSeconds < result.frames[2].timeSeconds);
  for (const frame of result.frames) {
    assert.equal(path.extname(frame.thumbnailPath), '.jpg');
    assert.ok((await fs.stat(frame.thumbnailPath)).size > 0);
  }
});
