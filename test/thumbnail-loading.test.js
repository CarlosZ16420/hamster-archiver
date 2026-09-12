'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('thumbnail IO waits for visibility, stays within four reads and skips detached items', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  let onIntersection;
  const observed = new Set();
  const pending = [];
  const reads = [];
  const node = () => ({ dataset: {}, isConnected: true, setAttribute() {}, append(...children) {
    children.forEach((child, index) => { child.previousElementSibling = children[index - 1]; });
  } });
  const context = vm.createContext({
    IntersectionObserver: class {
      constructor(callback) { onIntersection = callback; }
      observe(image) { observed.add(image); }
      unobserve(image) { observed.delete(image); }
    },
    document: { createElement: node }, make: node,
    elements: { catalogDetail: { querySelectorAll: () => [...observed] } },
    loadThumbnail(image, record, ref) {
      reads.push(ref);
      return new Promise((resolve) => pending.push(() => resolve('data:image/png;base64,test')));
    }
  });
  vm.runInContext(source.slice(source.indexOf('const thumbnailLoadQueue = []'), source.indexOf('function thumbnailsForFile(')), context);
  const container = node();
  const images = Array.from({ length: 20 }, (_, index) => context.appendContainedThumbnail(container, 'project', String(index), 'test'));
  assert.equal(reads.length, 0, 'constructing cards must not read files');
  onIntersection(images.map((target) => ({ target, isIntersecting: true })));
  assert.equal(reads.length, 4);
  images[4].isConnected = false;
  pending.shift()();
  await new Promise(setImmediate);
  assert.equal(reads.length, 5);
  assert.equal(reads[4], '5');
  for (const image of images) image.isConnected = false;
  for (const finish of pending.splice(0)) finish();
  await new Promise(setImmediate);
  assert.equal(reads.length, 5, 'leaving a project cancels queued reads');
  context.appendContainedThumbnail(container, 'next', 'cover', 'next');
  assert.equal(observed.size, 1);
  context.releaseDetailThumbnails();
  assert.equal(observed.size, 0);
});
