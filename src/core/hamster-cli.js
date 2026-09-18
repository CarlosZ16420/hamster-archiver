#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const packageMetadata = require('../../package.json');
const mcpClient = require('./mcp-client');

const HELP = `Hamster Archiver CLI

Routine commands:
  hamster intake <path> --inventory|--archive [--output <dir>] [--staging <dir>] [--source keep|move|trash] --json
  hamster search <query> --json
  hamster project <record-id> --json
  hamster tag <record-id> --add <tag> --json
  hamster task get <task-id> --json
  hamster task wait <task-id> [--timeout 20] --json

Advanced and compatibility:
  hamster capabilities [--domain <domain>] --json
  hamster describe <capability> --json
  hamster call <capability> --input <file-or-> --json
  hamster doctor --json
  hamster mcp --stdio
  hamster version --json

Business completion is determined by task.status and task.terminal, not the process exit code.`;

function usage(message) {
  const error = new Error(message);
  error.code = 'CLI_USAGE';
  error.stage = 'cli';
  return error;
}

function takeOption(args, name, { multiple = false } = {}) {
  const values = [];
  for (let index = 0; index < args.length;) {
    if (args[index] !== name) { index += 1; continue; }
    const value = args[index + 1];
    if (value === undefined || String(value).startsWith('--')) throw usage(`${name} requires a value.`);
    values.push(value);
    args.splice(index, 2);
  }
  return multiple ? values : values.at(-1);
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function assertNoUnknown(args) {
  if (args.length) throw usage(`Unknown argument: ${args[0]}`);
}

function parse(argv) {
  const args = [...argv];
  for (const runtimeSwitch of ['--disable-crash-reporter', '--disable-breakpad']) takeFlag(args, runtimeSwitch);
  const command = args.shift() || 'help';
  const json = takeFlag(args, '--json');
  if (command === 'help' || command === '--help' || command === '-h') return { command: 'help', json };
  if (command === 'version' || command === '--version' || command === '-v') {
    assertNoUnknown(args);
    return { command: 'version', json };
  }
  if (command === 'mcp') {
    takeFlag(args, '--stdio');
    assertNoUnknown(args);
    return { command: 'mcp' };
  }
  if (command === 'intake') {
    const sourcePath = args.shift();
    if (!sourcePath) throw usage('intake requires one path.');
    const inventory = takeFlag(args, '--inventory');
    const archive = takeFlag(args, '--archive');
    if (inventory === archive) throw usage('Choose exactly one of --inventory or --archive.');
    const requestId = takeOption(args, '--request-id');
    const archiveOutputDirectory = takeOption(args, '--output');
    const archiveStagingDirectory = takeOption(args, '--staging');
    const sourceDisposition = takeOption(args, '--source');
    const processedSourceDirectory = takeOption(args, '--move-to');
    assertNoUnknown(args);
    return {
      command,
      capability: 'intake.submit',
      input: {
        ...(requestId ? { requestId } : { requestId: `cli-${crypto.randomUUID()}` }),
        paths: [sourcePath],
        mode: inventory ? 'inventory_only' : 'archive',
        ...(archiveOutputDirectory ? { archiveOutputDirectory } : {}),
        ...(archiveStagingDirectory ? { archiveStagingDirectory } : {}),
        ...(sourceDisposition ? { sourceDisposition } : {}),
        ...(processedSourceDirectory ? { processedSourceDirectory } : {})
      },
      json
    };
  }
  if (command === 'search') {
    const query = args.shift();
    if (query === undefined) throw usage('search requires a query.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.search', input: { query }, json };
  }
  if (command === 'project') {
    const recordId = args.shift();
    if (!recordId) throw usage('project requires a record ID.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.details', input: { recordId }, json };
  }
  if (command === 'tag') {
    const recordId = args.shift();
    if (!recordId) throw usage('tag requires a record ID.');
    const tags = takeOption(args, '--add', { multiple: true });
    if (!tags.length) throw usage('tag requires at least one --add <tag>.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.add_tags', input: { recordIds: [recordId], tags }, json };
  }
  if (command === 'task') {
    const action = args.shift();
    const taskId = args.shift();
    if (!['get', 'wait'].includes(action) || !taskId) throw usage('Use task get <task-id> or task wait <task-id>.');
    const timeoutRaw = takeOption(args, '--timeout');
    const timeoutSeconds = timeoutRaw === undefined ? 20 : Number(timeoutRaw);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 60) throw usage('--timeout must be an integer from 0 to 60.');
    assertNoUnknown(args);
    return {
      command,
      capability: action === 'get' ? 'task.get' : 'task.wait',
      input: { taskId, ...(action === 'wait' ? { timeoutSeconds } : {}) },
      json
    };
  }
  if (command === 'capabilities') {
    const domain = takeOption(args, '--domain');
    assertNoUnknown(args);
    return { command, tool: 'hamster_discover', arguments: domain ? { domain } : {}, json };
  }
  if (command === 'describe') {
    const capability = args.shift();
    if (!capability) throw usage('describe requires a capability name.');
    assertNoUnknown(args);
    return { command, tool: 'hamster_describe', arguments: { capability }, json };
  }
  if (command === 'call') {
    const capability = args.shift();
    if (!capability) throw usage('call requires a capability name.');
    const inputFile = takeOption(args, '--input');
    if (!inputFile) throw usage('call requires --input <file-or->.');
    assertNoUnknown(args);
    return { command, capability, inputFile, json };
  }
  if (command === 'doctor') {
    assertNoUnknown(args);
    return { command, json };
  }
  throw usage(`Unknown command: ${command}`);
}

async function readInput(file) {
  const text = file === '-'
    ? await new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
      })
    : await fs.readFile(path.resolve(file), 'utf8');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw usage('The input must contain one valid JSON object.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw usage('The input must contain one JSON object.');
  return value;
}

function connectionOptions() {
  return { appExecutable: '', connectionFile: '', showUi: false };
}

async function callTool(connectionFile, name, argumentsValue) {
  const response = await mcpClient.withSession(connectionFile, () => mcpClient.request(connectionFile, {
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: argumentsValue }
  }));
  if (response?.error) {
    const error = new Error(response.error.message || 'MCP request failed.');
    error.code = 'RPC_ERROR';
    error.stage = 'protocol';
    throw error;
  }
  const result = response?.result;
  const output = result?.structuredContent ?? result;
  if (result?.isError) {
    const detail = output?.error || {};
    const error = new Error(detail.message || result?.content?.[0]?.text || 'Hamster Archiver operation failed.');
    error.code = detail.code || 'BUSINESS_ERROR';
    error.stage = detail.stage || 'capability';
    error.retryable = detail.retryable === true;
    error.requiredAction = detail.requiredAction || null;
    throw error;
  }
  return output;
}

async function doctor(connectionFile) {
  return mcpClient.withSession(connectionFile, async () => {
    const initialized = await mcpClient.request(connectionFile, {
      jsonrpc: '2.0', id: 'initialize', method: 'initialize',
      params: { protocolVersion: '2025-11-25', clientInfo: { name: 'hamster-cli', version: packageMetadata.version }, capabilities: {} }
    });
    const runtime = await mcpClient.request(connectionFile, { jsonrpc: '2.0', id: 'runtime', method: 'hamster/runtime/status' });
    const tools = await mcpClient.request(connectionFile, { jsonrpc: '2.0', id: 'tools', method: 'tools/list' });
    return { ok: true, server: initialized.result?.serverInfo, runtime: runtime.result, tools: tools.result?.tools?.map((tool) => tool.name) || [] };
  });
}

function print(value, json = true) {
  if (!json && typeof value === 'string') process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.command === 'help') { print(HELP, false); return; }
  if (options.command === 'version') { print({ schemaVersion: 1, name: packageMetadata.name, version: packageMetadata.version }); return; }
  if (options.command === 'mcp') { await mcpClient.main([]); return; }
  const connectionFile = await mcpClient.startOrConnect(connectionOptions());
  if (options.command === 'doctor') { print(await doctor(connectionFile)); return; }
  if (options.command === 'call') options.input = await readInput(options.inputFile);
  const result = options.tool
    ? await callTool(connectionFile, options.tool, options.arguments)
    : await callTool(connectionFile, 'hamster_call', { capability: options.capability, input: options.input || {} });
  print(result);
}

function exitCodeFor(error) {
  if (error?.code === 'CLI_USAGE' || error?.code === 'INVALID_JSON') return 2;
  if (['STARTUP_TIMEOUT', 'STARTUP_FAILED', 'APPLICATION_SPAWN_FAILED', 'CONNECTION_FAILED', 'CONNECTION_STALE', 'CONNECTION_INVALID', 'RPC_ERROR', 'PROTOCOL_MISMATCH'].includes(error?.code)) return 3;
  return 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    ok: false,
    error: {
      code: error.code || 'HAMSTER_CLI_ERROR',
      stage: error.stage || 'cli',
      message: error.message,
      retryable: error.retryable === true,
      requiredAction: error.requiredAction || null
    }
  })}\n`);
  process.exitCode = exitCodeFor(error);
});

module.exports = { HELP, exitCodeFor, main, parse };
