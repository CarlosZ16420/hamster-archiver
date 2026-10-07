'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { makeDefaultConfig } = require('../src/core/paths');
const { AppStore } = require('../src/core/store');
const { QueueManager } = require('../src/core/queue-manager');
const { createCapabilityService } = require('../src/core/mcp-capabilities');
const { savedIntakePreferences, resolveIntakeOptions } = require('../src/core/intake-options');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-staging-preference-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AppStore(path.join(root, 'userdata'));
  return { root, store, defaults: makeDefaultConfig(root) };
}

test('new settings enable automatic staging and legacy custom paths survive loading', async (t) => {
  const { root, store, defaults } = await fixture(t);
  assert.equal((await store.loadSettings(defaults)).archiveStagingAutomatic, true);
  const output = path.join(root, 'archives');
  for (const staging of ['', `${output}-staging`, path.join(root, 'custom')]) {
    await store.saveSettings({ archiveOutputDirectory: output, archiveStagingDirectory: staging });
    const loaded = await store.loadSettings(defaults);
    assert.equal(loaded.archiveStagingAutomatic, staging !== path.join(root, 'custom'));
    assert.equal(loaded.archiveStagingDirectory, staging || `${output}-staging`);
  }
  await store.saveSettings({ libraryDir: output, stagingDir: path.join(root, 'legacy-custom') });
  const legacy = new QueueManager(store, await store.loadSettings(defaults));
  assert.equal(legacy.config.archiveStagingAutomatic, false);
  assert.equal(legacy.config.archiveStagingDirectory, path.join(root, 'legacy-custom'));
});

test('automatic staging follows output, while disabling it preserves even the former default path', async (t) => {
  const { root, store, defaults } = await fixture(t);
  const manager = new QueueManager(store, { ...defaults, archiveOutputDirectory: path.join(root, 'first') });
  assert.equal(manager.config.archiveStagingDirectory, path.join(root, 'first-staging'));
  await manager.updateConfig({ ...manager.config, archiveOutputDirectory: path.join(root, 'second') });
  const preserved = path.join(root, 'second-staging');
  assert.equal(manager.config.archiveStagingDirectory, preserved);
  await manager.updateConfig({ ...manager.config, archiveStagingAutomatic: false });
  await manager.updateConfig({ ...manager.config, archiveOutputDirectory: path.join(root, 'third') });
  assert.equal(manager.config.archiveStagingDirectory, preserved);
  assert.equal((await store.loadSettings(defaults)).archiveStagingAutomatic, false);
  assert.equal((await store.loadSettings(defaults)).archiveStagingDirectory, preserved);
  await manager.updateConfig({ ...manager.config, archiveStagingAutomatic: true });
  assert.equal(manager.config.archiveStagingDirectory, path.join(root, 'third-staging'));
  assert.equal((await fs.stat(manager.config.archiveStagingDirectory)).isDirectory(), true);
});

test('manual empty staging survives saves and restart and prevents archive execution without changing jobs', async (t) => {
  const { root, store, defaults } = await fixture(t);
  const manager = new QueueManager(store, { ...defaults, archiveOutputDirectory: path.join(root, 'archives') });
  await manager.updateConfig({ ...manager.config, archiveStagingAutomatic: false, archiveStagingDirectory: '' });
  await manager.updateConfig({ ...manager.config, theme: 'dark' });
  const loaded = await store.loadSettings(defaults);
  const restarted = new QueueManager(store, loaded);
  assert.equal(restarted.config.archiveStagingDirectory, '');
  assert.equal(restarted.config.archiveStagingAutomatic, false);
  restarted.jobs = [{ id: 'waiting', status: 'queued', sourcePath: path.join(root, 'source') }];
  const before = structuredClone(restarted.jobs);
  await assert.rejects(restarted.startArchiveQueue(), (error) => error.code === 'ARCHIVE_STAGING_REQUIRED');
  assert.deepEqual(restarted.jobs, before);
  const saved = savedIntakePreferences(loaded);
  for (const responseVersion of [1, 2]) {
    assert.equal(resolveIntakeOptions({ mode: 'archive', responseVersion, start: false }, saved).archiveStagingDirectory, '');
  }
});

test('MCP manual staging patches opt out of automatic mode and subsequent output patches preserve it', async (t) => {
  const { root, store, defaults } = await fixture(t);
  const manager = new QueueManager(store, { ...defaults, archiveOutputDirectory: path.join(root, 'archives') });
  const service = createCapabilityService(manager);
  const apply = async (patch) => {
    const input = { patch };
    const preview = await service.call('settings.patch', input);
    return service.call('settings.patch', input, preview.confirmation.token);
  };
  const manual = path.join(root, 'manual');
  await apply({ archiveStagingDirectory: manual });
  assert.equal(manager.config.archiveStagingAutomatic, false);
  await apply({ archiveOutputDirectory: path.join(root, 'changed') });
  assert.equal(manager.config.archiveStagingDirectory, manual);
  await apply({ archiveStagingAutomatic: true });
  assert.equal(manager.config.archiveStagingDirectory, path.join(root, 'changed-staging'));
});
