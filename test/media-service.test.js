'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { extractVideoFrames, parseFfmpegProbeOutput, probeVideo, runMediaProcess } = require('../src/core/media-service');

test('media timeout excludes paused time and cancellation waits for child close', async () => {
  const pauseController = { paused: true, waitIfPaused: async () => {}, attach: async () => {}, detach: () => {} };
  const timer = setTimeout(() => { pauseController.paused = false; }, 300);
  try {
    const result = await runMediaProcess(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 350)'], {
      timeoutMs: 200, pauseController
    });
    assert.ok(result.activeElapsedMs < 200);
  } finally { clearTimeout(timer); }
  const abort = new AbortController();
  let detached = false;
  await assert.rejects(runMediaProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    signal: abort.signal,
    pauseController: { waitIfPaused: async () => {}, attach: async () => { abort.abort(); }, detach: () => { detached = true; } }
  }), { code: 'TASK_CANCELLED' });
  assert.equal(detached, true);
});

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

test('video frame failures preserve successes, unique names and a total processing budget', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-partial-frames-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'sample.mp4');
  await fs.writeFile(source, 'fixture');
  let frameCalls = 0;
  let probeCalls = 0;
  const result = await extractVideoFrames(source, root, 0, 10, { ffmpegPath: 'fixture' }, {
    async runProcess(_executable, args, options) {
      if (args.includes('null')) {
        probeCalls += 1;
        return { stdout: '', stderr: 'Duration: 00:01:00.00\nStream #0:0: Video: h264, yuv420p, 640x360, 24 fps', activeElapsedMs: 1 };
      }
      frameCalls += 1;
      assert.ok(options.timeoutMs <= 30_000);
      if (frameCalls === 2) throw Object.assign(new Error('bad frame'), { activeElapsedMs: 30_000 });
      await fs.writeFile(args.at(-1), 'frame');
      return { activeElapsedMs: 30_000 };
    }
  });
  assert.equal(probeCalls, 1);
  assert.equal(frameCalls, 4);
  assert.equal(result.frames.length, 3);
  assert.deepEqual(result.frames.map((frame) => frame.frameIndex), [0, 2, 3]);
  assert.deepEqual(result.frames.map((frame) => path.basename(frame.thumbnailPath)), ['001.jpg', '002.jpg', '003.jpg']);
});

function readImageDimensions(imagePath) {
  const inspected = spawnSync(ffmpegPath, [
    '-hide_banner', '-i', imagePath, '-map', '0:v:0', '-frames:v', '0', '-f', 'null', '-'
  ], { windowsHide: true, encoding: 'utf8' });
  assert.equal(inspected.status, 0, inspected.stderr);
  const videoLine = inspected.stderr.split(/\r?\n/).find((line) => /Stream #.*Video:/i.test(line)) || '';
  const match = videoLine.match(/(?:^|[\s,])(\d{2,6})x(\d{2,6})(?:[\s,\[]|$)/);
  assert.ok(match, `Could not read thumbnail dimensions from: ${videoLine}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

test('portable FFmpeg extracts evenly spaced JPEG thumbnails without baked-in letterboxing', {
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
    const dimensions = readImageDimensions(frame.thumbnailPath);
    assert.equal(dimensions.width, 360);
    assert.ok(dimensions.height < 240);
    assert.ok(Math.abs((dimensions.width / dimensions.height) - (16 / 9)) < 0.02);
  }

  const portraitVideoPath = path.join(root, 'portrait.mp4');
  const generatedPortrait = spawnSync(ffmpegPath, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24',
    '-t', '1', '-pix_fmt', 'yuv420p', '-y', portraitVideoPath
  ], { windowsHide: true, encoding: 'utf8' });
  assert.equal(generatedPortrait.status, 0, generatedPortrait.stderr);
  const portrait = await extractVideoFrames(portraitVideoPath, root, 3, 1, config);
  const portraitDimensions = readImageDimensions(portrait.frames[0].thumbnailPath);
  assert.equal(portraitDimensions.height, 240);
  assert.ok(portraitDimensions.width < 360);
  assert.ok(Math.abs((portraitDimensions.width / portraitDimensions.height) - (9 / 16)) < 0.02);
});
