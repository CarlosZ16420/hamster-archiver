'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { groupsForFile, makePlan, parseArgs } = require('../scripts/qa-plan');

test('documentation-only maintenance requires no test or build prerequisites', () => {
  const plan = makePlan(['docs/RELEASE.md', 'CHANGELOG.md']);
  assert.equal(plan.level, 'none');
  assert.deepEqual(plan.tests, []);
  assert.equal(plan.needsDependencies, false);
  assert.equal(plan.needsElectron, false);
});

test('release workflow changes select only release tests', () => {
  const plan = makePlan(['scripts/release.js', '.github/workflows/package.yml']);
  assert.equal(plan.level, 'targeted');
  assert.deepEqual(plan.groups, ['release']);
  assert.ok(plan.tests.includes('test/release-local.test.js'));
  assert.ok(!plan.tests.includes('test/archive-engine.test.js'));
  assert.equal(plan.needsDependencies, false);
  assert.equal(plan.needsElectron, false);
});

test('feature paths map to affected groups and full QA stays explicit', () => {
  assert.deepEqual(groupsForFile('src/core/archive-engine.js'), ['archive']);
  assert.deepEqual(groupsForFile('src/core/mcp-client.js'), ['mcp']);
  assert.deepEqual(groupsForFile('scripts/release-sync-cnb.js'), ['mirrors']);
  const full = makePlan(['docs/RELEASE.md'], { level: 'full' });
  assert.equal(full.level, 'full');
  assert.equal(full.needsElectron, true);
});

test('one group can be retried without selecting the complete suite', () => {
  const options = parseArgs(['--group', 'release', '--test-file', 'test/release-local.test.js', '--execute']);
  assert.deepEqual(options.groups, ['release']);
  assert.deepEqual(options.testFiles, ['test/release-local.test.js']);
  assert.equal(options.execute, true);
});
