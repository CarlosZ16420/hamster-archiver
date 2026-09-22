'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const RECORD_NAME = 'snapshot-source.json';
function digestEntries(entries) {
  const hash = crypto.createHash('sha256');
  for (const entry of entries.filter(item => item.name !== RECORD_NAME).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.mode === '120000' || entry.stage !== '0') throw new Error(`Snapshot contains a symlink or conflict: ${entry.name}`);
    hash.update(`${entry.mode}\0${entry.oid}\0${entry.name}\0`);
  }
  return hash.digest('hex');
}
function snapshotDigest(root) {
  const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' });
  const entries = index.split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) (\d)\t(.+)$/.exec(line);
    if (!match) throw new Error('Invalid Git index entry in snapshot.');
    return { mode: match[1], oid: match[2], stage: match[3], name: match[4] };
  });
  return digestEntries(entries);
}
function verifySnapshotRecord(root) {
  const record = JSON.parse(fs.readFileSync(path.join(root, RECORD_NAME), 'utf8'));
  if (record.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(record.privateSourceCommit) ||
      !/^[a-f0-9]{64}$/.test(record.exportDigest) || record.exportDigest !== snapshotDigest(root)) {
    throw new Error('Public snapshot source record or normalized export digest is invalid.');
  }
  return record;
}
module.exports = { RECORD_NAME, digestEntries, snapshotDigest, verifySnapshotRecord };
