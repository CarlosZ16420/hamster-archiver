'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
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
    this.automationRequestsPath = path.join(
      layout.root || path.dirname(layout.settingsPath),
      'automation',
      'mcp-requests.json'
    );
    this.logWriteTail = Promise.resolve();
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

  async loadCatalogInBackground(repositoryDirectory, onProgress = null) {
    const repository = this.getRepository(repositoryDirectory);
    return new Promise((resolve, reject) => {
      const records = [];
      const worker = new Worker(path.join(__dirname, 'catalog-loader-worker.js'), {
        workerData: { databasePath: repository.databasePath }
      });
      worker.unref();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      worker.on('message', (message) => {
        if (message?.type === 'batch') {
          try {
            records.push(...message.records);
            onProgress?.({ loaded: message.loaded, total: message.total });
          } catch (error) {
            void worker.terminate();
            finish(reject, error);
            return;
          }
          worker.postMessage({ type: 'continue' });
        } else if (message?.type === 'complete') {
          finish(resolve, records);
        } else if (message?.type === 'error') {
          finish(reject, Object.assign(new Error(message.error?.message || '仓库后台加载失败。'), message.error));
        }
      });
      worker.on('error', (error) => finish(reject, error));
      worker.on('exit', (code) => {
        if (!settled && code !== 0) finish(reject, new Error(`仓库后台加载线程异常退出 (${code})。`));
      });
    });
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

  findExactFileMatches(repositoryDirectory, manifest, limit, excludedRecordId = '') {
    return findExactFileMatches(this.getRepository(repositoryDirectory).database, manifest, limit, excludedRecordId);
  }

  async loadPendingManifest(repositoryDirectory, jobId) {
    const row = this.getRepository(repositoryDirectory).database
      .prepare('SELECT manifest_json FROM pending_manifests WHERE job_id = ?')
      .get(String(jobId));
    if (!row) return null;
    const payload = JSON.parse(row.manifest_json);
    if (Array.isArray(payload)) return payload;
    if (!payload || payload.schemaVersion !== 2 || !Array.isArray(payload.manifest)) return null;
    const manifest = payload.manifest;
    Object.defineProperty(manifest, 'directories', {
      value: Array.isArray(payload.directories) ? payload.directories : [], enumerable: false, configurable: true
    });
    Object.defineProperty(manifest, 'skippedFiles', {
      value: Array.isArray(payload.skippedFiles) ? payload.skippedFiles : [], enumerable: false, configurable: true
    });
    if (payload.sourceSnapshot) {
      Object.defineProperty(manifest, 'sourceSnapshot', {
        value: payload.sourceSnapshot, enumerable: false, configurable: true
      });
    }
    return manifest;
  }

  async savePendingManifest(repositoryDirectory, jobId, manifest) {
    this.getRepository(repositoryDirectory).database.prepare(`
      INSERT INTO pending_manifests(job_id, manifest_json) VALUES (?, ?)
      ON CONFLICT(job_id) DO UPDATE SET manifest_json = excluded.manifest_json
    `).run(String(jobId), JSON.stringify({
      schemaVersion: 2,
      manifest: Array.isArray(manifest) ? manifest : [],
      directories: Array.isArray(manifest?.directories) ? manifest.directories : [],
      skippedFiles: Array.isArray(manifest?.skippedFiles) ? manifest.skippedFiles : [],
      sourceSnapshot: manifest?.sourceSnapshot || null
    }));
  }

  async deletePendingManifest(repositoryDirectory, jobId) {
    this.getRepository(repositoryDirectory).database
      .prepare('DELETE FROM pending_manifests WHERE job_id = ?')
      .run(String(jobId));
  }

  async appendLog(_repositoryDirectory, entry) {
    const operation = this.logWriteTail.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      await fs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    });
    this.logWriteTail = operation;
    return operation;
  }

  async loadLogs(limit = 300) {
    let source;
    try {
      source = await fs.readFile(this.logPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const entries = [];
    const lines = source.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== 'object' || typeof entry.at !== 'string' ||
            typeof entry.level !== 'string' || typeof entry.message !== 'string') continue;
        entries.push({
          at: entry.at,
          level: entry.level,
          message: entry.message,
          jobId: entry.jobId ?? null
        });
      } catch {
        // A truncated final line from an interrupted process must not hide older logs.
      }
    }
    return entries.slice(-Math.max(1, Number(limit) || 300));
  }

  async flushLogs() {
    await this.logWriteTail.catch(() => {});
  }

  async loadAutomationRequests() {
    return readJson(this.automationRequestsPath, []);
  }

  async saveAutomationRequests(requests) {
    await writeJsonAtomic(this.automationRequestsPath, requests);
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
