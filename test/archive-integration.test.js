'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { runArchiveJob } = require('../src/core/archive-engine');
const { QueueManager } = require('../src/core/queue-manager');
const { AppStore } = require('../src/core/store');

const sevenZipPath = path.resolve(__dirname, '..', 'tools', '7zip', '7z.exe');

test('real 7-Zip flow encrypts, verifies and moves a small test archive', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const sourcePath = path.join(root, 'source', '测试目录');
  const archiveStagingDirectory = path.join(root, 'staging');
  const archiveOutputDirectory = path.join(root, 'library');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(path.join(sourcePath, '空子目录'), { recursive: true });
  await fs.writeFile(path.join(sourcePath, '不会明文显示的文件名.txt'), 'hamster archive integration test', 'utf8');
  const sourceStats = await fs.stat(path.join(sourcePath, '不会明文显示的文件名.txt'));

  const result = await runArchiveJob({
    id: 'integration-job',
    sourcePath,
    sourceType: 'directory',
    fileCount: 1,
    totalBytes: sourceStats.size,
    archiveBaseName: 'arc_20260814T151230Z_a1b2c3d4.7z'
  }, {
    archiveStagingDirectory,
    archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'saves'),
    sevenZipPath,
    archivePassword: 'integration-secret'
  });

  assert.equal(result.archiveFiles.length, 1);
  assert.equal(result.manifest.length, 1);
  assert.deepEqual(result.directories, ['空子目录']);
  assert.match(result.manifest[0].md5, /^[a-f0-9]{32}$/);
  const archivePath = path.join(
    archiveOutputDirectory,
    result.archiveFiles[0].name
  );
  assert.equal(fsSync.existsSync(archivePath), true);
  assert.equal(fsSync.existsSync(path.join(archiveStagingDirectory, 'integration-job')), false);

  const wrongPasswordListing = spawnSync(sevenZipPath, [
    'l', archivePath, '-pwrong-password', '-y'
  ], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(wrongPasswordListing.status, 0);
  assert.equal(`${wrongPasswordListing.stdout}${wrongPasswordListing.stderr}`.includes('不会明文显示的文件名.txt'), false);
});

test('real archive publication is recovered when the SQLite catalog commit is rejected', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-archive-commit-failure-'));
  const repositoryDirectory = path.join(root, 'repository');
  const sourcePath = path.join(root, 'source', 'commit-failure');
  const archiveOutputDirectory = path.join(root, 'output');
  const archiveStagingDirectory = path.join(root, 'staging');
  const realStore = new AppStore(path.join(root, 'userdata'));
  t.after(async () => {
    realStore.closeAll();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(sourcePath, { recursive: true });
  const sourceFile = path.join(sourcePath, 'random.bin');
  await fs.writeFile(sourceFile, crypto.randomBytes(512 * 1024));
  const sourceStats = await fs.stat(sourceFile);
  const store = new Proxy(realStore, {
    get(target, property) {
      if (property === 'saveCatalog') {
        return async () => {
          const error = new Error('simulated SQLite commit denial');
          error.code = 'EACCES';
          throw error;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const manager = new QueueManager(store, {
    repositoryDirectory,
    archiveOutputDirectory,
    archiveStagingDirectory,
    sevenZipPath,
    archivePassword: '',
    archiveVolumeEnabled: false,
    moveCompleted: false,
    autoTrashCompleted: false,
    autoSkipExactDuplicates: false,
    similarityEnabled: false
  });
  const job = {
    id: 'real-commit-failure',
    sourcePath,
    sourceType: 'directory',
    displayName: 'commit-failure',
    fileCount: 1,
    totalBytes: sourceStats.size,
    status: 'queued',
    progress: 0,
    archiveBaseName: 'real-commit-failure.7z',
    intakeModeSelected: true
  };
  manager.jobs = [job];

  await manager.startQueue();

  assert.equal(job.status, 'failed');
  assert.equal(job.errorCode, 'EACCES');
  assert.equal(manager.catalog.length, 0);
  assert.deepEqual(await realStore.loadCatalog(repositoryDirectory), []);
  await fs.access(sourceFile);
  await assert.rejects(fs.access(path.join(archiveOutputDirectory, job.archiveBaseName)), /ENOENT/);
  assert.equal(job.catalogRecovery.archiveState, 'recovered_to_staging');
  assert.equal(job.catalogRecovery.recoveryRequired, false);
  assert.equal(job.catalogRecovery.recoveredFiles.length, 1);
  await fs.access(job.catalogRecovery.recoveredFiles[0].recoveryPath);
});
