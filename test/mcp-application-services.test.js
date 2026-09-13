'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMcpApplicationServices } = require('../src/core/mcp-application-services');
const { runUserDataMigration } = require('../src/core/mcp-user-data-migration-worker');
const { prepareUserDataTarget } = require('../src/core/storage-migration');
const { writeJsonAtomic } = require('../src/core/store');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-app-services-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applicationRoot = path.join(root, 'application');
  const currentDirectory = path.join(root, 'current-user-data');
  const repositoryDirectory = path.join(currentDirectory, 'warehouse');
  await fs.mkdir(path.join(currentDirectory, 'config'), { recursive: true });
  await fs.mkdir(repositoryDirectory, { recursive: true });
  await fs.writeFile(path.join(currentDirectory, 'config', 'settings.json'), '{"language":"zh-CN"}\n');
  await fs.writeFile(path.join(repositoryDirectory, 'warehouse.sqlite'), 'test database');
  await fs.mkdir(applicationRoot, { recursive: true });
  const events = [];
  const queueManager = {
    running: false,
    jobs: [{ id: 'job-1', sourcePath: path.join(root, 'source-one') }],
    catalog: [{ id: 'record-1', originalSourcePath: path.join(root, 'source-two'), sourceDisposition: 'kept' }],
    config: {
      userDataDirectory: currentDirectory,
      repositoryDirectory,
      sevenZipPath: path.join(applicationRoot, '7z.exe')
    },
    async ensureSimilarityIgnoreTermsFile() {
      const result = path.join(currentDirectory, 'config', 'similarity-ignore-terms.txt');
      await fs.writeFile(result, 'sample\n');
      return result;
    }
  };
  const appStore = {
    async saveSettings() { events.push('save-settings'); },
    async checkpoint() { events.push('checkpoint'); },
    closeAll() { events.push('close-all'); }
  };
  const context = {
    app: { isPackaged: true, getVersion: () => '4.6.0' },
    net: { fetch: async () => {} },
    queueManager,
    appStore,
    applicationRoot,
    activeUserDataLocationPath: path.join(applicationRoot, 'user-data-location.json'),
    isInstalledDistribution: false,
    getMainWindow: () => null,
    async showUi(input) { events.push(['show-ui', input]); return input; },
    async copyText(value) { events.push(['copy', value]); },
    async openPath(value) { events.push(['open', value]); return value; },
    async requestQuitForRestart() { events.push('quit'); },
    temporaryDirectory: root,
    processExecutable: path.join(applicationRoot, 'HamsterArchiver.exe'),
    workerScriptPath: path.join(applicationRoot, 'worker.js')
  };
  return { root, applicationRoot, currentDirectory, repositoryDirectory, queueManager, appStore, context, events };
}

function spawnedWorker({ onSpawn } = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.unref = () => {};
  child.kill = () => { child.exitCode = 1; };
  queueMicrotask(async () => {
    try {
      await onSpawn?.();
      child.emit('spawn');
    } catch (error) {
      child.emit('error', error);
    }
  });
  return child;
}

test('application UI, clipboard and controlled paths accept only fixed capabilities', async (t) => {
  const data = await fixture(t);
  const services = createMcpApplicationServices(data.context);
  await services.app.showUi({ section: 'catalog' });
  await services.app.setView({ section: 'settings' });
  await services.app.setTheme({ theme: 'twilight' });
  await services.app.copyText({ text: 'hello' });
  await services.paths.open({ kind: 'warehouse' });
  await services.paths.open({ kind: 'source', id: 'job-1' });
  await services.paths.open({ kind: 'catalog_source', id: 'record-1' });
  await assert.rejects(() => services.app.setTheme({ theme: 'system' }), { code: 'INVALID_THEME' });
  await assert.rejects(() => services.app.setView({ section: 'developer-tools' }), { code: 'INVALID_SECTION' });
  await assert.rejects(() => services.paths.open({ kind: 'arbitrary', id: 'C:\\Windows' }), { code: 'INVALID_PATH_KIND' });
  assert.deepEqual(data.events.slice(0, 4), [
    ['show-ui', { section: 'catalog' }],
    ['show-ui', { section: 'settings' }],
    ['show-ui', { theme: 'twilight' }],
    ['copy', 'hello']
  ]);
});

test('manual update cache binds installation to the checked version and automatic checks do not replace it', async (t) => {
  const data = await fixture(t);
  const checks = [];
  const preparations = [];
  const launches = [];
  data.context.checkForUpdates = async (options) => {
    checks.push(options);
    const latestVersion = options.includeHistory ? '4.7.0' : '4.8.0';
    return {
      currentVersion: '4.6.0', latestVersion, updateAvailable: true, installable: true,
      distributionMode: 'portable', asset: { downloadUrl: `https://github.com/example/${latestVersion}.zip` }
    };
  };
  data.context.prepareUpdate = async (input) => {
    preparations.push(input);
    return { version: input.release.latestVersion, runRoot: path.join(data.root, 'update') };
  };
  data.context.launchUpdate = async (input) => { launches.push(input); return { updaterPid: 42 }; };
  const services = createMcpApplicationServices(data.context);
  await services.updates.check({ mode: 'manual' });
  await services.updates.check({ mode: 'automatic' });
  await assert.rejects(() => services.updates.install({ version: '4.8.0' }), { code: 'UPDATE_CHECK_REQUIRED' });
  const result = await services.updates.install({ version: '4.7.0' });
  assert.equal(result.restarting, true);
  assert.equal(preparations[0].release.latestVersion, '4.7.0');
  assert.equal(launches[0].prepared.version, '4.7.0');
  assert.equal(data.events.at(-1), 'quit');
  assert.equal(checks[0].includeHistory, true);
  assert.equal(checks[1].includeHistory, false);
});

test('migration preflight rejects existing and overlapping targets', async (t) => {
  const data = await fixture(t);
  const services = createMcpApplicationServices(data.context);
  await assert.rejects(
    () => services.userData.preflightMove({ targetDirectory: path.join(data.currentDirectory, 'nested') }),
    { code: 'SOURCE_TARGET_OVERLAP' }
  );
  const existing = path.join(data.root, 'existing-target');
  await fs.mkdir(existing);
  await assert.rejects(
    () => services.userData.preflightMove({ targetDirectory: existing }),
    { code: 'TARGET_ALREADY_EXISTS' }
  );
  await assert.rejects(
    () => services.userData.preflightMove({ targetDirectory: path.join(data.applicationRoot, 'userdata') }),
    { code: 'APPLICATION_TARGET_OVERLAP' }
  );
});

test('migration execution rejects a stale preflight fingerprint before closing the database', async (t) => {
  const data = await fixture(t);
  const services = createMcpApplicationServices(data.context);
  const targetDirectory = path.join(data.root, 'new-user-data');
  const preflight = await services.userData.preflightMove({ targetDirectory });
  await fs.writeFile(path.join(data.currentDirectory, 'config', 'changed-after-preflight.txt'), 'changed');
  await assert.rejects(
    () => services.userData.move({ targetDirectory, expectedStateFingerprint: preflight.stateFingerprint }),
    { code: 'STALE_MIGRATION_STATE' }
  );
  assert.deepEqual(data.events, []);
  await assert.rejects(() => fs.access(targetDirectory), { code: 'ENOENT' });
});

test('migration worker launch failure does not request application exit', async (t) => {
  const data = await fixture(t);
  data.context.spawnImpl = () => spawnedWorker({ onSpawn: async () => { throw new Error('spawn blocked'); } });
  const services = createMcpApplicationServices(data.context);
  const targetDirectory = path.join(data.root, 'new-user-data');
  const preflight = await services.userData.preflightMove({ targetDirectory });
  await assert.rejects(
    () => services.userData.move({ targetDirectory, expectedStateFingerprint: preflight.stateFingerprint }),
    { code: 'MIGRATION_WORKER_START_FAILED' }
  );
  assert.equal(data.events.includes('quit'), false);
  assert.deepEqual(data.events.slice(0, 3), ['save-settings', 'checkpoint', 'close-all']);
  await assert.rejects(() => fs.access(targetDirectory), { code: 'ENOENT' });
});

test('scheduled migration waits for worker acknowledgement before requesting normal exit', async (t) => {
  const data = await fixture(t);
  data.context.spawnImpl = (_executable, _args, options) => spawnedWorker({
    onSpawn: async () => {
      const plan = JSON.parse(await fs.readFile(options.env.HAMSTER_USER_DATA_MIGRATION_PLAN, 'utf8'));
      await fs.writeFile(plan.startedFile, '{}');
    }
  });
  const services = createMcpApplicationServices(data.context);
  const targetDirectory = path.join(data.root, 'new-user-data');
  const preflight = await services.userData.preflightMove({ targetDirectory });
  const result = await services.userData.move({ targetDirectory, expectedStateFingerprint: preflight.stateFingerprint });
  assert.equal(result.scheduled, true);
  assert.equal(result.completed, false);
  assert.equal(result.targetDirectory, targetDirectory);
  assert.equal(data.events.at(-1), 'quit');
});

test('startup validation failure restores the pointer while retaining source and copied target', async (t) => {
  const data = await fixture(t);
  const targetDirectory = path.join(data.root, 'worker-target');
  const runRoot = path.join(data.root, 'worker-run');
  const locationFilePath = path.join(data.applicationRoot, 'user-data-location.json');
  const originalPointer = `${JSON.stringify({ version: 1, userDataDirectory: data.currentDirectory }, null, 2)}\n`;
  await fs.writeFile(locationFilePath, originalPointer);
  const sourceState = await require('../src/core/mcp-application-services').inspectUserDataState(data.currentDirectory);
  const plan = {
    migrationId: 'test-migration',
    sourceDirectory: data.currentDirectory,
    targetDirectory,
    locationFilePath,
    applicationExecutable: path.join(data.applicationRoot, 'HamsterArchiver.exe'),
    applicationRoot: data.applicationRoot,
    targetPid: 123,
    currentVersion: '4.6.0',
    expectedSourceTreeFingerprint: sourceState.treeFingerprint,
    originalLocation: { exists: true, contentBase64: Buffer.from(originalPointer).toString('base64') },
    runRoot,
    startedFile: path.join(runRoot, 'started.json'),
    cancelledFile: path.join(runRoot, 'cancelled.json'),
    validationFile: path.join(runRoot, 'validation.json')
  };
  const launched = { exitCode: null, unref() {} };
  await assert.rejects(() => runUserDataMigration(plan, {
    fsImpl: fs,
    prepareUserDataTarget,
    writeJsonAtomic,
    waitForProcessExit: async () => {},
    launchApplication: async () => launched,
    waitForValidation: async () => { throw new Error('validation failed'); }
  }), /validation failed/);
  assert.equal(await fs.readFile(locationFilePath, 'utf8'), originalPointer);
  assert.equal((await fs.stat(data.currentDirectory)).isDirectory(), true);
  assert.equal((await fs.stat(targetDirectory)).isDirectory(), true);
  const failure = JSON.parse(await fs.readFile(path.join(runRoot, 'failed.json'), 'utf8'));
  assert.equal(failure.pointerRestored, true);
  assert.equal(failure.sourceRetained, true);
  assert.equal(failure.targetRetained, true);
});

test('user data migration skips transient MCP connection credentials', async (t) => {
  const data = await fixture(t);
  await fs.mkdir(path.join(data.currentDirectory, 'mcp'));
  await fs.writeFile(path.join(data.currentDirectory, 'mcp', 'connection.json'), '{"token":"temporary"}');
  const target = path.join(data.root, 'copied-without-runtime-state');
  await prepareUserDataTarget(data.currentDirectory, target);
  await assert.rejects(() => fs.access(path.join(target, 'mcp')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(target, 'config', 'settings.json'), 'utf8'), '{"language":"zh-CN"}\n');
});
