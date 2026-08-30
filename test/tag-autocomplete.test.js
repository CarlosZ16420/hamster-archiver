'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  completeTagValue,
  findTagSuggestions,
  splitActiveTag
} = require('../src/renderer/tag-autocomplete');

const existingTags = ['和尚', '大美女', '大美人', '旅行摄影', 'Travel'];

test('tag suggestions match only the active comma-separated segment', () => {
  assert.deepEqual(findTagSuggestions('大', existingTags), ['大美女', '大美人']);
  assert.deepEqual(findTagSuggestions('和尚，大', existingTags), ['大美女', '大美人']);
  assert.deepEqual(findTagSuggestions('和尚, 大', existingTags), ['大美女', '大美人']);
});

test('tag suggestions exclude tags already entered with Chinese or English commas', () => {
  assert.deepEqual(findTagSuggestions('大美女，大', existingTags), ['大美人']);
  assert.deepEqual(findTagSuggestions('大美女,大', existingTags), ['大美人']);
  assert.deepEqual(findTagSuggestions('travel', existingTags), []);
});

test('Tab completion replacement preserves the existing separator and spacing', () => {
  assert.equal(completeTagValue('和尚，大', '大美女'), '和尚，大美女');
  assert.equal(completeTagValue('和尚, 大', '大美女'), '和尚, 大美女');
  assert.deepEqual(splitActiveTag('和尚，大'), {
    prefix: '和尚，',
    leadingWhitespace: '',
    query: '大',
    completedTags: ['和尚']
  });
});
