#!/usr/bin/env node
'use strict';

// Standard MCP stdio adapter and one-shot CLI. stdout is protocol/JSON only.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const MAX_MESSAGE_BYTES = 1024 * 1024;

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

async function waitForReady(readyFile, timeoutMs = 20_000, getLaunchError = () => null) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const launchError = getLaunchError();
    if (launchError) throw new Error(`Could not start Hamster Archiver: ${launchError.message}`);
    try {
      const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
      if (typeof ready.connectionFile === 'string' && path.isAbsolute(ready.connectionFile)) return ready.connectionFile;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Hamster Archiver MCP did not become ready${lastError ? `: ${lastError.message}` : ''}`);
}

async function startOrConnect(options) {
  const readyFile = path.join(os.tmpdir(), `hamster-mcp-ready-${process.pid}-${crypto.randomBytes(16).toString('hex')}.json`);
  const launch = resolveApplicationLaunch(options.appExecutable);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [...launch.prefixArgs, '--enable-mcp', '--background', `--mcp-ready-file=${readyFile}`];
  if (options.showUi) args.push('--show-ui');
  const child = spawn(launch.executable, args, { cwd: path.dirname(launch.executable), detached: true, stdio: 'ignore', windowsHide: !options.showUi, env });
  let launchError = null;
  child.once('error', (error) => { launchError = error; });
  child.unref();
  try { return await waitForReady(readyFile, 20_000, () => launchError); }
  finally { await fs.rm(readyFile, { force: true }).catch(() => {}); }
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
module.exports = { main, parseCli, request, resolveApplicationLaunch, startOrConnect, waitForReady };
