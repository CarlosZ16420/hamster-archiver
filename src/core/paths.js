'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { ARCHIVE_PASSWORD, LARGE_TASK_BYTES, MIB } = require('./constants');

const PORTABLE_SEVEN_ZIP_PATH = path.join('tools', '7zip', '7z.exe');
const PORTABLE_FFMPEG_PATH = path.join('tools', 'ffmpeg', 'ffmpeg.exe');

function normalizeForComparison(input) {
  return path.resolve(input).replace(/[\\/]+$/, '').toLowerCase();
}

function isPathInside(parent, candidate) {
  const parentPath = normalizeForComparison(parent);
  const candidatePath = normalizeForComparison(candidate);
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

function createArchiveName(now = new Date(), randomBytes = crypto.randomBytes, extension = '7z') {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const suffix = randomBytes(4).toString('hex');
  return `arc_${timestamp}_${suffix}.${extension === 'zip' ? 'zip' : '7z'}`;
}

function archiveExtension(config = {}) {
  return String(config.archiveFormat || '7z').toLowerCase() === 'zip' ? 'zip' : '7z';
}

function validateWindowsFileStem(input, label = '自定义名称') {
  const value = String(input ?? '').trim();
  if (!value) throw new Error(`${label}不能为空。`);
  if (value.length > 120) throw new Error(`${label}不能超过 120 个字符。`);
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(value) || /[. ]$/.test(value)) {
    throw new Error(`${label}包含 Windows 文件名不允许的字符，或以句点、空格结尾。`);
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error(`${label}使用了 Windows 保留名称。`);
  }
  return value;
}

function createConfiguredArchiveName(displayName, config = {}, randomBytes = crypto.randomBytes, now = new Date()) {
  const mode = config.archiveNamingMode || 'timestamp_random';
  const extension = archiveExtension(config);
  if (mode === 'original') {
    try {
      const rawStem = path.parse(String(displayName)).name;
      const suffix = randomBytes(4).toString('hex');
      const maxStemLength = Math.max(1, 120 - suffix.length - 1);
      const stem = validateWindowsFileStem(rawStem.slice(0, maxStemLength).replace(/[. ]+$/g, ''), '原文件名');
      return `${stem}_${suffix}.${extension}`;
    } catch {
      return createArchiveName(now, randomBytes, extension);
    }
  }
  if (mode === 'custom_random') {
    const stem = validateWindowsFileStem(config.customArchiveName, '自定义名称');
    return `${stem}_${randomBytes(4).toString('hex')}.${extension}`;
  }
  return createArchiveName(now, randomBytes, extension);
}

function makeArchiveStagingDirectory(archiveOutputDirectory) {
  const output = String(archiveOutputDirectory || '').trim();
  return output ? `${path.resolve(output)}-staging` : '';
}

function resolveApplicationPath(applicationRoot, configuredPath) {
  const value = String(configuredPath || '').trim();
  if (!value) return '';
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(applicationRoot, value);
}

function normalizePortableProgramPath(configuredPath, applicationRoot, portableRelativePath) {
  const value = String(configuredPath || '').trim();
  if (!value) return portableRelativePath;
  const normalizedValue = path.normalize(value).toLowerCase();
  const normalizedTail = path.normalize(portableRelativePath).toLowerCase();
  if (!path.isAbsolute(value) || normalizedValue.endsWith(normalizedTail)) return portableRelativePath;
  const portableAbsolutePath = path.resolve(applicationRoot, portableRelativePath);
  return normalizeForComparison(value) === normalizeForComparison(portableAbsolutePath)
    ? portableRelativePath
    : path.normalize(value);
}

function rebasePortableUserDataPaths(config, layout) {
  const previousRoot = String(config.userDataDirectory || '').trim();
  const currentRoot = path.resolve(layout.root);
  if (previousRoot && normalizeForComparison(previousRoot) !== normalizeForComparison(currentRoot)) {
    for (const key of [
      'repositoryDirectory',
      'processedSourceDirectory',
      'similarityIgnoreTermsPath',
      'archiveStagingDirectory'
    ]) {
      const value = String(config[key] || '').trim();
      if (!value || !isPathInside(previousRoot, value)) continue;
      config[key] = path.join(currentRoot, path.relative(previousRoot, value));
      if (key === 'repositoryDirectory') config.migratedRepositoryFrom = value;
    }
  }
  config.userDataDirectory = currentRoot;
  return config;
}

function makeDefaultConfig(workspaceRoot, userDataLayout = {}) {
  const userDataRoot = userDataLayout.root || path.join(workspaceRoot, 'userdata');
  return {
    storageSchemaVersion: 3,
    language: 'zh-CN',
    userDataDirectory: userDataRoot,
    intakeDirectory: '',
    archiveStagingDirectory: '',
    archiveOutputDirectory: '',
    repositoryDirectory: userDataLayout.repositoryDirectory || path.join(userDataRoot, 'warehouse'),
    sevenZipPath: PORTABLE_SEVEN_ZIP_PATH,
    ffmpegPath: PORTABLE_FFMPEG_PATH,
    similarityIgnoreTermsPath: userDataLayout.similarityIgnoreTermsPath || path.join(userDataRoot, 'config', 'similarity-ignore-terms.txt'),
    similarityStrength: 'standard',
    similarityEnabled: true,
    archivePassword: ARCHIVE_PASSWORD,
    archiveNamingMode: 'timestamp_random',
    customArchiveName: '',
    videoFrameBackup: true,
    videoFrameCount: 3,
    thumbnailLimit: 30,
    archiveFormat: '7z',
    compressionLevel: 1,
    archiveVolumeEnabled: true,
    archiveVolumeBytes: LARGE_TASK_BYTES,
    smallItemFilter: true,
    minimumTaskBytes: 100 * MIB,
    scheduleEnabled: false,
    scheduleStart: '',
    scheduleEnd: '',
    moveCompleted: true,
    processedSourceDirectory: userDataLayout.processedSourceDirectory || path.join(userDataRoot, 'processed'),
    autoTrashCompleted: false,
    recordBackupLocation: false,
    backupLocation: '',
    recordArchivePassword: true,
    suppressInventoryOnlyRisk: false,
    suppressCatalogCompressionRisk: false
  };
}

function validateSourceSelection(config, sourcePath = config.intakeDirectory) {
  if (!sourcePath) throw new Error('请选择需要备份的文件主目录、文件夹或视频。');
  const checks = [
    ['archiveStagingDirectory', '暂存目录不能与所选源项目互相包含。'],
    ['archiveOutputDirectory', '打包后文件存放点不能与所选源项目互相包含。'],
    ['repositoryDirectory', '仓库位置不能与所选源项目互相包含。']
  ];
  for (const [key, message] of checks) {
    const target = String(config[key] || '').trim();
    if (target && (isPathInside(sourcePath, target) || isPathInside(target, sourcePath))) {
      throw new Error(message);
    }
  }
  if (config.moveCompleted && config.processedSourceDirectory) {
    const processedDirectory = config.processedSourceDirectory;
    if (isPathInside(sourcePath, processedDirectory) || isPathInside(processedDirectory, sourcePath)) {
      throw new Error('归档后移动位置不能与源项目互相包含。');
    }
  }
}

function validatePathLayout(config, sourcePath = config.intakeDirectory) {
  const repositoryDirectory = config.repositoryDirectory;
  if (!sourcePath || !config.archiveStagingDirectory || !config.archiveOutputDirectory || !repositoryDirectory) {
    throw new Error('主目录、暂存目录、打包后文件存放点和仓库位置不能为空。');
  }
  validateSourceSelection(config, sourcePath);
  if (isPathInside(config.archiveStagingDirectory, config.archiveOutputDirectory) ||
      isPathInside(config.archiveOutputDirectory, config.archiveStagingDirectory)) {
    throw new Error('暂存目录与库目录不能互相包含。');
  }
  const repositoryOverlapsStaging = isPathInside(config.archiveStagingDirectory, repositoryDirectory) ||
    isPathInside(repositoryDirectory, config.archiveStagingDirectory);
  const repositoryOverlapsOutput = isPathInside(config.archiveOutputDirectory, repositoryDirectory) ||
    isPathInside(repositoryDirectory, config.archiveOutputDirectory);
  if (repositoryOverlapsStaging || repositoryOverlapsOutput) {
    throw new Error('仓库位置不能与暂存目录或打包后文件存放点互相包含。');
  }
  if (config.moveCompleted) {
    if (!config.processedSourceDirectory) throw new Error('启用归档后移动时，必须填写移动位置。');
    const processedDirectory = config.processedSourceDirectory;
    const overlapsSource = isPathInside(sourcePath, processedDirectory) || isPathInside(processedDirectory, sourcePath);
    const overlapsStaging = isPathInside(config.archiveStagingDirectory, processedDirectory) ||
      isPathInside(processedDirectory, config.archiveStagingDirectory);
    const overlapsOutput = isPathInside(config.archiveOutputDirectory, processedDirectory) ||
      isPathInside(processedDirectory, config.archiveOutputDirectory);
    const overlapsRepository = isPathInside(repositoryDirectory, processedDirectory) ||
      isPathInside(processedDirectory, repositoryDirectory);
    if (overlapsSource || overlapsStaging || overlapsOutput || overlapsRepository) {
      throw new Error('归档后移动位置不能与源项目、暂存目录、成品目录或仓库位置互相包含。');
    }
  }
}

module.exports = {
  createArchiveName,
  createConfiguredArchiveName,
  isPathInside,
  makeArchiveStagingDirectory,
  makeDefaultConfig,
  normalizePortableProgramPath,
  normalizeForComparison,
  PORTABLE_FFMPEG_PATH,
  PORTABLE_SEVEN_ZIP_PATH,
  rebasePortableUserDataPaths,
  resolveApplicationPath,
  validatePathLayout,
  validateSourceSelection,
  validateWindowsFileStem
};
