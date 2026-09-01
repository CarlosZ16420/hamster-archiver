'use strict';

const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  ARCHIVE_PASSWORD,
  LARGE_TASK_BYTES,
  MAX_ARCHIVE_VOLUME_BYTES,
  MIN_ARCHIVE_VOLUME_BYTES,
  PASSWORD_SCHEME
} = require('./constants');
const { CancelledError } = require('./archive-engine-errors');
const { buildManifest, collectDirectories, validateManifestUnchanged } = require('./manifest');
const { validatePathLayout } = require('./paths');

function resolveArchiveVolumeBytes(job) {
  const totalBytes = Number(job.totalBytes) || 0;
  const configuredBytes = Number(job.archiveVolumeBytes);
  const validConfiguredSize = Number.isInteger(configuredBytes) &&
    configuredBytes >= MIN_ARCHIVE_VOLUME_BYTES && configuredBytes <= MAX_ARCHIVE_VOLUME_BYTES;
  const customVolumeBytes = job.archiveVolumeEnabled === true && validConfiguredSize
    ? configuredBytes
    : 0;

  if (customVolumeBytes > 0 && totalBytes > customVolumeBytes) return customVolumeBytes;
  // 关闭自定义分卷也不会绕过既有的 10 GiB 大任务安全上限。
  if (totalBytes > LARGE_TASK_BYTES) return LARGE_TASK_BYTES;
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

function runProcess(executable, args, options = {}) {
  const { cwd, signal, pauseController, onOutput = () => {}, onProgress = () => {} } = options;

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

    const consume = (chunk) => {
      const text = chunk.toString('utf8');
      outputTail = `${outputTail}${text}`.slice(-12000);
      onOutput(text);
      const matches = [...text.matchAll(/(?:^|\s)(\d{1,3})%/g)];
      if (matches.length > 0) {
        onProgress(Math.min(100, Number(matches.at(-1)[1])));
      }
    };

    child.stdout.on('data', consume);
    child.stderr.on('data', consume);

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

async function assertUsableConfiguration(config, sourcePath) {
  const executable = await fs.stat(config.sevenZipPath);
  if (!executable.isFile()) throw new Error('7-Zip 路径不是文件。');

  validatePathLayout(config, sourcePath);

  await fs.mkdir(config.archiveStagingDirectory, { recursive: true });
  await fs.mkdir(config.archiveOutputDirectory, { recursive: true });
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
  if (process.platform === 'win32') {
    return path.parse(path.resolve(firstPath)).root.toLowerCase() === path.parse(path.resolve(secondPath)).root.toLowerCase();
  }
  const [first, second] = await Promise.all([fs.stat(firstPath), fs.stat(secondPath)]);
  return first.dev === second.dev;
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

async function publishArchiveFiles(sourceDir, archiveRoot, archiveNames) {
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
  try {
    for (const name of archiveNames) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(archiveRoot, name);
      try {
        await fs.rename(sourcePath, targetPath);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
        const [sourceStats, targetStats] = await Promise.all([fs.stat(sourcePath), fs.stat(targetPath)]);
        if (sourceStats.size !== targetStats.size) throw new Error(`跨磁盘复制校验失败：${name}`);
        await fs.rm(sourcePath, { force: true });
      }
      published.push(targetPath);
    }
    await fs.rm(sourceDir, { recursive: true, force: true });
  } catch (error) {
    await Promise.allSettled(published.map((targetPath) => fs.rm(targetPath, { force: true })));
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

  try {
    await removeAppOwnedDirectory(taskStagingDir);
    await fs.mkdir(taskStagingDir, { recursive: true });

    await onStage('inventorying', '正在生成逐文件清单与 MD5');
    const manifest = hooks.preparedManifest || await buildManifest(job.sourcePath, job.sourceType, {
        signal,
        pauseController,
        largeFolderSimplification: job.largeFolderSimplification ?? config.largeFolderSimplification,
        largeFolderFileThreshold: job.largeFolderFileThreshold ?? config.largeFolderFileThreshold,
        largeFolderMd5SampleLimit: job.largeFolderMd5SampleLimit ?? config.largeFolderMd5SampleLimit,
        skipTinyMd5Files: job.skipTinyMd5Files ?? config.skipTinyMd5Files,
        tinyFileMd5ThresholdBytes: job.tinyFileMd5ThresholdBytes ?? config.tinyFileMd5ThresholdBytes,
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
    if (manifest.length === 0) throw new Error('没有可安全读取并归档的文件。');

    if (hooks.preparedManifest) {
      await validateManifestUnchanged(job.sourcePath, job.sourceType, manifest, signal, pauseController);
    }

    const directories = await collectDirectories(job.sourcePath, job.sourceType, {
      signal,
      pauseController,
      onSkippedFile: (item) => {
        onLog(`清单目录已跳过：${item.path}（${item.code}）`);
        hooks.onSkippedFile?.(item);
      }
    });

    await hooks.onManifestReady?.(manifest);

    await assertEnoughDiskSpace(config.archiveStagingDirectory, job.totalBytes);
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();

    const outputPath = path.join(taskStagingDir, job.archiveBaseName);
    const listFilePath = path.join(taskStagingDir, 'archive-inputs.txt');
    const archiveInputs = manifest.map((file) => job.sourceType === 'video'
      ? path.basename(job.sourcePath)
      : path.join(path.basename(job.sourcePath), ...file.relativePath.split('/')));
    await fs.writeFile(listFilePath, `\uFEFF${archiveInputs.map((value) => `"${value}"`).join('\r\n')}\r\n`, 'utf8');
    const hasPassword = Boolean(config.archivePassword);
    const archiveVolumeBytes = resolveArchiveVolumeBytes(volumeJob);
    await onStage('compressing', archiveVolumeBytes > 0
      ? `${hasPassword ? '正在加密压缩' : '正在压缩'}并生成 ${formatVolumeBytes(archiveVolumeBytes)} 分卷`
      : (hasPassword ? '正在加密压缩' : '正在压缩'));
    onLog(hasPassword ? '开始调用 7-Zip；密码参数已隐藏。' : '开始调用 7-Zip；本任务未设置密码。');
    await runProcess(config.sevenZipPath, buildCompressArgs(volumeJob, outputPath, config.archivePassword, listFilePath), {
      cwd: path.dirname(job.sourcePath),
      signal,
      pauseController,
      onProgress,
      onOutput: () => {}
    });

    const archiveFiles = await listArchiveFiles(taskStagingDir, job.archiveBaseName);
    if (archiveFiles.length === 0) throw new Error('7-Zip 成功退出，但没有找到输出压缩包。');

    await onStage('verifying', '正在复核源文件未发生变化');
    await validateManifestUnchanged(job.sourcePath, job.sourceType, manifest, signal, pauseController);

    const verificationTarget = path.join(taskStagingDir, archiveFiles[0]);
    await onStage('verifying', '正在执行 7-Zip 完整性测试');
    await runProcess(config.sevenZipPath, buildVerifyArgs(verificationTarget, config.archivePassword), {
      cwd: taskStagingDir,
      signal,
      pauseController,
      onProgress,
      onOutput: () => {}
    });

    const stagedArchiveBytes = (await Promise.all(
      archiveFiles.map(async (name) => (await fs.stat(path.join(taskStagingDir, name))).size)
    )).reduce((sum, size) => sum + size, 0);
    if (!(await sameStorage(taskStagingDir, archiveRoot))) {
      await assertEnoughDiskSpace(archiveRoot, stagedArchiveBytes, '成品磁盘');
    }
    await onStage('moving', '正在把已验证成品移入归档库');
    await publishArchiveFiles(taskStagingDir, archiveRoot, archiveFiles);

    const finalFiles = [];
    for (const name of archiveFiles) {
      const stats = await fs.stat(path.join(archiveRoot, name));
      finalFiles.push({ name, size: stats.size });
    }

    return {
      archiveFiles: finalFiles,
      archiveTotalBytes: finalFiles.reduce((sum, item) => sum + item.size, 0),
      archiveVolumeBytes: archiveVolumeBytes || null,
      manifest,
      directories,
      skippedFiles,
      passwordScheme: hasPassword ? PASSWORD_SCHEME : 'none',
      hasPassword,
      verifiedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof CancelledError || error.code === 'TASK_CANCELLED') {
      await removeAppOwnedDirectory(taskStagingDir);
      throw new CancelledError();
    }
    throw error;
  }
}

module.exports = {
  CancelledError,
  assertEnoughDiskSpace,
  buildCompressArgs,
  buildVerifyArgs,
  resolveArchiveVolumeBytes,
  runArchiveJob,
  runProcess
};
