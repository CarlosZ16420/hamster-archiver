#!/usr/bin/env node
'use strict';

// Standard MCP stdio adapter and one-shot CLI. stdout is protocol/JSON only.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { createDesktopLaunchRequest, mcpTempDirectory } = require('./mcp-launch');

const MAX_MESSAGE_BYTES = 1024 * 1024;
const MCP_CLIENT_RUNTIME_SWITCHES = [
  '--disable-crash-reporter',
  '--disable-breakpad'
];
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const recentLaunches = new Map();
const EXPECTED_MCP_TOOLS = ['hamster_discover', 'hamster_describe', 'hamster_call'];
const WINDOWS_DESKTOP_BROKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$shell = New-Object -ComObject Shell.Application',
  "$shell.ShellExecute($env:HAMSTER_MCP_APPLICATION, ('--mcp-temp-dir=\"' + $env:HAMSTER_MCP_TEMP_DIRECTORY + '\"'), $env:HAMSTER_MCP_WORKING_DIRECTORY, 'open', 0)"
].join('; ');

function remainingBudget(deadline, maximumMs = 120_000) {
  const left = Number.isFinite(deadline) ? Math.ceil(deadline - performance.now()) : maximumMs;
  if (left <= 0) throw Object.assign(new Error('The total MCP request deadline expired.'), {
    code: 'DEADLINE_EXCEEDED', stage: 'deadline'
  });
  return Math.max(1, Math.min(maximumMs, left));
}

function parseCli(argv) {
  const args = [...argv];
  const commands = ['describe', 'call', 'doctor'];
  if (args[0] && !String(args[0]).startsWith('--') && !commands.includes(args[0])) {
    throw Object.assign(new Error(`Unknown command: ${args[0]}`), { code: 'CLI_USAGE' });
  }
  const command = commands.includes(args[0]) ? args.shift() : 'stdio';
  let showUi = false;
  let appExecutable = '';
  let connectionFile = '';
  let json = '{}';
  let jsonProvided = false;
  let jsonFile = '';
  let outputFile = '';
  for (let index = 0; index < args.length;) {
    if (args[index] === '--show-ui') { showUi = true; args.splice(index, 1); continue; }
    if (args[index] === '--app-executable') { appExecutable = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (args[index] === '--connection') { connectionFile = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (args[index] === '--json') { json = args[index + 1] || ''; jsonProvided = true; args.splice(index, 2); continue; }
    if (args[index] === '--json-file') { jsonFile = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (args[index] === '--output') { outputFile = args[index + 1] || ''; args.splice(index, 2); continue; }
    if (MCP_CLIENT_RUNTIME_SWITCHES.includes(args[index])) { args.splice(index, 1); continue; }
    if (String(args[index]).startsWith('--')) throw Object.assign(new Error(`Unknown option: ${args[index]}`), { code: 'CLI_USAGE' });
    index += 1;
  }
  if (jsonFile && jsonProvided) throw Object.assign(new Error('Use either --json or --json-file, not both.'), { code: 'CLI_USAGE' });
  if ((command === 'stdio' || command === 'describe' || command === 'doctor') && (jsonFile || jsonProvided)) {
    throw Object.assign(new Error('--json and --json-file are available only with call.'), { code: 'CLI_USAGE' });
  }
  if (command === 'stdio' && outputFile) throw Object.assign(new Error('--output is not available in stdio MCP mode.'), { code: 'CLI_USAGE' });
  return { command, args, showUi, appExecutable, connectionFile, json, jsonFile, outputFile };
}

function resolveApplicationLaunch(appExecutable) {
  if (appExecutable) return { executable: path.resolve(appExecutable), prefixArgs: [] };
  if (!['node', 'node.exe'].includes(path.basename(process.execPath).toLowerCase())) {
    return { executable: process.execPath, prefixArgs: [] };
  }
  // Source-tree convenience. Packaged use never needs an external Node.js runtime.
  const electron = require('electron');
  return { executable: electron, prefixArgs: [path.resolve(__dirname, '..', '..')] };
}

async function readDiagnosticFailure(diagnosticFile) {
  if (!diagnosticFile) return null;
  try {
    const value = JSON.parse(await fs.readFile(diagnosticFile, 'utf8'));
    if (!value?.message) return null;
    return Object.assign(new Error(value.message), { code: value.code || 'STARTUP_FAILED', stage: value.stage || 'startup' });
  } catch { return null; }
}

async function writeLaunchDiagnostic(file, value) {
  try {
    await fs.writeFile(file, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx' });
    return file;
  } catch (error) {
    if (error.code !== 'EEXIST') return null;
    // The application can publish its startup diagnostic before the client does.
    // Preserve that evidence only after reading a complete diagnostic for this attempt.
    try {
      const existing = JSON.parse(await fs.readFile(file, 'utf8'));
      return existing?.schemaVersion === 1 &&
        (existing.launchAttemptId == null || existing.launchAttemptId === value.launchAttemptId)
        ? file : null;
    } catch { return null; }
  }
}

async function waitForReady(readyFile, timeoutMs = 45_000, getLaunchFailure = () => null, diagnosticFile = '') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const launchFailure = getLaunchFailure();
    if (launchFailure) throw launchFailure;
    const diagnosticFailure = await readDiagnosticFailure(diagnosticFile);
    if (diagnosticFailure) throw diagnosticFailure;
    try {
      const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
      if (typeof ready.connectionFile === 'string' && path.isAbsolute(ready.connectionFile)) return ready.connectionFile;
    } catch { /* The ready file is created only after application initialization. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Object.assign(new Error(
    `Hamster Archiver MCP did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds. ` +
    'Startup may still be verifying the release or loading the warehouse. Run doctor for a staged diagnosis.'
  ), { code: 'STARTUP_TIMEOUT', stage: 'ready' });
}

function launchExitError(code, signal, stderrTail = '') {
  const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
  const gpuEvidence = /gpu process isn't usable|gpu_data_manager/i.test(stderrTail);
  const errorCode = gpuEvidence ? 'GRAPHICS_INITIALIZATION_FAILED' : 'APPLICATION_EXITED';
  const hint = gpuEvidence
    ? ' Electron graphics initialization failed while using the system default graphics profile.'
    : '';
  return Object.assign(new Error(
    `Hamster Archiver exited before MCP was ready (${outcome}).${hint}` +
    (stderrTail ? `\nRecent diagnostics:\n${stderrTail}` : '')
  ), { code: errorCode, stage: 'application-start' });
}

async function readConnectionDiagnostic(connectionFile, connection) {
  const file = String(connection?.diagnosticRef || '');
  const expectedDirectory = path.join(path.dirname(connectionFile), 'diagnostics');
  if (!file || path.dirname(path.resolve(file)).toLowerCase() !== expectedDirectory.toLowerCase() ||
      !/^instance-[a-f0-9-]{36}\.json$/i.test(path.basename(file))) return null;
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (value.instanceId !== connection.instanceId || value.pid !== connection.pid) return null;
    return { file, value };
  } catch { return null; }
}

function isUnexpectedLaunchExit(code) {
  // A zero exit commonly means Electron handed the arguments to the already-running
  // single instance. That instance will produce the ready file.
  return code !== 0;
}

async function launchApplication(launch, options) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const tempDirectory = mcpTempDirectory([], env);
  await fs.mkdir(tempDirectory, { recursive: true });
  const launchAttemptId = crypto.randomUUID();
  let requestFile = '';
  let failed = false;
  const temporaryFiles = new Set();
  const attemptFiles = () => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const readyFile = path.join(tempDirectory, `hamster-mcp-ready-${process.pid}-${nonce}.json`);
    const diagnosticFile = path.join(tempDirectory, `hamster-mcp-diagnostic-${process.pid}-${nonce}.json`);
    temporaryFiles.add(readyFile);
    temporaryFiles.add(diagnosticFile);
    return { readyFile, diagnosticFile };
  };
  async function startDirectly() {
    const { readyFile, diagnosticFile } = attemptFiles();
    const args = [
      ...launch.prefixArgs,
      ...MCP_CLIENT_RUNTIME_SWITCHES,
      '--enable-mcp',
      '--background',
      `--mcp-temp-dir=${tempDirectory}`,
      `--mcp-launch-attempt-id=${launchAttemptId}`,
      `--mcp-ready-file=${readyFile}`,
      `--mcp-diagnostic-file=${diagnosticFile}`
    ];
    if (options.showUi) args.push('--show-ui');
    const child = spawn(launch.executable, args, { cwd: path.dirname(launch.executable), detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !options.showUi, env });
    let launchFailure = null;
    let stderrTail = '';
    let readyConnectionFile = '';
    let resolveCloseEvidence;
    const closeEvidence = new Promise((resolve) => { resolveCloseEvidence = resolve; });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-MAX_DIAGNOSTIC_BYTES); });
    child.once('error', (error) => {
      launchFailure = Object.assign(new Error(`Could not start Hamster Archiver: ${error.message}`), { code: 'APPLICATION_SPAWN_FAILED', stage: 'application-start' });
    });
    child.once('exit', (code, signal) => {
      if (isUnexpectedLaunchExit(code)) launchFailure = launchExitError(code, signal, stderrTail);
    });
    child.once('close', (code, signal) => {
      const knownCause = /gpu process isn't usable|gpu_data_manager/i.test(stderrTail)
        ? 'graphics_initialization' : code === 0 ? 'normal_exit' : 'unknown';
      const exit = { code, signal, stderrTail, knownCause, at: new Date().toISOString() };
      const previous = recentLaunches.get(readyConnectionFile) || {};
      if (readyConnectionFile) recentLaunches.set(readyConnectionFile, { ...previous, exit });
      const writeDiagnostic = code === 0 ? Promise.resolve(null) : writeLaunchDiagnostic(diagnosticFile,
        { schemaVersion: 1, launchAttemptId,
          instanceId: previous.instanceId || null, code: 'APPLICATION_EXITED', knownCause,
          exitCode: code, signal, stderrTail: stderrTail.slice(-MAX_DIAGNOSTIC_BYTES),
          at: exit.at });
      void writeDiagnostic.then((diagnosticRef) => resolveCloseEvidence({ exit, diagnosticRef }));
    });
    child.unref();
    child.stderr?.unref?.();
    try {
      readyConnectionFile = await waitForReady(readyFile, remainingBudget(options.deadline, 45_000), () => launchFailure, diagnosticFile);
      const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
      recentLaunches.set(readyConnectionFile, { ...(recentLaunches.get(readyConnectionFile) || {}),
        launchAttemptId, instanceId: ready.instanceId || null, closeEvidence });
      // The child may exit immediately after ready. Keep its diagnostic file for
      // the later request even if launchApplication has already returned.
      temporaryFiles.delete(diagnosticFile);
      return readyConnectionFile;
    } catch (error) { child.stderr?.destroy(); throw error; }
  }
  try {
    if (process.platform === 'win32' && launch.prefixArgs.length === 0) {
      const { readyFile, diagnosticFile } = attemptFiles();
      requestFile = await createDesktopLaunchRequest({
        applicationExecutable: launch.executable,
        readyFile,
        diagnosticFile,
        launchAttemptId,
        showUi: options.showUi,
        tempDirectory
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
          HAMSTER_MCP_WORKING_DIRECTORY: path.dirname(launch.executable),
          HAMSTER_MCP_TEMP_DIRECTORY: tempDirectory
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
        const connectionFile = await waitForReady(readyFile, remainingBudget(options.deadline, 45_000), () => brokerFailure, diagnosticFile);
        const ready = JSON.parse(await fs.readFile(readyFile, 'utf8'));
        recentLaunches.set(connectionFile, { launchAttemptId, instanceId: ready.instanceId || null });
        return connectionFile;
      } catch (brokerError) {
        await fs.rm(requestFile, { force: true }).catch(() => {});
        requestFile = '';
        try { return await startDirectly(); }
        catch (directError) {
          throw Object.assign(new Error(
            `Windows desktop launch failed: ${brokerError.message}\nDirect fallback failed: ${directError.message}`
          ), { code: directError.code || brokerError.code || 'STARTUP_FAILED', stage: directError.stage || 'application-start' });
        }
      }
    }
    return await startDirectly();
  } catch (error) {
    failed = true;
    error.launchAttemptId = launchAttemptId;
    error.knownCause = error.code === 'GRAPHICS_INITIALIZATION_FAILED'
      ? 'graphics_initialization' : 'unknown';
    const diagnosticFile = [...temporaryFiles].find((file) => path.basename(file).startsWith('hamster-mcp-diagnostic-'));
    if (diagnosticFile) {
      const diagnosticRef = await writeLaunchDiagnostic(diagnosticFile, { schemaVersion: 1, launchAttemptId,
        code: error.code || 'STARTUP_FAILED', stage: error.stage || 'application-start',
        knownCause: error.knownCause, message: String(error.message).slice(-MAX_DIAGNOSTIC_BYTES),
        at: new Date().toISOString() });
      if (diagnosticRef) error.diagnosticRef = diagnosticRef;
    }
    throw error;
  } finally {
    await Promise.all([
      ...[...temporaryFiles].filter((file) => !failed || !path.basename(file).startsWith('hamster-mcp-diagnostic-'))
        .map((file) => fs.rm(file, { force: true }).catch(() => {})),
      requestFile ? fs.rm(requestFile, { force: true }).catch(() => {}) : Promise.resolve()
    ]);
  }
}

async function connectionIsLive(connectionFile) {
  try {
    const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
    if (!Number.isInteger(connection.pid) || connection.pid < 1) return false;
    process.kill(connection.pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function coordinateLaunch(directory, start, timeoutMs = 105_000) {
  const ownerFile = path.join(directory, 'owner.json');
  const resultFile = path.join(directory, 'result.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
      await fs.writeFile(ownerFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx' });
      try {
        const connectionFile = await start();
        const pendingResult = path.join(directory, `result-${process.pid}.json`);
        await fs.writeFile(pendingResult, JSON.stringify({ connectionFile }), { flag: 'wx' });
        await fs.rename(pendingResult, resultFile);
        return connectionFile;
      } catch (error) {
        await fs.unlink(ownerFile).catch(() => {});
        await fs.rmdir(directory).catch(() => {});
        throw error;
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    let stale = false;
    try {
      const result = JSON.parse(await fs.readFile(resultFile, 'utf8'));
      if (typeof result.connectionFile === 'string' && path.isAbsolute(result.connectionFile) &&
          await connectionIsLive(result.connectionFile)) return result.connectionFile;
      stale = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') stale = true;
      else {
        try {
          const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'));
          if (!Number.isInteger(owner.pid) || owner.pid < 1) stale = true;
          else process.kill(owner.pid, 0);
        } catch (ownerError) {
          if (ownerError?.code !== 'ENOENT' && ownerError?.code !== 'EPERM') stale = true;
        }
        const age = Date.now() - (await fs.stat(directory).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
        if (age > 120_000) stale = true;
      }
    }
    if (stale) {
      const abandoned = `${directory}-${crypto.randomBytes(6).toString('hex')}`;
      try {
        await fs.rename(directory, abandoned);
        const names = await fs.readdir(abandoned);
        await Promise.all(names.filter((name) => name === 'owner.json' || name === 'result.json' ||
          /^result-\d+\.json$/.test(name)).map((name) => fs.unlink(path.join(abandoned, name)).catch(() => {})));
        await fs.rmdir(abandoned).catch(() => {});
      } catch { /* Another process already replaced the rendezvous. */ }
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Object.assign(new Error(`Hamster Archiver MCP launch did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`), {
    code: 'STARTUP_TIMEOUT', stage: 'ready'
  });
}

async function startOrConnect(options) {
  const launch = resolveApplicationLaunch(options.appExecutable);
  if (process.platform !== 'win32' || launch.prefixArgs.length > 0 || options.showUi) {
    return launchApplication(launch, options);
  }

  // A burst of CLI processes must share one desktop launch. Each process still
  // reads the application's own connection file; this rendezvous stores no token.
  const key = crypto.createHash('sha256').update(JSON.stringify([
    launch.executable.toLowerCase(),
    process.env.HAMSTER_DEV_USER_DATA_DIR || '',
    process.env.HAMSTER_LOCAL_ROOT || '',
    process.env.HAMSTER_SMOKE_USER_DATA_DIR || '',
    mcpTempDirectory([], process.env)
  ])).digest('hex').slice(0, 24);
  return coordinateLaunch(
    path.join(mcpTempDirectory([], process.env), `hamster-mcp-start-${key}`),
    () => launchApplication(launch, options),
    remainingBudget(options.deadline, 105_000)
  );
}

async function request(connectionFile, message, options = {}) {
  const timeoutMs = remainingBudget(options.deadline, options.timeoutMs || 120_000);
  const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
  if (typeof connection.token !== 'string' || !/^[0-9a-f]{64}$/i.test(connection.token)) {
    throw Object.assign(new Error('Invalid local MCP connection token'), { code: 'CONNECTION_INVALID', stage: 'request' });
  }
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid local MCP endpoint');
  }
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify(message)
    });
  } catch (error) {
    let processAlive = null;
    if (Number.isInteger(connection.pid) && connection.pid > 0) {
      try { process.kill(connection.pid, 0); processAlive = true; }
      catch (failure) { processAlive = failure.code === 'EPERM'; }
    }
    const stale = processAlive === false;
    const recentLaunch = recentLaunches.get(connectionFile) || {};
    let closeEvidence = null;
    if (stale && recentLaunch.closeEvidence) {
      const waitMs = Math.min(500, Number.isFinite(options.deadline)
        ? Math.max(0, options.deadline - performance.now()) : 500);
      if (waitMs > 0) {
        let timer;
        try {
          closeEvidence = await Promise.race([recentLaunch.closeEvidence,
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); })]);
        } finally { clearTimeout(timer); }
      }
    }
    const launch = { ...(recentLaunches.get(connectionFile) || recentLaunch), ...(closeEvidence || {}) };
    const persisted = stale ? await readConnectionDiagnostic(connectionFile, connection) : null;
    const gpuEventAge = Date.now() - Date.parse(persisted?.value?.childProcess?.at || '');
    const persistedCause = persisted?.value?.knownCause === 'gpu_process_failure' &&
      (!Number.isFinite(gpuEventAge) || gpuEventAge > 60_000)
      ? 'unknown' : persisted?.value?.knownCause;
    const knownCause = stale ? launch.exit?.knownCause || persistedCause || 'unknown' : 'unknown';
    const deadlineExpired = Number.isFinite(options.deadline) && performance.now() >= options.deadline;
    const timedOut = ['AbortError', 'TimeoutError'].includes(error?.name);
    throw Object.assign(new Error(stale
      ? `The MCP connection is stale: Hamster Archiver process ${connection.pid} is no longer running.`
      : deadlineExpired ? 'The total MCP request deadline expired before a response was received.'
        : timedOut ? 'The local MCP endpoint did not respond in time.'
          : `Could not reach the local Hamster Archiver MCP endpoint: ${error.message}`), {
      code: stale && knownCause === 'graphics_initialization' ? 'GRAPHICS_INITIALIZATION_FAILED'
        : stale ? 'CONNECTION_STALE' : deadlineExpired ? 'DEADLINE_EXCEEDED'
          : timedOut ? 'CONNECTION_TIMEOUT' : 'CONNECTION_FAILED',
      stage: deadlineExpired ? 'deadline' : 'request', knownCause,
      launchAttemptId: launch.launchAttemptId || persisted?.value?.launchAttemptId || null,
      instanceId: connection.instanceId || launch.instanceId || null,
      requestId: message?.params?.arguments?.input?.requestId || null,
      taskId: message?.params?.arguments?.input?.taskId || null,
      diagnosticRef: launch.diagnosticRef || persisted?.file || null
    });
  }
  if (!response.ok) throw new Error(`Local MCP request failed (${response.status})`);
  return response.status === 202 || response.status === 204 ? null : response.json();
}

async function withSession(connectionFile, action, options = {}) {
  const acquired = await request(connectionFile, { jsonrpc: '2.0', id: 'session-acquire', method: 'hamster/session/acquire' }, options);
  if (acquired?.error || typeof acquired?.result?.sessionId !== 'string') {
    throw Object.assign(new Error(acquired?.error?.message || 'The local MCP session could not be acquired.'), {
      code: 'SESSION_ACQUIRE_FAILED', stage: 'session'
    });
  }
  const sessionId = acquired.result.sessionId;
  let heartbeatFailureReported = false;
  let heartbeatInFlight = false;
  const heartbeat = sessionId && setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    void request(connectionFile, { jsonrpc: '2.0', id: 'session-touch', method: 'hamster/session/touch', params: { sessionId } }, {
      deadline: options.deadline, timeoutMs: 1_000
    }).catch((error) => {
      if (!heartbeatFailureReported) process.stderr.write(`MCP heartbeat failed: ${error.message}\n`);
      heartbeatFailureReported = true;
    }).finally(() => { heartbeatInFlight = false; });
  }, 15_000);
  heartbeat?.unref?.();
  try { return await action(); }
  finally {
    if (heartbeat) clearInterval(heartbeat);
    if (sessionId) await request(connectionFile, { jsonrpc: '2.0', id: 'session-release', method: 'hamster/session/release', params: { sessionId } }, {
      timeoutMs: 750
    }).catch(() => {});
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

async function readJsonArguments(options) {
  if (!options.jsonFile) return options.json;
  if (options.jsonFile === '-') {
    const chunks = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      total += Buffer.byteLength(chunk);
      if (total > MAX_MESSAGE_BYTES) throw Object.assign(new Error('JSON input is too large.'), { code: 'INPUT_TOO_LARGE' });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8').replace(/^\uFEFF/, '');
  }
  const stats = await fs.stat(path.resolve(options.jsonFile));
  if (stats.size > MAX_MESSAGE_BYTES) throw Object.assign(new Error('JSON input is too large.'), { code: 'INPUT_TOO_LARGE' });
  return (await fs.readFile(path.resolve(options.jsonFile), 'utf8')).replace(/^\uFEFF/, '');
}

async function writeOutput(value, outputFile = '', replaceReserved = false) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputFile) { process.stdout.write(text); return; }
  await fs.writeFile(path.resolve(outputFile), text, { encoding: 'utf8', flag: replaceReserved ? 'w' : 'wx' });
}

async function reserveOutputFile(outputFile) {
  if (!outputFile) return false;
  await fs.writeFile(path.resolve(outputFile), `${JSON.stringify({
    ok: false,
    code: 'OPERATION_PENDING',
    stage: 'client',
    message: 'The command reserved this result file but has not completed.'
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return true;
}

function rpcResult(response, stage) {
  if (response?.error) {
    throw Object.assign(new Error(response.error.message || `MCP ${stage} failed.`), {
      code: 'RPC_ERROR', stage
    });
  }
  if (!response || !Object.hasOwn(response, 'result')) {
    throw Object.assign(new Error(`MCP ${stage} returned no result.`), {
      code: 'RPC_INVALID_RESPONSE', stage
    });
  }
  return response.result;
}

function validateDoctorResults(initializedResponse, runtimeResponse, toolsResponse, connection) {
  const initialized = rpcResult(initializedResponse, 'initialize');
  if (initialized?.protocolVersion !== '2025-11-25' || initialized?.serverInfo?.name !== 'hamster-archiver' ||
      typeof initialized?.serverInfo?.version !== 'string' || !initialized.serverInfo.version) {
    throw Object.assign(new Error('The MCP server returned an unexpected protocol or identity.'), {
      code: 'PROTOCOL_MISMATCH', stage: 'initialize'
    });
  }
  const runtime = rpcResult(runtimeResponse, 'runtime');
  const tools = rpcResult(toolsResponse, 'tools');
  const names = Array.isArray(tools?.tools) ? tools.tools.map((tool) => tool?.name).filter(Boolean) : [];
  const missingTools = EXPECTED_MCP_TOOLS.filter((name) => !names.includes(name));
  if (missingTools.length > 0) {
    throw Object.assign(new Error(`The MCP server is missing required tools: ${missingTools.join(', ')}`), {
      code: 'TOOLS_MISSING', stage: 'tools'
    });
  }
  if (!connection?.instanceId || runtime?.instanceId !== connection.instanceId) {
    throw Object.assign(new Error('The authenticated runtime does not match the selected connection instance.'), {
      code: 'INSTANCE_MISMATCH', stage: 'runtime'
    });
  }
  if (connection.version && (runtime?.version !== connection.version || initialized.serverInfo.version !== connection.version)) {
    throw Object.assign(new Error('The MCP server version does not match the selected connection instance.'), {
      code: 'VERSION_MISMATCH', stage: 'runtime'
    });
  }
  return { initialized, runtime, names };
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
    const json = await readJsonArguments(options);
    try { argumentsValue = JSON.parse(json); } catch { throw Object.assign(new Error('JSON input must contain one valid JSON object.'), { code: 'INVALID_JSON' }); }
    if (!argumentsValue || Array.isArray(argumentsValue) || typeof argumentsValue !== 'object') throw Object.assign(new Error('JSON input must contain one JSON object.'), { code: 'INVALID_JSON' });
    rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: argumentsValue } };
  }
  const response = await withSession(connectionFile, () => request(connectionFile, rpc, options), options);
  if (response?.error) throw new Error(response.error.message);
  const result = response?.result;
  const output = result?.structuredContent ?? result;
  await writeOutput(output, options.outputFile, options.outputReserved === true);
  if (result?.isError) process.exitCode = 1;
}

async function runDoctor(connectionFile, options) {
  const result = await withSession(connectionFile, async () => {
    const initializedResponse = await request(connectionFile, { jsonrpc: '2.0', id: 'doctor-init', method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'hamster-doctor', version: '1' }, capabilities: {} } }, options);
    rpcResult(initializedResponse, 'initialize');
    await request(connectionFile, { jsonrpc: '2.0', method: 'notifications/initialized' }, options);
    const [runtimeResponse, toolsResponse] = await Promise.all([
      request(connectionFile, { jsonrpc: '2.0', id: 'doctor-runtime', method: 'hamster/runtime/status' }, options),
      request(connectionFile, { jsonrpc: '2.0', id: 'doctor-tools', method: 'tools/list' }, options)
    ]);
    const connection = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
    const { initialized, runtime, names } = validateDoctorResults(initializedResponse, runtimeResponse, toolsResponse, connection);
    return {
      ok: true,
      protocolVersion: initialized.protocolVersion,
      server: initialized.serverInfo,
      runtime,
      tools: names
    };
  }, options);
  await writeOutput(result, options.outputFile, options.outputReserved === true);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.command !== 'stdio') options.deadline = performance.now() + 120_000;
  const outputReserved = await reserveOutputFile(options.outputFile);
  options.outputReserved = outputReserved;
  try {
    const connectionFile = options.connectionFile
      ? path.resolve(options.connectionFile)
      : await startOrConnect(options);
    if (options.command === 'stdio') await runStdio(connectionFile);
    else if (options.command === 'doctor') await runDoctor(connectionFile, options);
    else await runOneShot(connectionFile, options);
  } catch (error) {
    if (outputReserved) {
      await writeOutput({ ok: false, code: error.code || 'MCP_CLIENT_ERROR', stage: error.stage || 'client', message: error.message }, options.outputFile, true)
        .catch(() => {});
    }
    throw error;
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'MCP_CLIENT_ERROR', stage: error.stage || 'client', message: error.message })}\n`);
  process.exitCode = 1;
});
module.exports = {
  MCP_CLIENT_RUNTIME_SWITCHES,
  EXPECTED_MCP_TOOLS,
  coordinateLaunch,
  isUnexpectedLaunchExit,
  launchApplication,
  main,
  parseCli,
  readJsonArguments,
  remainingBudget,
  reserveOutputFile,
  request,
  resolveApplicationLaunch,
  startOrConnect,
  waitForReady,
  validateDoctorResults,
  withSession,
  writeOutput
};
