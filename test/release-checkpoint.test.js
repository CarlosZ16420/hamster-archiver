'use strict';

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { openCheckpoint, runStage } = require('../scripts/release-checkpoint');

test('successful release stages are reused and failed stages alone are retried', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hamster-release-checkpoint-'));
  const layout = { releaseRunsRoot: path.join(root, 'runs') };
  try {
    const checkpoint = await openCheckpoint({ version: '9.9.9', commit: 'a'.repeat(40) }, { layout });
    let builds = 0;
    await runStage(checkpoint, 'build', async () => ({ artifact: 'app' }));
    await runStage(checkpoint, 'build', async () => { builds += 1; });
    assert.equal(builds, 0);

    await assert.rejects(runStage(checkpoint, 'smoke', async () => { throw new Error('temporary'); }), /temporary/);
    await runStage(checkpoint, 'smoke', async () => ({ ok: true }));
    assert.equal(checkpoint.state.stages.build.attempts, 1);
    assert.equal(checkpoint.state.stages.smoke.attempts, 2);
    assert.equal(checkpoint.state.stages.smoke.status, 'success');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
