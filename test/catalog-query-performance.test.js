'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { QueueManager } = require('../src/core/queue-manager');
const { findCatalogIdsByMd5, findCatalogIdsBySearchTerms, findExactFileMatches } = require('../src/core/sqlite-repository');

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

test('Warehouse search includes matches beyond the first 2000 indexed records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE catalog_search_terms(record_id TEXT, term TEXT); CREATE TABLE catalog_files(record_id TEXT, md5 TEXT)');
    const insertTerm = db.prepare('INSERT INTO catalog_search_terms VALUES(?, ?)');
    const insertFile = db.prepare('INSERT INTO catalog_files VALUES(?, ?)');
    const md5 = 'a'.repeat(32);
    const catalog = [];
    db.exec('BEGIN');
    for (let index = 0; index < 2001; index += 1) {
      const id = String(index);
      insertTerm.run(id, 'char:c');
      insertFile.run(id, md5);
      catalog.push({ id, title: `common ${index}`, manifest: [{ relativePath: 'shared.bin', md5, size: 1 }] });
    }
    db.exec('COMMIT');
    const manager = new QueueManager({
      findCatalogIdsBySearchTerms: (_directory, terms, limit) => findCatalogIdsBySearchTerms(db, terms, limit),
      findCatalogIdsByMd5: (_directory, value, limit) => findCatalogIdsByMd5(db, value, limit)
    }, { repositoryDirectory: 'E:\\warehouse' });
    manager.catalog = catalog;

    assert.equal(manager.searchCatalog('common').length, 2001);
    assert.equal(manager.searchCatalog(md5).length, 2001);
    assert.equal(findCatalogIdsBySearchTerms(db, ['char:c'], 200).length, 200);
  } finally { db.close(); }
});
