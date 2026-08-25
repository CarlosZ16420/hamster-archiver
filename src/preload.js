'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('archiveApp', {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseDirectory: (initialPath) => ipcRenderer.invoke('dialog:choose-directory', initialPath),
  chooseProgram: (initialPath) => ipcRenderer.invoke('dialog:choose-program', initialPath),
  changeWarehouseLocation: () => ipcRenderer.invoke('warehouse:change-location'),
  openWarehouse: () => ipcRenderer.invoke('warehouse:open'),
  exportWarehouse: () => ipcRenderer.invoke('warehouse:export'),
  importWarehouse: () => ipcRenderer.invoke('warehouse:import'),
  checkForUpdates: (options = {}) => ipcRenderer.invoke('app:check-for-updates', options),
  installUpdatePackage: () => ipcRenderer.invoke('app:update-from-package'),
  changeUserDataLocation: () => ipcRenderer.invoke('user-data:change-location'),
  openSimilarityIgnoreTerms: () => ipcRenderer.invoke('similarity:open-ignore-terms'),
  reloadSimilarityIgnoreTerms: () => ipcRenderer.invoke('similarity:reload-ignore-terms'),
  rebuildAllSimilarity: () => ipcRenderer.invoke('similarity:rebuild-all'),
  openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
  copyText: (value) => ipcRenderer.invoke('system:copy-text', value),
  chooseSingle: (kind) => ipcRenderer.invoke('dialog:choose-single', kind),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  scanSource: (intakeDirectory) => ipcRenderer.invoke('source:scan', intakeDirectory),
  addSingle: (sourcePath) => ipcRenderer.invoke('task:add-single', sourcePath),
  openTaskSource: (jobId) => ipcRenderer.invoke('task:open-source', jobId),
  getDroppedPath: (file) => webUtils.getPathForFile(file),
  confirmTask: (jobId) => ipcRenderer.invoke('task:confirm', jobId),
  confirmAnomaly: (jobId) => ipcRenderer.invoke('task:confirm-anomaly', jobId),
  discardAnomaly: (jobId) => ipcRenderer.invoke('task:discard-anomaly', jobId),
  acknowledgeTrashSafety: (jobId) => ipcRenderer.invoke('task:acknowledge-trash-safety', jobId),
  cancelTask: (jobId) => ipcRenderer.invoke('task:cancel', jobId),
  retryTask: (jobId) => ipcRenderer.invoke('task:retry', jobId),
  startQueue: () => ipcRenderer.invoke('queue:start'),
  startInventoryOnlyQueue: () => ipcRenderer.invoke('queue:start-inventory-only'),
  pauseQueue: () => ipcRenderer.invoke('queue:pause'),
  resumeQueue: () => ipcRenderer.invoke('queue:resume'),
  removeJobs: (jobIds) => ipcRenderer.invoke('queue:remove-jobs', jobIds),
  clearCompletedJobs: () => ipcRenderer.invoke('queue:clear-completed'),
  clearCancelledJobs: () => ipcRenderer.invoke('queue:clear-cancelled'),
  clearQueue: () => ipcRenderer.invoke('queue:clear'),
  clearPotentialDuplicates: () => ipcRenderer.invoke('queue:clear-duplicates'),
  clearExactDuplicates: () => ipcRenderer.invoke('queue:clear-exact-duplicates'),
  confirmAllDuplicates: () => ipcRenderer.invoke('queue:confirm-all-duplicates'),
  finishNextAndPause: () => ipcRenderer.invoke('queue:finish-next'),
  searchCatalog: (query) => ipcRenderer.invoke('catalog:search', query),
  getCatalogSuggestions: (query) => ipcRenderer.invoke('catalog:suggestions', query),
  getWarehouseInsights: () => ipcRenderer.invoke('catalog:insights'),
  getRandomCatalogRecord: (excludeId) => ipcRenderer.invoke('catalog:random', excludeId),
  getCatalogDetails: (recordId) => ipcRenderer.invoke('catalog:details', recordId),
  openCatalogSource: (recordId) => ipcRenderer.invoke('catalog:open-source', recordId),
  restoreCatalogSource: (recordId) => ipcRenderer.invoke('catalog:restore-source', recordId),
  updateCatalogMetadata: (recordId, metadata) => ipcRenderer.invoke('catalog:update-metadata', recordId, metadata),
  recalculateCatalogSimilarity: (recordId) => ipcRenderer.invoke('catalog:recalculate-similarity', recordId),
  removeCatalogSimilarity: (recordId, similarId) => ipcRenderer.invoke('catalog:remove-similarity', recordId, similarId),
  setCatalogCover: (recordId, relativePath) => ipcRenderer.invoke('catalog:set-cover', recordId, relativePath),
  deleteCatalogImage: (recordId, thumbnailRef) => ipcRenderer.invoke('catalog:delete-thumbnail', recordId, thumbnailRef),
  addManualCatalogRecord: (input) => ipcRenderer.invoke('catalog:add-manual', input),
  addCatalogImage: (recordId, input) => ipcRenderer.invoke('catalog:add-image', recordId, input),
  addTagsToCatalogRecords: (recordIds, tags) => ipcRenderer.invoke('catalog:add-tags', recordIds, tags),
  updateBackupLocationForCatalogRecords: (recordIds, location) => ipcRenderer.invoke('catalog:update-backup-location', recordIds, location),
  queueCatalogRecordsForCompression: (recordIds) => ipcRenderer.invoke('catalog:queue-compression', recordIds),
  undoCatalogAction: () => ipcRenderer.invoke('catalog:undo'),
  deleteCatalogRecords: (recordIds, options) => ipcRenderer.invoke('catalog:delete', recordIds, options),
  getThumbnail: (recordId, relativePath) => ipcRenderer.invoke('catalog:thumbnail', recordId, relativePath),
  onStateChanged: (callback) => {
    ipcRenderer.on('state:changed', (_event, state) => callback(state));
  },
  onTaskProgress: (callback) => {
    ipcRenderer.on('task:progress', (_event, progress) => callback(progress));
  },
  onCatalogChanged: (callback) => {
    ipcRenderer.on('catalog:changed', (_event, catalog) => callback(catalog));
  },
  onScanProgress: (callback) => {
    ipcRenderer.on('scan:progress', (_event, progress) => callback(progress));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update:progress', (_event, progress) => callback(progress));
  },
  onSimilarityRebuildProgress: (callback) => {
    ipcRenderer.on('similarity:rebuild-progress', (_event, progress) => callback(progress));
  }
});
