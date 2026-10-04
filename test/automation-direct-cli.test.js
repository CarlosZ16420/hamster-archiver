'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const cli = require('../src/core/hamster-cli');
const mcpClient = require('../src/core/mcp-client');
const { pendingRequests, readRequestFile, updateRequestFile } = require('../src/core/cli-request-store');

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-cli-'));
  const originalRoot = process.env.HAMSTER_CLI_USER_DATA_DIR;
  const original = { startOrConnect: mcpClient.startOrConnect,
    withSession: mcpClient.withSession, request: mcpClient.request };
  process.env.HAMSTER_CLI_USER_DATA_DIR = path.join(root, 'userdata');
  t.after(async () => {
    Object.assign(mcpClient, original);
    if (originalRoot === undefined) delete process.env.HAMSTER_CLI_USER_DATA_DIR;
    else process.env.HAMSTER_CLI_USER_DATA_DIR = originalRoot;
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('CLI preserves required output fields returned by the application', async (t) => {
  await setup(t);
  mcpClient.startOrConnect = async () => 'test-connection';
  mcpClient.withSession = async (_connection, action) => action();
  mcpClient.request = async () => ({ result: { isError: true, structuredContent: {
    ok: false, error: { code: 'ARCHIVE_OUTPUT_REQUIRED', requiredAction: 'choose_archive_output',
      requiredFields: ['archiveOutputDirectory'], message: 'Choose an output location.' }
  } } });
  let failure;
  try { await cli.runCommand(cli.parse(['task', 'start', 'task-id', '--json'])); }
  catch (error) { failure = error; }
  assert.equal(failure.code, 'ARCHIVE_OUTPUT_REQUIRED');
  assert.deepEqual(cli.errorEnvelope(failure).error.requiredFields, ['archiveOutputDirectory']);
});

test('lost response leaves a request file and resume reuses the exact identity', async (t) => {
  const root = await setup(t);
  const repositoryDirectory = path.join(root, 'warehouse');
  const userDataRoot = process.env.HAMSTER_CLI_USER_DATA_DIR;
  const identities = new Map();
  let dropFirstResponse = true;
  mcpClient.startOrConnect = async () => 'test-connection';
  mcpClient.withSession = async (_connection, action) => action();
  mcpClient.request = async (_connection, rpc) => {
    if (rpc.method === 'hamster/runtime/status') return { result: {
      instanceId: 'test-instance', repositoryDirectory, userDataRoot, applicationRoot: root
    } };
    const input = rpc.params.arguments.input;
    const requestId = input.requestId;
    if (!identities.has(requestId)) identities.set(requestId, `task-${identities.size + 1}`);
    if (dropFirstResponse) {
      dropFirstResponse = false;
      throw Object.assign(new Error('response dropped after acceptance'), { code: 'CONNECTION_FAILED' });
    }
    return { result: { structuredContent: { schemaVersion: 2, ok: true,
      task: { id: identities.get(requestId), requestId, status: 'queued', terminal: false },
      outcome: 'pending', summary: { requestedProjects: 1, created: 0, updated: 0, reused: 0,
        skipped: 0, failed: 0, cancelled: 0, pending: 1 } } } };
  };
  const source = path.join(root, 'source');
  const input = cli.parse(['intake', source, '--inventory', '--json']);
  let lost;
  try { await cli.runCommand(input); } catch (error) { lost = error; }
  assert.equal(lost.acceptance, 'unknown');
  assert.ok(lost.requestFile);
  const pending = await pendingRequests(userDataRoot);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestFile, lost.requestFile);
  const recorded = (await readRequestFile(lost.requestFile)).value;
  assert.equal(recorded.status, 'unknown');
  assert.equal(identities.size, 1);
  const resumed = await cli.runCommand(cli.parse(['task', 'resume', '--request-file', lost.requestFile, '--json']));
  assert.equal(resumed.task.id, identities.get(recorded.requestId));
  assert.equal(identities.size, 1);
  const newIntent = await cli.runCommand(cli.parse(['intake', source, '--inventory', '--json']));
  assert.notEqual(newIntent.task.requestId, recorded.requestId);
  assert.equal(identities.size, 2);
  assert.equal((await pendingRequests(userDataRoot)).length, 2);
});

test('invalid JSON and existing result targets fail before any application launch', async (t) => {
  const root = await setup(t);
  const input = path.join(root, 'bad.json');
  const result = path.join(root, 'result.json');
  await fs.writeFile(input, '{invalid');
  let starts = 0;
  mcpClient.startOrConnect = async () => { starts++; throw new Error('must not start'); };
  await assert.rejects(cli.main(['call', 'intake.submit', '--input', input,
    '--result-file', result, '--json']), { code: 'CLI_USAGE' });
  const saved = JSON.parse(await fs.readFile(result, 'utf8'));
  assert.equal(saved.error.code, 'CLI_USAGE');
  assert.equal(saved.error.acceptance, 'not_accepted');
  assert.equal(starts, 0);
  await assert.rejects(cli.main(['intake', path.join(root, 'source'), '--inventory',
    '--result-file', result, '--json']), { code: 'EEXIST' });
  assert.equal(starts, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(result, 'utf8')), saved);
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  const inventoryInput = path.join(root, 'inventory.json');
  await fs.writeFile(inventoryInput, JSON.stringify({ responseVersion: 2,
    paths: [source], mode: 'inventory_only', sourceDisposition: 'trash' }));
  await assert.rejects(cli.main(['call', 'intake.submit', '--input', inventoryInput,
    '--result-file', path.join(root, 'contradiction.json'), '--json']),
  { code: 'CONFLICTING_INTAKE_OPTIONS' });
  assert.equal(starts, 0);
  await fs.writeFile(inventoryInput, JSON.stringify({ responseVersion: 2,
    paths: [source], mode: 'inventory_only' }));
  await assert.rejects(cli.main(['call', 'intake.submit', '--input', inventoryInput,
    '--result-file', path.join(source, 'would-pollute-source.json'), '--json']), { code: 'CLI_USAGE' });
  assert.equal(starts, 0);
  await fs.writeFile(inventoryInput, JSON.stringify({ responseVersion: 2,
    paths: [source], mode: 'archive', archiveOutputDirectory: 'relative-output' }));
  await assert.rejects(cli.main(['call', 'intake.submit', '--input', inventoryInput,
    '--result-file', path.join(root, 'relative-output-result.json'), '--json']), { code: 'INVALID_PATH' });
  assert.equal(starts, 0);
  await fs.writeFile(inventoryInput, JSON.stringify({ responseVersion: 2,
    paths: [source], mode: 'archive', archiveOutputDirectory: path.join(source, 'archives') }));
  await assert.rejects(cli.main(['call', 'intake.submit', '--input', inventoryInput,
    '--result-file', path.join(root, 'overlapping-output-result.json'), '--json']), { code: 'INVALID_PATH_LAYOUT' });
  assert.equal(starts, 0);
});

test('pending scans past one thousand terminal files and prunes only terminal history', async (t) => {
  const root = await setup(t);
  const userDataRoot = process.env.HAMSTER_CLI_USER_DATA_DIR;
  const directory = path.join(userDataRoot, 'automation', 'cli-requests');
  await fs.mkdir(directory, { recursive: true });
  const source = path.join(root, 'source');
  const input = { responseVersion: 2, requestId: 'pending-new', paths: [source], mode: 'inventory_only' };
  const base = { schemaVersion: 1, repositoryDirectory: path.join(root, 'warehouse'),
    userDataRoot, createdAt: new Date().toISOString() };
  await Promise.all(Array.from({ length: 1001 }, (_, index) => fs.writeFile(
    path.join(directory, `a${String(index).padStart(4, '0')}.json`), JSON.stringify({ ...base,
      requestId: `done-${index}`, input: { ...input, requestId: `done-${index}` }, status: 'completed' }))));
  const pendingFile = path.join(directory, 'z-current.json');
  await fs.writeFile(pendingFile, JSON.stringify({ ...base, requestId: input.requestId, input, status: 'unknown' }));
  assert.deepEqual((await pendingRequests(userDataRoot)).map((entry) => entry.requestId), ['pending-new']);
  const latest = path.join(directory, 'z-latest.json');
  await fs.writeFile(latest, JSON.stringify({ ...base, requestId: 'latest',
    input: { ...input, requestId: 'latest' }, status: 'accepted' }));
  await updateRequestFile(latest, { status: 'completed' });
  const remaining = await fs.readdir(directory);
  assert.equal(remaining.filter((name) => name.endsWith('.json')).length, 257);
  assert.ok(remaining.includes('z-current.json'));
  assert.deepEqual((await pendingRequests(userDataRoot)).map((entry) => entry.requestId), ['pending-new']);
  const acceptedFile = path.join(directory, 'z-accepted.json');
  await fs.writeFile(acceptedFile, JSON.stringify({ ...base, requestId: 'accepted-old',
    taskId: 'task-accepted-old', input: { ...input, requestId: 'accepted-old' }, status: 'accepted' }));
  await fs.mkdir(path.join(userDataRoot, 'config'), { recursive: true });
  await fs.writeFile(path.join(userDataRoot, 'config', 'settings.json'),
    JSON.stringify({ repositoryDirectory: base.repositoryDirectory }));
  await fs.writeFile(path.join(userDataRoot, 'automation', 'mcp-requests.json'), JSON.stringify([{
    requestId: 'accepted-old', taskId: 'task-accepted-old', repositoryDirectory: base.repositoryDirectory,
    terminalReceipts: { 2: { schemaVersion: 2, task: { status: 'completed' } } }
  }]));
  assert.deepEqual((await pendingRequests(userDataRoot)).map((entry) => entry.requestId), ['pending-new']);
  assert.equal((await readRequestFile(acceptedFile)).value.status, 'completed');
});
