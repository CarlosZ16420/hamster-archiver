'use strict';

const path = require('node:path');
const { makeArchiveStagingDirectory } = require('./paths');
const { codedError } = require('./task-contracts');

const SOURCE_DISPOSITIONS = new Set(['keep', 'move', 'trash']);

function absolutePath(value, label, { required = true } = {}) {
  const text = String(value || '').trim();
  if (!text && !required) return '';
  if (!text || text.includes('\0') || !path.isAbsolute(text)) {
    throw codedError('INVALID_PATH', `${label} must be an absolute local path.`, 'prepare', {
      requiredAction: 'correct_path'
    });
  }
  return path.normalize(text);
}

function savedIntakePreferences(config = {}) {
  const marker = config.intakePreferences;
  if (marker?.version === 1 && SOURCE_DISPOSITIONS.has(marker.sourceDisposition) &&
      String(marker.archiveOutputDirectory || '').trim()) {
    return {
      archiveOutputDirectory: path.normalize(marker.archiveOutputDirectory),
      sourceDisposition: marker.sourceDisposition,
      processedSourceDirectory: marker.sourceDisposition === 'move'
        ? String(marker.processedSourceDirectory || '').trim()
        : ''
    };
  }
  const archiveOutputDirectory = String(config.archiveOutputDirectory || '').trim();
  const move = config.moveCompleted === true;
  const trash = config.autoTrashCompleted === true;
  const processedSourceDirectory = String(config.processedSourceDirectory || '').trim();
  if (!archiveOutputDirectory || (!trash && !(move && processedSourceDirectory))) return null;
  return {
    archiveOutputDirectory: path.normalize(archiveOutputDirectory),
    sourceDisposition: move ? 'move' : 'trash',
    processedSourceDirectory: move ? processedSourceDirectory : ''
  };
}

function resolveIntakeOptions(explicitInput = {}, savedPreferences = {}) {
  const mode = explicitInput.mode;
  if (!['archive', 'inventory_only'].includes(mode)) {
    throw codedError('INVALID_MODE', 'mode must be archive or inventory_only.', 'prepare', {
      requiredAction: 'choose_intake_mode'
    });
  }
  if (mode === 'inventory_only') {
    return Object.freeze({
      mode,
      archiveOutputDirectory: '',
      archiveStagingDirectory: '',
      sourceDisposition: 'keep',
      processedSourceDirectory: ''
    });
  }
  const saved = savedPreferences || {};
  const archiveOutputDirectory = absolutePath(
    explicitInput.archiveOutputDirectory ?? saved.archiveOutputDirectory,
    'archiveOutputDirectory'
  );
  const sourceDisposition = explicitInput.sourceDisposition ?? saved.sourceDisposition;
  if (!SOURCE_DISPOSITIONS.has(sourceDisposition)) {
    throw codedError('INTAKE_PREFERENCES_REQUIRED', 'Choose keep, move, or trash for sourceDisposition.', 'prepare', {
      requiredAction: 'choose_source_disposition'
    });
  }
  const processedSourceDirectory = sourceDisposition === 'move'
    ? absolutePath(explicitInput.processedSourceDirectory ?? saved.processedSourceDirectory, 'processedSourceDirectory')
    : '';
  const archiveStagingDirectory = explicitInput.archiveStagingDirectory
    ? absolutePath(explicitInput.archiveStagingDirectory, 'archiveStagingDirectory')
    : makeArchiveStagingDirectory(archiveOutputDirectory);
  return Object.freeze({
    mode,
    archiveOutputDirectory,
    archiveStagingDirectory,
    sourceDisposition,
    processedSourceDirectory
  });
}

module.exports = { resolveIntakeOptions, savedIntakePreferences };
