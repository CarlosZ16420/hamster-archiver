'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { catalogRangeSelection, catalogMarqueeSelection } = require('../src/renderer/ui-state');

test('Shift ranges follow page order in either direction and exclude other pages', () => {
  const page = ['third', 'first', 'second', 'fourth'];
  const original = new Set(['other-page']);
  assert.deepEqual([...catalogRangeSelection(page, 'second', 'third', original)], ['third', 'first', 'second']);
  assert.deepEqual([...catalogRangeSelection(page, 'first', 'fourth', original, true)], ['other-page', 'first', 'second', 'fourth']);
  assert.deepEqual([...catalogRangeSelection(page, 'other-page', 'first', original)], ['first']);
  assert.deepEqual([...catalogRangeSelection(page, 'first', 'missing', original)], ['other-page']);
  assert.deepEqual([...original], ['other-page']);
});

test('Ctrl marquee toggles against the initial snapshot rather than each move', () => {
  const original = new Set(['first', 'other-page']);
  const firstMove = catalogMarqueeSelection(original, ['first', 'second'], 'toggle');
  const repeatedMove = catalogMarqueeSelection(original, ['first', 'second'], 'toggle');
  assert.deepEqual([...firstMove], ['other-page', 'second']);
  assert.deepEqual(repeatedMove, firstMove);
  assert.deepEqual([...catalogMarqueeSelection(original, ['second'], 'toggle')], ['first', 'other-page', 'second']);
  assert.deepEqual([...catalogMarqueeSelection(original, [], 'toggle')], ['first', 'other-page']);
  assert.deepEqual([...original], ['first', 'other-page']);
});

test('plain marquee replaces cross-page selection, Shift adds, and empty hits clear only in replace mode', () => {
  const original = new Set(['other-page']);
  assert.deepEqual([...catalogMarqueeSelection(original, ['current-page'], 'replace')], ['current-page']);
  assert.deepEqual([...catalogMarqueeSelection(original, ['current-page'], 'add')], ['other-page', 'current-page']);
  assert.equal(catalogMarqueeSelection(original, [], 'replace').size, 0);
  assert.deepEqual([...catalogMarqueeSelection(original, [], 'add')], ['other-page']);
});
