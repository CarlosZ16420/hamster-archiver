'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveIntakeOptions, savedIntakePreferences } = require('../src/core/intake-options');

test('intake keeps custom staging for its output and derives staging after an output change', () => {
  const saved = savedIntakePreferences({
    archiveOutputDirectory: 'D:\\Archive', archiveStagingDirectory: 'E:\\Custom-Staging',
    moveCompleted: true, processedSourceDirectory: 'F:\\Processed'
  });
  assert.equal(resolveIntakeOptions({ mode: 'archive' }, saved).archiveStagingDirectory, 'E:\\Custom-Staging');
  assert.equal(resolveIntakeOptions({ mode: 'archive', archiveOutputDirectory: 'G:\\New' }, saved)
    .archiveStagingDirectory, 'G:\\New-staging');
  assert.equal(resolveIntakeOptions({ mode: 'archive', archiveOutputDirectory: 'G:\\New',
    archiveStagingDirectory: 'H:\\Selected' }, saved).archiveStagingDirectory, 'H:\\Selected');
});
