'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { makeArchiveStagingDirectory, normalizeForComparison } = require('./paths');

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function inspectTree(targetPath) {
  const stats = await fs.lstat(targetPath);
  if (!stats.isDirectory()) return { files: 1, directories: 0, bytes: stats.size };
  const result = { files: 0, directories: 1, bytes: 0 };
  for (const entry of await fs.readdir(targetPath)) {
    const child = await inspectTree(path.join(targetPath, entry));
    result.files += child.files;
    result.directories += child.directories;
    result.bytes += child.bytes;
  }
  return result;
}

async function verifyCopiedPath(sourcePath, targetPath) {
  const [source, target] = await Promise.all([inspectTree(sourcePath), inspectTree(targetPath)]);
  if (source.files !== target.files || source.directories !== target.directories || source.bytes !== target.bytes) {
    throw new Error(`数据迁移复核失败：${path.basename(sourcePath)}`);
  }
}

async function prepareUserDataTarget(currentRoot, targetRoot) {
  const current = path.resolve(String(currentRoot || ''));
  const target = path.resolve(String(targetRoot || ''));
  if (path.parse(target).root === target) throw new Error('不能把磁盘根目录设为用户数据区。');
  if (normalizeForComparison(current) === normalizeForComparison(target)) {
    return { mode: 'current', target };
  }
  const relativeTarget = path.relative(current, target);
  const relativeCurrent = path.relative(target, current);
  const isInside = (relative) => relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (isInside(relativeTarget) || isInside(relativeCurrent)) {
    throw new Error('新旧用户数据区不能互相包含。');
  }

  await fs.mkdir(target, { recursive: true });
  const targetEntries = await fs.readdir(target);
  if (targetEntries.length > 0) {
    const recognized = await pathExists(path.join(target, 'config', 'settings.json')) ||
      await pathExists(path.join(target, 'warehouse', 'warehouse.sqlite'));
    if (!recognized) {
      throw new Error('所选目录不是空目录，也没有找到可识别的 Hamster Archiver 用户数据。');
    }
    return { mode: 'existing', target };
  }

  const skipped = new Set(['electron', 'updates']);
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    await fs.cp(path.join(current, entry.name), path.join(target, entry.name), {
      recursive: true,
      force: false,
      errorOnExist: true
    });
    await verifyCopiedPath(path.join(current, entry.name), path.join(target, entry.name));
  }
  return { mode: 'copied', target };
}

async function copyPathIfMissing(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath)) || await pathExists(targetPath)) return false;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
  await verifyCopiedPath(sourcePath, targetPath);
  return true;
}

async function movePathIfMissing(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath)) || await pathExists(targetPath)) return false;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: true });
    await verifyCopiedPath(sourcePath, targetPath);
  }
  return true;
}

async function migrateToUserData(config, workspaceRoot, layout) {
  await Promise.all([
    fs.mkdir(layout.configDirectory, { recursive: true }),
    fs.mkdir(layout.logDirectory, { recursive: true })
  ]);

  let changed = false;
  const oldRepository = String(config.repositoryDirectory || '');
  const legacyDefaultRepository = path.join(workspaceRoot, 'saves');
  const usesLegacyDefaultRepository = oldRepository &&
    normalizeForComparison(oldRepository) === normalizeForComparison(legacyDefaultRepository);

  if (usesLegacyDefaultRepository) {
    const movedRepository = await movePathIfMissing(oldRepository, layout.repositoryDirectory);
    if (!movedRepository) {
      await fs.mkdir(layout.repositoryDirectory, { recursive: true });
      for (const entry of ['warehouse.sqlite', 'warehouse.sqlite-wal', 'warehouse.sqlite-shm', 'thumbnails']) {
        await copyPathIfMissing(path.join(oldRepository, entry), path.join(layout.repositoryDirectory, entry));
      }
    }
    config.repositoryDirectory = layout.repositoryDirectory;
    config.migratedRepositoryFrom = oldRepository;
    changed = true;
  }

  const legacyStagingDirectories = [
    path.join(workspaceRoot, 'archive-staging'),
    path.join(workspaceRoot, '压缩暂存目录'),
    path.join(layout.root, 'staging')
  ];
  const derivedStagingDirectory = makeArchiveStagingDirectory(config.archiveOutputDirectory);
  if (derivedStagingDirectory && (!config.archiveStagingDirectory || legacyStagingDirectories.some((candidate) =>
    normalizeForComparison(config.archiveStagingDirectory) === normalizeForComparison(candidate)))) {
    const currentStaging = config.archiveStagingDirectory || legacyStagingDirectories[0];
    await movePathIfMissing(currentStaging, derivedStagingDirectory);
    config.archiveStagingDirectory = derivedStagingDirectory;
    changed = true;
  }

  const legacyProcessedDirectory = path.join(workspaceRoot, 'processed');
  if (!config.processedSourceDirectory ||
      normalizeForComparison(config.processedSourceDirectory) === normalizeForComparison(legacyProcessedDirectory)) {
    await movePathIfMissing(legacyProcessedDirectory, layout.processedSourceDirectory);
    config.processedSourceDirectory = layout.processedSourceDirectory;
    if (config.moveCompleted === undefined) config.moveCompleted = true;
    changed = true;
  }

  if (normalizeForComparison(config.similarityIgnoreTermsPath || path.join(workspaceRoot, 'config', 'similarity-ignore-terms.txt')) !==
      normalizeForComparison(layout.similarityIgnoreTermsPath)) {
    const configuredTermsPath = config.similarityIgnoreTermsPath || path.join(workspaceRoot, 'config', 'similarity-ignore-terms.txt');
    const localMigrationBackup = path.join(workspaceRoot, 'Developer', 'similarity-ignore-terms.txt');
    const sourceTermsPath = await pathExists(configuredTermsPath) ? configuredTermsPath : localMigrationBackup;
    await copyPathIfMissing(sourceTermsPath, layout.similarityIgnoreTermsPath);
    config.similarityIgnoreTermsPath = layout.similarityIgnoreTermsPath;
    changed = true;
  }

  await Promise.all([
    fs.mkdir(layout.repositoryDirectory, { recursive: true }),
    ...(derivedStagingDirectory ? [fs.mkdir(derivedStagingDirectory, { recursive: true })] : []),
    fs.mkdir(layout.processedSourceDirectory, { recursive: true })
  ]);

  const migrationMarker = path.join(layout.configDirectory, '.portable-v3-migrated');
  if (!(await pathExists(migrationMarker))) {
    const legacyLogCandidates = [
      oldRepository ? path.join(oldRepository, 'logs', 'app.log') : '',
      path.join(layout.repositoryDirectory, 'logs', 'app.log')
    ].filter(Boolean);
    const legacyLogPath = (await Promise.all(legacyLogCandidates.map(async (candidate) =>
      await pathExists(candidate) ? candidate : null))).find(Boolean);
    if (legacyLogPath) {
      if (await pathExists(layout.logPath)) {
        const legacyLog = await fs.readFile(legacyLogPath, 'utf8');
        await fs.appendFile(layout.logPath, `\n${legacyLog}`, 'utf8');
        await fs.rm(legacyLogPath, { force: true });
      } else {
        await fs.rename(legacyLogPath, layout.logPath);
      }
      await fs.rmdir(path.dirname(legacyLogPath)).catch(() => {});
    }
    await fs.writeFile(migrationMarker, `${new Date().toISOString()}\n`, 'utf8');
  }

  if (config.storageSchemaVersion !== 3 || config.userDataDirectory !== layout.root) {
    config.storageSchemaVersion = 3;
    config.userDataDirectory = layout.root;
    changed = true;
  }
  return changed;
}

module.exports = {
  copyPathIfMissing,
  migrateToUserData,
  movePathIfMissing,
  pathExists,
  prepareUserDataTarget
};
