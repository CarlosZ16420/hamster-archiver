'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('local release retries only transient Windows rename failures and keeps rollback paths guarded', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');

  assert.match(source, /async function renameWithRetry/);
  assert.match(source, /\['EPERM', 'EACCES', 'EBUSY'\]\.includes\(error\.code\)/);
  assert.match(source, /process\.platform !== 'win32'\) throw error/);
  assert.match(source, /HAMSTER_RENAME_SOURCE: sourcePath/);
  assert.match(source, /HAMSTER_RENAME_DESTINATION: destinationPath/);
  assert.match(source, /Move-Item -LiteralPath \$env:HAMSTER_RENAME_SOURCE -Destination \$env:HAMSTER_RENAME_DESTINATION/);
  assert.match(source, /renameWithRetry\(previousCurrent, layout\.currentBuild\)/);
  assert.match(source, /renameWithRetry\(priorZip, finalZip\)/);
  assert.match(source, /renameWithRetry\(priorSha, finalSha\)/);
});

test('an authorized build repairs a missing Electron runtime at the locked version', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.equal(packageJson.scripts['electron:prepare'], 'node scripts/prepare-electron-runtime.js');
  assert.match(source, /prepare-electron-runtime\.js/);
  assert.match(source, /@electron-internal[\s\S]*extract-zip/);
  assert.match(source, /\[npmCli, 'ci'\]/);
  assert.match(source, /\[npmCli, 'run', 'tools:prepare'\]/);
  assert.match(source, /prepare-electron-runtime\.js'\), '--allow-download'/);
});

test('local release builds only explicitly requested outputs', () => {
  const localRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const formalRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'package.yml'), 'utf8');

  assert.match(localRelease, /outputs: new Set\(\['current'\]\)/);
  assert.match(localRelease, /options\.outputs\.has\('zip'\)/);
  assert.match(localRelease, /options\.outputs\.has\('installer'\)/);
  assert.match(localRelease, /options\.outputs\.has\('current'\)/);
  assert.match(localRelease, /'-mx=5'/);
  assert.doesNotMatch(formalRelease, /\['build:installer'\]/);
  assert.match(workflow, /\{ 'zip,installer' \} else \{ 'zip' \}/);
  assert.match(workflow, /--outputs \$outputs --qa none/);
});

test('packaged smoke acceptance uses durable files instead of GUI stdout markers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const application = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(source, /HAMSTER_SMOKE_RESULT_FILE: smokeResultPath/);
  assert.match(source, /HAMSTER_SMOKE_MODE: 'minimal'/);
  assert.match(application, /async function writeSmokeResult/);
  assert.match(application, /writeSmokeResult\(true, 'complete'/);
  assert.match(application, /usesEnglishUi\(\)[\s\S]*Keep Originals[\s\S]*归档后不移动原文件/);
  assert.match(source, /if \(options\.startupIntegrity\)/);
  assert.doesNotMatch(source, /smokeOutput\.includes\('HAMSTER_SMOKE_TEST_OK'\)/);
  assert.doesNotMatch(source, /startupOutputs.*cacheHit/s);
});

test('formal local fallback reuses a complete exact-commit bundle before rebuilding', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');

  assert.ok(source.indexOf('await verifyFiles()') < source.indexOf("'release:local'"));
  assert.match(source, /no tests or rebuild were repeated/);
});

test('CI and package workflows select QA once and never fall back to full checks', () => {
  const packageJson = require('../package.json');
  const localRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  const packageWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'package.yml'), 'utf8');

  assert.equal(packageJson.scripts['test:changed'], 'node scripts/qa-plan.js --execute');
  assert.match(localRelease, /qa: 'none'/);
  assert.match(ci, /Make one QA plan/);
  assert.match(ci, /test_file/);
  assert.doesNotMatch(ci, /^\s+- run: npm test\s*$/m);
  assert.match(packageWorkflow, /verify-source-ci-receipt\.js/);
  assert.match(packageWorkflow, /--wait-seconds 0/);
  assert.doesNotMatch(packageWorkflow, /--full-checks/);
  assert.match(packageWorkflow, /needs: \[preflight, build\]/);
  assert.match(packageWorkflow, /resume_run_id/);
});
