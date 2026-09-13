'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const buildArgument = process.argv.slice(2).find((value) => value.startsWith('--build='));
const buildRoot = path.resolve(buildArgument?.slice('--build='.length) || '');
const executable = path.join(buildRoot, 'HamsterArchiver.exe');
const launcher = path.join(buildRoot, 'HamsterArchiver-MCP.cmd');
const connectionFileName = path.join('mcp', 'connection.json');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForExit(pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    await wait(50);
  }
  throw new Error(`Process ${pid} did not exit`);
}

function cleanEnvironment(extra = {}) {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const env = { ...process.env, ...extra, PATH: path.join(systemRoot, 'System32') };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function quoteCommandPart(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function spawnLauncher(args = [], options = {}) {
  const command = [quoteCommandPart(launcher), ...args.map(quoteCommandPart)].join(' ');
  return spawn(command, {
    cwd: buildRoot,
    env: cleanEnvironment(options.env),
    shell: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

async function collectProcess(child, timeoutMs = 30_000) {
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = child.exitCode !== null ? child.exitCode : await Promise.race([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (value) => resolve(value));
    }),
    wait(timeoutMs).then(() => { throw new Error('Launcher timed out'); })
  ]);
  return { code, stdout, stderr };
}

async function startStdio() {
  const child = spawnLauncher();
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let nextId = 0;
  async function rpc(method, params) {
    const id = ++nextId;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const lines = stdout.split('\n');
      for (let index = 0; index < lines.length - 1; index += 1) {
        const message = JSON.parse(lines[index]);
        if (message.id === id) {
          lines.splice(index, 1);
          stdout = lines.join('\n');
          return message;
        }
      }
      if (child.exitCode !== null) throw new Error(`stdio launcher exited (${child.exitCode}): ${stderr}`);
      await wait(25);
    }
    throw new Error(`Timed out waiting for ${method}: ${stderr}`);
  }
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'runtime-verifier', version: '1' } });
  return { child, rpc, errors: () => stderr };
}

async function stopStdio(session) {
  session.child.stdin.end();
  const result = await collectProcess(session.child);
  assert.equal(result.code, 0, result.stderr || session.errors());
}

async function main() {
  if (process.platform !== 'win32') throw new Error('MCP runtime verification requires Windows.');
  await Promise.all([fs.access(executable), fs.access(launcher)]);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mcp-runtime-'));
  const dataRoot = path.join(tempRoot, 'userdata');
  const locationFile = path.join(buildRoot, 'user-data-location.json');
  let originalLocation = null;
  try {
    try { originalLocation = await fs.readFile(locationFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(locationFile, `${JSON.stringify({ userDataDirectory: dataRoot }, null, 2)}\n`, 'utf8');

    const described = await collectProcess(spawnLauncher(['describe']));
    assert.equal(described.code, 0, described.stderr);
    const discovery = JSON.parse(described.stdout);
    assert.ok(discovery.items?.length > 0 || discovery.total > 0, 'CLI describe returned no capabilities');

    const called = await collectProcess(spawnLauncher(['call', 'hamster_search', '--json', '{}']));
    assert.equal(called.code, 0, called.stderr);
    assert.ok(Array.isArray(JSON.parse(called.stdout).items), 'CLI call did not return a query result');

    const background = await startStdio();
    const listed = await background.rpc('tools/list');
    assert.equal(listed.result.tools.length, 3);
    const applicationCapability = await background.rpc('tools/call', {
      name: 'hamster_describe', arguments: { capability: 'app.set_theme' }
    });
    assert.equal(applicationCapability.result.structuredContent.available, true, 'main process did not wire application services into MCP');
    const backgroundStatus = (await background.rpc('hamster/runtime/status')).result;
    assert.equal(backgroundStatus.background, true);
    assert.equal(backgroundStatus.windowCount, 0);
    assert.equal(backgroundStatus.hasVisibleWindow, false);
    await stopStdio(background);
    await waitForExit(backgroundStatus.pid);

    const gui = spawn(executable, [], { cwd: buildRoot, env: cleanEnvironment(), windowsHide: true, stdio: 'ignore' });
    await wait(1_000);
    assert.equal(gui.exitCode, null, 'GUI instance exited before reuse test');
    const reused = await startStdio();
    const reusedStatus = (await reused.rpc('hamster/runtime/status')).result;
    assert.equal(reusedStatus.pid, gui.pid, 'MCP started a second repository owner');
    assert.equal(reusedStatus.background, false);
    assert.ok(reusedStatus.windowCount >= 1);
    await stopStdio(reused);
    assert.equal(gui.exitCode, null, 'MCP client exit closed the existing GUI');
    process.kill(gui.pid);
    await waitForExit(gui.pid);

    const crashed = await startStdio();
    const crashedStatus = (await crashed.rpc('hamster/runtime/status')).result;
    process.kill(crashedStatus.pid);
    await waitForExit(crashedStatus.pid);
    crashed.child.kill();
    await collectProcess(crashed.child).catch(() => {});
    await fs.access(path.join(dataRoot, connectionFileName));

    const recovered = await startStdio();
    const recoveredStatus = (await recovered.rpc('hamster/runtime/status')).result;
    assert.notEqual(recoveredStatus.pid, crashedStatus.pid);
    const queried = await recovered.rpc('tools/call', { name: 'hamster_search', arguments: {} });
    assert.equal(queried.result.isError, false);
    await stopStdio(recovered);
    await waitForExit(recoveredStatus.pid);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      externalNodeRequired: false,
      stdoutProtocolClean: true,
      cliDescribe: true,
      cliCall: true,
      backgroundWindowCount: backgroundStatus.windowCount,
      reusedExistingPid: reusedStatus.pid,
      staleConnectionRecovered: true,
      finalProcessExited: true
    })}\n`);
  } finally {
    if (originalLocation) await fs.writeFile(locationFile, originalLocation);
    else await fs.rm(locationFile, { force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
