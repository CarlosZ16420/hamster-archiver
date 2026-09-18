'use strict';

const { DatabaseSync } = require('node:sqlite');
const { parentPort, workerData } = require('node:worker_threads');

const MAX_BATCH_RECORDS = 24;
const MAX_BATCH_SOURCE_BYTES = 512 * 1024;

function postError(error) {
  parentPort.postMessage({
    type: 'error',
    error: {
      message: String(error?.message || error || '仓库后台加载失败。'),
      code: error?.code || '',
      stack: error?.stack || ''
    }
  });
}

function sendBatch(records, loaded, total) {
  return new Promise((resolve) => {
    parentPort.once('message', resolve);
    parentPort.postMessage({ type: 'batch', records, loaded, total });
  });
}

let database;
async function loadCatalog() {
  database = new DatabaseSync(workerData.databasePath, { readOnly: true });
  const total = database.prepare('SELECT count(*) AS count FROM catalog_records').get().count;
  const rows = database.prepare('SELECT record_json FROM catalog_records ORDER BY sort_index ASC').iterate();
  let batch = [];
  let batchBytes = 0;
  let loaded = 0;
  for (const row of rows) {
    const source = row.record_json;
    batch.push(JSON.parse(source));
    batchBytes += Buffer.byteLength(source, 'utf8');
    loaded += 1;
    if (batch.length >= MAX_BATCH_RECORDS || batchBytes >= MAX_BATCH_SOURCE_BYTES) {
      await sendBatch(batch, loaded, total);
      batch = [];
      batchBytes = 0;
    }
  }
  if (batch.length > 0) await sendBatch(batch, loaded, total);
  parentPort.postMessage({ type: 'complete', loaded, total });
}

loadCatalog().catch(postError).finally(() => {
  database?.close();
});
