'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createThumbnails } = require('../src/core/thumbnail-service');

async function fixture(t, count) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-thumbnails-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    job: { id: 'job', sourceType: 'folder', sourcePath: root },
    manifest: Array.from({ length: count }, (_, index) => ({ name: `${index}.png`, relativePath: `${index}.png`, extension: '.png' })),
    config: { repositoryDirectory: root, thumbnailLimit: 3 }
  };
}

test('thumbnail concurrency is bounded and respects successful output limit with failures', async (t) => {
  const { job, manifest, config } = await fixture(t, 8);
  let active = 0;
  let maximum = 0;
  const image = {
    async createThumbnailFromPath(source) {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { isEmpty: () => path.basename(source) === '0.png', toPNG: () => Buffer.from('preview') };
    }
  };
  await createThumbnails(job, manifest, config, {}, image);
  const outputs = manifest.filter((file) => file.thumbnailPath);
  assert.equal(maximum, 2);
  assert.equal(outputs.length, 3);
  assert.equal(new Set(outputs.map((file) => file.thumbnailPath)).size, 3);
  assert.deepEqual(outputs.map((file) => file.name), ['1.png', '2.png', '3.png']);
  for (const file of outputs) assert.equal(await fs.readFile(file.thumbnailPath, 'utf8'), 'preview');
});

test('thumbnail failures have a bounded attempt budget', async (t) => {
  const { job, manifest, config } = await fixture(t, 100);
  let attempts = 0;
  const logs = [];
  await createThumbnails(job, manifest, config, { onLog: (message) => logs.push(message) }, {
    async createThumbnailFromPath() { attempts += 1; return { isEmpty: () => true }; }
  });
  assert.equal(attempts, 30);
  assert.ok(logs.some((message) => message.includes('尝试达到上限')));
});

test('cancellation drains pending image work before rollback can start', async (t) => {
  const { job, manifest, config } = await fixture(t, 8);
  const abort = new AbortController();
  let completed = 0;
  await assert.rejects(createThumbnails(job, manifest, config, { signal: abort.signal }, {
    async createThumbnailFromPath(source) {
      if (path.basename(source) === '0.png') abort.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      completed += 1;
      return { isEmpty: () => false, toPNG: () => Buffer.from('preview') };
    }
  }), { code: 'TASK_CANCELLED' });
  assert.equal(completed, 2);
  assert.equal(manifest.filter((file) => file.thumbnailPath).length, 0);
});

test('incremental refresh keeps existing previews and does not reread unchanged media', async (t) => {
  const { job, manifest, config } = await fixture(t, 3);
  manifest[0].thumbnailPath = 'existing-preview.png';
  manifest[0].thumbnails = [{ thumbnailPath: 'existing-preview.png', type: 'image' }];
  await fs.mkdir(path.join(config.repositoryDirectory, 'thumbnails'), { recursive: true });
  await fs.writeFile(path.join(config.repositoryDirectory, 'thumbnails', 'existing-preview.png'), 'cached');
  manifest[1].sourceMetadataUnchanged = true;
  const attempts = [];

  await createThumbnails(job, manifest, config, {}, {
    async createThumbnailFromPath(source) {
      attempts.push(path.basename(source));
      return { isEmpty: () => false, toPNG: () => Buffer.from('preview') };
    }
  });

  assert.deepEqual(attempts, ['2.png']);
  assert.equal(manifest[0].thumbnailPath, 'existing-preview.png');
  assert.equal(manifest[1].thumbnailPath, undefined);
  assert.ok(manifest[2].thumbnailPath);
});

test('incremental refresh repairs a missing cache only for that media', async (t) => {
  const { job, manifest, config } = await fixture(t, 1);
  manifest[0].sourceMetadataUnchanged = true;
  manifest[0].thumbnailPath = 'missing-preview.png';
  let attempts = 0;
  await createThumbnails(job, manifest, config, {}, {
    async createThumbnailFromPath() {
      attempts += 1;
      return { isEmpty: () => false, toPNG: () => Buffer.from('replacement') };
    }
  });
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(manifest[0].thumbnailPath, 'utf8'), 'replacement');
});

test('source changes during preview processing are fatal rather than decode warnings', async (t) => {
  const { job, manifest, config } = await fixture(t, 1);
  const source = path.join(job.sourcePath, manifest[0].relativePath);
  await fs.writeFile(source, 'original');
  const stats = await fs.stat(source);
  Object.assign(manifest[0], { size: stats.size, modifiedAtMs: stats.mtimeMs });
  const logs = [];
  await assert.rejects(createThumbnails(job, manifest, config, { onLog: (message) => logs.push(message) }, {
    async createThumbnailFromPath() {
      await fs.writeFile(source, 'new contents with different size');
      return { isEmpty: () => false, toPNG: () => Buffer.from('stale-preview') };
    }
  }), { code: 'SOURCE_CHANGED' });
  assert.deepEqual(logs, []);
});
