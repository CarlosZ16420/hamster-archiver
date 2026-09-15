#!/usr/bin/env node
'use strict';

// Standard MCP stdio adapter and one-shot CLI. stdout is protocol/JSON only.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createDesktopLaunchRequest } = require('./mcp-launch');

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MCP_ELECTRON_COMPATIBILITY_SWITCHES = ['--disable-crash-reporter', '--disable-breakpad'];
const WINDOWS_DESKTOP_BROKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$shell = New-Object -ComObject Shell.Application',
  "$shell.ShellExecute($env:HAMSTER_MCP_APPLICATION, '', $env:HAMSTER_MCP_WORKING_DIRECTORY, 'open', 0)"
].join('; ');

function parseCli(argv) {
  const args = [...argv];
  const command = ['describe', 'call'].includes(args[0]) ? args.shift() : 'stdio';
  let showUi = false;
  let appExecutable = '';
  let connectionFile = '';
  let json = '{}';
  for (let index = 0; index < args.length;) {
    if (args[index] === '--show-ui') { showUi = true; args.splice(index, 1); continue; }
    if (args[index] === '--app-executable') { appExecutable = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (args[index] === '--connection') { connectionFile = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (args[index] === '--json') { json = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (MCP_ELECTRON_COMPATIBILITY_SWITCHES.includes(args[index])) { args.splice(index, 1); continue; }
    index += 1;
  }
  return { command, args, showUi, appExecutable, connectionFile, json };
}

function resolveApplicationLaunch(appExecutable) {
  if (appExecutable) return { executable: path.resolve(appExecutable), prefixArgs: [] };
  if (path.basename(process.execPath).toLowerCase() !== 'node.exe') {
    return { executable: process.execPath, prefixArgs: [] };
  }
  // Source-tree convenience. Packaged use never needs an external Node.js runtime.
  const electron = require('electron');
  return { executable: electron, prefixArgs: [path.resolve(__dirname, '..', '..')] };
}

async function waitForReady(readyFile, timeoutMs = 20_000, getLaunchFailure = () => null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const launchFailure = getLaunchFailure();
    if (launchFailure) throw launchFailure;
    try {
      const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
      if (typeof ready.connectionFile === 'string' && path.isAbsolute(ready.connectionFile)) return ready.connectionFile;
    } catch { /* The ready file is created only after application initialization. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Hamster Archiver MCP did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds. ` +
    'The AI client may be blocking local desktop processes; allow application launches and retry, ' +
    'or open HamsterArchiver.exe once and reconnect.'
  );
}

async function startOrConnect(options) {
  const readyFile = path.join(os.tmpdir(), `hamster-mcp-ready-${process.pid}-${crypto.randomBytes(16).toString('hex')}.json`);
  const launch = resolveApplicationLaunch(options.appExecutable);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let requestFile = '';
  async function startDirectly() {
    const args = [
      ...launch.prefixArgs,
      ...MCP_ELECTRON_COMPATIBILITY_SWITCHES,
      '--enable-mcp',
      '--background',
      `--mcp-ready-file=${readyFile}`
    ];
    if (options.showUi) args.push('--show-ui');
    const child = spawn(launch.executable, args, { cwd: path.dirname(launch.executable), detached: true, stdio: 'ignore', windowsHide: !options.showUi, env });
    let launchFailure = null;
    child.once('error', (error) => {
      launchFailure = new Error(`Could not start Hamster Archiver: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      if (code === 0) return;
      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      launchFailure = new Error(
        `Hamster Archiver exited before MCP was ready (${outcome}). ` +
        'The AI client may be blocking local Electron processes.'
      );
    });
    child.unref();
    return waitForReady(readyFile, 20_000, () => launchFailure);
  }
  try {
    if (process.platform === 'win32' && launch.prefixArgs.length === 0) {
      requestFile = await createDesktopLaunchRequest({
        applicationExecutable: launch.executable,
        readyFile,
        showUi: options.showUi
      });
      const windowsRoot = env.SystemRoot || env.WINDIR || 'C:\\Windows';
      const powerShell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const encodedBrokerScript = Buffer.from(WINDOWS_DESKTOP_BROKER_SCRIPT, 'utf16le').toString('base64');
      const broker = spawn(powerShell, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedBrokerScript
      ], {
        cwd: path.dirname(launch.executable),
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...env,
          HAMSTER_MCP_APPLICATION: launch.executable,
          HAMSTER_MCP_WORKING_DIRECTORY: path.dirname(launch.executable)
        }
      });
      let brokerFailure = null;
      broker.once('error', (error) => {
        brokerFailure = new Error(`Could not ask the Windows desktop to start Hamster Archiver: ${error.message}`);
      });
      broker.once('exit', (code, signal) => {
        if (code === 0) return;
        const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
        brokerFailure = new Error(`The Windows desktop could not start Hamster Archiver (${outcome}).`);
      });
      broker.unref();
      try {
        return await waitForReady(readyFile, 20_000, () => brokerFailure);
      } catch {
        await fs.rm(requestFile, { force: true }).catch(() => {});
        requestFile = '';
        return await startDirectly();
      }
    }
    return await startDirectly();
  } finally {
    await Promise.all([
      fs.rm(readyFile, { force: true }).catch(() => {}),
      requestFile ? fs.rm(requestFile, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
  }
}

async function request(connectionFile, message) {
  const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid local MCP endpoint');
  }
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${connection.token}` },
    body: JSON.stringify(message)
  });
  if (!response.ok) throw new Error(`Local MCP request failed (${response.status})`);
  return response.status === 202 || response.status === 204 ? null : response.json();
}

async function withSession(connectionFile, action) {
  const acquired = await request(connectionFile, { jsonrpc: '2.0', id: 'session-acquire', method: 'hamster/session/acquire' });
  const sessionId = acquired?.result?.sessionId;
  const heartbeat = sessionId && setInterval(() => {
    void request(connectionFile, { jsonrpc: '2.0', id: 'session-touch', method: 'hamster/session/touch', params: { sessionId } }).catch(() => {});
  }, 15_000);
  heartbeat?.unref?.();
  try { return await action(); }
  finally {
    if (heartbeat) clearInterval(heartbeat);
    if (sessionId) await request(connectionFile, { jsonrpc: '2.0', id: 'session-release', method: 'hamster/session/release', params: { sessionId } }).catch(() => {});
  }
}

async function runStdio(connectionFile) {
  await withSession(connectionFile, async () => {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        continue;
      }
      try {
        if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error('Request too large');
        const result = await request(connectionFile, message);
        if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
      } catch (error) {
        if (message && Object.hasOwn(message, 'id')) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } })}\n`);
        else process.stderr.write(`${error.message}\n`);
      }
    }
  });
}

async function runOneShot(connectionFile, options) {
  let rpc;
  if (options.command === 'describe') {
    const capability = options.args[0];
    rpc = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: capability
        ? { name: 'hamster_describe', arguments: { capability } }
        : { name: 'hamster_discover', arguments: {} }
    };
  } else {
    const name = options.args[0];
    if (!name) throw new Error('Usage: call <tool-name> --json <arguments>');
    let argumentsValue;
    try { argumentsValue = JSON.parse(options.json); } catch { throw new Error('--json must contain a JSON object'); }
    if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== 'object') throw new Error('--json must contain a JSON object');
    rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: argumentsValue } };
  }
  const response = await withSession(connectionFile, () => request(connectionFile, rpc));
  if (response?.error) throw new Error(response.error.message);
  const result = response?.result;
  const output = result?.structuredContent ?? result;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result?.isError) process.exitCode = 1;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const connectionFile = options.connectionFile
    ? path.resolve(options.connectionFile)
    : await startOrConnect(options);
  if (options.command === 'stdio') await runStdio(connectionFile);
  else await runOneShot(connectionFile, options);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = {
  MCP_ELECTRON_COMPATIBILITY_SWITCHES,
  main,
  parseCli,
  request,
  resolveApplicationLaunch,
  startOrConnect,
  waitForReady
};
