'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { LARGE_TASK_BYTES } = require('../src/core/constants');
const {
  createArchiveName,
  createConfiguredArchiveName,
  isPathInside,
  makeArchiveStagingDirectory,
  makeDefaultConfig,
  normalizePortableProgramPath,
  rebasePortableUserDataPaths,
  resolveApplicationPath,
  validatePathLayout,
  validateSourceSelection,
  validateWindowsFileStem
} = require('../src/core/paths');

test('archive names use ASCII UTC timestamp and random suffix', () => {
  const name = createArchiveName(
    new Date('2026-08-14T15:12:30.000Z'),
    () => Buffer.from('a1b2c3d4', 'hex')
  );
  assert.equal(name, 'arc_20260814T151230Z_a1b2c3d4.7z');
  assert.match(name, /^[\x00-\x7F]+$/);
});

test('path containment handles descendants but not similarly prefixed siblings', () => {
  assert.equal(isPathInside('E:\\source', 'E:\\source\\child'), true);
  assert.equal(isPathInside('E:\\source', 'E:\\source-two'), false);
});

test('unsafe source, staging and library nesting is rejected', () => {
  assert.throws(() => validatePathLayout({
    intakeDirectory: 'E:\\source',
    archiveStagingDirectory: 'E:\\source\\staging',
    archiveOutputDirectory: 'E:\\library',
    repositoryDirectory: 'E:\\repository'
  }), /暂存目录/);
  assert.throws(() => validatePathLayout({
    intakeDirectory: 'E:\\source',
    archiveStagingDirectory: 'E:\\work',
    archiveOutputDirectory: 'E:\\work\\library',
    repositoryDirectory: 'E:\\repository'
  }), /互相包含/);
});

test('source selection can be queued before an output directory is configured', () => {
  assert.doesNotThrow(() => validateSourceSelection({
    archiveStagingDirectory: '',
    archiveOutputDirectory: '',
    repositoryDirectory: 'E:\\portable-app\\userdata\\warehouse',
    moveCompleted: false
  }, 'E:\\incoming\\tiny-folder'));
  assert.throws(() => validateSourceSelection({
    archiveOutputDirectory: 'E:\\incoming\\tiny-folder\\packed'
  }, 'E:\\incoming\\tiny-folder'), /压缩包存储点/);
  assert.throws(() => validateSourceSelection({
    repositoryDirectory: 'E:\\portable-app\\userdata\\warehouse'
  }, 'E:\\portable-app\\userdata\\warehouse\\accidental-source'), /仓库位置/);
});

test('configured archive naming supports original and validated custom names', () => {
  assert.equal(createConfiguredArchiveName(
    '旅行视频.mp4',
    { archiveNamingMode: 'original' },
    () => Buffer.from('a1b2c3d4', 'hex')
  ), '旅行视频_a1b2c3d4.7z');
  assert.equal(createConfiguredArchiveName('ignored', {
    archiveNamingMode: 'custom_random', customArchiveName: '台湾旅行'
  }, () => Buffer.from('a1b2c3d4', 'hex')), '台湾旅行_a1b2c3d4.7z');
  assert.throws(() => validateWindowsFileStem('bad:name'), /不允许/);
  assert.throws(() => validateWindowsFileStem('CON'), /保留名称/);
});

test('configured archive naming follows the selected archive format', () => {
  assert.equal(createConfiguredArchiveName('旅行视频.mp4', {
    archiveNamingMode: 'original',
    archiveFormat: 'zip'
  }, () => Buffer.from('a1b2c3d4', 'hex')), '旅行视频_a1b2c3d4.zip');
});

test('new installs keep source/output user-selected and default processed inside portable userdata', () => {
  const config = makeDefaultConfig('E:\\program', {
    root: 'C:\\user-data',
    archiveStagingDirectory: 'C:\\user-data\\staging',
    repositoryDirectory: 'C:\\user-data\\warehouse',
    similarityIgnoreTermsPath: 'C:\\user-data\\config\\similarity-ignore-terms.txt'
  });
  assert.equal(config.intakeDirectory, '');
  assert.equal(config.archiveOutputDirectory, '');
  assert.equal(config.processedSourceDirectory, 'C:\\user-data\\processed');
  assert.equal(config.archivePassword, '');
  assert.equal(config.moveCompleted, false);
  assert.equal(config.recordArchivePassword, true);
  assert.equal(config.repositoryDirectory, 'C:\\user-data\\warehouse');
  assert.equal(config.archiveStagingDirectory, '');
  assert.equal(config.sevenZipPath, path.join('tools', '7zip', '7z.exe'));
  assert.equal(config.videoFrameCount, 3);
  assert.equal(config.thumbnailLimit, 30);
  assert.equal(config.archiveFormat, '7z');
  assert.equal(config.compressionLevel, 1);
  assert.equal(config.archiveVolumeEnabled, true);
  assert.equal(config.archiveVolumeBytes, LARGE_TASK_BYTES);
  assert.equal(config.largeFolderMd5SampleLimit, 200);
  assert.equal(config.largeFolderFileThreshold, 500);
  assert.equal(config.tinyFileMd5ThresholdBytes, 5 * 1024);
  assert.equal(config.largeFolderSimplification, true);
  assert.equal(config.skipTinyMd5Files, true);
  assert.equal(config.autoSkipExactDuplicates, true);
});

test('portable tools remain relative and owned user-data paths rebase after moving the app', () => {
  assert.equal(makeArchiveStagingDirectory('C:\\ABC'), path.resolve('C:\\ABC') + '-staging');
  assert.equal(
    normalizePortableProgramPath('D:\\old-app\\tools\\7zip\\7z.exe', 'E:\\new-app', path.join('tools', '7zip', '7z.exe')),
    path.join('tools', '7zip', '7z.exe')
  );
  assert.equal(
    resolveApplicationPath('E:\\new-app', path.join('tools', '7zip', '7z.exe')),
    path.resolve('E:\\new-app', 'tools', '7zip', '7z.exe')
  );
  const config = rebasePortableUserDataPaths({
    userDataDirectory: 'D:\\old-app\\userdata',
    repositoryDirectory: 'D:\\old-app\\userdata\\warehouse',
    processedSourceDirectory: 'D:\\old-app\\userdata\\processed',
    similarityIgnoreTermsPath: 'D:\\old-app\\userdata\\config\\similarity-ignore-terms.txt',
    archiveStagingDirectory: 'D:\\old-app\\userdata\\staging',
    intakeDirectory: 'F:\\my-input',
    archiveOutputDirectory: 'F:\\my-archives',
    sevenZipPath: 'G:\\custom-tools\\7z.exe'
  }, { root: 'E:\\new-app\\userdata' });
  assert.equal(config.repositoryDirectory, path.resolve('E:\\new-app\\userdata', 'warehouse'));
  assert.equal(config.archiveStagingDirectory, path.resolve('E:\\new-app\\userdata', 'staging'));
  assert.equal(config.migratedRepositoryFrom, 'D:\\old-app\\userdata\\warehouse');
  assert.equal(config.intakeDirectory, 'F:\\my-input');
  assert.equal(config.archiveOutputDirectory, 'F:\\my-archives');
  assert.equal(config.sevenZipPath, 'G:\\custom-tools\\7z.exe');
});
