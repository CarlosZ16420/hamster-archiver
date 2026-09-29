'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { launchApplication, request, remainingBudget, withSession } = require('../src/core/mcp-client');
const { mcpTempDirectory } = require('../src/core/mcp-launch');

async function localEndpoint(t, handler) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-transport-'));
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    await handler(JSON.parse(raw), res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connectionFile = path.join(root, 'connection.json');
  await fs.writeFile(connectionFile, JSON.stringify({
    pid: process.pid, token: 'a'.repeat(64), url: `http://127.0.0.1:${server.address().port}/mcp`
  }));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true }); });
  return connectionFile;
}

test('one monotonic deadline bounds the business request and release cannot mask its result', async (t) => {
  let releases = 0;
  const connectionFile = await localEndpoint(t, async (message, response) => {
    if (message.method === 'hamster/session/release') { releases++; return; }
    const result = message.method === 'hamster/session/acquire' ? { sessionId: 'session' } : { ok: true };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  const start = performance.now();
  const deadline = start + 2_000;
  const result = await withSession(connectionFile, () => request(connectionFile,
    { jsonrpc: '2.0', id: 1, method: 'business' }, { deadline }), { deadline });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(releases, 1);
  assert.ok(performance.now() - start < 1_200);
  assert.throws(() => remainingBudget(performance.now() - 1), { code: 'DEADLINE_EXCEEDED' });
});

test('a stalled business call uses remaining total budget and still releases promptly', async (t) => {
  let releases = 0;
  const connectionFile = await localEndpoint(t, async (message, response) => {
    if (message.method === 'hamster/session/acquire') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'session' } }));
    } else if (message.method === 'hamster/session/release') {
      releases++;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
    }
  });
  const start = performance.now();
  const deadline = start + 180;
  await assert.rejects(withSession(connectionFile, () => request(connectionFile,
    { jsonrpc: '2.0', id: 1, method: 'stalled-business' }, { deadline }), { deadline }),
  { code: 'DEADLINE_EXCEEDED' });
  assert.equal(releases, 1);
  assert.ok(performance.now() - start < 1_000);
});

test('test profile temp selection is explicit and desktop argument survives a separate environment', () => {
  const temp = path.resolve(os.tmpdir(), 'hamster-custom-temp');
  assert.equal(mcpTempDirectory([], { HAMSTER_DEV_USER_DATA_DIR: temp, HAMSTER_MCP_TEMP_DIR: temp }), temp);
  assert.equal(mcpTempDirectory([`--mcp-temp-dir=${temp}`], {}), temp);
  assert.equal(mcpTempDirectory([], { HAMSTER_MCP_TEMP_DIR: temp }), os.tmpdir());
});

test('a direct child exiting after ready retains evidence and does not guess a GPU cause', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-exit-'));
  const previousDev = process.env.HAMSTER_DEV_USER_DATA_DIR;
  const previousTemp = process.env.HAMSTER_MCP_TEMP_DIR;
  process.env.HAMSTER_DEV_USER_DATA_DIR = path.join(root, 'userdata');
  process.env.HAMSTER_MCP_TEMP_DIR = root;
  t.after(async () => {
    if (previousDev === undefined) delete process.env.HAMSTER_DEV_USER_DATA_DIR;
    else process.env.HAMSTER_DEV_USER_DATA_DIR = previousDev;
    if (previousTemp === undefined) delete process.env.HAMSTER_MCP_TEMP_DIR;
    else process.env.HAMSTER_MCP_TEMP_DIR = previousTemp;
    await fs.rm(root, { recursive: true, force: true });
  });
  const script = path.join(root, 'fake-app.js');
  await fs.writeFile(script, [
    "const fs=require('node:fs');const path=require('node:path');",
    "const ready=process.argv.find(x=>x.startsWith('--mcp-ready-file=')).split('=')[1];",
    "const connection=path.join(path.dirname(ready), 'connection-'+process.pid+'.json');",
    "fs.writeFileSync(connection,JSON.stringify({pid:process.pid,instanceId:'fake-instance',token:'a'.repeat(64),url:'http://127.0.0.1:9/mcp'}));",
    "fs.writeFileSync(ready,JSON.stringify({connectionFile:connection,instanceId:'fake-instance'}));",
    "setTimeout(()=>{if(process.env.FAKE_GPU==='1')process.stderr.write('GPU process isn\\'t usable');process.exit(2)},100);"
  ].join('\n'));
  for (const gpu of [false, true]) {
    process.env.FAKE_GPU = gpu ? '1' : '0';
    const connectionFile = await launchApplication({ executable: process.execPath, prefixArgs: [script] },
      { showUi: false, deadline: performance.now() + 4_000 });
    const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
    for (let attempt = 0; attempt < 30; attempt++) {
      try { process.kill(connection.pid, 0); await new Promise((resolve) => setTimeout(resolve, 25)); }
      catch { break; }
    }
    let failure;
    try { await request(connectionFile, { jsonrpc: '2.0', id: 1, method: 'test' }, { timeoutMs: 250 }); }
    catch (error) { failure = error; }
    assert.equal(failure.code, gpu ? 'GRAPHICS_INITIALIZATION_FAILED' : 'CONNECTION_STALE');
    assert.equal(failure.knownCause, gpu ? 'graphics_initialization' : 'unknown');
    assert.equal(failure.instanceId, 'fake-instance');
    assert.ok(failure.launchAttemptId);
    assert.ok(failure.diagnosticRef);
    const diagnostic = JSON.parse(await fs.readFile(failure.diagnosticRef, 'utf8'));
    assert.equal(diagnostic.launchAttemptId, failure.launchAttemptId);
  }
  delete process.env.FAKE_GPU;
});

test('a later CLI process reads bounded app-owned cause by matching instance', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-persisted-diagnostic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'mcp');
  const diagnosticDirectory = path.join(directory, 'diagnostics');
  await fs.mkdir(diagnosticDirectory, { recursive: true });
  const instanceId = 'c8dc8207-e87c-4f17-a73a-1b90dc13255a';
  const launchAttemptId = '01f38ac9-b260-4e70-a87d-657c8464fe0a';
  const diagnosticRef = path.join(diagnosticDirectory, `instance-${instanceId}.json`);
  const connectionFile = path.join(directory, 'connection.json');
  await fs.writeFile(connectionFile, JSON.stringify({ pid: 2147483647, instanceId,
    diagnosticRef, token: 'a'.repeat(64), url: 'http://127.0.0.1:8/mcp' }));
  await fs.writeFile(diagnosticRef, JSON.stringify({ schemaVersion: 1, instanceId,
    pid: 2147483647, launchAttemptId, knownCause: 'gpu_process_failure',
    childProcess: { type: 'GPU', reason: 'launch-failed', exitCode: 7, at: new Date().toISOString() } }));
  const script = `const {request}=require(${JSON.stringify(path.resolve(__dirname, '../src/core/mcp-client.js'))});` +
    `request(process.argv[1],{jsonrpc:'2.0',id:1,method:'ping'},{timeoutMs:200}).catch(e=>` +
    `process.stdout.write(JSON.stringify({code:e.code,knownCause:e.knownCause,instanceId:e.instanceId,` +
    `launchAttemptId:e.launchAttemptId,diagnosticRef:e.diagnosticRef})));`;
  const child = spawnSync(process.execPath, ['-e', script, connectionFile], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { code: 'CONNECTION_STALE',
    knownCause: 'gpu_process_failure', instanceId, launchAttemptId, diagnosticRef });
  await fs.writeFile(diagnosticRef, JSON.stringify({ schemaVersion: 1, instanceId,
    pid: 2147483647, launchAttemptId, knownCause: 'gpu_process_failure',
    childProcess: { type: 'GPU', at: new Date(Date.now() - 120_000).toISOString() } }));
  const oldGpu = spawnSync(process.execPath, ['-e', script, connectionFile], { encoding: 'utf8' });
  assert.equal(JSON.parse(oldGpu.stdout).knownCause, 'unknown');
  await fs.writeFile(diagnosticRef, JSON.stringify({ schemaVersion: 1, instanceId: crypto.randomUUID(),
    pid: 2147483647, knownCause: 'gpu_process_failure' }));
  const unknown = spawnSync(process.execPath, ['-e', script, connectionFile], { encoding: 'utf8' });
  assert.equal(JSON.parse(unknown.stdout).knownCause, 'unknown');
});
