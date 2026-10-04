'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPerformanceTrace } = require('../src/core/performance-trace');

test('performance trace is bounded, memory-only and excludes unapproved fields', () => {
  const emitted = [];
  const trace = createPerformanceTrace({ maxEntries: 2, sink: (entry) => emitted.push(entry) });
  trace.record({ stage: 'scan', elapsedMs: 1, fileCount: 4, sourcePath: 'private-path', password: 'secret' });
  trace.record({ stage: 'hash', elapsedMs: 2 });
  trace.record({ stage: 'save', elapsedMs: 3 });
  assert.deepEqual(trace.snapshot().map((entry) => entry.stage), ['hash', 'save']);
  assert.equal(emitted.length, 3);
  assert.equal(JSON.stringify(emitted).includes('private-path'), false);
  assert.equal(JSON.stringify(emitted).includes('secret'), false);
  trace.clear();
  assert.deepEqual(trace.snapshot(), []);
});
