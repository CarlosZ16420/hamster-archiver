'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {
  integrityCheck,
  findCatalogIdsByExactName,
  findCatalogIdsByMd5,
  findCatalogIdsByProjectContent,
  findCatalogIdsByProjectShape,
  findCatalogIdsBySearchTerms,
  findCatalogIdsBySimilarityKeys,
  findExactFileMatches,
  loadCatalog: loadCatalogFromDatabase,
  loadJobs: loadJobsFromDatabase,
  openRepository,
  saveCatalog: saveCatalogToDatabase,
  saveCatalogRecords: saveCatalogRecordsToDatabase,
  saveJobs: saveJobsToDatabase
} = require('./sqlite-repository');

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

const jsonWriteQueues = new Map();

async function performJsonAtomicWrite(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  const previous = jsonWriteQueues.get(resolved) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => performJsonAtomicWrite(resolved, value));
  jsonWriteQueues.set(resolved, operation);
  try {
    await operation;
  } finally {
    if (jsonWriteQueues.get(resolved) === operation) jsonWriteQueues.delete(resolved);
  }
}

class AppStore {
  constructor(userDataOrLayout) {
    const layout = typeof userDataOrLayout === 'string'
      ? {
          settingsPath: path.join(userDataOrLayout, 'settings.json'),
          legacySettingsPath: null,
          logPath: path.join(userDataOrLayout, 'logs', 'app.log')
        }
      : userDataOrLayout;
    if (!layout?.settingsPath || !layout?.logPath) throw new Error('用户数据布局无效。');
    this.settingsPath = layout.settingsPath;
    this.legacySettingsPath = layout.legacySettingsPath || null;
    this.logPath = layout.logPath;
    this.loadedLegacySettings = false;
    this.repositories = new Map();
  }

  async loadSettings(defaults) {
    let saved = await readJson(this.settingsPath, null);
    if (!saved && this.legacySettingsPath) {
      saved = await readJson(this.legacySettingsPath, null);
      this.loadedLegacySettings = Boolean(saved);
    }
    return { ...defaults, ...(saved || {}) };
  }

  async saveSettings(settings) {
    await writeJsonAtomic(this.settingsPath, settings);
  }

  metadataPaths(repositoryDirectory) {
    return {
      repositoryDirectory,
      databasePath: path.join(repositoryDirectory, 'warehouse.sqlite'),
      legacyJobsPath: path.join(repositoryDirectory, 'jobs.json'),
      legacyCatalogPath: path.join(repositoryDirectory, 'catalog.json')
    };
  }

  getRepository(repositoryDirectory) {
    const resolved = path.resolve(repositoryDirectory);
    const current = this.repositories.get(resolved);
    if (current) return current;
    const paths = this.metadataPaths(resolved);
    if (!fsSync.existsSync(paths.databasePath) &&
        (fsSync.existsSync(paths.legacyCatalogPath) || fsSync.existsSync(paths.legacyJobsPath))) {
      const error = new Error(
        `检测到旧版 JSON 存档，但尚未生成 warehouse.sqlite。请先运行 scripts\\migrate-saves-to-sqlite.js 转换“${resolved}”。`
      );
      error.code = 'LEGACY_JSON_REQUIRES_MIGRATION';
      throw error;
    }
    const repository = openRepository(resolved);
    this.repositories.set(resolved, repository);
    return repository;
  }

  async loadJobs(repositoryDirectory) {
    return loadJobsFromDatabase(this.getRepository(repositoryDirectory).database);
  }

  async saveJobs(repositoryDirectory, jobs) {
    return saveJobsToDatabase(this.getRepository(repositoryDirectory).database, jobs);
  }

  async loadCatalog(repositoryDirectory) {
    return loadCatalogFromDatabase(this.getRepository(repositoryDirectory).database);
  }

  async saveCatalog(repositoryDirectory, records) {
    return saveCatalogToDatabase(this.getRepository(repositoryDirectory).database, records);
  }

  async saveCatalogRecords(repositoryDirectory, records, allRecords = records) {
    const sortIndexById = new Map((allRecords || []).map((record, index) => [String(record.id), index]));
    return saveCatalogRecordsToDatabase(this.getRepository(repositoryDirectory).database, records, sortIndexById);
  }

  findCatalogIdsByExactName(repositoryDirectory, nameKey, limit) {
    return findCatalogIdsByExactName(this.getRepository(repositoryDirectory).database, nameKey, limit);
  }

  findCatalogIdsBySearchTerms(repositoryDirectory, terms, limit) {
    return findCatalogIdsBySearchTerms(this.getRepository(repositoryDirectory).database, terms, limit);
  }

  findCatalogIdsBySimilarityKeys(repositoryDirectory, keys, limit) {
    return findCatalogIdsBySimilarityKeys(this.getRepository(repositoryDirectory).database, keys, limit);
  }

  findCatalogIdsByMd5(repositoryDirectory, md5, limit) {
    return findCatalogIdsByMd5(this.getRepository(repositoryDirectory).database, md5, limit);
  }

  findCatalogIdsByProjectShape(repositoryDirectory, fingerprint, limit) {
    return findCatalogIdsByProjectShape(this.getRepository(repositoryDirectory).database, fingerprint, limit);
  }

  findCatalogIdsByProjectContent(repositoryDirectory, fingerprint, limit) {
    return findCatalogIdsByProjectContent(this.getRepository(repositoryDirectory).database, fingerprint, limit);
  }

  findExactFileMatches(repositoryDirectory, manifest, limit) {
    return findExactFileMatches(this.getRepository(repositoryDirectory).database, manifest, limit);
  }

  async loadPendingManifest(repositoryDirectory, jobId) {
    const row = this.getRepository(repositoryDirectory).database
      .prepare('SELECT manifest_json FROM pending_manifests WHERE job_id = ?')
      .get(String(jobId));
    return row ? JSON.parse(row.manifest_json) : null;
  }

  async savePendingManifest(repositoryDirectory, jobId, manifest) {
    this.getRepository(repositoryDirectory).database.prepare(`
      INSERT INTO pending_manifests(job_id, manifest_json) VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET manifest_json = excluded.manifest_json
    `).run(String(jobId), JSON.stringify(manifest));
  }

  async deletePendingManifest(repositoryDirectory, jobId) {
    this.getRepository(repositoryDirectory).database
      .prepare('DELETE FROM pending_manifests WHERE job_id = ?')
      .run(String(jobId));
  }

  async appendLog(_repositoryDirectory, entry) {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async checkpoint(repositoryDirectory) {
    const repository = this.repositories.get(path.resolve(repositoryDirectory));
    if (!repository) return;
    repository.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  closeRepository(repositoryDirectory) {
    const resolved = path.resolve(repositoryDirectory);
    const repository = this.repositories.get(resolved);
    if (!repository) return;
    repository.database.close();
    this.repositories.delete(resolved);
  }

  closeAll() {
    for (const repository of this.repositories.values()) repository.database.close();
    this.repositories.clear();
  }

  async verifyRepository(repositoryDirectory) {
    return integrityCheck(this.getRepository(repositoryDirectory).database);
  }
}

module.exports = { AppStore, readJson, writeJsonAtomic };
