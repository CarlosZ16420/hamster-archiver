#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const packageMetadata = require('../../package.json');
const mcpClient = require('./mcp-client');
const { capabilities } = require('./mcp-capabilities');
const { validateExplicitIntakeInput } = require('./intake-options');
const { validate } = require('./mcp-tools');
const requestStore = require('./cli-request-store');

const HELP = `Hamster Archiver CLI

Routine commands:
  hamster intake <path> --inventory|--archive [--layout single|children|ask] [--on-duplicate use_existing|ask|create_new|skip] [--output <dir>] [--source keep|move|trash] [--result-file <new-path>] --json
  hamster search <query> --json
  hamster project <record-id> --json
  hamster tag <record-id> --add <tag> --json
  hamster task get <task-id> [--source-changes --offset 0 --limit 100] --json
  hamster task wait <task-id> [--timeout 20] --json
  hamster task resolve <task-id> --decision <id> --revision <n> --choice <value> --json
  hamster task start <task-id> --json
  hamster task pending --json
  hamster task resume --request-file <path> --json

Advanced and compatibility:
  hamster capabilities [--domain <domain>] --json
  hamster describe <capability> --json
  hamster call <capability> --input <file-or-> [--confirmation-token <token>] --json
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
  const resultFile = takeOption(args, '--result-file');
  if (command === 'help' || command === '--help' || command === '-h') return { command: 'help', json, resultFile };
  if (command === 'version' || command === '--version' || command === '-v') {
    assertNoUnknown(args);
    return { command: 'version', json, resultFile };
  }
  if (command === 'mcp') {
    if (resultFile) throw usage('--result-file is unavailable in MCP stdio mode.');
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
    const layout = takeOption(args, '--layout') || 'single';
    const onDuplicate = takeOption(args, '--on-duplicate') || 'ask';
    if (!['single', 'children', 'ask'].includes(layout)) throw usage('--layout must be single, children, or ask.');
    if (!['use_existing', 'ask', 'create_new', 'skip'].includes(onDuplicate)) throw usage('Invalid --on-duplicate policy.');
    if (sourceDisposition && !['keep', 'move', 'trash'].includes(sourceDisposition)) throw usage('Invalid --source action.');
    if (inventory && (sourceDisposition && sourceDisposition !== 'keep' || processedSourceDirectory || archiveOutputDirectory || archiveStagingDirectory)) {
      throw usage('Inventory-only intake keeps originals and does not use archive directories.');
    }
    if (processedSourceDirectory && sourceDisposition !== 'move') throw usage('--move-to requires --source move.');
    if (!path.isAbsolute(sourcePath) || sourcePath.includes('\0')) throw usage('intake requires an absolute local path.');
    assertNoUnknown(args);
    return {
      command,
      capability: 'intake.submit',
      input: {
        ...(requestId ? { requestId } : { requestId: `cli-${crypto.randomUUID()}` }),
        paths: [sourcePath],
        mode: inventory ? 'inventory_only' : 'archive',
        responseVersion: 2,
        layout,
        onDuplicate,
        waitMilliseconds: 0,
        ...(archiveOutputDirectory ? { archiveOutputDirectory } : {}),
        ...(archiveStagingDirectory ? { archiveStagingDirectory } : {}),
        ...(sourceDisposition ? { sourceDisposition } : {}),
        ...(processedSourceDirectory ? { processedSourceDirectory } : {})
      },
      json,
      resultFile
    };
  }
  if (command === 'search') {
    const query = args.shift();
    if (query === undefined) throw usage('search requires a query.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.search', input: { query }, json, resultFile };
  }
  if (command === 'project') {
    const recordId = args.shift();
    if (!recordId) throw usage('project requires a record ID.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.details', input: { recordId }, json, resultFile };
  }
  if (command === 'tag') {
    const recordId = args.shift();
    if (!recordId) throw usage('tag requires a record ID.');
    const tags = takeOption(args, '--add', { multiple: true });
    if (!tags.length) throw usage('tag requires at least one --add <tag>.');
    assertNoUnknown(args);
    return { command, capability: 'catalog.add_tags', input: { recordIds: [recordId], tags }, json, resultFile };
  }
  if (command === 'task') {
    const action = args.shift();
    if (action === 'pending') {
      assertNoUnknown(args);
      return { command, action, json, resultFile };
    }
    if (action === 'resume') {
      const requestFile = takeOption(args, '--request-file');
      if (!requestFile) throw usage('task resume requires --request-file <path>.');
      assertNoUnknown(args);
      return { command, action, requestFile, json, resultFile };
    }
    const taskId = args.shift();
    if (!['get', 'wait', 'resolve', 'start'].includes(action) || !taskId) throw usage('Use task get, wait, resolve, start, pending, or resume.');
    if (action === 'resolve') {
      const decisionId = takeOption(args, '--decision');
      const revision = Number(takeOption(args, '--revision'));
      const choice = takeOption(args, '--choice');
      const rootFiles = takeOption(args, '--root-files');
      if (!decisionId || !Number.isSafeInteger(revision) || revision < 1 || !choice) {
        throw usage('task resolve requires --decision, --revision, and --choice.');
      }
      if (rootFiles && rootFiles !== 'exclude') throw usage('--root-files currently supports exclude.');
      assertNoUnknown(args);
      return { command, action, capability: 'task.resolve', input: { taskId, decisionId, revision,
        choice, responseVersion: 2, ...(rootFiles ? { rootFiles } : {}) }, json, resultFile };
    }
    const timeoutRaw = takeOption(args, '--timeout');
    if (action !== 'wait' && timeoutRaw !== undefined) throw usage('--timeout is available only with task wait.');
    if (timeoutRaw !== undefined && !/^(?:0|[1-9]\d*)$/.test(timeoutRaw)) {
      throw usage('--timeout must be an integer from 0 to 60.');
    }
    const timeoutSeconds = timeoutRaw === undefined ? 20 : Number(timeoutRaw);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 60) throw usage('--timeout must be an integer from 0 to 60.');
    const includeSourceChanges = takeFlag(args, '--source-changes');
    const changesOffsetRaw = takeOption(args, '--offset');
    const changesLimitRaw = takeOption(args, '--limit');
    if (action !== 'get' && (includeSourceChanges || changesOffsetRaw !== undefined || changesLimitRaw !== undefined)) {
      throw usage('--source-changes, --offset and --limit are available only with task get.');
    }
    const changesOffset = changesOffsetRaw === undefined ? 0 : Number(changesOffsetRaw);
    const changesLimit = changesLimitRaw === undefined ? 100 : Number(changesLimitRaw);
    if (!Number.isSafeInteger(changesOffset) || changesOffset < 0 || !Number.isInteger(changesLimit) || changesLimit < 1 || changesLimit > 500 ||
        [changesOffsetRaw, changesLimitRaw].some((raw) => raw !== undefined && !/^(?:0|[1-9]\d*)$/.test(raw))) {
      throw usage('Source changes require --offset >= 0 and --limit from 1 to 500.');
    }
    if (!includeSourceChanges && (changesOffsetRaw !== undefined || changesLimitRaw !== undefined)) throw usage('Use --source-changes with pagination.');
    assertNoUnknown(args);
    return {
      command,
      action,
      capability: action === 'get' ? 'task.get' : action === 'wait' ? 'task.wait' : 'task.start',
      input: { taskId, responseVersion: 2, ...(action === 'wait' ? { timeoutSeconds } : {}),
        ...(includeSourceChanges ? { includeSourceChanges, changesOffset, changesLimit } : {}) },
      json,
      resultFile
    };
  }
  if (command === 'capabilities') {
    const domain = takeOption(args, '--domain');
    assertNoUnknown(args);
    return { command, tool: 'hamster_discover', arguments: domain ? { domain } : {}, json, resultFile };
  }
  if (command === 'describe') {
    const capability = args.shift();
    if (!capability) throw usage('describe requires a capability name.');
    assertNoUnknown(args);
    return { command, tool: 'hamster_describe', arguments: { capability }, json, resultFile };
  }
  if (command === 'call') {
    const capability = args.shift();
    if (!capability) throw usage('call requires a capability name.');
    const inputFile = takeOption(args, '--input');
    const confirmationToken = takeOption(args, '--confirmation-token');
    if (!inputFile) throw usage('call requires --input <file-or->.');
    assertNoUnknown(args);
    return { command, capability, inputFile, confirmationToken, json, resultFile };
  }
  if (command === 'doctor') {
    assertNoUnknown(args);
    return { command, json, resultFile };
  }
  throw usage(`Unknown command: ${command}`);
}

async function readInput(file) {
  const text = file === '-'
    ? await new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        process.stdin.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) reject(usage('The input exceeds 1 MiB.'));
          else chunks.push(chunk);
        });
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
      })
    : await (async () => {
        const target = path.resolve(file);
        if ((await fs.stat(target)).size > 1024 * 1024) throw usage('The input exceeds 1 MiB.');
        return fs.readFile(target, 'utf8');
      })();
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw usage('The input must contain one valid JSON object.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw usage('The input must contain one JSON object.');
  return value;
}

function connectionOptions(deadline) {
  return { appExecutable: '', connectionFile: '', showUi: false, deadline };
}

async function callTool(connectionFile, name, argumentsValue, deadline) {
  const requestOptions = { deadline };
  const response = await mcpClient.withSession(connectionFile, () => mcpClient.request(connectionFile, {
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: argumentsValue }
  }, requestOptions), requestOptions);
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
    if (detail.requiredFields) error.requiredFields = detail.requiredFields;
    error.acceptance = detail.acceptance || 'unknown';
    throw error;
  }
  return output;
}

async function doctor(connectionFile, deadline) {
  const requestOptions = { deadline };
  return mcpClient.withSession(connectionFile, async () => {
    const initialized = await mcpClient.request(connectionFile, {
      jsonrpc: '2.0', id: 'initialize', method: 'initialize',
      params: { protocolVersion: '2025-11-25', clientInfo: { name: 'hamster-cli', version: packageMetadata.version }, capabilities: {} }
    }, requestOptions);
    const runtime = await mcpClient.request(connectionFile, { jsonrpc: '2.0', id: 'runtime', method: 'hamster/runtime/status' }, requestOptions);
    const tools = await mcpClient.request(connectionFile, { jsonrpc: '2.0', id: 'tools', method: 'tools/list' }, requestOptions);
    return { ok: true, server: initialized.result?.serverInfo, runtime: runtime.result, tools: tools.result?.tools?.map((tool) => tool.name) || [] };
  }, requestOptions);
}

function print(value, json = true) {
  if (!json && typeof value === 'string') process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorEnvelope(error) {
  return { schemaVersion: 2, ok: false, error: {
    code: error.code || 'HAMSTER_CLI_ERROR', stage: error.stage || 'cli', message: error.message,
    acceptance: error.acceptance || 'not_accepted', requestId: error.requestId || null,
    taskId: error.taskId || null, retryClass: error.retryable ? 'retryable' : 'inspect',
    safeNextAction: error.requestFile ? { kind: 'resume', requestFile: error.requestFile }
      : error.requiredAction || null,
    ...(error.requiredFields ? { requiredFields: error.requiredFields } : {}),
    diagnosticRef: error.diagnosticRef || null,
    knownCause: error.knownCause || 'unknown',
    launchAttemptId: error.launchAttemptId || null,
    instanceId: error.instanceId || null
  } };
}

function requestedResultPath(argv) {
  const index = argv.indexOf('--result-file');
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : '';
}

function resultFileConflicts(target, options) {
  if (!target) return false;
  const result = path.resolve(target).toLowerCase();
  const separator = path.sep.toLowerCase();
  const sources = options?.capability === 'intake.submit' ? options.input?.paths || [] : [];
  return sources.some((sourcePath) => {
    const source = path.resolve(sourcePath).toLowerCase();
    return result === source || result.startsWith(`${source}${separator}`);
  }) ||
    Boolean(options?.inputFile && options.inputFile !== '-' && result === path.resolve(options.inputFile).toLowerCase());
}

async function reserveResultFile(target) {
  if (!target) return null;
  const resolved = path.resolve(target);
  const handle = await fs.open(resolved, 'wx');
  try { await handle.writeFile(`${JSON.stringify({ schemaVersion: 2, ok: false,
    error: { code: 'OPERATION_PENDING', stage: 'client', acceptance: 'unknown' } })}\n`, 'utf8'); }
  finally { await handle.close(); }
  const identity = await fs.stat(resolved);
  return { path: resolved, dev: identity.dev, ino: identity.ino };
}

async function writeResultFile(reservation, value) {
  if (!reservation) return;
  const current = await fs.stat(reservation.path);
  if (current.dev !== reservation.dev || current.ino !== reservation.ino) {
    const error = new Error('The reserved result file was replaced by another process.');
    error.code = 'RESULT_FILE_CHANGED';
    throw error;
  }
  const temporary = `${reservation.path}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, reservation.path);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function validateCapabilityInput(capability, input) {
  const definition = capabilities.find((entry) => entry.name === capability);
  if (!definition) throw usage(`Unknown capability: ${capability}`);
  try { validate(input, definition.inputSchema, 'input'); }
  catch (error) { throw usage(error.message); }
}

function requireV2Receipt(result) {
  if (result?.requiresConfirmation) return result;
  if (result?.schemaVersion !== 2) {
    const error = new Error('The running application does not support v2 task receipts.');
    error.code = 'PROTOCOL_MISMATCH';
    error.stage = 'receipt';
    throw error;
  }
  return result;
}

async function runtimeStatus(connectionFile, deadline) {
  const response = await mcpClient.request(connectionFile, {
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'hamster/runtime/status'
  }, { deadline });
  const runtime = response?.result;
  if (!runtime?.repositoryDirectory || !runtime?.userDataRoot || !runtime?.instanceId) {
    const error = new Error('The running application does not provide the v2 repository identity.');
    error.code = 'PROTOCOL_MISMATCH';
    error.stage = 'runtime';
    throw error;
  }
  return runtime;
}

async function runCommand(options) {
  if (options.command === 'help') return HELP;
  if (options.command === 'version') return { schemaVersion: 1, name: packageMetadata.name, version: packageMetadata.version };
  if (options.command === 'mcp') { await mcpClient.main([]); return null; }
  if (options.command === 'call') {
    options.input ||= await readInput(options.inputFile);
    validateCapabilityInput(options.capability, options.input);
  } else if (options.capability) validateCapabilityInput(options.capability, options.input || {});
  if (options.capability === 'intake.submit' && options.input?.responseVersion === 2) {
    validateExplicitIntakeInput(options.input);
  }
  if (options.command === 'task' && options.action === 'pending') {
    return { schemaVersion: 2, ok: true, pending: await requestStore.pendingRequests(requestStore.cliUserDataRoot()) };
  }
  if (options.command === 'task' && options.action === 'get') {
    const stored = await requestStore.offlineTerminalReceipt(requestStore.cliUserDataRoot(), options.input.taskId, 2);
    if (stored) {
      await requestStore.reconcileTerminalRequests(requestStore.cliUserDataRoot()).catch(() => {});
      return stored;
    }
  }
  let resumed = null;
  if (options.command === 'task' && options.action === 'resume') {
    resumed = await requestStore.readRequestFile(options.requestFile);
    validateCapabilityInput('intake.submit', resumed.value.input);
    if (resumed.value.taskId) {
      const stored = await requestStore.offlineTerminalReceipt(
        resumed.value.userDataRoot, resumed.value.taskId, 2);
      if (stored) {
        await requestStore.reconcileTerminalRequests(resumed.value.userDataRoot).catch(() => {});
        return stored;
      }
    }
  }
  const connectionFile = await mcpClient.startOrConnect(connectionOptions(options.deadline));
  if (options.command === 'doctor') return doctor(connectionFile, options.deadline);
  if (resumed || options.command === 'intake') {
    const runtime = await runtimeStatus(connectionFile, options.deadline);
    let requestFile;
    let input;
    if (resumed) {
      if (!requestStore.sameRepository(resumed.value.repositoryDirectory, runtime.repositoryDirectory) ||
          path.resolve(resumed.value.userDataRoot) !== path.resolve(runtime.userDataRoot)) {
        const error = new Error('The request file belongs to a different warehouse or user data location.');
        error.code = 'REQUEST_REPOSITORY_MISMATCH';
        throw error;
      }
      requestFile = resumed.file;
      input = resumed.value.input;
    } else {
      input = options.input;
      requestFile = await requestStore.createRequestFile(runtime.userDataRoot, {
        requestId: input.requestId, repositoryDirectory: runtime.repositoryDirectory,
        userDataRoot: runtime.userDataRoot, applicationRoot: runtime.applicationRoot,
        input
      });
    }
    await requestStore.updateRequestFile(requestFile, { status: 'sending' });
    try {
      const result = requireV2Receipt(await callTool(connectionFile, 'hamster_call', { capability: 'intake.submit', input }, options.deadline));
      await requestStore.updateRequestFile(requestFile, { taskId: result?.task?.id || null,
        status: result?.task?.terminal ? 'completed' : result?.requiresConfirmation ? 'not_accepted' : 'accepted' });
      return { ...result, requestFile };
    } catch (error) {
      await requestStore.updateRequestFile(requestFile, { status: 'unknown' }).catch(() => {});
      error.requestFile = requestFile;
      error.requestId = input.requestId;
      error.acceptance = 'unknown';
      throw error;
    }
  }
  const result = options.tool
    ? callTool(connectionFile, options.tool, options.arguments, options.deadline)
    : callTool(connectionFile, 'hamster_call', { capability: options.capability, input: options.input || {},
      ...(options.confirmationToken ? { confirmationToken: options.confirmationToken } : {}) }, options.deadline);
  const resolved = await result;
  if (resolved?.task?.terminal) {
    await requestStore.reconcileTerminalRequests(requestStore.cliUserDataRoot()).catch(() => {});
  }
  return options.input?.responseVersion === 2 ? requireV2Receipt(resolved) : resolved;
}

async function main(argv = process.argv.slice(2)) {
  let reservation = null;
  let commandResult = null;
  try {
    const options = parse(argv);
    options.deadline = performance.now() + 120_000;
    if (options.command === 'call') {
      options.input = await readInput(options.inputFile);
      validateCapabilityInput(options.capability, options.input);
    }
    if (resultFileConflicts(options.resultFile, options)) {
      const error = usage('--result-file cannot write into an intake source or input file.');
      error.resultFileUnsafe = true;
      throw error;
    }
    reservation = await reserveResultFile(options.resultFile);
    commandResult = await runCommand(options);
    if (commandResult !== null) {
      await writeResultFile(reservation, commandResult);
      print(commandResult, typeof commandResult !== 'string');
    }
    return commandResult;
  } catch (error) {
    if (commandResult?.task?.id) {
      error.acceptance = 'accepted';
      error.taskId = commandResult.task.id;
      error.requestId = commandResult.task.requestId || null;
      error.requestFile = commandResult.requestFile || null;
    }
    if (!reservation && !error.resultFileUnsafe && requestedResultPath(argv)) {
      try { reservation = await reserveResultFile(requestedResultPath(argv)); }
      catch { /* The target may already exist or be unwritable. */ }
    }
    if (reservation) await writeResultFile(reservation, errorEnvelope(error)).catch(() => {});
    throw error;
  }
}

function exitCodeFor(error) {
  if (error?.code === 'CLI_USAGE' || error?.code === 'INVALID_JSON') return 2;
  if (['STARTUP_TIMEOUT', 'STARTUP_FAILED', 'APPLICATION_SPAWN_FAILED', 'APPLICATION_EXITED',
    'GRAPHICS_INITIALIZATION_FAILED', 'CONNECTION_FAILED', 'CONNECTION_STALE',
    'CONNECTION_TIMEOUT', 'CONNECTION_INVALID', 'DEADLINE_EXCEEDED', 'SESSION_ACQUIRE_FAILED',
    'RPC_ERROR', 'PROTOCOL_MISMATCH'].includes(error?.code)) return 3;
  return 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${JSON.stringify(errorEnvelope(error))}\n`);
  process.exitCode = exitCodeFor(error);
});

module.exports = { HELP, exitCodeFor, main, parse, errorEnvelope, readInput,
  reserveResultFile, runCommand, writeResultFile };
