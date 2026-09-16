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
