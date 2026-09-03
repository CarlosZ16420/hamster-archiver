'use strict';

const crypto = require('node:crypto');
const fsSync = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createProjectFingerprint, normalizeName, similarityCandidateKeys } = require('./duplicate-check');

const SCHEMA_VERSION = 3;
const WAREHOUSE_INITIALIZED_MARKER = '.warehouse-initialized';

// 候选键算法版本：saveCatalog 只在记录内容变化时重写键，
// 算法升级后靠这个版本号把存量记录的键整体重建一次。
const SIMILARITY_KEYS_VERSION = '2';

function searchGrams(value) {
  const compact = String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (!compact) return [];
  const grams = new Set();
  for (const character of compact) grams.add(`char:${character}`);
  for (let index = 0; index < compact.length - 1; index += 1) grams.add(`gram:${compact.slice(index, index + 2)}`);
  return [...grams];
}

function stableJson(value) {
  return JSON.stringify(value);
}

function contentHash(json) {
  return crypto.createHash('sha256').update(json).digest('hex');
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_records (
      id TEXT PRIMARY KEY,
      sort_index INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      inventory_date TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL DEFAULT 0,
      record_type TEXT NOT NULL DEFAULT 'archive',
      source_path TEXT NOT NULL DEFAULT '',
      backup_location TEXT NOT NULL DEFAULT '',
      possible_duplicate INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalog_sort_index ON catalog_records(sort_index);
    CREATE INDEX IF NOT EXISTS catalog_title ON catalog_records(title);
    CREATE INDEX IF NOT EXISTS catalog_inventory_date ON catalog_records(inventory_date);
    CREATE INDEX IF NOT EXISTS catalog_rating ON catalog_records(rating);
    CREATE INDEX IF NOT EXISTS catalog_backup_location ON catalog_records(backup_location);

    CREATE TABLE IF NOT EXISTS catalog_tags (
      record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (record_id, tag)
    );
    CREATE INDEX IF NOT EXISTS catalog_tags_tag ON catalog_tags(tag);

    CREATE TABLE IF NOT EXISTS catalog_files (
      record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      relative_path TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      md5 TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (record_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS catalog_files_md5_size ON catalog_files(md5, size);
    CREATE INDEX IF NOT EXISTS catalog_files_name_size ON catalog_files(name, size);

    CREATE TABLE IF NOT EXISTS catalog_project_fingerprints (
      record_id TEXT PRIMARY KEY REFERENCES catalog_records(id) ON DELETE CASCADE,
      file_count INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      shape_hash TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      complete_md5 INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS catalog_project_shape_lookup
      ON catalog_project_fingerprints(shape_hash, file_count, total_bytes);
    CREATE INDEX IF NOT EXISTS catalog_project_content_lookup
      ON catalog_project_fingerprints(content_hash, file_count, total_bytes);

    CREATE TABLE IF NOT EXISTS catalog_name_keys (
      record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
      name_key TEXT NOT NULL,
      PRIMARY KEY (record_id, name_key)
    );
    CREATE INDEX IF NOT EXISTS catalog_name_keys_lookup ON catalog_name_keys(name_key, record_id);

    CREATE TABLE IF NOT EXISTS catalog_search_terms (
      record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
      term TEXT NOT NULL,
      PRIMARY KEY (record_id, term)
    );
    CREATE INDEX IF NOT EXISTS catalog_search_terms_lookup ON catalog_search_terms(term, record_id);

    CREATE TABLE IF NOT EXISTS catalog_similarity_keys (
      record_id TEXT NOT NULL REFERENCES catalog_records(id) ON DELETE CASCADE,
      candidate_key TEXT NOT NULL,
      PRIMARY KEY (record_id, candidate_key)
    );
    CREATE INDEX IF NOT EXISTS catalog_similarity_keys_lookup ON catalog_similarity_keys(candidate_key, record_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      queue_index INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      job_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_queue_index ON jobs(queue_index);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS pending_manifests (
      job_id TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL
    );
  `);
  database.prepare(`
    INSERT INTO metadata(key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));
}

function openRepository(repositoryDirectory, options = {}) {
  fsSync.mkdirSync(repositoryDirectory, { recursive: true });
  const databasePath = options.databasePath || path.join(repositoryDirectory, 'warehouse.sqlite');
  if (fsSync.existsSync(databasePath)) {
    const stats = fsSync.statSync(databasePath);
    const markerPath = path.join(path.dirname(databasePath), WAREHOUSE_INITIALIZED_MARKER);
    const hasRepositoryEvidence = [
      markerPath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
      path.join(path.dirname(databasePath), 'catalog.json'),
      path.join(path.dirname(databasePath), 'jobs.json'),
      path.join(path.dirname(databasePath), 'thumbnails')
    ].some((candidate) => fsSync.existsSync(candidate));
    if (stats.isFile() && stats.size === 0 && hasRepositoryEvidence) {
      const error = new Error(`仓库数据库为空，可能已损坏：${databasePath}。请恢复 warehouse.sqlite 后再启动。`);
      error.code = 'REPOSITORY_DATABASE_EMPTY';
      throw error;
    }
  }
  const database = new DatabaseSync(databasePath);
  initializeSchema(database);
  const markerPath = path.join(path.dirname(databasePath), WAREHOUSE_INITIALIZED_MARKER);
  if (!fsSync.existsSync(markerPath)) {
    try {
      fsSync.writeFileSync(markerPath, `${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  ensureSimilarityKeyVersion(database);
  ensureProjectFingerprintVersion(database);
  return { database, databasePath };
}

function ensureSimilarityKeyVersion(database) {
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'similarity_keys_version'").get();
  if (row?.value === SIMILARITY_KEYS_VERSION) return;
  withTransaction(database, () => {
    database.exec('DELETE FROM catalog_similarity_keys');
    const insertKey = database.prepare(
      'INSERT OR IGNORE INTO catalog_similarity_keys(record_id, candidate_key) VALUES (?, ?)'
    );
    for (const record of database.prepare('SELECT id, record_json FROM catalog_records').all()) {
      let parsed;
      try {
        parsed = JSON.parse(record.record_json);
      } catch {
        continue;
      }
      for (const key of similarityCandidateKeys(parsed, [])) insertKey.run(record.id, key);
    }
    database.prepare(`
      INSERT INTO metadata(key, value) VALUES ('similarity_keys_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(SIMILARITY_KEYS_VERSION);
  });
}

function ensureProjectFingerprintVersion(database) {
  const version = '1';
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'project_fingerprints_version'").get();
  if (row?.value === version) return;
  withTransaction(database, () => {
    database.exec('DELETE FROM catalog_project_fingerprints');
    const insert = database.prepare(`
      INSERT INTO catalog_project_fingerprints(
        record_id, file_count, total_bytes, shape_hash, content_hash, complete_md5
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const record of database.prepare('SELECT id, record_json FROM catalog_records').all()) {
      let parsed;
      try {
        parsed = JSON.parse(record.record_json);
      } catch {
        parsed = {};
      }
      const fingerprint = createProjectFingerprint(parsed.manifest);
      insert.run(
        record.id,
        fingerprint.fileCount,
        fingerprint.totalBytes,
        fingerprint.shapeHash,
        fingerprint.contentHash,
        fingerprint.completeMd5 ? 1 : 0
      );
    }
    database.prepare(`
      INSERT INTO metadata(key, value) VALUES ('project_fingerprints_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(version);
  });
}

function withTransaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function loadCatalog(database) {
  return database.prepare('SELECT record_json FROM catalog_records ORDER BY sort_index ASC')
    .all()
    .map((row) => JSON.parse(row.record_json));
}

function saveCatalog(database, records, options = {}) {
  const normalized = Array.isArray(records) ? records : [];
  const deleteMissing = options.deleteMissing !== false;
  const sortIndexById = options.sortIndexById instanceof Map ? options.sortIndexById : null;
  const existing = new Map(database.prepare('SELECT id, content_hash, sort_index FROM catalog_records').all()
    .map((row) => [row.id, row]));
  const keepIds = new Set();
  const upsertRecord = database.prepare(`
    INSERT INTO catalog_records(
      id, sort_index, title, display_name, inventory_date, rating, record_type,
      source_path, backup_location, possible_duplicate, content_hash, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      sort_index = excluded.sort_index,
      title = excluded.title,
      display_name = excluded.display_name,
      inventory_date = excluded.inventory_date,
      rating = excluded.rating,
      record_type = excluded.record_type,
      source_path = excluded.source_path,
      backup_location = excluded.backup_location,
      possible_duplicate = excluded.possible_duplicate,
      content_hash = excluded.content_hash,
      record_json = excluded.record_json
  `);
  const updateSortIndex = database.prepare('UPDATE catalog_records SET sort_index = ? WHERE id = ?');
  const deleteRecord = database.prepare('DELETE FROM catalog_records WHERE id = ?');
  const deleteTags = database.prepare('DELETE FROM catalog_tags WHERE record_id = ?');
  const insertTag = database.prepare('INSERT OR IGNORE INTO catalog_tags(record_id, tag) VALUES (?, ?)');
  const deleteFiles = database.prepare('DELETE FROM catalog_files WHERE record_id = ?');
  const insertFile = database.prepare(`
    INSERT INTO catalog_files(record_id, ordinal, relative_path, name, size, md5, media_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteNameKeys = database.prepare('DELETE FROM catalog_name_keys WHERE record_id = ?');
  const insertNameKey = database.prepare('INSERT OR IGNORE INTO catalog_name_keys(record_id, name_key) VALUES (?, ?)');
  const deleteSearchTerms = database.prepare('DELETE FROM catalog_search_terms WHERE record_id = ?');
  const insertSearchTerm = database.prepare('INSERT OR IGNORE INTO catalog_search_terms(record_id, term) VALUES (?, ?)');
  const deleteSimilarityKeys = database.prepare('DELETE FROM catalog_similarity_keys WHERE record_id = ?');
  const insertSimilarityKey = database.prepare('INSERT OR IGNORE INTO catalog_similarity_keys(record_id, candidate_key) VALUES (?, ?)');
  const upsertProjectFingerprint = database.prepare(`
    INSERT INTO catalog_project_fingerprints(
      record_id, file_count, total_bytes, shape_hash, content_hash, complete_md5
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      file_count = excluded.file_count,
      total_bytes = excluded.total_bytes,
      shape_hash = excluded.shape_hash,
      content_hash = excluded.content_hash,
      complete_md5 = excluded.complete_md5
  `);
  const indexedIds = new Set(database.prepare('SELECT DISTINCT record_id FROM catalog_search_terms').all().map((row) => row.record_id));

  return withTransaction(database, () => {
    let changed = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      const record = normalized[index];
      if (!record?.id) throw new Error(`第 ${index + 1} 条仓库记录缺少 id。`);
      const id = String(record.id);
      if (keepIds.has(id)) throw new Error(`仓库记录 id 重复：${id}`);
      keepIds.add(id);
      const json = stableJson(record);
      const hash = contentHash(json);
      const previous = existing.get(id);
      const sortIndex = sortIndexById?.get(id) ?? index;
      if (previous?.content_hash === hash && indexedIds.has(id)) {
        if (Number(previous.sort_index) !== sortIndex) updateSortIndex.run(sortIndex, id);
        continue;
      }
      upsertRecord.run(
        id,
        sortIndex,
        String(record.title || ''),
        String(record.displayName || ''),
        String(record.inventoryDate || record.completedAt || ''),
        Number.isInteger(record.rating) ? record.rating : 0,
        record.recordType === 'manual' ? 'manual' : 'archive',
        String(record.sourcePath || ''),
        String(record.backupLocation || ''),
        record.possibleDuplicate ? 1 : 0,
        hash,
        json
      );
      deleteTags.run(id);
      for (const tag of Array.isArray(record.tags) ? record.tags : []) {
        insertTag.run(id, String(tag));
      }
      deleteFiles.run(id);
      for (const [fileIndex, file] of (Array.isArray(record.manifest) ? record.manifest : []).entries()) {
        insertFile.run(
          id,
          fileIndex,
          String(file.relativePath || ''),
          String(file.name || ''),
          Number(file.size) || 0,
          String(file.md5 || ''),
          String(file.mediaType || '')
        );
      }
      deleteNameKeys.run(id);
      for (const name of [record.title, record.displayName]) {
        const nameKey = normalizeName(String(name || ''));
        if (nameKey) insertNameKey.run(id, nameKey);
      }
      deleteSearchTerms.run(id);
      const searchableFields = [
        record.title, record.displayName, ...(record.tags || []), record.notes,
        record.backupLocation, record.sourcePath, record.archiveBaseName,
        ...(record.manifest || []).map((file) => file.relativePath)
      ];
      for (const term of new Set(searchableFields.flatMap(searchGrams))) insertSearchTerm.run(id, term);
      deleteSimilarityKeys.run(id);
      for (const key of similarityCandidateKeys(record, [])) insertSimilarityKey.run(id, key);
      const fingerprint = createProjectFingerprint(record.manifest);
      upsertProjectFingerprint.run(
        id,
        fingerprint.fileCount,
        fingerprint.totalBytes,
        fingerprint.shapeHash,
        fingerprint.contentHash,
        fingerprint.completeMd5 ? 1 : 0
      );
      changed += 1;
    }
    if (deleteMissing) for (const id of existing.keys()) {
      if (!keepIds.has(id)) {
        deleteRecord.run(id);
        changed += 1;
      }
    }
    return { changed, total: normalized.length };
  });
}

function saveCatalogRecords(database, records, sortIndexById) {
  return saveCatalog(database, records, { deleteMissing: false, sortIndexById });
}

function queryIdsByValues(database, table, column, values, limit = 2000) {
  const normalized = [...new Set((values || []).filter(Boolean))];
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => '?').join(', ');
  return database.prepare(`
    SELECT record_id, COUNT(*) AS hits FROM ${table}
    WHERE ${column} IN (${placeholders})
    GROUP BY record_id ORDER BY hits DESC LIMIT ?
  `).all(...normalized, Math.max(1, Math.min(10000, Number(limit) || 2000))).map((row) => row.record_id);
}

function findCatalogIdsByExactName(database, nameKey, limit = 20) {
  return database.prepare('SELECT record_id FROM catalog_name_keys WHERE name_key = ? LIMIT ?')
    .all(String(nameKey || ''), Math.max(1, Math.min(1000, Number(limit) || 20)))
    .map((row) => row.record_id);
}

function findCatalogIdsBySearchTerms(database, terms, limit = 2000) {
  return queryIdsByValues(database, 'catalog_search_terms', 'term', terms, limit);
}

function findCatalogIdsBySimilarityKeys(database, keys, limit = 2000) {
  return queryIdsByValues(database, 'catalog_similarity_keys', 'candidate_key', keys, limit);
}

function findCatalogIdsByMd5(database, md5, limit = 2000) {
  return database.prepare('SELECT DISTINCT record_id FROM catalog_files WHERE md5 = ? LIMIT ?')
    .all(String(md5 || '').toLowerCase(), Math.max(1, Math.min(10000, Number(limit) || 2000)))
    .map((row) => row.record_id);
}

function findCatalogIdsByProjectShape(database, fingerprint) {
  if (!fingerprint?.shapeHash || !(fingerprint.fileCount > 0)) return [];
  return database.prepare(`
    SELECT record_id FROM catalog_project_fingerprints
    WHERE shape_hash = ? AND file_count = ? AND total_bytes = ?
  `).all(
    fingerprint.shapeHash,
    fingerprint.fileCount,
    fingerprint.totalBytes
  ).map((row) => row.record_id);
}

function findCatalogIdsByProjectContent(database, fingerprint, limit = 20) {
  if (!fingerprint?.contentHash || fingerprint.completeMd5 !== true || !(fingerprint.fileCount > 0)) return [];
  return database.prepare(`
    SELECT record_id FROM catalog_project_fingerprints
    WHERE content_hash = ? AND file_count = ? AND total_bytes = ? AND complete_md5 = 1
    LIMIT ?
  `).all(
    fingerprint.contentHash,
    fingerprint.fileCount,
    fingerprint.totalBytes,
    Math.max(1, Math.min(1000, Number(limit) || 20))
  ).map((row) => row.record_id);
}

function findExactFileMatches(database, manifest, limit = 100) {
  const sourceFiles = (manifest || []).map((file, sourceIndex) => ({ file, sourceIndex }))
    .filter(({ file }) => /^[a-f0-9]{32}$/i.test(String(file?.md5 || '')));
  const matches = [];
  for (let offset = 0; offset < sourceFiles.length; offset += 200) {
    const chunk = sourceFiles.slice(offset, offset + 200);
    const values = chunk.map(() => '(?, ?, ?)').join(', ');
    const parameters = chunk.flatMap(({ file, sourceIndex }) => [
      sourceIndex,
      String(file.md5 || '').trim().toLowerCase(),
      Number(file.size) || 0
    ]);
    const rows = database.prepare(`
      WITH incoming(source_index, md5, size) AS (VALUES ${values}), ranked AS (
        SELECT i.source_index, f.record_id, f.relative_path, r.display_name, r.record_json,
          ROW_NUMBER() OVER (PARTITION BY i.source_index ORDER BY f.record_id, f.ordinal) AS match_rank
        FROM incoming i
        JOIN catalog_files f ON f.md5 = i.md5 AND f.size = i.size
        JOIN catalog_records r ON r.id = f.record_id
      )
      SELECT source_index, record_id, relative_path, display_name, record_json
      FROM ranked WHERE match_rank <= 5 ORDER BY source_index, match_rank
    `).all(...parameters);
    const rowsBySource = new Map();
    for (const row of rows) {
      if (!rowsBySource.has(row.source_index)) rowsBySource.set(row.source_index, []);
      rowsBySource.get(row.source_index).push(row);
    }
    for (const { file, sourceIndex } of chunk) {
      const fileRows = rowsBySource.get(sourceIndex) || [];
      if (fileRows.length === 0) continue;
      matches.push({
        sourceRelativePath: file.relativePath,
        md5: String(file.md5 || '').trim().toLowerCase(),
        size: file.size,
        previous: fileRows.map((row) => {
          const record = JSON.parse(row.record_json);
          return {
            archiveId: row.record_id,
            archiveName: record.archiveBaseName,
            archivedTask: row.display_name,
            relativePath: row.relative_path
          };
        })
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}

function loadJobs(database) {
  return database.prepare('SELECT job_json FROM jobs ORDER BY queue_index ASC')
    .all()
    .map((row) => JSON.parse(row.job_json));
}

function saveJobs(database, jobs) {
  const normalized = Array.isArray(jobs) ? jobs : [];
  const existing = new Map(database.prepare('SELECT id, content_hash, queue_index FROM jobs').all()
    .map((row) => [row.id, row]));
  const keepIds = new Set();
  const upsert = database.prepare(`
    INSERT INTO jobs(id, queue_index, status, source_path, display_name, content_hash, job_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      queue_index = excluded.queue_index,
      status = excluded.status,
      source_path = excluded.source_path,
      display_name = excluded.display_name,
      content_hash = excluded.content_hash,
      job_json = excluded.job_json
  `);
  const updateIndex = database.prepare('UPDATE jobs SET queue_index = ? WHERE id = ?');
  const remove = database.prepare('DELETE FROM jobs WHERE id = ?');
  return withTransaction(database, () => {
    let changed = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      const job = normalized[index];
      if (!job?.id) throw new Error(`第 ${index + 1} 个任务缺少 id。`);
      const id = String(job.id);
      if (keepIds.has(id)) throw new Error(`任务 id 重复：${id}`);
      keepIds.add(id);
      const json = stableJson(job);
      const hash = contentHash(json);
      const previous = existing.get(id);
      if (previous?.content_hash === hash) {
        if (Number(previous.queue_index) !== index) updateIndex.run(index, id);
        continue;
      }
      upsert.run(id, index, String(job.status || ''), String(job.sourcePath || ''), String(job.displayName || ''), hash, json);
      changed += 1;
    }
    for (const id of existing.keys()) {
      if (!keepIds.has(id)) {
        remove.run(id);
        changed += 1;
      }
    }
    return { changed, total: normalized.length };
  });
}

function integrityCheck(database) {
  const result = database.prepare('PRAGMA integrity_check').all();
  return result.length === 1 && result[0].integrity_check === 'ok';
}

module.exports = {
  SCHEMA_VERSION,
  WAREHOUSE_INITIALIZED_MARKER,
  contentHash,
  findCatalogIdsByExactName,
  findCatalogIdsByMd5,
  findCatalogIdsByProjectContent,
  findCatalogIdsByProjectShape,
  findCatalogIdsBySearchTerms,
  findCatalogIdsBySimilarityKeys,
  findExactFileMatches,
  initializeSchema,
  integrityCheck,
  loadCatalog,
  loadJobs,
  openRepository,
  saveCatalog,
  saveCatalogRecords,
  saveJobs,
  searchGrams,
  stableJson,
  withTransaction
};
