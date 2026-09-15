'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyRuns, parseArgs, waitForReceipt } = require('../scripts/verify-source-ci-receipt');

const commit = 'a'.repeat(40);

test('source CI receipt accepts only Hamster repositories and a bounded wait', () => {
  assert.deepEqual(parseArgs(['--repo', 'CarlosZ16420/hamster-archive', '--wait-seconds', '60']), {
    repo: 'CarlosZ16420/hamster-archive',
    waitSeconds: 60
  });
  assert.throws(() => parseArgs(['--repo', 'owner/repo']), /restricted/);
  assert.throws(() => parseArgs(['--repo', 'CarlosZ16420/hamster-archive', '--wait-seconds', '601']), /between 0 and 600/);
  assert.equal(parseArgs(['--repo', 'CarlosZ16420/hamster-archive']).waitSeconds, 0);
});

test('only a successful CI run for the exact commit is reusable', () => {
  const receipt = classifyRuns([
    { id: 1, head_sha: 'b'.repeat(40), event: 'push', status: 'completed', conclusion: 'success' },
    { id: 2, head_sha: commit, event: 'pull_request', status: 'completed', conclusion: 'failure' },
    { id: 3, head_sha: commit, event: 'push', status: 'completed', conclusion: 'failure' },
    { id: 4, head_sha: commit, event: 'push', status: 'completed', conclusion: 'success', updated_at: '2026-09-15T00:00:00Z' }
  ], commit);
  assert.equal(receipt.successful.id, 4);
  assert.equal(receipt.active, false);
});

test('an exact pull-request commit is also a reusable receipt', () => {
  const receipt = classifyRuns([
    { id: 7, head_sha: commit, event: 'pull_request', status: 'completed', conclusion: 'success' }
  ], commit);
  assert.equal(receipt.successful.id, 7);
});

test('an active exact-commit CI is waited for once and its success is reused', async () => {
  let reads = 0;
  let delays = 0;
  const receipt = await waitForReceipt({
    commit,
    waitSeconds: 60,
    loadRuns: async () => ++reads === 1
      ? [{ id: 5, head_sha: commit, event: 'push', status: 'in_progress', conclusion: null }]
      : [{ id: 5, head_sha: commit, event: 'push', status: 'completed', conclusion: 'success' }],
    delay: async () => { delays += 1; }
  });
  assert.equal(receipt.id, 5);
  assert.equal(reads, 2);
  assert.equal(delays, 1);
});

test('missing or failed exact-commit CI falls back immediately', async () => {
  let delays = 0;
  const receipt = await waitForReceipt({
    commit,
    waitSeconds: 60,
    loadRuns: async () => [{ id: 6, head_sha: commit, event: 'push', status: 'completed', conclusion: 'failure' }],
    delay: async () => { delays += 1; }
  });
  assert.equal(receipt, null);
  assert.equal(delays, 0);
});
