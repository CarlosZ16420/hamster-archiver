'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { findExactFileMatches } = require('../src/core/sqlite-repository');

test('exact file lookup excludes self before ranking and reads each project JSON once', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE catalog_records(id TEXT PRIMARY KEY, display_name TEXT, record_json TEXT); CREATE TABLE catalog_files(record_id TEXT, ordinal INTEGER, relative_path TEXT, md5 TEXT, size INTEGER); CREATE INDEX exact ON catalog_files(md5,size)');
    const md5 = 'a'.repeat(32);
    for (const id of ['a-self', 'b-other']) {
      db.prepare('INSERT INTO catalog_records VALUES(?,?,?)').run(id, id, JSON.stringify({ archiveBaseName: `${id}.7z`, padding: 'x'.repeat(500000) }));
      for (let index = 0; index < 6; index++) db.prepare('INSERT INTO catalog_files VALUES(?,?,?,?,?)').run(id, index, `file-${index}`, md5, 8);
    }
    let metadataReads = 0;
    const wrapper = { prepare(sql) {
      const statement = db.prepare(sql);
      if (sql.startsWith('SELECT display_name')) return { get(...args) { metadataReads++; return statement.get(...args); } };
      return statement;
    } };
    const manifest = Array.from({ length: 401 }, (_, index) => ({ relativePath: `source-${index}`, md5, size: 8 }));
    const matches = findExactFileMatches(wrapper, manifest, 401, 'a-self');
    assert.equal(matches.length, 401);
    assert.equal(metadataReads, 1);
    assert.equal(matches[400].previous.length, 5);
    assert.equal(matches[0].previous.every((item) => item.archiveId === 'b-other'), true);
    assert.equal(matches[0].previous[0].archiveName, 'b-other.7z');
    assert.equal(findExactFileMatches(db, [{ relativePath: 'bad', md5: '', size: 8 }]).length, 0);
  } finally { db.close(); }
});
