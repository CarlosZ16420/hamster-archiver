'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { verifyFileIntegrityEntriesWithMetadata } = require('./tool-integrity');

let lastProgressAt = 0;

verifyFileIntegrityEntriesWithMetadata(workerData.applicationRoot, workerData.entries, {
  onProgress(progress) {
    const now = Date.now();
    if (progress.processedBytes < progress.totalBytes && now - lastProgressAt < 100) return;
    lastProgressAt = now;
    parentPort.postMessage({ type: 'progress', progress });
  }
}).then((files) => {
  parentPort.postMessage({ type: 'complete', files });
  parentPort.close();
}).catch((error) => {
  parentPort.postMessage({
    type: 'error',
    error: { message: error.message, code: error.code || '', stack: error.stack || '' }
  });
  parentPort.close();
});
