'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cloud release keeps only QA, build, and publish as separately retryable jobs', () => {
  const workflow = read('.github/workflows/package.yml');
  assert.match(workflow, /^  qa:\s*$/m);
  assert.match(workflow, /^  build:\s*$/m);
  assert.match(workflow, /^  publish:\s*$/m);
  assert.match(workflow, /build:\s*\n\s+needs: qa/);
  assert.match(workflow, /publish:\s*\n\s+needs: build/);
  assert.doesNotMatch(workflow, /^  (?:state|preflight):\s*$/m);
  assert.doesNotMatch(workflow, /needs_bundle|release_state/);
  assert.match(workflow, /--outputs \$outputs --smoke/);
  assert.doesNotMatch(workflow, /verify-source-ci-receipt/);
  assert.doesNotMatch(workflow, /release:local[^\n]*--qa/);
  assert.match(workflow, /--base previous-release --level \$qa/);
  assert.match(workflow, /--execute --base previous-release --level \$env:QA_LEVEL/);
  assert.doesNotMatch(workflow, /--base HEAD\^/);
  assert.match(read('scripts/release.js'), /'--base', 'previous-release'/);
});

test('verified cloud artifacts can resume publishing without rebuilding', () => {
  const workflow = read('.github/workflows/package.yml');
  assert.match(workflow, /resume_run_id/);
  assert.match(workflow, /if: \$\{\{ !inputs\.resume_run_id \}\}/);
  assert.match(workflow, /retry_test_file/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
});

test('ordinary targeted CI skips Electron binary downloads', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:\s*$/m);
  assert.match(workflow, /ELECTRON_SKIP_BINARY_DOWNLOAD: '1'/);
  assert.match(workflow, /needs\.plan\.outputs\.needs_electron == 'true'/);
  assert.doesNotMatch(workflow, /^\s+- run: npm test\s*$/m);
});

test('runner temporary paths are evaluated only in step contexts', () => {
  for (const name of ['.github/workflows/package.yml', '.github/workflows/ci.yml']) {
    const workflow = read(name);
    assert.doesNotMatch(workflow, /^    env:\s*\n(?:^      [^\n]+\n)*?^      [^\n]*\$\{\{ runner\.temp \}\}/m);
  }
});

test('public and CNB distribution consume upstream Release assets', () => {
  const githubMirror = read('scripts/release-publish.js');
  const cnbMirror = read('scripts/release-sync-cnb.js');
  assert.match(githubMirror, /downloadVerifiedReleaseAssets\(sourceRepo, tag/);
  assert.match(githubMirror, /'release', 'download', tag/);
  assert.doesNotMatch(githubMirror, /npm run build/);
  assert.match(cnbMirror, /prepareGithubBundle/);
  assert.match(cnbMirror, /downloadAsset\(remote, targetPath\)/);
});
