'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ARCHIVE_PASSWORD,
  LARGE_TASK_BYTES,
  MIN_ARCHIVE_VOLUME_BYTES,
  PASSWORD_SCHEME
} = require('./constants');
const { CancelledError } = require('./archive-engine-errors');
const { buildManifest, collectDirectories, sourceSnapshotFromManifest, validateManifestUnchanged } = require('./manifest');
const { validatePathLayout } = require('./paths');
const { performanceTrace } = require('./performance-trace');
const { samePublishedFileIdentity } = require('./file-metadata');

function resolveArchiveVolumeBytes(job) {
  const totalBytes = Number(job.totalBytes) || 0;
  const configuredBytes = Number(job.archiveVolumeBytes ?? LARGE_TASK_BYTES);
  const validConfiguredSize = Number.isSafeInteger(configuredBytes) &&
    configuredBytes >= MIN_ARCHIVE_VOLUME_BYTES;
  const customVolumeBytes = job.archiveVolumeEnabled !== false && validConfiguredSize
    ? configuredBytes
    : 0;

  if (customVolumeBytes > 0 && totalBytes > customVolumeBytes) return customVolumeBytes;
  return 0;
}

function formatVolumeBytes(bytes) {
  if (bytes % (1024 ** 3) === 0) return `${bytes / (1024 ** 3)} GiB`;
  return `${Math.round(bytes / (1024 ** 2))} MiB`;
}

function buildCompressArgs(job, outputPath, password = ARCHIVE_PASSWORD, listFilePath = '') {
  const format = String(job.archiveFormat || '7z').toLowerCase() === 'zip' ? 'zip' : '7z';
  const levelValue = Number(job.compressionLevel ?? 1);
  const level = Number.isInteger(levelValue) && levelValue >= 0 && levelValue <= 9 ? levelValue : 1;
  const args = [
    'a',
    `-t${format}`,
    `-mx=${level}`,
    '-sccUTF-8',
    '-bsp1',
    '-bso1',
    '-bse1',
    '-bb1',
    '-y'
  ];
  const threadCount = Number(job.sevenZipThreads);
  if (Number.isInteger(threadCount) && threadCount > 0) args.push(`-mmt=${threadCount}`);

  if (password) args.splice(3, 0, ...(format === '7z' ? ['-mhe=on', `-p${password}`] : [`-p${password}`]));

  const archiveVolumeBytes = resolveArchiveVolumeBytes(job);
  if (archiveVolumeBytes > 0) args.push(`-v${archiveVolumeBytes}b`);
  if (listFilePath) args.push('-scsUTF-8', outputPath, `@${listFilePath}`);
  else args.push(outputPath, '--', path.basename(job.sourcePath));
  return args;
}

function buildVerifyArgs(archivePath, password = ARCHIVE_PASSWORD) {
  const args = [
    't',
    archivePath,
    '-sccUTF-8',
    '-bsp1',
    '-bso1',
    '-bse1',
    '-bb1',
    '-y'
  ];
  if (password) args.splice(2, 0, `-p${password}`);
  return args;
}

function buildListArgs(archivePath, password = ARCHIVE_PASSWORD) {
  const args = ['l', archivePath, '-slt', '-ba', '-sccUTF-8', '-y'];
  if (password) args.push(`-p${password}`);
  return args;
}

function runProcess(executable, args, options = {}) {
  const { cwd, signal, pauseController, onOutput = () => {}, onStdout = () => {}, onProgress = () => {} } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }

    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    Promise.resolve(pauseController?.attach(child.pid)).catch((error) => {
      child.kill();
      reject(error);
    });
    let outputTail = '';
    let aborted = false;

    const consume = (chunk, stdout) => {
      const text = String(chunk);
      outputTail = `${outputTail}${text}`.slice(-12000);
      onOutput(text);
      if (stdout) onStdout(text);
      const matches = [...text.matchAll(/(?:^|\s)(\d{1,3})%/g)];
      if (matches.length > 0) {
        onProgress(Math.min(100, Number(matches.at(-1)[1])));
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => consume(chunk, true));
    child.stderr.on('data', (chunk) => consume(chunk, false));

    const abortHandler = () => {
      aborted = true;
      child.kill();
    };
    signal?.addEventListener('abort', abortHandler, { once: true });

    child.on('error', (error) => {
      pauseController?.detach(child.pid);
      signal?.removeEventListener('abort', abortHandler);
      reject(error);
    });

    child.on('close', (code) => {
      pauseController?.detach(child.pid);
      signal?.removeEventListener('abort', abortHandler);
      if (aborted || signal?.aborted) {
        reject(new CancelledError());
      } else if (code === 0) {
        resolve({ code, outputTail });
      } else {
        const error = new Error(`7-Zip 退出码为 ${code}。${outputTail.trim() ? ` 输出：${outputTail.trim()}` : ''}`);
        error.code = 'SEVEN_ZIP_FAILED';
        error.exitCode = code;
        reject(error);
      }
    });
  });
}

function archiveContentMismatch() {
  const error = new Error('归档内容与源文件及目录清单不一致，已停止发布。');
  error.code = 'ARCHIVE_CONTENT_MISMATCH';
  return error;
}

function createArchiveListingReader() {
  const entries = new Map();
  let remainder = '';
  let current = {};
  let parseError = null;
  const commit = () => {
    if (Object.keys(current).length === 0) return;
    const name = current.path?.replace(/\\/g, '/').replace(/\/+$/, '');
    const directory = current.folder === '+' || String(current.attributes || '').startsWith('D');
    const size = Number(current.size);
    if (!name || entries.has(name) || (!directory && (!Number.isSafeInteger(size) || size < 0))) {
      throw archiveContentMismatch();
    }
    entries.set(name, { directory, size: directory ? 0 : size });
    current = {};
  };
  const line = (value) => {
    const content = value.replace(/\r$/, '');
    if (!content) { commit(); return; }
    for (const [prefix, key] of [
      ['Path = ', 'path'], ['Size = ', 'size'], ['Attributes = ', 'attributes'], ['Folder = ', 'folder']
    ]) {
      if (content.startsWith(prefix)) { current[key] = content.slice(prefix.length); return; }
    }
  };
  return {
    push(chunk) {
      if (parseError) return;
      try {
        remainder += chunk;
        let end;
        while ((end = remainder.indexOf('\n')) !== -1) {
          line(remainder.slice(0, end));
          remainder = remainder.slice(end + 1);
        }
      } catch (error) { parseError = error; }
    },
    finish() {
      if (parseError) throw parseError;
      if (remainder) line(remainder);
      commit();
      return entries;
    }
  };
}

function assertArchiveContentsMatch(job, manifest, directories, entries) {
  const sourceName = path.basename(job.sourcePath);
  const expectedFiles = new Map(manifest.map((file) => [
    job.sourceType === 'video' ? sourceName : `${sourceName}/${file.relativePath}`,
    Number(file.size)
  ]));
  const expectedDirectories = new Set(job.sourceType === 'video' ? [] : [
    sourceName, ...directories.map((directory) => `${sourceName}/${directory}`)
  ]);
  const actualFiles = new Map();
  const actualDirectories = new Set();
  for (const [entryPath, entry] of entries) {
    if (entry.directory) actualDirectories.add(entryPath);
    else actualFiles.set(entryPath, entry.size);
    const parts = entryPath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      actualDirectories.add(parts.slice(0, index).join('/'));
    }
  }
  if (expectedFiles.size !== actualFiles.size || expectedDirectories.size !== actualDirectories.size ||
      [...expectedFiles].some(([name, size]) => actualFiles.get(name) !== size) ||
      [...expectedDirectories].some((name) => !actualDirectories.has(name)) ||
      [...actualDirectories].some((name) => !expectedDirectories.has(name))) {
    throw archiveContentMismatch();
  }
}

async function verifyArchiveContents(sevenZipPath, archivePath, job, manifest, directories, password, options = {}) {
  const reader = createArchiveListingReader();
  await runProcess(sevenZipPath, buildListArgs(archivePath, password), {
    ...options,
    onStdout: (chunk) => reader.push(chunk)
  });
  assertArchiveContentsMatch(job, manifest, directories, reader.finish());
}

async function buildArchiveInputs(job, manifest, directories) {
  const sourceName = path.basename(job.sourcePath);
  if (job.sourceType === 'video') return [sourceName];
  const inputs = manifest.map((file) => path.join(sourceName, ...file.relativePath.split('/')));
  const occupied = new Set();
  for (const directory of directories) {
    const slash = directory.lastIndexOf('/');
    if (slash > 0) occupied.add(directory.slice(0, slash));
  }
  for (const file of manifest) {
    const slash = file.relativePath.lastIndexOf('/');
    if (slash > 0) occupied.add(file.relativePath.slice(0, slash));
  }
  for (const directory of directories) {
    if (occupied.has(directory)) continue;
    const absolutePath = path.join(job.sourcePath, ...directory.split('/'));
    if ((await fs.readdir(absolutePath)).length !== 0) {
      const error = new Error('归档前源目录结构发生变化，请重新扫描。');
      error.code = 'SOURCE_CHANGED';
      throw error;
    }
    inputs.push(path.join(sourceName, ...directory.split('/')));
  }
  if (inputs.length === 0 && (await fs.readdir(job.sourcePath)).length === 0) inputs.push(sourceName);
  return inputs;
}

async function assertUsableConfiguration(config, sourcePath) {
  const executable = await fs.stat(config.sevenZipPath);
  if (!executable.isFile()) throw new Error('7-Zip 路径不是文件。');

  validatePathLayout(config, sourcePath);

  await fs.mkdir(config.archiveStagingDirectory, { recursive: true });
  let archiveOutputStats;
  try {
    archiveOutputStats = await fs.stat(config.archiveOutputDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error('压缩包存储位置不存在；请先确认是否创建，或重新选择位置。');
      missing.code = 'ARCHIVE_OUTPUT_DIRECTORY_MISSING';
      throw missing;
    }
    throw error;
  }
  if (!archiveOutputStats.isDirectory()) throw new Error('压缩包存储位置不是文件夹。');
  await fs.mkdir(config.repositoryDirectory, { recursive: true });
  await Promise.all([
    fs.access(config.archiveStagingDirectory, fsConstants.R_OK | fsConstants.W_OK),
    fs.access(config.archiveOutputDirectory, fsConstants.R_OK | fsConstants.W_OK),
    fs.access(config.repositoryDirectory, fsConstants.R_OK | fsConstants.W_OK)
  ]);
}

async function assertEnoughDiskSpace(directory, requiredBytes, label = '暂存磁盘') {
  if (typeof fs.statfs !== 'function') {
    const error = new Error(`${label}剩余空间无法读取，已停止任务以避免生成不完整压缩包。`);
    error.code = 'DISK_SPACE_CHECK_UNAVAILABLE';
    throw error;
  }
  let stats;
  try {
    stats = await fs.statfs(directory);
  } catch (cause) {
    const error = new Error(`${label}剩余空间读取失败，已停止任务：${cause.message}`);
    error.code = 'DISK_SPACE_CHECK_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  const safetyMargin = Math.max(1024 ** 3, Math.ceil(requiredBytes * 0.05));
  if (freeBytes < requiredBytes + safetyMargin) {
    const error = new Error(`${label}可用空间不足，无法安全处理当前任务。`);
    error.code = 'INSUFFICIENT_DISK_SPACE';
    throw error;
  }
}

async function sameStorage(firstPath, secondPath) {
  const [first, second] = await Promise.all([
    fs.stat(firstPath, { bigint: true }),
    fs.stat(secondPath, { bigint: true })
  ]);
  if (process.platform === 'win32') {
    const firstRoot = path.parse(path.resolve(firstPath)).root.toLowerCase();
    const secondRoot = path.parse(path.resolve(secondPath)).root.toLowerCase();
    if (firstRoot !== secondRoot) return false;
  }
  return String(first.dev) === String(second.dev);
}

async function removeAppOwnedDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
}

async function listArchiveFiles(directory, archiveBaseName) {
  const names = await fs.readdir(directory);
  return names
    .filter((name) => name === archiveBaseName || name.startsWith(`${archiveBaseName}.`))
    .sort();
}

async function copyDirectoryVerified(sourceDir, destinationDir) {
  const incomingDir = `${destinationDir}.incoming`;
  await fs.rm(incomingDir, { recursive: true, force: true });
  await fs.cp(sourceDir, incomingDir, { recursive: true, errorOnExist: true, force: false });

  const sourceNames = await fs.readdir(sourceDir);
  for (const name of sourceNames) {
    const sourceStats = await fs.stat(path.join(sourceDir, name));
    const destinationStats = await fs.stat(path.join(incomingDir, name));
    if (sourceStats.size !== destinationStats.size) {
      throw new Error(`跨磁盘复制校验失败：${name}`);
    }
  }

  await fs.rename(incomingDir, destinationDir);
  await fs.rm(sourceDir, { recursive: true, force: true });
}

async function moveTaskDirectory(sourceDir, destinationDir) {
  try {
    await fs.rename(sourceDir, destinationDir);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await copyDirectoryVerified(sourceDir, destinationDir);
  }
}

async function publishArchiveFiles(
  sourceDir,
  archiveRoot,
  archiveNames,
  expectedSourceIdentities = new Map(),
  { copySpacePrechecked = false } = {}
) {
  await fs.mkdir(archiveRoot, { recursive: true });
  for (const name of archiveNames) {
    try {
      await fs.access(path.join(archiveRoot, name));
      throw new Error(`归档库中已经存在同名文件：${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const published = [];
  let usedCrossDiskCopy = false;
  let usedSameDiskCopy = false;
  let copySpaceChecked = copySpacePrechecked;
  try {
    for (let index = 0; index < archiveNames.length; index += 1) {
      const name = archiveNames[index];
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(archiveRoot, name);
      let expectedSourceIdentity = expectedSourceIdentities.get(name);
      if (!expectedSourceIdentity) {
        expectedSourceIdentity = await readPublishedFileIdentity(sourcePath);
        expectedSourceIdentities.set(name, expectedSourceIdentity);
      }
      let targetIdentity;
      let linkedTarget = false;
      try {
        // Linking reserves the final name atomically: a concurrent owner wins
        // with EEXIST instead of being overwritten by a rename.
        await fs.link(sourcePath, targetPath);
        linkedTarget = true;
        targetIdentity = await readPublishedFileIdentity(targetPath);
        if (!samePublishedFileIdentity(expectedSourceIdentity, targetIdentity)) {
          const error = new Error(`归档成品移动后身份复核失败：${name}`);
          error.code = 'ARCHIVE_PUBLICATION_IDENTITY_CHANGED';
          throw error;
        }
        if (!samePublishedFileIdentity(expectedSourceIdentity, await readPublishedFileIdentity(sourcePath))) {
          throw new Error(`归档成品发布前源文件身份已变化：${name}`);
        }
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
          if (linkedTarget) error.message += `；已占用的成品路径保留待核对：${targetPath}`;
          throw error;
        }
        if (error.code === 'EXDEV') usedCrossDiskCopy = true;
        else usedSameDiskCopy = true;
        expectedSourceIdentity ||= await readPublishedFileIdentity(sourcePath);
        expectedSourceIdentities.set(name, expectedSourceIdentity);
        if (!copySpaceChecked) {
          const remainingNames = archiveNames.slice(index);
          await Promise.all(remainingNames.map(async (remainingName) => {
            if (expectedSourceIdentities.has(remainingName)) return;
            expectedSourceIdentities.set(
              remainingName,
              await readPublishedFileIdentity(path.join(sourceDir, remainingName))
            );
          }));
          const remainingBytes = remainingNames.reduce(
            (sum, remainingName) => sum + Number(expectedSourceIdentities.get(remainingName)?.size || 0),
            0
          );
          await assertEnoughDiskSpace(archiveRoot, remainingBytes, '成品磁盘');
          copySpaceChecked = true;
        }
        try {
          await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
          const [sourceIdentity, copiedIdentity] = await Promise.all([
            readPublishedFileIdentity(sourcePath),
            readPublishedFileIdentity(targetPath)
          ]);
          if (!samePublishedFileIdentity(expectedSourceIdentity, sourceIdentity) ||
              Number(copiedIdentity.size) !== Number(expectedSourceIdentity.size)) {
            throw new Error(`跨磁盘复制校验失败：${name}`);
          }
          targetIdentity = copiedIdentity;
        } catch (copyError) {
          copyError.message += `；请核对可能保留的复制目标：${targetPath}`;
          throw copyError;
        }
      }
      published.push({ targetPath, identity: targetIdentity });
    }
    const publicationFiles = published.map(({ targetPath, identity }) => ({
        name: path.basename(targetPath),
        path: path.resolve(targetPath),
        identity
      }));
    // Transfer only. The staging names remain until runArchiveJob accepts the final files.
    return {
      files: publicationFiles,
      mode: usedCrossDiskCopy ? 'cross_disk_copy' : usedSameDiskCopy ? 'same_disk_copy' : 'same_disk_link'
    };
  } catch (error) {
    if (published.length > 0) {
      const retained = published.map((file) => file.targetPath);
      error.retainedPublishedPaths = retained;
      error.message += `；已发布的成品未自动删除，请核对：${retained.join('；')}`;
    }
    throw error;
  }
}

function isStrictChildPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function readPublishedFileIdentity(filePath) {
  const stats = await fs.stat(filePath, { bigint: true });
  if (!stats.isFile()) throw new Error(`归档成品不是普通文件：${filePath}`);
  return {
    size: Number(stats.size),
    device: String(stats.dev),
    inode: String(stats.ino),
    modifiedNs: String(stats.mtimeNs),
    createdNs: String(stats.birthtimeNs)
  };
}

async function createArchivePublicationReceipt(jobId, archiveRoot, archiveStagingDirectory, archiveNames) {
  const ownerJobId = String(jobId || '');
  if (!ownerJobId || path.basename(ownerJobId) !== ownerJobId || /[\\/]/.test(ownerJobId)) {
    throw new Error('归档任务标识无效，无法登记成品所有权。');
  }
  const resolvedArchiveRoot = path.resolve(archiveRoot);
  const resolvedStagingRoot = path.resolve(archiveStagingDirectory);
  const files = [];
  for (const rawName of archiveNames) {
    const name = String(rawName || '');
    if (!name || path.basename(name) !== name || /[\\/]/.test(name)) {
      throw new Error('归档成品名称无效，无法登记成品所有权。');
    }
    const filePath = path.resolve(resolvedArchiveRoot, name);
    if (!isStrictChildPath(resolvedArchiveRoot, filePath)) {
      throw new Error('归档成品超出最终输出目录，无法登记成品所有权。');
    }
    files.push({ name, path: filePath, identity: await readPublishedFileIdentity(filePath) });
  }
  return {
    ownerJobId,
    publicationId: crypto.randomUUID(),
    archiveRoot: resolvedArchiveRoot,
    stagingRoot: resolvedStagingRoot,
    files
  };
}

async function movePublishedFileToRecovery(sourcePath, recoveryPath, expectedIdentity) {
  const beforeMoveIdentity = await readPublishedFileIdentity(sourcePath);
  if (!samePublishedFileIdentity(expectedIdentity, beforeMoveIdentity)) {
    const error = new Error(`归档成品身份已变化，已拒绝自动移动：${sourcePath}`);
    error.code = 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED';
    throw error;
  }
  try {
    await fs.rename(sourcePath, recoveryPath);
    const movedIdentity = await readPublishedFileIdentity(recoveryPath);
    if (!samePublishedFileIdentity(expectedIdentity, movedIdentity)) {
      try { await fs.rename(recoveryPath, sourcePath); } catch { /* 保留在恢复目录并交由上层报告 */ }
      const error = new Error(`归档成品移动后身份复核失败：${sourcePath}`);
      error.code = 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED';
      throw error;
    }
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
  }

  await fs.copyFile(sourcePath, recoveryPath, fsConstants.COPYFILE_EXCL);
  try {
    const [sourceIdentity, recoveryIdentity] = await Promise.all([
      readPublishedFileIdentity(sourcePath),
      readPublishedFileIdentity(recoveryPath)
    ]);
    if (!samePublishedFileIdentity(expectedIdentity, sourceIdentity) ||
        Number(recoveryIdentity.size) !== Number(expectedIdentity.size)) {
      throw new Error('跨磁盘恢复副本校验失败。');
    }
    await fs.rm(sourcePath);
  } catch (error) {
    await fs.rm(recoveryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function recoverPublishedArchiveFiles(publication) {
  if (!publication || !Array.isArray(publication.files) || publication.files.length === 0) {
    return { recoveryDirectory: '', recoveredFiles: [] };
  }
  const rawArchiveRoot = String(publication.archiveRoot || '').trim();
  const rawStagingRoot = String(publication.stagingRoot || '').trim();
  if (!rawArchiveRoot || !rawStagingRoot) {
    throw new Error('归档成品发布凭据缺少最终目录或暂存目录，已拒绝自动补偿。');
  }
  const archiveRoot = path.resolve(rawArchiveRoot);
  const stagingRoot = path.resolve(rawStagingRoot);
  const ownerJobId = String(publication.ownerJobId || '');
  const publicationId = String(publication.publicationId || '');
  if (!ownerJobId || path.basename(ownerJobId) !== ownerJobId || /[\\/]/.test(ownerJobId) ||
      !publicationId || path.basename(publicationId) !== publicationId || /[\\/]/.test(publicationId)) {
    throw new Error('归档成品发布凭据无效，已拒绝自动补偿。');
  }

  const recoveryRoot = path.join(stagingRoot, 'recovery');
  const recoveryDirectory = path.join(recoveryRoot, ownerJobId, publicationId);
  const verified = [];
  for (const file of publication.files) {
    const sourcePath = path.resolve(String(file.path || ''));
    if (!isStrictChildPath(archiveRoot, sourcePath) || path.basename(sourcePath) !== String(file.name || '')) {
      const error = new Error('归档成品发布凭据超出最终输出目录，已拒绝自动补偿。');
      error.code = 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED';
      error.unrecoveredPaths = publication.files.map((item) => String(item.path || '')).filter(Boolean);
      throw error;
    }
    let currentIdentity;
    try {
      currentIdentity = await readPublishedFileIdentity(sourcePath);
    } catch (cause) {
      const error = new Error(`无法复核本任务刚发布的归档成品：${sourcePath} · ${cause.message}`);
      error.code = 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED';
      error.unrecoveredPaths = publication.files.map((item) => String(item.path || '')).filter(Boolean);
      throw error;
    }
    if (!samePublishedFileIdentity(file.identity, currentIdentity)) {
      const error = new Error(`归档成品身份已变化，已拒绝自动移动：${sourcePath}`);
      error.code = 'ARCHIVE_RECOVERY_OWNERSHIP_UNVERIFIED';
      error.unrecoveredPaths = publication.files.map((item) => String(item.path || '')).filter(Boolean);
      throw error;
    }
    verified.push({ ...file, sourcePath });
  }

  const recoveredFiles = [];
  try {
    await fs.mkdir(path.dirname(recoveryDirectory), { recursive: true });
    await fs.mkdir(recoveryDirectory);
    for (const file of verified) {
      const recoveryPath = path.join(recoveryDirectory, file.name);
      await movePublishedFileToRecovery(file.sourcePath, recoveryPath, file.identity);
      recoveredFiles.push({ originalPath: file.sourcePath, recoveryPath });
    }
    await fs.writeFile(path.join(recoveryDirectory, 'recovery.json'), `${JSON.stringify({
      type: 'catalog-commit-recovery',
      ownerJobId,
      publicationId,
      recoveredAt: new Date().toISOString(),
      files: recoveredFiles
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return { recoveryDirectory, recoveredFiles };
  } catch (cause) {
    const recoveredOriginalPaths = new Set(recoveredFiles.map((item) => item.originalPath));
    const error = new Error(`归档成品补偿未完成：${cause.message}`);
    error.code = 'ARCHIVE_RECOVERY_INCOMPLETE';
    error.recoveryDirectory = recoveryDirectory;
    error.recoveredFiles = recoveredFiles;
    error.unrecoveredPaths = verified
      .map((file) => file.sourcePath)
      .filter((filePath) => !recoveredOriginalPaths.has(filePath));
    throw error;
  }
}

async function runArchiveJob(job, config, hooks = {}, signal) {
  const onStage = hooks.onStage || (async () => {});
  const onProgress = hooks.onProgress || (() => {});
  const onLog = hooks.onLog || (() => {});
  const pauseController = hooks.pauseController;
  const volumeJob = {
    ...job,
    archiveVolumeEnabled: typeof job.archiveVolumeEnabled === 'boolean'
      ? job.archiveVolumeEnabled
      : config.archiveVolumeEnabled === true,
    archiveVolumeBytes: Number(job.archiveVolumeBytes ?? config.archiveVolumeBytes ?? LARGE_TASK_BYTES)
  };

  await assertUsableConfiguration(config, job.sourcePath);
  const taskStagingDir = path.join(config.archiveStagingDirectory, job.id);
  const archiveRoot = config.archiveOutputDirectory;
  let publicationStarted = false;

  try {
    await removeAppOwnedDirectory(taskStagingDir);
    await fs.mkdir(taskStagingDir, { recursive: true });

    await onStage('inventorying', '正在生成逐文件清单与 MD5');
    const manifest = hooks.preparedManifest || await buildManifest(job.sourcePath, job.sourceType, {
        jobId: job.id,
        signal,
        pauseController,
        preparedSnapshot: hooks.preparedSnapshot,
        reuseManifest: hooks.reuseManifest,
        largeFolderSimplification: job.largeFolderSimplification ?? config.largeFolderSimplification,
        largeFolderFileThreshold: job.largeFolderFileThreshold ?? config.largeFolderFileThreshold,
        largeFolderMd5SampleLimit: job.largeFolderMd5SampleLimit ?? config.largeFolderMd5SampleLimit,
        skipTinyMd5Files: job.skipTinyMd5Files ?? config.skipTinyMd5Files,
        tinyFileMd5ThresholdBytes: job.tinyFileMd5ThresholdBytes ?? config.tinyFileMd5ThresholdBytes,
        onMetadataReady: hooks.onManifestMetadataReady,
        onPlan: hooks.onInventoryPlan,
        onProgress: (progress) => {
          onProgress(progress.percent);
          if (progress.currentFile) hooks.onInventoryProgress?.(progress);
        },
        onSkippedFile: (item) => {
          onLog(`已跳过无法读取的${item.type === 'directory' ? '目录' : '文件'}：${item.path}（${item.code}）`);
          hooks.onSkippedFile?.(item);
        }
      });
    const skippedFiles = manifest.skippedFiles || job.skippedFiles || [];
    const manifestBytes = manifest.reduce((sum, file) => sum + file.size, 0);
    if (skippedFiles.length === 0 && (manifest.length !== job.fileCount || manifestBytes !== job.totalBytes)) {
      const error = new Error('源文件在扫描后发生变化，请重新扫描后再归档。');
      error.code = 'SOURCE_CHANGED';
      throw error;
    }
    const directories = Array.isArray(manifest.directories)
      ? manifest.directories
      : await collectDirectories(job.sourcePath, job.sourceType, {
        signal,
        pauseController,
        onSkippedFile: (item) => {
          onLog(`清单目录已跳过：${item.path}（${item.code}）`);
          hooks.onSkippedFile?.(item);
        }
      });

    const sourceSnapshot = manifest.sourceSnapshot || sourceSnapshotFromManifest(
      job.sourcePath, job.sourceType, manifest, directories, { complete: skippedFiles.length === 0 }
    );
    if (skippedFiles.length > 0 || sourceSnapshot.complete !== true) {
      const error = new Error('源文件或目录清单不完整，已停止归档；请处理无法读取的内容后重试。');
      error.code = 'ARCHIVE_SOURCE_INCOMPLETE';
      throw error;
    }
    if (hooks.preparedManifest && !hooks.preparedManifestValidated) {
      await validateManifestUnchanged(job.sourcePath, job.sourceType, manifest, signal, pauseController, sourceSnapshot);
    }

    await hooks.onManifestReady?.(manifest, directories);

    await assertEnoughDiskSpace(config.archiveStagingDirectory, job.totalBytes);
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();

    const outputPath = path.join(taskStagingDir, job.archiveBaseName);
    const listFilePath = path.join(taskStagingDir, 'archive-inputs.txt');
    const archiveInputs = await buildArchiveInputs(job, manifest, directories);
    if (archiveInputs.length === 0) throw new Error('没有可安全读取并归档的文件。');
    await fs.writeFile(listFilePath, `\uFEFF${archiveInputs.map((value) => `"${value}"`).join('\r\n')}\r\n`, 'utf8');
    const hasPassword = Boolean(config.archivePassword);
    const archiveVolumeBytes = resolveArchiveVolumeBytes(volumeJob);
    await onStage('compressing', archiveVolumeBytes > 0
      ? `${hasPassword ? '正在加密压缩' : '正在压缩'}并生成 ${formatVolumeBytes(archiveVolumeBytes)} 分卷`
      : (hasPassword ? '正在加密压缩' : '正在压缩'));
    onLog(hasPassword ? '开始调用 7-Zip；密码参数已隐藏。' : '开始调用 7-Zip；本任务未设置密码。');
    const compressStartedAt = Date.now();
    await runProcess(config.sevenZipPath, buildCompressArgs(volumeJob, outputPath, config.archivePassword, listFilePath), {
      cwd: path.dirname(job.sourcePath),
      signal,
      pauseController,
      onProgress,
      onOutput: () => {}
    });
    performanceTrace.record({ jobId: job.id, stage: '7zip-compress', elapsedMs: Date.now() - compressStartedAt,
      fileCount: manifest.length, bytes: manifestBytes });

    const archiveFiles = await listArchiveFiles(taskStagingDir, job.archiveBaseName);
    if (archiveFiles.length === 0) throw new Error('7-Zip 成功退出，但没有找到输出压缩包。');
    const stagedIdentities = new Map();
    await Promise.all(archiveFiles.map(async (name) => {
      stagedIdentities.set(name, await readPublishedFileIdentity(path.join(taskStagingDir, name)));
    }));

    await onStage('verifying', '正在复核源文件未发生变化');
    const revalidationStartedAt = Date.now();
    await validateManifestUnchanged(job.sourcePath, job.sourceType, manifest, signal, pauseController, sourceSnapshot);
    performanceTrace.record({ jobId: job.id, stage: 'source-revalidation',
      elapsedMs: Date.now() - revalidationStartedAt, fileCount: manifest.length });

    const crossStorage = !(await sameStorage(taskStagingDir, archiveRoot));
    if (crossStorage) {
      const stagedArchiveBytes = [...stagedIdentities.values()]
        .reduce((sum, identity) => sum + Number(identity.size || 0), 0);
      await assertEnoughDiskSpace(archiveRoot, stagedArchiveBytes, '成品磁盘');
    }
    await onStage('moving', '正在把待验收成品传输到归档库');
    const publicationId = crypto.randomUUID();
    const publicationStartedAt = Date.now();
    publicationStarted = true;
    const publicationResult = await publishArchiveFiles(
      taskStagingDir, archiveRoot, archiveFiles, stagedIdentities, { copySpacePrechecked: crossStorage }
    );
    const publishedFiles = publicationResult.files;
    const archivePublicationMode = publicationResult.mode;
    const publicationLabel = archivePublicationMode === 'cross_disk_copy' ? '跨盘复制'
      : archivePublicationMode === 'same_disk_copy' ? '同盘复制' : '同盘链接';
    onLog(`待验收成品已就位：${publicationLabel} ${publishedFiles.length} 个文件。`);
    performanceTrace.record({ jobId: job.id, stage: 'archive-publication',
      elapsedMs: Date.now() - publicationStartedAt, fileCount: publishedFiles.length,
      bytes: publishedFiles.reduce((sum, file) => sum + Number(file.identity.size || 0), 0),
      mode: archivePublicationMode });

    const verificationTarget = path.join(archiveRoot, archiveFiles[0]);
    await onStage('verifying', '正在执行 7-Zip 完整性测试');
    const testStartedAt = Date.now();
    await runProcess(config.sevenZipPath, buildVerifyArgs(verificationTarget, config.archivePassword), {
      cwd: archiveRoot,
      signal,
      pauseController,
      onProgress,
      onOutput: () => {}
    });
    performanceTrace.record({ jobId: job.id, stage: '7zip-test', elapsedMs: Date.now() - testStartedAt,
      fileCount: archiveFiles.length });

    await onStage('verifying', '正在比对归档与源文件及目录清单');
    const contentCheckStartedAt = Date.now();
    await verifyArchiveContents(config.sevenZipPath, verificationTarget, job, manifest, directories, config.archivePassword, {
      cwd: archiveRoot,
      signal,
      pauseController
    });
    performanceTrace.record({ jobId: job.id, stage: 'archive-content-check', elapsedMs: Date.now() - contentCheckStartedAt,
      fileCount: manifest.length, directoryCount: directories.length });

    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    for (const file of publishedFiles) {
      if (!samePublishedFileIdentity(file.identity, await readPublishedFileIdentity(file.path)) ||
          !samePublishedFileIdentity(stagedIdentities.get(file.name),
            await readPublishedFileIdentity(path.join(taskStagingDir, file.name)))) {
        const error = new Error(`归档成品最终验收后身份已变化：${file.name}`);
        error.code = 'ARCHIVE_PUBLICATION_IDENTITY_CHANGED';
        throw error;
      }
    }
    await fs.rm(taskStagingDir, { recursive: true, force: true });
    onLog(`最终位置验收通过，成品发布完成：${publicationLabel} ${publishedFiles.length} 个文件。`);
    const archivePublication = {
      ownerJobId: String(job.id),
      publicationId,
      archiveRoot: path.resolve(archiveRoot),
      stagingRoot: path.resolve(config.archiveStagingDirectory),
      files: publishedFiles
    };

    const finalFiles = publishedFiles.map((file) => ({
      name: file.name,
      size: file.identity.size,
      identity: {
        device: file.identity.device,
        inode: file.identity.inode,
        modifiedNs: file.identity.modifiedNs,
        createdNs: file.identity.createdNs
      }
    }));

    return {
      archiveFiles: finalFiles,
      archiveTotalBytes: finalFiles.reduce((sum, item) => sum + item.size, 0),
      archiveVolumeBytes: archiveVolumeBytes || null,
      archivePublicationMode,
      manifest,
      directories,
      skippedFiles,
      sourceSnapshot,
      passwordScheme: hasPassword ? PASSWORD_SCHEME : 'none',
      hasPassword,
      archivePublication,
      verifiedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof CancelledError || error.code === 'TASK_CANCELLED') {
      if (!publicationStarted) await removeAppOwnedDirectory(taskStagingDir);
    }
    if (publicationStarted) {
      error.stagingRecoveryDirectory = taskStagingDir;
      error.message += `；待验收现场与暂存来源保留，请核对：${archiveRoot}；${taskStagingDir}`;
    }
    throw error;
  }
}

module.exports = {
  CancelledError,
  assertUsableConfiguration,
  assertEnoughDiskSpace,
  buildCompressArgs,
  buildVerifyArgs,
  resolveArchiveVolumeBytes,
  createArchivePublicationReceipt,
  publishArchiveFiles,
  recoverPublishedArchiveFiles,
  runArchiveJob,
  runProcess
};
