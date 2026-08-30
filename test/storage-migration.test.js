'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { migrateToUserData, prepareUserDataTarget } = require('../src/core/storage-migration');
const { makeUserDataLayout, resolveUserDataRootFromLocationFile } = require('../src/core/storage-paths');

test('portable storage migration moves legacy data under the application root and merges the user log once', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-storage-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaceRoot = path.join(root, 'program');
  const oldRepository = path.join(workspaceRoot, 'saves');
  const oldTerms = path.join(workspaceRoot, 'config', 'similarity-ignore-terms.txt');
  const layout = makeUserDataLayout(workspaceRoot, path.join(root, 'electron-profile'));
  const oldProcessed = path.join(workspaceRoot, 'processed');
  await fs.mkdir(path.join(oldRepository, 'thumbnails', 'job-one'), { recursive: true });
  await fs.mkdir(path.join(oldRepository, 'logs'), { recursive: true });
  await fs.mkdir(path.dirname(oldTerms), { recursive: true });
  await fs.mkdir(oldProcessed, { recursive: true });
  await fs.mkdir(layout.logDirectory, { recursive: true });
  await fs.writeFile(path.join(oldRepository, 'warehouse.sqlite'), 'legacy-database');
  await fs.writeFile(path.join(oldRepository, 'thumbnails', 'job-one', '001.png'), 'legacy-thumbnail');
  await fs.writeFile(path.join(oldRepository, 'logs', 'app.log'), 'legacy-log\n');
  await fs.writeFile(oldTerms, 'FC2\nPPV\n');
  await fs.writeFile(path.join(oldProcessed, 'completed.bin'), 'completed-source');
  await fs.writeFile(layout.logPath, 'new-log\n');
  const config = {
    repositoryDirectory: oldRepository,
    archiveStagingDirectory: path.join(workspaceRoot, 'archive-staging'),
    archiveOutputDirectory: path.join(root, 'archives'),
    similarityIgnoreTermsPath: oldTerms
  };

  assert.equal(await migrateToUserData(config, workspaceRoot, layout), true);
  const firstMergedLog = await fs.readFile(layout.logPath, 'utf8');
  await migrateToUserData(config, workspaceRoot, layout);

  assert.equal(config.repositoryDirectory, layout.repositoryDirectory);
  assert.equal(config.archiveStagingDirectory, `${path.resolve(config.archiveOutputDirectory)}-staging`);
  assert.equal(config.similarityIgnoreTermsPath, layout.similarityIgnoreTermsPath);
  assert.equal(config.userDataDirectory, layout.root);
  assert.equal(config.storageSchemaVersion, 3);
  assert.equal(config.migratedRepositoryFrom, oldRepository);
  assert.equal(await fs.readFile(path.join(layout.repositoryDirectory, 'warehouse.sqlite'), 'utf8'), 'legacy-database');
  assert.equal(await fs.readFile(path.join(layout.repositoryDirectory, 'thumbnails', 'job-one', '001.png'), 'utf8'), 'legacy-thumbnail');
  assert.equal(await fs.readFile(layout.similarityIgnoreTermsPath, 'utf8'), 'FC2\nPPV\n');
  assert.equal(await fs.readFile(path.join(layout.processedSourceDirectory, 'completed.bin'), 'utf8'), 'completed-source');
  await assert.rejects(fs.access(oldRepository), /ENOENT/);
  await assert.rejects(fs.access(oldProcessed), /ENOENT/);
  assert.equal((firstMergedLog.match(/legacy-log/g) || []).length, 1);
  assert.equal(await fs.readFile(layout.logPath, 'utf8'), firstMergedLog);
});

test('choosing an empty user data area copies durable data but keeps the old area intact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-user-data-switch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const target = path.join(root, 'target');
  await fs.mkdir(path.join(current, 'config'), { recursive: true });
  await fs.mkdir(path.join(current, 'warehouse'), { recursive: true });
  await fs.mkdir(path.join(current, 'electron'), { recursive: true });
  await fs.mkdir(path.join(current, 'updates'), { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(current, 'config', 'settings.json'), '{"version":1}');
  await fs.writeFile(path.join(current, 'warehouse', 'warehouse.sqlite'), 'database');
  await fs.writeFile(path.join(current, 'electron', 'cache.bin'), 'cache');
  await fs.writeFile(path.join(current, 'updates', 'package.zip'), 'temporary');

  const result = await prepareUserDataTarget(current, target);

  assert.equal(result.mode, 'copied');
  assert.equal(await fs.readFile(path.join(target, 'config', 'settings.json'), 'utf8'), '{"version":1}');
  assert.equal(await fs.readFile(path.join(target, 'warehouse', 'warehouse.sqlite'), 'utf8'), 'database');
  await assert.rejects(fs.access(path.join(target, 'electron')), /ENOENT/);
  await assert.rejects(fs.access(path.join(target, 'updates')), /ENOENT/);
  assert.equal(await fs.readFile(path.join(current, 'warehouse', 'warehouse.sqlite'), 'utf8'), 'database');
});

test('user data switching accepts recognized existing data and rejects unsafe nesting', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-user-data-existing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const existing = path.join(root, 'existing');
  await fs.mkdir(path.join(current, 'config'), { recursive: true });
  await fs.mkdir(path.join(existing, 'config'), { recursive: true });
  await fs.writeFile(path.join(existing, 'config', 'settings.json'), '{}');

  assert.equal((await prepareUserDataTarget(current, existing)).mode, 'existing');
  await assert.rejects(
    prepareUserDataTarget(current, path.join(current, 'nested')),
    /不能互相包含/
  );
});

test('installed distribution resolves data from a pointer beside the default Windows user data root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-installed-storage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const defaultRoot = path.join(root, 'AppData', 'Roaming', 'Hamster Archiver');
  const selectedRoot = path.join(root, 'Documents', 'Hamster data');
  const pointer = path.join(defaultRoot, 'user-data-location.json');
  await fs.mkdir(defaultRoot, { recursive: true });
  await fs.mkdir(selectedRoot, { recursive: true });

  assert.equal(resolveUserDataRootFromLocationFile(pointer, defaultRoot), defaultRoot);
  await fs.writeFile(pointer, JSON.stringify({ userDataDirectory: selectedRoot }), 'utf8');
  assert.equal(resolveUserDataRootFromLocationFile(pointer, defaultRoot), selectedRoot);
});
