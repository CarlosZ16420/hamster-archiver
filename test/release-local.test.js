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

test('local release prepares Electron without implicitly allowing a download', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const packageJson = require('../package.json');

  assert.equal(packageJson.scripts['electron:prepare'], 'node scripts/prepare-electron-runtime.js');
  assert.match(source, /prepare-electron-runtime\.js/);
  assert.match(source, /@electron-internal[\s\S]*extract-zip/);
  assert.match(source, /\[npmCli, 'ci'\]/);
  assert.match(source, /\[npmCli, 'run', 'tools:prepare'\]/);
  assert.doesNotMatch(source, /--allow-download/);
});

test('local Current promotion also builds both executable distributions once', () => {
  const localRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const formalRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'package.yml'), 'utf8');

  assert.match(localRelease, /build-installer\.js/);
  assert.ok(localRelease.indexOf('build-installer.js') < localRelease.indexOf('await promoteCurrent(suffix)'));
  assert.match(localRelease, /便携版程序/);
  assert.match(localRelease, /安装程序/);
  assert.doesNotMatch(formalRelease, /\['build:installer'\]/);
  assert.doesNotMatch(workflow, /run:\s*npm run build:installer/);
});

test('packaged smoke acceptance uses durable files instead of GUI stdout markers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-local.js'), 'utf8');
  const application = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(source, /HAMSTER_SMOKE_RESULT_FILE: smokeResultPath/);
  assert.match(application, /async function writeSmokeResult/);
  assert.match(application, /writeSmokeResult\(true, 'complete'/);
  assert.match(application, /usesEnglishUi\(\)[\s\S]*Keep Originals[\s\S]*归档后不移动原文件/);
  assert.match(source, /HAMSTER_UPDATE_VALIDATION_FILE: validationPath/);
  assert.match(source, /release-integrity-v1\.json/);
  assert.doesNotMatch(source, /smokeOutput\.includes\('HAMSTER_SMOKE_TEST_OK'\)/);
  assert.doesNotMatch(source, /startupOutputs.*cacheHit/s);
});

test('formal local fallback reuses a complete exact-commit bundle before rebuilding', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release.js'), 'utf8');

  assert.ok(source.indexOf('await verifyFiles()') < source.indexOf("'release:local'"));
  assert.match(source, /no tests or rebuild were repeated/);
});
