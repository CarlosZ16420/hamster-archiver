'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { groupsForFile, makePlan, parseArgs, previousReleaseBase, runPlan } = require('../scripts/qa-plan');

test('removed source files retain group coverage but are not passed to the syntax checker', () => {
  const plan = makePlan(['scripts/verify-source-ci-receipt.js'], { level: 'targeted' });
  assert.deepEqual(plan.groups, ['safety']);
  assert.doesNotThrow(() => runPlan({ ...plan, tests: [], syntaxFiles: ['scripts/nonexistent-deleted-qa-regression.js'] }));
});

test('formal release QA compares the previous version, not only the final documentation commit', () => {
  const calls = [];
  assert.equal(previousReleaseBase(args => { calls.push(args); return 'v4.6.9'; }), 'v4.6.9');
  assert.deepEqual(calls, [['describe', '--tags', '--match', 'v[0-9]*', '--exclude', '*-*', '--abbrev=0', 'HEAD^']]);
});

test('first release QA includes the root commit through an empty tree baseline', () => {
  const calls = [];
  assert.equal(previousReleaseBase(args => {
    calls.push(args);
    if (args[0] === 'describe') throw new Error('No previous version');
    return 'empty-tree';
  }), 'empty-tree');
  assert.deepEqual(calls[1], ['hash-object', '-t', 'tree', '--stdin']);
});

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
