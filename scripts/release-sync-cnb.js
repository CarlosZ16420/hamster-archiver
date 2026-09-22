'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { expectedReleaseAssetNames } = require('../src/core/sync-cnb-release-assets');

const DEFAULT_CNB_API_BASE = 'https://api.cnb.cool';
const DEFAULT_CNB_WEB_BASE = 'https://cnb.cool';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const GITHUB_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--tag', '--github-repo', '--cnb-repo', '--attempts', '--make-latest'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Use --tag vX.Y.Z --github-repo OWNER/REPO --cnb-repo GROUP/REPO [--attempts 2] [--make-latest false].');
    }
    const key = argv[index].slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    options[key] = argv[index + 1];
  }
  return options;
}

function normalizeBaseUrl(value, label) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error(`${label} must be a valid URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${label} must be an HTTPS URL without credentials.`);
  return parsed.href.replace(/\/$/, '');
}

function parseHosts(value) {
  return new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function isCnbSyncEnabled(environment = process.env) {
  return environment.CNB_SYNC_ENABLED === 'true';
}

function disabledMessage() {
  return 'CNB synchronization is disabled. Set CNB_SYNC_ENABLED=true only after the target, API contract, upload hosts and token permissions have been independently verified. No CNB request was made.';
}

function validateConfig(options, environment = process.env) {
  const enabled = isCnbSyncEnabled(environment);
  const tag = options.tag || environment.RELEASE_TAG || '';
  const githubRepo = options.githubRepo || environment.GITHUB_REPOSITORY || '';
  const cnbRepo = options.cnbRepo || environment.CNB_REPO_SLUG || '';
  const token = environment.CNB_TOKEN || '';
  const attempts = Number(options.attempts || environment.CNB_SYNC_ATTEMPTS || 2);
  const requestTimeoutMs = Number(environment.CNB_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);
  const makeLatestValue = String(options.makeLatest ?? environment.CNB_MAKE_LATEST ?? 'false');
  if (!enabled) throw new Error(disabledMessage());
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('RELEASE_TAG or --tag must be an exact vX.Y.Z tag.');
  if (githubRepo !== 'CarlosZ16420/hamster-archiver') throw new Error('GitHub source must be the authoritative CarlosZ16420/hamster-archiver repository.');
  if (!/^[^\s/]+(?:\/[^\s/]+)+$/.test(cnbRepo)) throw new Error('CNB_REPO_SLUG or --cnb-repo must identify the existing public CNB repository. No default is guessed.');
  if (!token) throw new Error('CNB_TOKEN is required. Configure its permissions against the current official CNB contract; this script cannot verify authorization from a declaration string. No synchronization was attempted.');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 2) throw new Error('CNB_SYNC_ATTEMPTS must be 1 or 2.');
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 120_000) {
    throw new Error('CNB_REQUEST_TIMEOUT_MS must be an integer from 1000 to 120000.');
  }
  if (!['true', 'false'].includes(makeLatestValue)) throw new Error('CNB_MAKE_LATEST or --make-latest must be exactly true or false.');
  const apiBase = normalizeBaseUrl(environment.CNB_API_BASE || DEFAULT_CNB_API_BASE, 'CNB_API_BASE');
  const webBase = normalizeBaseUrl(environment.CNB_WEB_BASE || DEFAULT_CNB_WEB_BASE, 'CNB_WEB_BASE');
  const uploadHosts = parseHosts(environment.CNB_UPLOAD_HOSTS);
  if (!uploadHosts.size) {
    throw new Error('CNB_UPLOAD_HOSTS is required. Set the exact comma-separated hostnames returned by the official CNB pre-signed upload API.');
  }
  return { enabled, tag, githubRepo, cnbRepo, token, githubToken: environment.GH_TOKEN || '', attempts, requestTimeoutMs, makeLatest: makeLatestValue === 'true', apiBase, webBase, uploadHosts };
}

function encodeRepo(repo) {
  return String(repo).split('/').map(encodeURIComponent).join('/');
}

function retryableError(error) {
  return Boolean(error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError' ||
    error?.status === 408 || error?.status === 429 || error?.status >= 500);
}

async function withRetry(operation, { attempts = 2, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(attempt); } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryableError(error)) throw error;
      await delay(Math.min(2_000, 200 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function validateHttpsHost(url, hosts, label) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !hosts.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${label} is outside its HTTPS host allowlist.`);
  }
  return parsed.href;
}

function markRetryable(error) {
  if (error && typeof error === 'object') error.retryable = true;
  return error;
}

async function runWithTimeout(operation, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, label = 'Request') {
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(`${label} timed out after ${timeoutMs}ms.`);
      error.name = 'TimeoutError';
      error.retryable = true;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout
    ]);
  } catch (error) {
    if (error?.name === 'AbortError') markRetryable(error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestResponseWithTrustedRedirects(url, options, label, fetchImpl, hosts, signal, maxRedirects = 5) {
  let currentUrl = validateHttpsHost(url, hosts, label);
  let currentOptions = { ...options, headers: { ...(options?.headers || {}) }, redirect: 'manual', signal };
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response;
    try { response = await fetchImpl(currentUrl, currentOptions); } catch (error) {
      throw markRetryable(error);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === maxRedirects) throw new Error(`${label} exceeded ${maxRedirects} redirects.`);
    const location = response.headers?.get?.('location');
    if (!location) throw new Error(`${label} redirect has no Location header.`);
    const nextUrl = validateHttpsHost(new URL(location, currentUrl).href, hosts, `${label} redirect`);
    const method = String(currentOptions.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) && currentOptions.body && typeof currentOptions.body !== 'string') {
      throw new Error(`${label} returned a redirect for a non-replayable request body.`);
    }
    if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
      delete currentOptions.headers.Authorization;
      delete currentOptions.headers.authorization;
    }
    currentUrl = nextUrl;
  }
  throw new Error(`${label} redirect failed.`);
}

async function requestWithTrustedRedirects(url, options, label, fetchImpl, hosts, maxRedirects = 5, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return runWithTimeout(
    signal => requestResponseWithTrustedRedirects(url, options, label, fetchImpl, hosts, signal, maxRedirects),
    timeoutMs,
    label
  );
}

function assertExpectedStatus(response, expectedStatuses, label) {
  if (!expectedStatuses.includes(response.status)) {
    const error = new Error(`${label} failed (HTTP ${response.status}).`);
    error.status = response.status;
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw error;
  }
}

async function requestJson(url, options, expectedStatuses, label, fetchImpl, hosts, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return runWithTimeout(async signal => {
    const response = await requestResponseWithTrustedRedirects(url, options, label, fetchImpl, hosts, signal);
    assertExpectedStatus(response, expectedStatuses, label);
    try {
      return await response.json();
    } catch (error) {
      const wrapped = new Error(`${label} response body could not be read as JSON: ${error.message}`);
      wrapped.cause = error;
      wrapped.retryable = true;
      throw wrapped;
    }
  }, timeoutMs, label);
}

async function requestAndDrain(url, options, expectedStatuses, label, fetchImpl, hosts, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return runWithTimeout(async signal => {
    const response = await requestResponseWithTrustedRedirects(url, options, label, fetchImpl, hosts, signal);
    assertExpectedStatus(response, expectedStatuses, label);
    try {
      if (typeof response.arrayBuffer === 'function') await response.arrayBuffer();
      else if (typeof response.text === 'function') await response.text();
    } catch (error) {
      const wrapped = new Error(`${label} response body could not be read: ${error.message}`);
      wrapped.cause = error;
      wrapped.retryable = true;
      throw wrapped;
    }
    return response;
  }, timeoutMs, label);
}

function assertBilingualNotes(body) {
  const normalized = String(body || '').replace(/\r\n?/g, '\n');
  const sections = normalized.split(/^## /m);
  if (!sections.some(section => section.startsWith('中文\n') && section.slice(3).trim()) ||
      !sections.some(section => section.startsWith('English\n') && section.slice(7).trim())) {
    throw new Error('The published GitHub Release body must contain non-empty 中文 and English sections before CNB synchronization.');
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function normalizeRemoteDigest(asset) {
  if (String(asset?.hash_algo || '').toLowerCase() === 'sha256' && /^[a-f0-9]{64}$/i.test(asset.hash_value || '')) {
    return String(asset.hash_value).toLowerCase();
  }
  const match = String(asset?.digest || '').match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : '';
}

function normalizedText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function planCnbUploads(localAssets, remoteAssets) {
  return localAssets.filter(local => {
    const remote = (remoteAssets || []).find(item => item.name === local.name);
    if (!remote) return true;
    const remoteDigest = normalizeRemoteDigest(remote);
    if (Number(remote.size) !== Number(local.size) || remoteDigest !== local.digest) {
      throw new Error(`CNB Release contains a conflicting or unverifiable ${local.name}; synchronization stopped without overwriting it.`);
    }
    return false;
  });
}

function inspectCnbRelease(release, bundle) {
  if (!release || release.prerelease || release.tag_name !== bundle.tag) {
    throw new Error(`CNB ${bundle.tag} is missing or has invalid release metadata.`);
  }
  if (normalizedText(release.body) !== normalizedText(bundle.body)) {
    throw new Error('CNB Release notes conflict with the published GitHub Release body; synchronization stopped.');
  }
  if (String(release.name || '') !== String(bundle.name || '')) {
    throw new Error('CNB Release title conflicts with the published GitHub Release title; synchronization stopped.');
  }
  const pending = planCnbUploads(bundle.assets, release.assets || []);
  if (!release.draft && pending.length) {
    throw new Error(`Published CNB ${bundle.tag} is incomplete; synchronization stopped without changing it.`);
  }
  return pending;
}

function assertCnbRelease(release, bundle) {
  const pending = inspectCnbRelease(release, bundle);
  if (release.draft) throw new Error(`CNB ${bundle.tag} is still a draft after verification.`);
  if (pending.length) throw new Error(`CNB ${bundle.tag} is missing verified assets.`);
  return pending;
}

async function syncReleaseBundle(bundle, cnbClient, { attempts = 2, delay, enabled = false, makeLatest = false } = {}) {
  if (!enabled) {
    return { disabled: true, created: false, uploaded: [], skipped: [], reason: disabledMessage() };
  }
  const tagExists = await withRetry(() => cnbClient.getTag(bundle.tag), { attempts, delay });
  if (!tagExists) throw new Error(`CNB tag ${bundle.tag} does not exist in the public snapshot repository. Source or tags were not pushed.`);
  let release = await withRetry(() => cnbClient.getRelease(bundle.tag), { attempts, delay });
  let created = false;
  if (!release) {
    release = await withRetry(async () => {
      const existing = await cnbClient.getRelease(bundle.tag);
      if (existing) return existing;
      try {
        const createdRelease = await cnbClient.createRelease({
          tag_name: bundle.tag,
          name: bundle.name,
          body: bundle.body,
          draft: true,
          prerelease: false,
          make_latest: 'false'
        });
        created = true;
        return createdRelease;
      } catch (error) {
        if (!retryableError(error)) throw error;
        const afterFailure = await cnbClient.getRelease(bundle.tag);
        if (afterFailure) return afterFailure;
        throw error;
      }
    }, { attempts, delay });
  }
  let pending = inspectCnbRelease(release, bundle);
  if (!release.draft) return { created, uploaded: [], skipped: bundle.assets.map(item => item.name), release };
  const uploaded = [];
  for (const asset of pending) {
    let attemptedUpload = false;
    await withRetry(async () => {
      const current = await cnbClient.getRelease(bundle.tag);
      const currentPending = inspectCnbRelease(current, bundle);
      if (!currentPending.some(item => item.name === asset.name)) return;
      attemptedUpload = true;
      try {
        await cnbClient.uploadAsset(current, asset);
      } catch (error) {
        if (!retryableError(error)) throw error;
        const afterFailure = await cnbClient.getRelease(bundle.tag);
        const stillPending = inspectCnbRelease(afterFailure, bundle).some(item => item.name === asset.name);
        if (!stillPending) return;
        throw error;
      }
      const afterUpload = await cnbClient.getRelease(bundle.tag);
      if (inspectCnbRelease(afterUpload, bundle).some(item => item.name === asset.name)) {
        const error = new Error(`CNB upload read-back is still missing ${asset.name}.`);
        error.retryable = true;
        throw error;
      }
    }, { attempts, delay });
    if (attemptedUpload) uploaded.push(asset.name);
  }
  release = await withRetry(() => cnbClient.getRelease(bundle.tag), { attempts, delay });
  pending = inspectCnbRelease(release, bundle);
  if (pending.length) throw new Error(`CNB read-back is missing verified assets: ${pending.map(item => item.name).join(', ')}.`);
  if (release.draft) {
    release = await withRetry(async () => {
      const current = await cnbClient.getRelease(bundle.tag);
      inspectCnbRelease(current, bundle);
      if (!current.draft) return current;
      try {
        await cnbClient.publishRelease(current, { makeLatest });
      } catch (error) {
        if (!retryableError(error)) throw error;
        const afterFailure = await cnbClient.getRelease(bundle.tag);
        if (!afterFailure.draft) return afterFailure;
        throw error;
      }
      const afterPublish = await cnbClient.getRelease(bundle.tag);
      if (afterPublish.draft) {
        const error = new Error(`CNB ${bundle.tag} publication was not visible during read-back.`);
        error.retryable = true;
        throw error;
      }
      return afterPublish;
    }, { attempts, delay });
  }
  assertCnbRelease(release, bundle);
  return { created, uploaded, skipped: bundle.assets.map(item => item.name).filter(name => !uploaded.includes(name)), release };
}

function createGithubClient(config, fetchImpl = globalThis.fetch) {
  const apiRoot = `https://api.github.com/repos/${encodeRepo(config.githubRepo)}`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hamster-archiver-cnb-sync' };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
  return {
    async getRelease(tag) {
      return withRetry(() => requestJson(`${apiRoot}/releases/tags/${encodeURIComponent(tag)}`, { headers }, [200], 'GitHub Release lookup', fetchImpl, new Set(['api.github.com']), config.requestTimeoutMs), { attempts: config.attempts });
    },
    async downloadAsset(asset, targetPath) {
      await withRetry(async () => {
        try {
          await runWithTimeout(async signal => {
            const label = `GitHub asset ${asset.name}`;
            const response = await requestResponseWithTrustedRedirects(
              asset.browser_download_url,
              { headers: { ...headers, Accept: 'application/octet-stream' } },
              label,
              fetchImpl,
              GITHUB_DOWNLOAD_HOSTS,
              signal
            );
            assertExpectedStatus(response, [200], label);
            if (!response.body) {
              const error = new Error(`${label} has no response body.`);
              error.retryable = true;
              throw error;
            }
            await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
          }, config.requestTimeoutMs, `GitHub asset ${asset.name}`);
        } catch (error) {
          markRetryable(error);
          await fsp.rm(targetPath, { force: true }).catch(() => {});
          throw error;
        }
      }, { attempts: config.attempts });
    }
  };
}

function createCnbClient(config, fetchImpl = globalThis.fetch) {
  if (config.enabled !== true) throw new Error(disabledMessage());
  const repoPath = encodeRepo(config.cnbRepo);
  const apiRoot = `${config.apiBase}/${repoPath}/-`;
  const apiOrigin = new URL(config.apiBase).origin;
  const apiHosts = new Set([new URL(config.apiBase).hostname.toLowerCase()]);
  const headers = {
    Accept: 'application/vnd.cnb.api+json',
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'hamster-archiver-cnb-sync'
  };
  const getOptional = async (url, label) => {
    return runWithTimeout(async signal => {
      const response = await requestResponseWithTrustedRedirects(url, { headers }, label, fetchImpl, apiHosts, signal);
      assertExpectedStatus(response, [200, 404], label);
      if (response.status === 404) {
        try {
          if (typeof response.arrayBuffer === 'function') await response.arrayBuffer();
          else if (typeof response.text === 'function') await response.text();
        } catch (error) {
          const wrapped = new Error(`${label} response body could not be read: ${error.message}`);
          wrapped.cause = error;
          wrapped.retryable = true;
          throw wrapped;
        }
        return null;
      }
      try {
        return await response.json();
      } catch (error) {
        const wrapped = new Error(`${label} response body could not be read as JSON: ${error.message}`);
        wrapped.cause = error;
        wrapped.retryable = true;
        throw wrapped;
      }
    }, config.requestTimeoutMs, label);
  };
  return {
    getTag: tag => getOptional(`${apiRoot}/git/tags/${encodeURIComponent(tag)}`, 'CNB tag lookup'),
    getRelease: tag => getOptional(`${apiRoot}/releases/tags/${encodeURIComponent(tag)}`, 'CNB Release lookup'),
    createRelease: payload => requestJson(`${apiRoot}/releases`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    }, [201], 'CNB Release creation', fetchImpl, apiHosts, config.requestTimeoutMs),
    publishRelease: (release, { makeLatest = false } = {}) => requestAndDrain(`${apiRoot}/releases/${encodeURIComponent(release.id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body: release.body, name: release.name, draft: false, prerelease: false, make_latest: makeLatest ? 'true' : 'false' })
    }, [200], 'CNB Release publication', fetchImpl, apiHosts, config.requestTimeoutMs),
    async uploadAsset(release, asset) {
      const reservation = await requestJson(`${apiRoot}/releases/${encodeURIComponent(release.id)}/asset-upload-url`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ asset_name: asset.name, overwrite: false, size: asset.size, ttl: 0 })
      }, [201], `CNB upload reservation for ${asset.name}`, fetchImpl, apiHosts, config.requestTimeoutMs);
      const uploadUrl = validateHttpsHost(reservation.upload_url, config.uploadHosts, `CNB upload URL for ${asset.name}`);
      const verifyUrl = new URL(String(reservation.verify_url || ''));
      const expectedPrefix = `/${repoPath}/-/releases/${encodeURIComponent(release.id)}/asset-upload-confirmation/`;
      if (verifyUrl.protocol !== 'https:' || verifyUrl.origin !== apiOrigin || !verifyUrl.pathname.startsWith(expectedPrefix)) {
        throw new Error(`CNB confirmation URL for ${asset.name} is outside the configured API boundary.`);
      }
      await requestAndDrain(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Length': String(asset.size), 'Content-Type': 'application/octet-stream' },
        body: fs.createReadStream(asset.path),
        duplex: 'half'
      }, [200, 201, 204], `CNB upload for ${asset.name}`, fetchImpl, config.uploadHosts, config.requestTimeoutMs);
      await requestAndDrain(verifyUrl.href, { method: 'POST', headers }, [200], `CNB upload confirmation for ${asset.name}`, fetchImpl, apiHosts, config.requestTimeoutMs);
    }
  };
}

async function prepareGithubBundle(config, githubClient) {
  const release = await githubClient.getRelease(config.tag);
  if (!release || release.draft || release.prerelease || !release.published_at) {
    throw new Error(`GitHub ${config.tag} must be a published stable Release before CNB synchronization.`);
  }
  assertBilingualNotes(release.body);
  const expectedNames = expectedReleaseAssetNames(config.tag);
  const selected = expectedNames.map(name => (release.assets || []).find(asset => asset.name === name));
  if (selected.some(asset => !asset || !asset.browser_download_url || !asset.size)) {
    throw new Error(`GitHub ${config.tag} must contain the exact four non-empty release attachments before CNB synchronization.`);
  }
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `hamster-cnb-${config.tag}-`));
  try {
    const assets = [];
    for (const remote of selected) {
      const targetPath = path.join(tempRoot, remote.name);
      await githubClient.downloadAsset(remote, targetPath);
      const stats = await fsp.stat(targetPath);
      if (stats.size !== Number(remote.size)) throw new Error(`Downloaded GitHub asset size mismatch: ${remote.name}.`);
      assets.push({ name: remote.name, path: targetPath, size: stats.size, digest: await hashFile(targetPath) });
    }
    for (const binary of assets.filter(asset => !asset.name.endsWith('.sha256'))) {
      const sidecar = assets.find(asset => asset.name === `${binary.name}.sha256`);
      const text = await fsp.readFile(sidecar.path, 'ascii');
      const match = text.trim().match(/^([a-f0-9]{64})\s+[* ]?(.+)$/i);
      if (!match || match[1].toLowerCase() !== binary.digest || path.basename(match[2]) !== binary.name) {
        throw new Error(`GitHub checksum attachment does not verify ${binary.name}.`);
      }
    }
    return {
      bundle: { tag: config.tag, name: release.name || `Hamster Archiver ${config.tag}`, body: release.body, assets },
      cleanup: () => fsp.rm(tempRoot, { recursive: true, force: true })
    };
  } catch (error) {
    await fsp.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  if (!isCnbSyncEnabled()) {
    console.log(disabledMessage());
    return;
  }
  const config = validateConfig(parseArgs(process.argv.slice(2)));
  const githubClient = createGithubClient(config);
  const cnbClient = createCnbClient(config);
  const prepared = await prepareGithubBundle(config, githubClient);
  try {
    const result = await syncReleaseBundle(prepared.bundle, cnbClient, {
      attempts: config.attempts,
      enabled: config.enabled,
      makeLatest: config.makeLatest
    });
    const page = `${config.webBase}/${config.cnbRepo}/-/releases/tag/${encodeURIComponent(config.tag)}`;
    console.log(JSON.stringify({ tag: config.tag, cnbRepo: config.cnbRepo, created: result.created, uploaded: result.uploaded, skipped: result.skipped, releaseUrl: page }, null, 2));
  } finally {
    await prepared.cleanup();
  }
}

if (require.main === module) main().catch(error => { console.error(`CNB synchronization failed: ${error.message}`); process.exitCode = 1; });

module.exports = {
  assertBilingualNotes,
  assertCnbRelease,
  createCnbClient,
  createGithubClient,
  hashFile,
  inspectCnbRelease,
  isCnbSyncEnabled,
  normalizeRemoteDigest,
  parseArgs,
  planCnbUploads,
  prepareGithubBundle,
  requestJson,
  requestWithTrustedRedirects,
  retryableError,
  syncReleaseBundle,
  validateConfig,
  withRetry
};
