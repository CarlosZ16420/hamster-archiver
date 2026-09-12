#!/usr/bin/env node
'use strict';

// Standard MCP stdio adapter, also included in portable/installed builds.
// stdout is reserved exclusively for JSON-RPC.
const fs = require('node:fs/promises');
const readline = require('node:readline');
const path = require('node:path');

async function main() {
  const index = process.argv.indexOf('--connection');
  const connectionFile = index >= 0 ? process.argv[index + 1] : process.env.HAMSTER_MCP_CONNECTION;
  if (!connectionFile || !path.isAbsolute(connectionFile)) throw new Error('Pass --connection with the absolute path to userdata/mcp/connection.json. Start Hamster Archiver with --enable-mcp first.');
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
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('Request too large');
      const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
      const url = new URL(connection.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) throw new Error('Invalid local MCP endpoint');
      const response = await fetch(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${connection.token}` },
        body: line
      });
      if (!response.ok) throw new Error(`Local MCP request failed (${response.status})`);
      if (response.status !== 202 && response.status !== 204) process.stdout.write(`${JSON.stringify(await response.json())}\n`);
    } catch (error) {
      if (message && Object.hasOwn(message, 'id')) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } })}\n`);
      else process.stderr.write(`${error.message}\n`);
    }
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
