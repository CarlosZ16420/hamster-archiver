'use strict';

const path = require('node:path');
const { isPathInside, makeArchiveStagingDirectory } = require('./paths');
const { codedError } = require('./task-contracts');

const SOURCE_DISPOSITIONS = new Set(['keep', 'move', 'trash']);
const LAYOUTS = new Set(['single', 'children', 'ask']);
const DUPLICATE_ACTIONS = new Set(['use_existing', 'ask', 'create_new', 'skip']);

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
      archiveStagingDirectory: path.normalize(marker.archiveOutputDirectory) === path.normalize(config.archiveOutputDirectory || '')
        ? String(config.archiveStagingDirectory || '').trim() : '',
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
    archiveStagingDirectory: String(config.archiveStagingDirectory || '').trim(),
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
  const v2 = explicitInput.responseVersion === 2;
  if (v2) {
    const layout = explicitInput.layout ?? 'single';
    const onDuplicate = explicitInput.onDuplicate ?? 'ask';
    if (!LAYOUTS.has(layout)) throw codedError('INVALID_LAYOUT', 'layout must be single, children, or ask.', 'prepare');
    if (!DUPLICATE_ACTIONS.has(onDuplicate)) {
      throw codedError('INVALID_DUPLICATE_POLICY', 'onDuplicate must be use_existing, ask, create_new, or skip.', 'prepare');
    }
    if (mode === 'inventory_only' && (explicitInput.sourceDisposition && explicitInput.sourceDisposition !== 'keep' ||
        explicitInput.processedSourceDirectory || explicitInput.archiveOutputDirectory || explicitInput.archiveStagingDirectory)) {
      throw codedError('CONFLICTING_INTAKE_OPTIONS', 'Inventory-only intake keeps originals and does not use archive directories.', 'prepare');
    }
    if (mode === 'archive' && explicitInput.sourceDisposition !== 'move' && explicitInput.processedSourceDirectory) {
      throw codedError('CONFLICTING_INTAKE_OPTIONS', 'processedSourceDirectory requires sourceDisposition move.', 'prepare');
    }
    if (mode === 'inventory_only') return Object.freeze({
      responseVersion: 2, mode, layout, onDuplicate,
      archiveOutputDirectory: '', archiveStagingDirectory: '',
      sourceDisposition: 'keep', processedSourceDirectory: ''
    });
    const saved = savedPreferences || {};
    const archiveOutputDirectory = absolutePath(
      explicitInput.archiveOutputDirectory ?? saved.archiveOutputDirectory, 'archiveOutputDirectory');
    const sourceDisposition = explicitInput.sourceDisposition ?? 'keep';
    if (!SOURCE_DISPOSITIONS.has(sourceDisposition)) {
      throw codedError('INVALID_SOURCE_DISPOSITION', 'sourceDisposition must be keep, move, or trash.', 'prepare');
    }
    const processedSourceDirectory = sourceDisposition === 'move'
      ? absolutePath(explicitInput.processedSourceDirectory ?? saved.processedSourceDirectory, 'processedSourceDirectory') : '';
    const savedStaging = path.normalize(String(saved.archiveOutputDirectory || '')) === archiveOutputDirectory
      ? saved.archiveStagingDirectory : '';
    const archiveStagingDirectory = explicitInput.archiveStagingDirectory
      ? absolutePath(explicitInput.archiveStagingDirectory, 'archiveStagingDirectory')
      : savedStaging ? absolutePath(savedStaging, 'archiveStagingDirectory')
        : makeArchiveStagingDirectory(archiveOutputDirectory);
    return Object.freeze({ responseVersion: 2, mode, layout, onDuplicate, archiveOutputDirectory,
      archiveStagingDirectory, sourceDisposition, processedSourceDirectory });
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
  const savedStaging = path.normalize(String(saved.archiveOutputDirectory || '')) === archiveOutputDirectory
    ? saved.archiveStagingDirectory : '';
  const archiveStagingDirectory = explicitInput.archiveStagingDirectory
    ? absolutePath(explicitInput.archiveStagingDirectory, 'archiveStagingDirectory')
    : savedStaging
      ? absolutePath(savedStaging, 'archiveStagingDirectory')
      : makeArchiveStagingDirectory(archiveOutputDirectory);
  return Object.freeze({
    mode,
    archiveOutputDirectory,
    archiveStagingDirectory,
    sourceDisposition,
    processedSourceDirectory
  });
}

function validateExplicitIntakeInput(input = {}) {
  if (input.responseVersion !== 2) return;
  if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100) {
    throw codedError('INVALID_PATHS', 'paths must contain between 1 and 100 local paths.', 'prepare');
  }
  for (const source of input.paths) absolutePath(source, 'source path');
  // Saved preferences are resolved in the running application. These valid
  // placeholders let the client reject malformed explicit values before launch.
  const placeholder = path.resolve('hamster-intake-preflight');
  resolveIntakeOptions(input, {
    archiveOutputDirectory: placeholder,
    processedSourceDirectory: path.join(placeholder, 'processed'),
    sourceDisposition: 'keep'
  });
  if (input.layout !== 'single' && input.layout !== undefined && input.paths.length !== 1) {
    throw codedError('INVALID_LAYOUT', 'children and ask require exactly one source path.', 'prepare');
  }
  if (input.mode === 'archive') {
    const explicitDirectories = ['archiveOutputDirectory', 'archiveStagingDirectory', 'processedSourceDirectory']
      .filter((key) => input[key]).map((key) => ({ key, value: path.normalize(input[key]) }));
    const overlaps = (left, right) => isPathInside(left, right) || isPathInside(right, left);
    for (const source of input.paths) {
      for (const directory of explicitDirectories) {
        if (overlaps(source, directory.value)) {
          throw codedError('INVALID_PATH_LAYOUT', `${directory.key} overlaps a source path.`, 'prepare');
        }
      }
    }
    for (let index = 0; index < explicitDirectories.length; index++) {
      for (const other of explicitDirectories.slice(index + 1)) {
        if (overlaps(explicitDirectories[index].value, other.value)) {
          throw codedError('INVALID_PATH_LAYOUT', `${explicitDirectories[index].key} overlaps ${other.key}.`, 'prepare');
        }
      }
    }
  }
}

module.exports = { resolveIntakeOptions, savedIntakePreferences, validateExplicitIntakeInput };
