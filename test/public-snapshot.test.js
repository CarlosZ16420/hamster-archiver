'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { snapshotSourceFromCommitMessage } = require('../scripts/sync-public-snapshot');

test('public snapshot commit messages expose their exact private source commit', () => {
  assert.equal(
    snapshotSourceFromCommitMessage('Snapshot 4ee23a155c22: release: prepare Hamster Archiver 4.6.8\n'),
    '4ee23a155c22'
  );
  assert.equal(snapshotSourceFromCommitMessage('ordinary public commit'), '');
});
