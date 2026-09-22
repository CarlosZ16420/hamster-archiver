'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireLocalLock } = require('../src/core/local-lock');

test('active local locks remain owned while a proven dead owner can be resumed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-local-lock-'));
  const target = path.join(root, 'task.lock');
  try {
    const release = await acquireLocalLock(target, { task: 'fixture' });
    await assert.rejects(acquireLocalLock(target, { task: 'second' }), /Lock is active/);
    await release();
    await fs.writeFile(target, JSON.stringify({ pid: 2147483647, task: 'interrupted' }));
    const resumed = await acquireLocalLock(target, { task: 'resumed' });
    assert.match(await fs.readFile(target, 'utf8'), /"task":"resumed"/);
    await resumed();
    await fs.writeFile(target, 'unknown owner');
    await assert.rejects(acquireLocalLock(target, { task: 'unsafe' }), /cannot be proved dead/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
