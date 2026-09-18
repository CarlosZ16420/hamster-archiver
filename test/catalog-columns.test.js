'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  columns, defaultWidths, normalizeRatios, visibleColumns, fitWidths, resizeWidths
} = require('../src/renderer/catalog-columns');
const i18n = require('../src/renderer/i18n');

const total = widths => Object.values(widths).reduce((sum, width) => sum + width, 0);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
const defaultTableWidth = 48 + columns.length * 20 + total(defaultWidths);

test('defaults reproduce the chosen ratios and discard legacy trailing filler', () => {
  const fitted = fitWidths(columns, {}, defaultTableWidth);
  assert.equal(fitted.gutter, 20);
  for (const { key } of columns) near(fitted.widths[key], defaultWidths[key]);
  const legacy = { ...defaultWidths, rating: 706 };
  assert.deepEqual(fitWidths(columns, normalizeRatios(legacy), defaultTableWidth), fitted);
  assert.deepEqual(normalizeRatios({ title: '293', type: NaN, number: -1, status: Infinity, tags: 214, unknown: 100 }), { tags: 214 });
  assert.deepEqual(normalizeRatios([]), {});
});

test('growth borrows from following editable columns without moving the final column', () => {
  const resized = resizeWidths(columns, defaultWidths, 'title', 150);
  assert.equal(resized.title, 443);
  assert.equal(resized.type, 40);
  assert.equal(resized.number, 32);
  assert.equal(resized.tags, 69);
  assert.equal(resized.rating, 64);
  near(total(resized), total(defaultWidths));
  assert.deepEqual(defaultWidths, { title: 293, type: 40, number: 37, status: 72, tags: 214, backup: 168, date: 97, rating: 64 });
});

test('extreme drags stop at minimum widths and the final boundary is immutable', () => {
  const wide = resizeWidths(columns, defaultWidths, 'title', 100000);
  for (const column of columns.slice(1, -1)) near(wide[column.key], column.min);
  near(total(wide), total(defaultWidths));
  assert.equal(wide.rating, defaultWidths.rating);
  const narrow = resizeWidths(columns, defaultWidths, 'title', -100000);
  assert.equal(narrow.title, 140);
  assert.equal(narrow.type, 193);
  near(total(narrow), total(defaultWidths));
  assert.deepEqual(resizeWidths(columns, defaultWidths, 'date', 100000), defaultWidths);
  assert.deepEqual(resizeWidths(columns, defaultWidths, 'rating', -100000), defaultWidths);
});

test('every responsive layout fits its container through repeated resizes and extreme gestures', () => {
  for (const viewport of [640, 980, 1280]) {
    const visible = visibleColumns(viewport);
    const last = visible.at(-1).key;
    for (let width = 180; width <= 1900; width += 29) {
      const fitted = fitWidths(visible, { title: 10000, status: 0.001, rating: 10000 }, width);
      const budget = width - 48 - visible.length * fitted.gutter;
      near(total(fitted.widths), budget);
      assert.ok(Object.values(fitted.widths).every(value => value >= 0 && Number.isFinite(value)));
      let current = fitted.widths;
      for (const column of visible) {
        for (const delta of [100000, -100000, 17, -31]) {
          const next = resizeWidths(visible, current, column.key, delta);
          near(total(next), budget);
          near(next[last], fitted.widths[last]);
          assert.ok(Object.values(next).every(value => value >= 0));
          current = next;
        }
      }
    }
  }
});

test('saved ratios reproduce the same layout and adapt to a new container', () => {
  const initial = fitWidths(columns, {}, 1440).widths;
  const adjusted = resizeWidths(columns, initial, 'status', 80);
  const restored = fitWidths(columns, normalizeRatios(adjusted), 1440).widths;
  for (const { key } of columns) near(restored[key], adjusted[key]);
  const larger = fitWidths(columns, normalizeRatios(adjusted), 1800).widths;
  near(larger.rating, 64);
  near(larger.title / larger.tags, adjusted.title / adjusted.tags);
  near(total(larger), 1800 - 48 - 8 * 20);
});

test('column-resize help covers English and Chinese', () => {
  const source = '拖动调整列宽；双击恢复默认布局；末列边界固定';
  i18n.setLocale('en-US');
  assert.equal(i18n.translate(source), 'Drag to resize; double-click to reset; the last-column boundary stays fixed');
  i18n.setLocale('zh-CN');
  assert.equal(i18n.translate(source), source);
});
