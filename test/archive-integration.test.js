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
const { attachManifestMetadata, buildManifest } = require('../src/core/manifest');
const { QueueManager } = require('../src/core/queue-manager');
const { AppStore } = require('../src/core/store');

const sevenZipPath = process.env.HAMSTER_TEST_7ZIP_PATH || path.resolve(__dirname, '..', 'tools', '7zip', '7z.exe');

test('real 7-Zip flow encrypts, verifies and moves a small test archive', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const sourcePath = path.join(root, 'source', '测试目录');
  const archiveStagingDirectory = path.join(root, 'staging');
  const archiveOutputDirectory = path.join(root, 'library');
  // Model the user's confirmed output folder, rather than implicit engine creation.
  await fs.mkdir(archiveOutputDirectory, { recursive: true });
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(path.join(sourcePath, '空子目录'), { recursive: true });
  await fs.mkdir(path.join(sourcePath, '父目录', '嵌套空目录'), { recursive: true });
  await fs.mkdir(path.join(sourcePath, '混合目录', '空层'), { recursive: true });
  await fs.writeFile(path.join(sourcePath, '不会明文显示的文件名.txt'), 'hamster archive integration test', 'utf8');
  await fs.writeFile(path.join(sourcePath, '混合目录', '内容.txt'), 'nested content', 'utf8');
  const sourceStats = await fs.stat(path.join(sourcePath, '不会明文显示的文件名.txt'));
  const nestedStats = await fs.stat(path.join(sourcePath, '混合目录', '内容.txt'));

  const result = await runArchiveJob({
    id: 'integration-job',
    sourcePath,
    sourceType: 'directory',
    fileCount: 2,
    totalBytes: sourceStats.size + nestedStats.size,
    archiveBaseName: 'arc_20260814T151230Z_a1b2c3d4.7z'
  }, {
    archiveStagingDirectory,
    archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'saves'),
    sevenZipPath,
    archivePassword: 'integration-secret'
  });

  assert.equal(result.archiveFiles.length, 1);
  assert.equal(result.manifest.length, 2);
  assert.deepEqual(new Set(result.directories), new Set(['空子目录', '父目录', '父目录/嵌套空目录', '混合目录', '混合目录/空层']));
  assert.match(result.manifest[0].md5, /^[a-f0-9]{32}$/);
  const archivePath = path.join(
    archiveOutputDirectory,
    result.archiveFiles[0].name
  );
  assert.equal(fsSync.existsSync(archivePath), true);
  const published = await fs.stat(archivePath, { bigint: true });
  assert.equal(result.archiveFiles[0].size, Number(published.size));
  assert.deepEqual(result.archiveFiles[0].identity, {
    device: String(published.dev), inode: String(published.ino),
    modifiedNs: String(published.mtimeNs), createdNs: String(published.birthtimeNs)
  });
  assert.equal(fsSync.existsSync(path.join(archiveStagingDirectory, 'integration-job')), false);

  const extracted = path.join(root, 'extracted');
  const extraction = spawnSync(sevenZipPath, ['x', archivePath, `-o${extracted}`, '-pintegration-secret', '-y'], {
    encoding: 'utf8', windowsHide: true
  });
  assert.equal(extraction.status, 0, `${extraction.stdout}${extraction.stderr}`);
  const extractedSource = path.join(extracted, path.basename(sourcePath));
  for (const relative of ['空子目录', path.join('父目录', '嵌套空目录'), path.join('混合目录', '空层')]) {
    const emptyDirectory = path.join(extractedSource, relative);
    assert.equal((await fs.stat(emptyDirectory)).isDirectory(), true);
    assert.deepEqual(await fs.readdir(emptyDirectory), []);
  }
  assert.equal(await fs.readFile(path.join(extractedSource, '混合目录', '内容.txt'), 'utf8'), 'nested content');
  assert.equal(await fs.readFile(path.join(extractedSource, '不会明文显示的文件名.txt'), 'utf8'), 'hamster archive integration test');

  const wrongPasswordListing = spawnSync(sevenZipPath, [
    'l', archivePath, '-pwrong-password', '-y'
  ], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(wrongPasswordListing.status, 0);
  assert.equal(`${wrongPasswordListing.stdout}${wrongPasswordListing.stderr}`.includes('不会明文显示的文件名.txt'), false);
});

test('final archive verification rejects a valid 7-Zip file missing a source empty directory', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-missing-archive-directory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  const archiveStagingDirectory = path.join(root, 'staging');
  const archiveOutputDirectory = path.join(root, 'output');
  const archiveBaseName = 'missing-directory.7z';
  await fs.mkdir(path.join(sourcePath, 'empty'), { recursive: true });
  await fs.mkdir(archiveOutputDirectory);
  const sourceFile = path.join(sourcePath, 'content.txt');
  await fs.writeFile(sourceFile, 'source remains intact');
  const totalBytes = (await fs.stat(sourceFile)).size;

  await assert.rejects(runArchiveJob({
    id: 'missing-directory', sourcePath, sourceType: 'directory', fileCount: 1,
    totalBytes, archiveBaseName
  }, {
    archiveStagingDirectory, archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: ''
  }, {
    onStage: async (stage, description) => {
      if (stage !== 'verifying' || description !== '正在比对归档与源文件及目录清单') return;
      const finalPath = path.join(archiveOutputDirectory, archiveBaseName);
      const deletion = spawnSync(sevenZipPath, ['d', finalPath, 'item\\empty', '-y'], {
        encoding: 'utf8', windowsHide: true
      });
      assert.equal(deletion.status, 0, `${deletion.stdout}${deletion.stderr}`);
    }
  }), { code: 'ARCHIVE_CONTENT_MISMATCH' });
  assert.equal(await fs.readFile(sourceFile, 'utf8'), 'source remains intact');
  await fs.access(path.join(archiveOutputDirectory, archiveBaseName));
  await fs.access(path.join(archiveStagingDirectory, 'missing-directory', archiveBaseName));
});

test('incomplete source scans cannot publish a partially verified archive', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-incomplete-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  const archiveOutputDirectory = path.join(root, 'output');
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(archiveOutputDirectory);
  const sourceFile = path.join(sourcePath, 'content.txt');
  await fs.writeFile(sourceFile, 'source stays in place');
  const manifest = await buildManifest(sourcePath, 'directory');
  const archiveBaseName = 'incomplete.7z';
  for (const { skippedFiles, complete } of [
    { skippedFiles: [{ path: 'unreadable.txt', code: 'EACCES', type: 'file' }], complete: true },
    { skippedFiles: [], complete: false }
  ]) {
    const incompleteManifest = attachManifestMetadata([...manifest], {
      directories: manifest.directories,
      skippedFiles,
      sourceSnapshot: { ...manifest.sourceSnapshot, complete }
    });
    await assert.rejects(runArchiveJob({
      id: 'incomplete-source', sourcePath, sourceType: 'directory', fileCount: 1,
      totalBytes: manifest[0].size, archiveBaseName
    }, {
      archiveStagingDirectory: path.join(root, 'staging'), archiveOutputDirectory,
      repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: ''
    }, { preparedManifest: incompleteManifest, preparedManifestValidated: true }), {
      code: 'ARCHIVE_SOURCE_INCOMPLETE'
    });
  }
  assert.equal(await fs.readFile(sourceFile, 'utf8'), 'source stays in place');
  await assert.rejects(fs.access(path.join(archiveOutputDirectory, archiveBaseName)), { code: 'ENOENT' });
});

test('ZIP archives preserve nested empty directories after structure verification', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-zip-empty-directory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  const archiveOutputDirectory = path.join(root, 'output');
  await fs.mkdir(path.join(sourcePath, 'nested', 'empty'), { recursive: true });
  await fs.mkdir(archiveOutputDirectory);
  await fs.writeFile(path.join(sourcePath, 'nested', 'content.txt'), 'ZIP content');
  const archiveBaseName = 'structure.zip';
  const result = await runArchiveJob({
    id: 'zip-structure', sourcePath, sourceType: 'directory', fileCount: 1,
    totalBytes: Buffer.byteLength('ZIP content'), archiveBaseName, archiveFormat: 'zip'
  }, {
    archiveStagingDirectory: path.join(root, 'staging'), archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: ''
  });
  assert.equal(result.archiveFiles.length, 1);
  const extracted = path.join(root, 'extracted');
  const extraction = spawnSync(sevenZipPath, [
    'x', path.join(archiveOutputDirectory, archiveBaseName), `-o${extracted}`, '-y'
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(extraction.status, 0, `${extraction.stdout}${extraction.stderr}`);
  assert.deepEqual(await fs.readdir(path.join(extracted, 'item', 'nested', 'empty')), []);
  assert.equal(await fs.readFile(path.join(extracted, 'item', 'nested', 'content.txt'), 'utf8'), 'ZIP content');
});

test('split 7z archives verify source structure through the first volume', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-split-empty-directory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  const archiveOutputDirectory = path.join(root, 'output');
  await fs.mkdir(path.join(sourcePath, 'nested', 'empty'), { recursive: true });
  await fs.mkdir(archiveOutputDirectory);
  const sourceFile = await fs.open(path.join(sourcePath, 'large.bin'), 'w');
  try {
    for (let index = 0; index < 66; index += 1) await sourceFile.write(crypto.randomBytes(1024 * 1024));
  } finally { await sourceFile.close(); }
  const archiveBaseName = 'structure.7z';
  const result = await runArchiveJob({
    id: 'split-structure', sourcePath, sourceType: 'directory', fileCount: 1,
    totalBytes: 66 * 1024 * 1024, archiveBaseName, archiveFormat: '7z', compressionLevel: 0,
    archiveVolumeEnabled: true, archiveVolumeBytes: 64 * 1024 * 1024
  }, {
    archiveStagingDirectory: path.join(root, 'staging'), archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: ''
  });
  assert.ok(result.archiveFiles.length >= 2);
  const extracted = path.join(root, 'extracted');
  const extraction = spawnSync(sevenZipPath, [
    'x', path.join(archiveOutputDirectory, result.archiveFiles[0].name), `-o${extracted}`, '-y'
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(extraction.status, 0, `${extraction.stdout}${extraction.stderr}`);
  assert.deepEqual(await fs.readdir(path.join(extracted, 'item', 'nested', 'empty')), []);
  assert.equal((await fs.stat(path.join(extracted, 'item', 'large.bin'))).size, 66 * 1024 * 1024);
});

test('verified same-disk archive rejects a staged replacement before publication', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-staged-replacement-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  const archiveStagingDirectory = path.join(root, 'staging');
  const archiveOutputDirectory = path.join(root, 'output');
  const archiveBaseName = 'owned.7z';
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.mkdir(archiveOutputDirectory, { recursive: true });
  await fs.writeFile(path.join(sourcePath, 'content.txt'), 'source remains unchanged');
  const totalBytes = (await fs.stat(path.join(sourcePath, 'content.txt'))).size;

  await assert.rejects(runArchiveJob({
    id: 'staged-replacement', sourcePath, sourceType: 'directory', fileCount: 1,
    totalBytes, archiveBaseName
  }, {
    archiveStagingDirectory, archiveOutputDirectory,
    repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: ''
  }, {
    onStage: async (stage) => {
      if (stage !== 'moving') return;
      const stagedPath = path.join(archiveStagingDirectory, 'staged-replacement', archiveBaseName);
      const replacement = path.join(path.dirname(stagedPath), 'replacement.tmp');
      await fs.writeFile(replacement, 'unverified replacement');
      await fs.rename(replacement, stagedPath);
    }
  }), /身份复核失败/);
  assert.equal(await fs.readFile(path.join(sourcePath, 'content.txt'), 'utf8'), 'source remains unchanged');
});

test('real archive publication is recovered when the SQLite catalog commit is rejected', {
  skip: process.platform !== 'win32' || !fsSync.existsSync(sevenZipPath)
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-archive-commit-failure-'));
  const repositoryDirectory = path.join(root, 'repository');
  const sourcePath = path.join(root, 'source', 'commit-failure');
  const archiveOutputDirectory = path.join(root, 'output');
  const archiveStagingDirectory = path.join(root, 'staging');
  await fs.mkdir(archiveOutputDirectory, { recursive: true });
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
      if (property === 'saveCatalog' || property === 'saveCatalogRecords') {
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

test('final-position validation detects equal-size corruption and retains staging on cancellation or copy failure', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-final-validation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source', 'item');
  await fs.mkdir(sourcePath, { recursive: true });
  const originalContent = crypto.randomBytes(8192);
  await fs.writeFile(path.join(sourcePath, 'content.bin'), originalContent);
  const originalLink = fs.link.bind(fs);
  const originalCopy = fs.copyFile.bind(fs);
  for (const scenario of ['EXDEV-success', 'ENOTSUP-success', 'corruption', 'cancel', 'copy-failure']) {
    const output = path.join(root, scenario, 'output');
    const staging = path.join(root, scenario, 'staging');
    await fs.mkdir(output, { recursive: true });
    const job = { id: scenario, sourcePath, sourceType: 'directory', fileCount: 1,
      totalBytes: originalContent.length, archiveBaseName: 'content.7z', compressionLevel: 0 };
    const stagedPath = path.join(staging, scenario, job.archiveBaseName);
    const finalPath = path.join(output, job.archiveBaseName);
    const abort = new AbortController();
    const calls = [];
    t.mock.method(fs, 'link', async (from, to) => {
      if (from === stagedPath && to === finalPath) throw Object.assign(new Error('injected boundary'), {
        code: scenario === 'ENOTSUP-success' ? 'ENOTSUP' : 'EXDEV'
      });
      return originalLink(from, to);
    });
    t.mock.method(fs, 'copyFile', async (from, to, flags) => {
      await originalCopy(from, to, flags);
      if (from !== stagedPath || to !== finalPath) return;
      if (scenario === 'copy-failure') throw Object.assign(new Error('copy interrupted'), { code: 'EIO' });
      if (scenario === 'corruption') {
        const handle = await fs.open(to, 'r+');
        try {
          const byte = Buffer.alloc(1);
          await handle.read(byte, 0, 1, 40);
          byte[0] ^= 0xff;
          await handle.write(byte, 0, 1, 40);
        } finally { await handle.close(); }
      }
    });
    try {
      const execution = runArchiveJob(job, { archiveStagingDirectory: staging, archiveOutputDirectory: output,
        repositoryDirectory: path.join(root, 'repository'), sevenZipPath, archivePassword: '' }, {
        onStage: async (_stage, description) => {
          calls.push(description);
          if (description === '正在执行 7-Zip 完整性测试') {
            await fs.access(stagedPath);
            await fs.access(finalPath);
            if (scenario === 'cancel') abort.abort();
          }
        }
      }, abort.signal);
      if (scenario.endsWith('success')) {
        const result = await execution;
        assert.equal(result.archivePublicationMode, scenario === 'EXDEV-success' ? 'cross_disk_copy' : 'same_disk_copy');
        for (const description of ['正在压缩', '正在执行 7-Zip 完整性测试', '正在比对归档与源文件及目录清单']) {
          assert.equal(calls.filter((value) => value === description).length, 1);
        }
        await assert.rejects(fs.access(stagedPath), { code: 'ENOENT' });
      } else {
        await assert.rejects(execution, undefined, scenario);
        const check = spawnSync(sevenZipPath, ['t', stagedPath], { windowsHide: true, encoding: 'utf8' });
        assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
        await fs.access(finalPath);
      }
      assert.deepEqual(await fs.readFile(path.join(sourcePath, 'content.bin')), originalContent);
    } finally { t.mock.restoreAll(); }
  }
});
