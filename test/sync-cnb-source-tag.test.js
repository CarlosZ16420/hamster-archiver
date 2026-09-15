'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureCnbSourceTag, remoteTagCommit, validateConfig } = require('../scripts/sync-cnb-source-tag');

const tag = 'v4.6.8';
const commit = '0dbb43024b80282c8b23608b1695db1d7a1f4ff5';
const config = {
  tag,
  githubRepo: 'CarlosZ16420/hamster-archiver',
  cnbRepo: 'carlosz16420/hamster-archive',
  token: 'secret'
};

test('CNB source tag configuration accepts only the public snapshot route', () => {
  assert.equal(validateConfig(config, { CNB_SYNC_ENABLED: 'true', CNB_TOKEN: 'secret' }).cnbRepo, config.cnbRepo);
  assert.throws(() => validateConfig({ ...config, githubRepo: 'CarlosZ16420/hamster-archive' }, {
    CNB_SYNC_ENABLED: 'true', CNB_TOKEN: 'secret'
  }), /public Hamster GitHub snapshot/);
  assert.throws(() => validateConfig(config, { CNB_SYNC_ENABLED: 'true' }), /CNB_TOKEN/);
});

test('remote tag parsing prefers the peeled commit for annotated tags', () => {
  assert.equal(remoteTagCommit(`${'a'.repeat(40)}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}`, tag), commit);
  assert.equal(remoteTagCommit(`${commit}\trefs/tags/${tag}`, tag), commit);
});

function runnerWithCnbState(initial) {
  let cnbCommit = initial;
  const runner = args => {
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'ls-remote' && args[1].includes('github.com')) return `${commit}\trefs/tags/${tag}`;
    if (args[0] === 'ls-remote' && args[1].includes('cnb.cool')) {
      return cnbCommit ? `${cnbCommit}\trefs/tags/${tag}` : '';
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  return { runner, setCnbCommit: value => { cnbCommit = value; } };
}

test('an existing matching CNB tag is reused without a push', async () => {
  const state = runnerWithCnbState(commit);
  let pushes = 0;
  const result = await ensureCnbSourceTag(config, {
    gitRunner: state.runner,
    pushTag: async () => { pushes += 1; }
  });
  assert.equal(result.created, false);
  assert.equal(pushes, 0);
});

test('a missing CNB tag is pushed once and must match on read-back', async () => {
  const state = runnerWithCnbState('');
  let pushes = 0;
  const result = await ensureCnbSourceTag(config, {
    gitRunner: state.runner,
    pushTag: async () => { pushes += 1; state.setCnbCommit(commit); }
  });
  assert.equal(result.created, true);
  assert.equal(pushes, 1);
});

test('a conflicting CNB tag stops without overwriting it', async () => {
  const state = runnerWithCnbState('f'.repeat(40));
  let pushes = 0;
  await assert.rejects(() => ensureCnbSourceTag(config, {
    gitRunner: state.runner,
    pushTag: async () => { pushes += 1; }
  }), /different commit/);
  assert.equal(pushes, 0);
});
