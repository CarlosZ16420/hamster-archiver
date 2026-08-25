'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeThumbnailReferences,
  resolveThumbnailReference,
  thumbnailReferenceForStorage
} = require('../src/core/warehouse-paths');

test('thumbnail references are stored relative to the warehouse', () => {
  const warehouse = path.resolve('E:\\current\\warehouse');
  assert.equal(
    thumbnailReferenceForStorage(warehouse, path.join(warehouse, 'thumbnails', 'job-one', 'cover.png')),
    'job-one/cover.png'
  );
  assert.equal(
    thumbnailReferenceForStorage(warehouse, 'D:\\old-app\\userdata\\warehouse\\thumbnails\\job-one\\cover.png'),
    'job-one/cover.png'
  );
  assert.equal(thumbnailReferenceForStorage(warehouse, 'thumbnails/job-one/cover.png'), 'job-one/cover.png');
  assert.equal(thumbnailReferenceForStorage(warehouse, 'job-one\\cover.png'), 'job-one/cover.png');
});

test('thumbnail references resolve against the current warehouse after a move', () => {
  const warehouse = path.resolve('E:\\moved\\warehouse');
  assert.equal(
    resolveThumbnailReference(warehouse, 'job-one/cover.png'),
    path.resolve(warehouse, 'thumbnails', 'job-one', 'cover.png')
  );
  assert.equal(
    resolveThumbnailReference(warehouse, 'D:\\old\\warehouse\\thumbnails\\job-one\\cover.png'),
    path.resolve(warehouse, 'thumbnails', 'job-one', 'cover.png')
  );
});

test('thumbnail normalization touches only thumbnailPath fields', () => {
  const warehouse = path.resolve('E:\\new\\warehouse');
  const record = {
    sourcePath: 'D:\\old\\warehouse\\thumbnails\\source-kept.txt',
    archiveDirectory: 'D:\\old\\archives',
    manifest: [{
      thumbnailPath: 'D:\\old\\warehouse\\thumbnails\\job-one\\cover.png',
      thumbnails: [{ thumbnailPath: 'job-one\\second.png' }]
    }]
  };
  const result = normalizeThumbnailReferences(record, warehouse, { strict: true });
  assert.equal(result.changed, 2);
  assert.equal(record.manifest[0].thumbnailPath, 'job-one/cover.png');
  assert.equal(record.manifest[0].thumbnails[0].thumbnailPath, 'job-one/second.png');
  assert.equal(record.sourcePath, 'D:\\old\\warehouse\\thumbnails\\source-kept.txt');
  assert.equal(record.archiveDirectory, 'D:\\old\\archives');
});

test('unsafe or unrelated thumbnail references are rejected', () => {
  const warehouse = path.resolve('E:\\warehouse');
  for (const value of [
    '..\\outside.png',
    'job\\..\\outside.png',
    'D:\\unrelated\\outside.png',
    'thumbnails',
    'E:\\warehouse\\thumbnails'
  ]) {
    assert.throws(
      () => thumbnailReferenceForStorage(warehouse, value),
      (error) => error.code === 'INVALID_THUMBNAIL_REFERENCE'
    );
  }
});
