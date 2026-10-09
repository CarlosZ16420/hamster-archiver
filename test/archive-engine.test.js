'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { LARGE_TASK_BYTES, MIB } = require('../src/core/constants');
const fs = require('node:fs/promises');
const os = require('node:os');
const {
  assertEnoughDiskSpace,
  assertUsableConfiguration,
  buildCompressArgs,
  buildVerifyArgs,
  createArchivePublicationReceipt,
  publishArchiveFiles,
  recoverPublishedArchiveFiles
} = require('../src/core/archive-engine');

function makeJob(totalBytes) {
  return {
    sourcePath: 'E:\\input\\示例目录',
    totalBytes
  };
}

test('small task has no password by default and is not split', () => {
  const args = buildCompressArgs(makeJob(LARGE_TASK_BYTES), 'E:\\stage\\test.7z');
  assert.equal(args.includes('-mhe=on'), false);
  assert.equal(args.some((arg) => arg.startsWith('-p')), false);
  assert.equal(args.some((arg) => arg.startsWith('-v')), false);
  assert.equal(args.at(-1), '示例目录');
});

test('task larger than 10 GiB uses 10 GiB volumes', () => {
  const args = buildCompressArgs(makeJob(LARGE_TASK_BYTES + 1), 'E:\\stage\\test.7z');
  assert.ok(args.includes(`-v${LARGE_TASK_BYTES}b`));
});

test('enabled custom volume size is passed to 7-Zip in exact bytes', () => {
  const archiveVolumeBytes = 512 * MIB;
  const args = buildCompressArgs({
    ...makeJob(2 * 1024 ** 3),
    archiveVolumeEnabled: true,
    archiveVolumeBytes
  }, 'E:\\stage\\test.7z');
  assert.ok(args.includes(`-v${archiveVolumeBytes}b`));
});

test('disabled splitting keeps both small and large tasks whole', () => {
  const smallArgs = buildCompressArgs({
    ...makeJob(2 * 1024 ** 3),
    archiveVolumeEnabled: false,
    archiveVolumeBytes: 512 * MIB
  }, 'E:\\stage\\small.7z');
  const largeArgs = buildCompressArgs({
    ...makeJob(LARGE_TASK_BYTES + 1),
    archiveVolumeEnabled: false,
    archiveVolumeBytes: 512 * MIB
  }, 'E:\\stage\\large.7z');
  assert.equal(smallArgs.some((arg) => arg.startsWith('-v')), false);
  assert.equal(largeArgs.some((arg) => arg.startsWith('-v')), false);
});

test('volume thresholds above 100 GiB keep sources whole until the configured size is exceeded', () => {
  for (const [totalGiB, expectedSplit] of [[20, false], [200, false], [256, false], [257, true]]) {
    const args = buildCompressArgs({
      ...makeJob(totalGiB * 1024 ** 3),
      archiveVolumeEnabled: true,
      archiveVolumeBytes: 256 * 1024 ** 3
    }, 'E:\\stage\\threshold.7z');
    assert.equal(args.includes(`-v${256 * 1024 ** 3}b`), expectedSplit);
  }
});

test('verification has no password argument by default', () => {
  const archivePath = path.join('E:\\stage', 'arc_20260814T151230Z_a1b2c3d4.7z.001');
  const args = buildVerifyArgs(archivePath);
  assert.equal(args[0], 't');
  assert.equal(args[1], archivePath);
  assert.equal(args.some((arg) => arg.startsWith('-p')), false);
});

test('custom password is used for compression and verification', () => {
  const job = { totalBytes: 1, sourcePath: 'E:\\source\\folder' };
  const compressArgs = buildCompressArgs(job, 'E:\\stage\\archive.7z', '新密码');
  assert.ok(compressArgs.includes('-mhe=on'));
  assert.ok(compressArgs.includes('-p新密码'));
  assert.ok(buildVerifyArgs('E:\\stage\\archive.7z', '新密码').includes('-p新密码'));
});

test('zip format uses selected compression level without 7z header encryption', () => {
  const args = buildCompressArgs({
    totalBytes: 1,
    sourcePath: 'E:\\source\\folder',
    archiveFormat: 'zip',
    compressionLevel: 7
  }, 'E:\\stage\\archive.zip', 'zip-pass');
  assert.ok(args.includes('-tzip'));
  assert.ok(args.includes('-mx=7'));
  assert.ok(args.includes('-pzip-pass'));
  assert.equal(args.includes('-mhe=on'), false);
});

test('configured per-task thread limit is passed to 7-Zip', () => {
  const args = buildCompressArgs({
    ...makeJob(1024),
    sevenZipThreads: 4
  }, 'E:\\stage\\archive.7z');
  assert.ok(args.includes('-mmt=4'));
});

test('disk-space guard rejects an impossibly large task instead of silently continuing', async () => {
  await assert.rejects(
    assertEnoughDiskSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER, '测试磁盘'),
    (error) => error.code === 'INSUFFICIENT_DISK_SPACE'
  );
  assert.ok(await fs.stat(os.tmpdir()));
});

test('archive configuration refuses to recreate a missing output folder', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-missing-output-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, '7z.exe');
  const source = path.join(root, 'source');
  const output = path.join(root, 'deleted-output');
  await fs.writeFile(executable, 'stub');
  await fs.mkdir(source);

  await assert.rejects(
    assertUsableConfiguration({
      sevenZipPath: executable,
      archiveStagingDirectory: path.join(root, 'staging'),
      archiveOutputDirectory: output,
      repositoryDirectory: path.join(root, 'warehouse'),
      processedSourceDirectory: '',
      moveCompleted: false
    }, source),
    (error) => error.code === 'ARCHIVE_OUTPUT_DIRECTORY_MISSING'
  );
  await assert.rejects(fs.stat(output), (error) => error.code === 'ENOENT');
});

test('EXDEV publication fallback checks target space and reports the actual copy mode', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-exdev-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(staging, 'owned.7z'), Buffer.alloc(64, 0x31));

  const originalLink = fs.link.bind(fs);
  const originalCopyFile = fs.copyFile.bind(fs);
  const events = [];
  t.mock.method(fs, 'link', async (sourcePath, targetPath) => {
    if (sourcePath === path.join(staging, 'owned.7z') && targetPath === path.join(output, 'owned.7z')) {
      events.push('link-exdev');
      const error = new Error('simulated mounted-volume boundary');
      error.code = 'EXDEV';
      throw error;
    }
    return originalLink(sourcePath, targetPath);
  });
  t.mock.method(fs, 'statfs', async (directory) => {
    assert.equal(path.resolve(directory), path.resolve(output));
    events.push('space-check');
    return { bavail: 1024 ** 3, bsize: 4096 };
  });
  t.mock.method(fs, 'copyFile', async (...args) => {
    events.push('copy');
    return originalCopyFile(...args);
  });

  const publication = await publishArchiveFiles(staging, output, ['owned.7z']);
  assert.equal(publication.mode, 'cross_disk_copy');
  assert.deepEqual(events.slice(0, 3), ['link-exdev', 'space-check', 'copy']);
  assert.deepEqual(await fs.readFile(path.join(output, 'owned.7z')), Buffer.alloc(64, 0x31));
  assert.equal((await fs.stat(staging)).isDirectory(), true);
});

test('EXDEV publication fallback leaves the source intact when target space is insufficient', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-exdev-space-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const sourcePath = path.join(staging, 'owned.7z');
  const targetPath = path.join(output, 'owned.7z');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(sourcePath, Buffer.alloc(64, 0x42));

  const originalLink = fs.link.bind(fs);
  t.mock.method(fs, 'link', async (fromPath, toPath) => {
    if (fromPath === sourcePath && toPath === targetPath) {
      const error = new Error('simulated mounted-volume boundary');
      error.code = 'EXDEV';
      throw error;
    }
    return originalLink(fromPath, toPath);
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 0, bsize: 4096 }));

  await assert.rejects(
    publishArchiveFiles(staging, output, ['owned.7z']),
    (error) => error.code === 'INSUFFICIENT_DISK_SPACE'
  );
  assert.deepEqual(await fs.readFile(sourcePath), Buffer.alloc(64, 0x42));
  await assert.rejects(fs.stat(targetPath), (error) => error.code === 'ENOENT');
});

test('publication copies without overwriting when hard links are unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-no-links-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const sourcePath = path.join(staging, 'owned.7z');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(sourcePath, 'published archive');
  t.mock.method(fs, 'link', async () => {
    const error = new Error('hard links unavailable');
    error.code = 'ENOTSUP';
    throw error;
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 1024 ** 3, bsize: 4096 }));

  const publication = await publishArchiveFiles(staging, output, ['owned.7z']);
  assert.equal(publication.mode, 'same_disk_copy');
  assert.equal(await fs.readFile(path.join(output, 'owned.7z'), 'utf8'), 'published archive');
  assert.equal((await fs.stat(staging)).isDirectory(), true);
});

test('failed exclusive copy reports a target that was partially created', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-copy-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const sourcePath = path.join(staging, 'owned.7z');
  const targetPath = path.join(output, 'owned.7z');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(sourcePath, 'published archive');
  t.mock.method(fs, 'link', async () => {
    const error = new Error('separate volumes');
    error.code = 'EXDEV';
    throw error;
  });
  t.mock.method(fs, 'statfs', async () => ({ bavail: 1024 ** 3, bsize: 4096 }));
  t.mock.method(fs, 'copyFile', async () => {
    await fs.writeFile(targetPath, 'partial copy');
    const error = new Error('copy interrupted');
    error.code = 'EIO';
    throw error;
  });

  await assert.rejects(publishArchiveFiles(staging, output, ['owned.7z']),
    (error) => error.code === 'EIO' && error.message.includes(targetPath));
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'published archive');
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'partial copy');
});

test('publication preserves a name claimed after its initial check', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const sourcePath = path.join(staging, 'owned.7z');
  const targetPath = path.join(output, 'owned.7z');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(sourcePath, 'published archive');
  const originalLink = fs.link.bind(fs);
  t.mock.method(fs, 'link', async (fromPath, toPath) => {
    if (fromPath === sourcePath && toPath === targetPath) await fs.writeFile(targetPath, 'new owner');
    return originalLink(fromPath, toPath);
  });

  await assert.rejects(publishArchiveFiles(staging, output, ['owned.7z']), (error) => error.code === 'EEXIST');
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'new owner');
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'published archive');
});

test('publication retains its staged file when the linked target is replaced', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-replaced-link-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const sourcePath = path.join(staging, 'owned.7z');
  const targetPath = path.join(output, 'owned.7z');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(sourcePath, 'published archive');
  const originalLink = fs.link.bind(fs);
  t.mock.method(fs, 'link', async (fromPath, toPath) => {
    await originalLink(fromPath, toPath);
    await fs.rm(targetPath);
    await fs.writeFile(targetPath, 'replacement');
  });

  await assert.rejects(publishArchiveFiles(staging, output, ['owned.7z']), /身份复核失败.*保留待核对/);
  assert.equal(await fs.readFile(sourcePath, 'utf8'), 'published archive');
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'replacement');
});

test('partial publication retains earlier volumes and reports their paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-partial-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  await fs.mkdir(staging, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(staging, 'one.7z.001'), 'first volume');
  await fs.writeFile(path.join(staging, 'one.7z.002'), 'second volume');
  const originalLink = fs.link.bind(fs);
  t.mock.method(fs, 'link', async (fromPath, toPath) => {
    if (toPath === path.join(output, 'one.7z.002')) await fs.writeFile(toPath, 'new owner');
    return originalLink(fromPath, toPath);
  });

  await assert.rejects(
    publishArchiveFiles(staging, output, ['one.7z.001', 'one.7z.002']),
    /已发布的成品未自动删除，请核对/
  );
  assert.equal(await fs.readFile(path.join(output, 'one.7z.001'), 'utf8'), 'first volume');
  assert.equal(await fs.readFile(path.join(output, 'one.7z.002'), 'utf8'), 'new owner');
  assert.equal(await fs.readFile(path.join(staging, 'one.7z.002'), 'utf8'), 'second volume');
});

test('archive recovery refuses to move a published path whose file identity changed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  await fs.mkdir(output, { recursive: true });
  const archivePath = path.join(output, 'owned.7z');
  await fs.writeFile(archivePath, Buffer.alloc(64, 0x11));
  const receipt = await createArchivePublicationReceipt('identity-job', output, staging, ['owned.7z']);

  await fs.rm(archivePath);
  await fs.writeFile(archivePath, Buffer.alloc(64, 0x22));

  await assert.rejects(
    recoverPublishedArchiveFiles(receipt),
    (error) => error.code === 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED'
  );
  assert.deepEqual(await fs.readFile(archivePath), Buffer.alloc(64, 0x22));
});

test('archive recovery never overwrites an existing recovery directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-publication-collision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'output');
  const staging = path.join(root, 'staging');
  await fs.mkdir(output, { recursive: true });
  const archivePath = path.join(output, 'owned.7z');
  await fs.writeFile(archivePath, 'owned publication');
  const receipt = await createArchivePublicationReceipt('collision-job', output, staging, ['owned.7z']);
  const recoveryDirectory = path.join(staging, 'recovery', receipt.ownerJobId, receipt.publicationId);
  await fs.mkdir(recoveryDirectory, { recursive: true });
  await fs.writeFile(path.join(recoveryDirectory, 'user-file.txt'), 'must remain');

  await assert.rejects(
    recoverPublishedArchiveFiles(receipt),
    (error) => error.code === 'ARCHIVE_RECOVERY_INCOMPLETE'
  );
  assert.equal(await fs.readFile(archivePath, 'utf8'), 'owned publication');
  assert.equal(await fs.readFile(path.join(recoveryDirectory, 'user-file.txt'), 'utf8'), 'must remain');
});
