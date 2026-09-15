'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MCP_DESKTOP_REQUEST_MAX_AGE_MS = 60_000;
const MCP_DESKTOP_REQUEST_PATTERN = /^hamster-mcp-launch-\d+-[a-f0-9]{32}\.json$/i;
const MCP_READY_FILE_PATTERN = /^hamster-mcp-ready-\d+-[a-f0-9]{32}\.json$/i;

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replaceAll('\\', '/').toLowerCase();
  return normalize(left) === normalize(right);
}

function isValidMcpReadyFile(value, tempDirectory = os.tmpdir()) {
  if (!value || !path.isAbsolute(value)) return false;
  const resolved = path.resolve(value);
  return samePath(path.dirname(resolved), tempDirectory) && MCP_READY_FILE_PATTERN.test(path.basename(resolved));
}

async function createDesktopLaunchRequest({ applicationExecutable, readyFile, showUi = false, tempDirectory = os.tmpdir() }) {
  const resolvedExecutable = path.resolve(applicationExecutable);
  if (!path.isAbsolute(resolvedExecutable) || !isValidMcpReadyFile(readyFile, tempDirectory)) {
    throw new Error('Invalid MCP desktop launch request');
  }
  const requestFile = path.join(
    path.resolve(tempDirectory),
    `hamster-mcp-launch-${process.pid}-${crypto.randomBytes(16).toString('hex')}.json`
  );
  await fsp.writeFile(requestFile, `${JSON.stringify({
    schemaVersion: 1,
    applicationExecutable: resolvedExecutable,
    readyFile: path.resolve(readyFile),
    showUi: Boolean(showUi),
    createdAt: new Date().toISOString()
  })}\n`, { encoding: 'utf8', flag: 'wx' });
  return requestFile;
}

function takeDesktopLaunchRequest({ applicationExecutable, tempDirectory = os.tmpdir(), now = Date.now(), fsImpl = fs }) {
  let names;
  try {
    names = fsImpl.readdirSync(tempDirectory).filter((name) => MCP_DESKTOP_REQUEST_PATTERN.test(name));
  } catch {
    return null;
  }
  for (const name of names) {
    const requestFile = path.join(tempDirectory, name);
    let request;
    try {
      request = JSON.parse(fsImpl.readFileSync(requestFile, 'utf8'));
    } catch {
      continue;
    }
    const createdAt = Date.parse(request?.createdAt || '');
    if (request?.schemaVersion !== 1 || !Number.isFinite(createdAt) || Math.abs(now - createdAt) > MCP_DESKTOP_REQUEST_MAX_AGE_MS ||
        !samePath(request.applicationExecutable || '', applicationExecutable) ||
        !isValidMcpReadyFile(request.readyFile, tempDirectory)) continue;
    try { fsImpl.unlinkSync(requestFile); } catch { continue; }
    return {
      readyFile: path.resolve(request.readyFile),
      showUi: request.showUi === true
    };
  }
  return null;
}

module.exports = {
  MCP_DESKTOP_REQUEST_MAX_AGE_MS,
  createDesktopLaunchRequest,
  isValidMcpReadyFile,
  takeDesktopLaunchRequest
};
