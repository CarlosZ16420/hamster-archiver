'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cloud release keeps QA, build, and publish in separately retryable jobs', () => {
  const workflow = read('.github/workflows/package.yml');
  assert.match(workflow, /^  qa:\s*$/m);
  assert.match(workflow, /^  build:\s*$/m);
  assert.match(workflow, /^  publish:\s*$/m);
  assert.match(workflow, /build:\s*\n\s+needs: \[preflight, qa\]/);
  assert.match(workflow, /publish:\s*\n\s+needs: \[preflight, build\]/);
  assert.match(workflow, /--wait-seconds 0/);
  assert.match(workflow, /--outputs \$outputs --qa none/);
  assert.doesNotMatch(workflow, /release:local -- --full-checks/);
});

test('verified cloud artifacts can resume publishing without rebuilding', () => {
  const workflow = read('.github/workflows/package.yml');
  assert.match(workflow, /resume_run_id/);
  assert.match(workflow, /retry_test_file/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /compression-level: 0/);
});

test('ordinary targeted CI skips Electron binary downloads', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m);
  assert.match(workflow, /ELECTRON_SKIP_BINARY_DOWNLOAD: '1'/);
  assert.match(workflow, /needs\.plan\.outputs\.needs_electron == 'true'/);
  assert.doesNotMatch(workflow, /^\s+- run: npm test\s*$/m);
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
