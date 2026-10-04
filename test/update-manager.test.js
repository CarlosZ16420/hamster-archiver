'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const { Readable } = require('node:stream');
const {
  APPLY_UPDATE_SCRIPT,
  INSTALL_STAGE_ITEMS_SCRIPT,
  UPDATE_LAUNCHER_SCRIPT,
  consumeUpdateFailure,
  createUpdateDownloadFetch,
  downloadFile,
  fetchDigestSidecar,
  fetchWithTrustedRedirects,
  hashFile,
  installedPackageVersion,
  launchInstalledUpdate,
  validateUpdatePackage,
  launchUpdate,
  manualUpdateInstructions,
  normalizeDigest,
  normalizeVersion,
  prepareOnlineUpdate,
  prepareUpdate,
  prepareInstalledUpdate,
  readUpdateSuccessNotice,
  resolveDownloadTrust,
  resolvePowerShellExecutable,
  validateProviderUrl,
  validateInstalledPackageVersion
} = require('../src/core/update-manager');
const { createFileIntegrityEntries } = require('../src/core/tool-integrity');

const execFileAsync = promisify(execFile);

test('update digest accepts GitHub SHA256 format and rejects malformed values', () => {
  const digest = 'a'.repeat(64);
  assert.equal(normalizeDigest(`sha256:${digest.toUpperCase()}`), digest);
  assert.equal(normalizeDigest(digest), digest);
  assert.equal(normalizeDigest(`${digest}  HamsterArchiver-v4.0.1-win-x64.zip`), digest);
  assert.equal(normalizeDigest('sha256:not-a-digest'), '');
});

test('update manifest version accepts a Release v prefix but keeps other differences visible', () => {
  assert.equal(normalizeVersion('v4.4.6'), '4.4.6');
  assert.equal(normalizeVersion(' V4.4.6 '), '4.4.6');
  assert.notEqual(normalizeVersion('4.4.5'), normalizeVersion('v4.4.6'));
});

test('update package hashing produces a stable SHA256 value', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-hash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'package.zip');
  await fs.writeFile(filePath, 'hamster archive update');
  assert.equal(await hashFile(filePath), '4422e5fb2510e3d5c57321f0db705bc9dde2ecb2d1daff34162668109612ed1a');
});


test('local update package accepts only a newer verified Windows x64 release', async function (t) {
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-local-update-package-'));
  t.after(() => fs.rm(packageRoot, { recursive: true, force: true }));
  const executablePath = path.join(packageRoot, 'HamsterArchiver.exe');
  await fs.writeFile(executablePath, 'verified executable');
  const integrityFiles = await createFileIntegrityEntries(packageRoot, ['HamsterArchiver.exe']);
  const writeManifest = (overrides = {}) => fs.writeFile(
    path.join(packageRoot, 'release-manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      version: '4.5.3',
      platform: 'win32-x64',
      integrity: { files: integrityFiles },
      releaseNotes: {
        'zh-CN': ['新增压缩包更新说明。'],
        'en-US': ['Added ZIP update notes.']
      },
      ...overrides
    })
  );
  await writeManifest();
  const validated = await validateUpdatePackage(packageRoot, '4.5.2');
  assert.equal(validated.version, '4.5.3');
  assert.deepEqual(validated.releaseNotes['zh-CN'], ['新增压缩包更新说明。']);
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.3'), /不高于当前版本/);
  await writeManifest({ platform: 'linux-x64' });
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.2'), /Windows x64/);
  await writeManifest();
  await fs.writeFile(executablePath, 'tampered executable');
  await assert.rejects(() => validateUpdatePackage(packageRoot, '4.5.2'), /关键文件(?:大小不一致| SHA-256 校验失败)/);
});

test('update script requires the current portable executable name', () => {
  assert.match(APPLY_UPDATE_SCRIPT, /HamsterArchiver\.exe/);
  assert.doesNotMatch(APPLY_UPDATE_SCRIPT, /HamsterArchive\.exe/);
  assert.match(APPLY_UPDATE_SCRIPT, /started\.json/);
  assert.match(UPDATE_LAUNCHER_SCRIPT, /Start-Process/);
  assert.match(UPDATE_LAUNCHER_SCRIPT, /apply-update\.ps1/);
  assert.match(APPLY_UPDATE_SCRIPT, /Normalize-Version/);
});

test('Windows stage installation replaces existing directories instead of nesting them', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-stage-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stageRoot = path.join(root, 'stage');
  const applicationRoot = path.join(root, 'application');
  await Promise.all([
    fs.mkdir(path.join(stageRoot, 'resources', 'app'), { recursive: true }),
    fs.mkdir(path.join(stageRoot, 'userdata'), { recursive: true }),
    fs.mkdir(path.join(applicationRoot, 'resources', 'app'), { recursive: true }),
    fs.mkdir(path.join(applicationRoot, 'userdata'), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(stageRoot, 'resources', 'app', 'version.txt'), 'new'),
    fs.writeFile(path.join(stageRoot, 'userdata', 'marker.txt'), 'empty-new-userdata'),
    fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'version.txt'), 'old'),
    fs.writeFile(path.join(applicationRoot, 'resources', 'app', 'stale.txt'), 'remove-me'),
    fs.writeFile(path.join(applicationRoot, 'userdata', 'marker.txt'), 'keep-existing-userdata')
  ]);
  const scriptPath = path.join(root, 'install-stage.ps1');
  await fs.writeFile(scriptPath, `\uFEFF${INSTALL_STAGE_ITEMS_SCRIPT}\n` + String.raw`
$items = @(Get-ChildItem -LiteralPath ([string]$env:HAMSTER_TEST_STAGE) -Force | Where-Object { $_.Name -ne 'userdata' })
Install-StageItems -Items $items -DestinationRoot ([string]$env:HAMSTER_TEST_APPLICATION)
`, 'utf8');
  await execFileAsync(resolvePowerShellExecutable(), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      HAMSTER_TEST_STAGE: stageRoot,
      HAMSTER_TEST_APPLICATION: applicationRoot
    }
  });

  assert.equal(await fs.readFile(path.join(applicationRoot, 'resources', 'app', 'version.txt'), 'utf8'), 'new');
  await assert.rejects(() => fs.access(path.join(applicationRoot, 'resources', 'app', 'stale.txt')), /ENOENT/);
  await assert.rejects(() => fs.access(path.join(applicationRoot, 'resources', 'resources')), /ENOENT/);
  assert.equal(await fs.readFile(path.join(applicationRoot, 'userdata', 'marker.txt'), 'utf8'), 'keep-existing-userdata');
});

test('PowerShell resolver prefers the stable Windows system path', () => {
  const root = 'C:\\Windows';
  const expected = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  assert.equal(resolvePowerShellExecutable({ SystemRoot: root }, (candidate) => candidate === expected), expected);
  assert.equal(resolvePowerShellExecutable({}, () => false), 'powershell.exe');
});

test('update launch waits for updater handshake before returning', async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-launch-'));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  let detached = false;
  let launchOptions;
  child.unref = () => { detached = true; };
  child.kill = () => {};
  const launchPromise = launchUpdate({
    prepared: {
      runRoot,
      applicationRoot: runRoot,
      packageRoot: runRoot,
      currentVersion: '4.1.1',
      version: '4.1.2',
      source: 'package',
      releaseNotes: { 'zh-CN': ['修复更新。'], 'en-US': ['Fixed updates.'] }
    },
    targetPid: 4567
  }, {
    spawnImpl: (_executable, _arguments, options) => {
      launchOptions = options;
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    existsSyncImpl: () => false,
    existsImpl: async () => true,
    startupTimeoutMs: 50,
    startupPollIntervalMs: 1
  });
  const result = await launchPromise;
  assert.equal(result.updaterPid, 1234);
  assert.equal(detached, true);
  assert.equal(launchOptions.env.HAMSTER_UPDATE_NOTICE_FILE, result.noticeFile);
  const notice = JSON.parse(await fs.readFile(result.noticeFile, 'utf8'));
  assert.equal(notice.fromVersion, '4.1.1');
  assert.equal(notice.toVersion, '4.1.2');
  assert.equal(notice.source, 'package');
  assert.deepEqual(notice.releaseNotes['en-US'], ['Fixed updates.']);
});

test('GitHub and CNB downloads use provider-specific host allowlists, including approved redirects', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-download-trust-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const digest = 'e'.repeat(64);
  const githubTrust = resolveDownloadTrust({ provider: 'github' });
  assert.doesNotThrow(() => validateProviderUrl('https://github.com/acme/release.zip', githubTrust, '更新包地址'));
  assert.doesNotThrow(() => validateProviderUrl('https://release-assets.githubusercontent.com/release.zip', githubTrust, '更新包重定向地址'));
  assert.throws(() => validateProviderUrl('https://evil.example/release.zip', githubTrust, '更新包地址'), /GitHub/);
  const githubCalls = [];
  assert.equal(await fetchDigestSidecar('https://github.com/acme/release.zip.sha256', async (url, options) => {
    githubCalls.push({ url, redirect: options.redirect });
    if (url.includes('github.com/acme')) return {
      status: 302,
      headers: { get: name => name === 'location' ? 'https://release-assets.githubusercontent.com/release.zip.sha256' : null }
    };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => `${digest} *release.zip` };
  }, githubTrust), digest);
  assert.equal(githubCalls.length, 2);
  assert.equal(githubCalls.every(call => call.redirect === 'manual'), true);

  const cnbConfig = {
    configured: true,
    discoveryMode: 'api',
    latestApiUrl: 'https://api.cnb.test/acme/app/-/releases/latest',
    releasesApiUrl: 'https://api.cnb.test/acme/app/-/releases',
    releasesUrl: 'https://cnb.test/acme/app/-/releases',
    configSchemaVersion: 2,
    downloadHosts: ['downloads.cnb.test', 'cdn.cnb.test']
  };
  const release = { provider: 'cnb', source: { provider: 'cnb', ...cnbConfig } };
  const cnbTrust = resolveDownloadTrust(release, cnbConfig);
  const target = path.join(root, 'release.zip');
  await downloadFile('https://downloads.cnb.test/release.zip', target, async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url.includes('downloads.cnb.test')) return {
      status: 307,
      headers: { get: name => name === 'location' ? 'https://cdn.cnb.test/release.zip' : null }
    };
    return {
      ok: true,
      status: 200,
      headers: { get: name => name === 'content-length' ? '3' : null },
      body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('cnb')); controller.close(); } })
    };
  }, () => {}, cnbTrust);
  assert.equal(await fs.readFile(target, 'utf8'), 'cnb');
  let cnbCalls = 0;
  await assert.rejects(() => fetchDigestSidecar('https://downloads.cnb.test/release.zip.sha256', async () => {
    cnbCalls += 1;
    return { status: 302, headers: { get: () => 'https://evil.example/release.zip.sha256' } };
  }, cnbTrust), /CNB/);
  assert.equal(cnbCalls, 1);
});

test('Electron update transport exposes manual redirects without following unvalidated hosts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-electron-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const digest = 'a'.repeat(64);
  const calls = [];
  const fetchImpl = createUpdateDownloadFetch((options) => {
    const request = new EventEmitter();
    calls.push(options);
    request.abort = () => { request.aborted = true; };
    request.end = () => queueMicrotask(() => {
      if (new URL(options.url).hostname === 'github.com') {
        const target = options.url.includes('unsafe') ? 'https://evil.example/package.zip'
          : `https://release-assets.githubusercontent.com/${path.basename(options.url)}`;
        request.emit('redirect', 302, 'GET', target);
        if (!request.aborted) request.emit('error', new Error('Redirect was cancelled'));
        return;
      }
      const body = options.url.endsWith('.sha256') ? `${digest} *package.zip` : 'verified update';
      const incoming = Readable.from([Buffer.from(body)]);
      incoming.statusCode = 200;
      incoming.headers = { 'content-length': String(Buffer.byteLength(body)), 'x-test': ['one', 'two'] };
      request.emit('response', incoming);
    });
    return request;
  });
  assert.equal(await fetchDigestSidecar('https://github.com/package.zip.sha256', fetchImpl), digest);
  const targetPath = path.join(root, 'package.zip');
  const progress = [];
  await downloadFile('https://github.com/package.zip', targetPath, fetchImpl, (value) => progress.push(value));
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'verified update');
  assert.equal(progress.at(-1).percentage, 100);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.redirect === 'manual' && call.method === 'GET'));
  await assert.rejects(() => downloadFile('https://github.com/unsafe.zip', targetPath, fetchImpl), /GitHub HTTPS/);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => new URL(call.url).hostname !== 'evil.example'));
});

test('Electron update transport propagates request and response stream failures', async () => {
  const fetchImpl = createUpdateDownloadFetch(() => {
    const request = new EventEmitter();
    request.end = () => queueMicrotask(() => request.emit('error', new Error('connection failed')));
    return request;
  });
  await assert.rejects(() => fetchImpl('https://github.com/package.zip'), /connection failed/);
  let incoming;
  const streamingFetch = createUpdateDownloadFetch(() => {
    const request = new EventEmitter();
    request.abort = () => request.emit('close');
    request.end = () => queueMicrotask(() => {
      incoming = new Readable({ read() {} });
      incoming.statusCode = 200;
      incoming.headers = {};
      request.emit('response', incoming);
    });
    return request;
  });
  const response = await streamingFetch('https://github.com/package.zip');
  const text = response.text();
  incoming.emit('aborted');
  await assert.rejects(() => text, /下载已中断/);
});

test('CNB download metadata must match the locally configured source exactly', () => {
  const config = {
    configured: true,
    discoveryMode: 'api',
    latestApiUrl: 'https://api.cnb.test/a/latest',
    releasesApiUrl: 'https://api.cnb.test/a/releases',
    releasesUrl: 'https://cnb.test/a/releases',
    configSchemaVersion: 2,
    downloadHosts: ['cnb.test']
  };
  assert.throws(() => resolveDownloadTrust({
    provider: 'cnb',
    source: { provider: 'cnb', ...config, releasesUrl: 'https://cnb.test/other/releases' }
  }, config), /不一致/);
  assert.throws(() => resolveDownloadTrust({ provider: 'unknown' }), /不支持的更新来源/);
});

test('manual Electron requests respect timeout signals before and after response headers', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('request timed out', 'TimeoutError'));
  const noRequest = createUpdateDownloadFetch(() => { throw new Error('must not start an aborted request'); });
  await assert.rejects(() => noRequest('https://github.com/package.zip', { signal: controller.signal }), /timed out/);
  let aborted = false;
  let incoming;
  const active = new AbortController();
  const fetchImpl = createUpdateDownloadFetch(() => {
    const request = new EventEmitter();
    request.abort = () => { aborted = true; request.emit('close'); };
    request.end = () => queueMicrotask(() => {
      incoming = new Readable({ read() {} });
      incoming.statusCode = 200;
      incoming.headers = {};
      request.emit('response', incoming);
    });
    return request;
  });
  const response = await fetchImpl('https://github.com/package.zip', { signal: active.signal });
  const text = response.text();
  active.abort(new DOMException('body timed out', 'TimeoutError'));
  await assert.rejects(() => text, /timed out/);
  assert.equal(aborted, true);
  await assert.rejects(() => fetchWithTrustedRedirects('https://github.com/package.zip', {},
    async () => { throw new DOMException('timed out', 'TimeoutError'); },
    resolveDownloadTrust({ provider: 'github' }), '更新包地址'), { code: 'UPDATE_DOWNLOAD_NETWORK_ERROR' });
  await assert.rejects(() => fetchWithTrustedRedirects('https://github.com/package.zip', {},
    async (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))),
    resolveDownloadTrust({ provider: 'github' }), '更新包地址', 5, 5), { code: 'UPDATE_DOWNLOAD_NETWORK_ERROR' });
});

test('stalled update streams are cancelled and reported as network failures', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-stall-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let cancelled = false;
  await assert.rejects(() => downloadFile('https://github.com/package.zip', path.join(root, 'package.zip'),
    async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), () => {},
    resolveDownloadTrust({ provider: 'github' }), { readTimeoutMs: 5 }), { code: 'UPDATE_DOWNLOAD_NETWORK_ERROR' });
  assert.equal(cancelled, true);
});

test('portable and installed preparations switch failed GitHub downloads to the verified same-version CNB package', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-mirror-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'package');
  await fs.mkdir(packageRoot);
  await fs.writeFile(path.join(packageRoot, 'HamsterArchiver.exe'), 'fictional application');
  const integrityFiles = await createFileIntegrityEntries(packageRoot, ['HamsterArchiver.exe']);
  await fs.writeFile(path.join(packageRoot, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 2, version: '4.8.3', platform: 'win32-x64', integrity: { files: integrityFiles }
  }));
  const sevenZipPath = path.resolve(__dirname, '..', 'tools', '7zip', '7z.exe');
  const archivePath = path.join(root, 'package.zip');
  await execFileAsync(sevenZipPath, ['a', '-tzip', archivePath, packageRoot], { windowsHide: true });
  for (const distributionMode of ['portable', 'installed']) {
    const bytes = distributionMode === 'portable' ? await fs.readFile(archivePath) : Buffer.from('fictional installer');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const name = distributionMode === 'portable' ? 'HamsterArchiver-v4.8.3-win-x64.zip' : 'HamsterArchiver-Setup-v4.8.3-win-x64.exe';
    const calls = [];
    const progress = [];
    const prepared = await prepareOnlineUpdate({
      applicationRoot: path.join(root, 'application'), userDataDirectory: path.join(root, distributionMode),
      sevenZipPath, currentVersion: '4.8.2', environment: {},
      release: { latestVersion: '4.8.3', provider: 'github', distributionMode,
        releaseNotes: { 'zh-CN': ['已确认的说明。'], 'en-US': ['Confirmed notes.'] },
        asset: { name, digest: `sha256:${digest}`, downloadUrl: `https://github.com/${name}` } },
      onProgress: value => progress.push(value), fetchImpl: async (url) => {
        calls.push(url);
        if (new URL(url).hostname === 'github.com') return new Response(null, { status: 503 });
        if (url.endsWith('/releases/latest')) return new Response(null, { status: 307,
          headers: { location: '/carlosz16420/hamster-archive/-/releases/tag/v4.8.3' } });
        return new Response(url.endsWith('.sha256') ? `${digest} *${name}` : bytes);
      }
    });
    assert.equal(prepared.provider, 'cnb');
    assert.equal(prepared.release.provider, 'cnb');
    assert.equal(prepared.version, '4.8.3');
    assert.equal(prepared.digest, digest);
    assert.deepEqual(prepared.releaseNotes['en-US'], ['Confirmed notes.']);
    assert.equal(calls.filter(url => new URL(url).hostname === 'github.com').length, 1);
    assert.equal(progress.some(value => value.stage === 'fallback'), true);
    if (distributionMode === 'portable') await fs.access(path.join(prepared.packageRoot, 'HamsterArchiver.exe'));
    else assert.equal(await fs.readFile(prepared.installerPath, 'utf8'), 'fictional installer');
  }
});

test('update fallback does not bypass checksum, URL trust or local file failures', async () => {
  for (const error of [new Error('SHA256 校验失败'), new Error('不是受信任的 HTTPS 地址'), Object.assign(new Error('disk full'), { code: 'ENOSPC' })]) {
    await assert.rejects(() => prepareOnlineUpdate({ release: { provider: 'github' } }, {
      prepareImpl: async () => { throw error; },
      checkCnbImpl: () => { throw new Error('CNB must not be consulted'); }
    }), value => value === error);
  }
});

test('both update formats reject conflicting mirror digests before downloading or extracting the package', {
  skip: process.platform !== 'win32'
}, async () => {
  for (const prepare of [prepareUpdate, prepareInstalledUpdate]) {
    let calls = 0;
    await assert.rejects(() => prepare({
      confirmedDigest: 'a'.repeat(64), currentVersion: '4.8.2',
      release: { latestVersion: '4.8.3', provider: 'github',
        asset: { name: 'HamsterArchiver-Setup-v4.8.3-win-x64.exe',
          digestDownloadUrl: 'https://github.com/package.sha256', downloadUrl: 'https://github.com/package' } },
      fetchImpl: async () => { calls += 1; return new Response(`${'b'.repeat(64)} *package`); }
    }), /摘要与 GitHub 已确认/);
    assert.equal(calls, 1);
  }
});

test('fallback retains a GitHub sidecar digest when the package download fails', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-sidecar-binding-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(() => prepareOnlineUpdate({
    currentVersion: '4.8.2', userDataDirectory: root, environment: {},
    release: { provider: 'github', latestVersion: '4.8.3', distributionMode: 'installed', asset: {
      name: 'HamsterArchiver-Setup-v4.8.3-win-x64.exe', downloadUrl: 'https://github.com/installer.exe',
      digestDownloadUrl: 'https://github.com/installer.exe.sha256'
    } },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === 'https://github.com/installer.exe.sha256') return new Response('a'.repeat(64));
      if (url === 'https://github.com/installer.exe') return new Response(null, { status: 503 });
      if (url.endsWith('/releases/latest')) return new Response(null, { status: 307,
        headers: { location: '/carlosz16420/hamster-archive/-/releases/tag/v4.8.3' } });
      assert.ok(url.endsWith('.sha256'));
      return new Response('b'.repeat(64));
    }
  }), /摘要与 GitHub 已确认/);
  assert.equal(calls.length, 4);
  assert.deepEqual(await fs.readdir(path.join(root, 'updates')), []);
});

test('a mismatched CNB digest is rejected and its prepared files are removed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-mirror-digest-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => prepareOnlineUpdate({
    currentVersion: '4.8.2', release: { provider: 'github', latestVersion: '4.8.3', asset: { digest: 'a'.repeat(64) } }
  }, {
    prepareImpl: async ({ release }) => {
      if (release.provider === 'github') throw Object.assign(new Error('offline'), { code: 'UPDATE_DOWNLOAD_NETWORK_ERROR' });
      return { runRoot: root, digest: 'b'.repeat(64) };
    },
    checkCnbImpl: async (options) => { assert.equal(options.expectedVersion, '4.8.3'); return { provider: 'cnb' }; }
  }), /摘要与 GitHub 已确认/);
  await assert.rejects(() => fs.access(root), /ENOENT/);
});

test('installed update accepts only a strictly named newer Setup package', () => {
  assert.equal(installedPackageVersion('D:\\Downloads\\HamsterArchiver-Setup-v4.5.17-win-x64.exe'), '4.5.17');
  assert.equal(validateInstalledPackageVersion(
    'D:\\Downloads\\HamsterArchiver-Setup-v4.5.17-win-x64.exe', '4.5.16', 'v4.5.17'
  ), '4.5.17');
  assert.throws(() => validateInstalledPackageVersion(
    'D:\\Downloads\\HamsterArchiver-v4.5.17-win-x64.zip', '4.5.16'
  ), /安装程序/);
  assert.throws(() => validateInstalledPackageVersion(
    'D:\\Downloads\\HamsterArchiver-Setup-v4.5.16-win-x64.exe', '4.5.16'
  ), /不高于当前版本/);
});

test('new version reads an updater notice only from its trusted updates directory', async (t) => {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-success-'));
  t.after(() => fs.rm(userDataRoot, { recursive: true, force: true }));
  const runRoot = path.join(userDataRoot, 'updates', '4.5.13-test');
  await fs.mkdir(runRoot, { recursive: true });
  const noticeFile = path.join(runRoot, 'update-notice.json');
  await fs.writeFile(noticeFile, JSON.stringify({
    schemaVersion: 1,
    fromVersion: '4.5.12',
    toVersion: '4.5.13',
    source: 'automatic',
    releaseNotes: { 'zh-CN': ['显示本次更新。'], 'en-US': ['Show this update.'] }
  }));
  const notice = await readUpdateSuccessNotice({
    userDataDirectory: userDataRoot,
    noticeFile,
    currentVersion: '4.5.13'
  });
  assert.equal(notice.fromVersion, '4.5.12');
  assert.equal(notice.toVersion, '4.5.13');
  assert.deepEqual(notice.releaseNotes['zh-CN'], ['显示本次更新。']);
  const discovered = await readUpdateSuccessNotice({
    userDataDirectory: userDataRoot,
    currentVersion: '4.5.13'
  });
  assert.equal(discovered.noticeFile, noticeFile);
  assert.equal(discovered.runRoot, runRoot);
  assert.equal(await readUpdateSuccessNotice({
    userDataDirectory: userDataRoot,
    noticeFile,
    currentVersion: '4.5.12'
  }), null);
  const outsideNotice = path.join(userDataRoot, 'outside.json');
  await fs.writeFile(outsideNotice, '{}');
  await assert.rejects(() => readUpdateSuccessNotice({
    userDataDirectory: userDataRoot,
    noticeFile: outsideNotice,
    currentVersion: '4.5.13'
  }), /不在受信任/);
});

test('installed update launches the verified installer visibly and leaves a release-note notice', async (t) => {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-installed-update-'));
  t.after(() => fs.rm(userDataRoot, { recursive: true, force: true }));
  const runRoot = path.join(userDataRoot, 'updates', 'installer-4.5.17-test');
  await fs.mkdir(runRoot, { recursive: true });
  const installerPath = path.join(runRoot, 'HamsterArchiver-Setup-v4.5.17-win-x64.exe');
  await fs.writeFile(installerPath, 'installer');
  const child = new EventEmitter();
  child.pid = 4321;
  child.unref = () => { child.unreferenced = true; };
  let launch;
  const result = await launchInstalledUpdate({
    prepared: {
      runRoot,
      installerPath,
      currentVersion: '4.5.16',
      version: '4.5.17',
      source: 'automatic',
      releaseNotes: { 'zh-CN': ['安装版更新。'], 'en-US': ['Installed update.'] }
    }
  }, {
    spawnImpl: (file, args, options) => {
      launch = { file, args, options };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }
  });
  assert.equal(launch.file, installerPath);
  assert.deepEqual(launch.args, []);
  assert.equal(launch.options.windowsHide, false);
  assert.equal(launch.options.detached, true);
  assert.equal(child.unreferenced, true);
  assert.equal(result.installerPid, 4321);
  const notice = JSON.parse(await fs.readFile(result.noticeFile, 'utf8'));
  assert.equal(notice.toVersion, '4.5.17');
  assert.deepEqual(notice.releaseNotes['en-US'], ['Installed update.']);
});

test('update launch reports a PowerShell spawn failure and keeps diagnostics', async (t) => {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-failure-'));
  t.after(() => fs.rm(runRoot, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};
  child.unref = () => {};
  await assert.rejects(() => launchUpdate({
    prepared: { runRoot, applicationRoot: runRoot, packageRoot: runRoot, version: '4.1.2' },
    targetPid: 4567
  }, {
    spawnImpl: () => {
      queueMicrotask(() => child.emit('error', new Error('blocked by policy')));
      return child;
    },
    existsSyncImpl: () => false,
    startupTimeoutMs: 50,
    startupPollIntervalMs: 1
  }), /自动更新助手未能启动.*blocked by policy/s);
  await fs.access(path.join(runRoot, 'launcher.log'));
});

test('failed replacement is surfaced once on the next application start', async (t) => {
  const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-notice-'));
  t.after(() => fs.rm(userDataRoot, { recursive: true, force: true }));
  const runRoot = path.join(userDataRoot, 'updates', '4.1.2-test');
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(path.join(runRoot, 'failed.json'), JSON.stringify({
    version: '4.1.2',
    error: 'replacement failed',
    failedAt: '2026-08-19T00:00:00.000Z'
  }));
  const failure = await consumeUpdateFailure(userDataRoot);
  assert.equal(failure.version, '4.1.2');
  assert.equal(failure.error, 'replacement failed');
  await fs.access(path.join(runRoot, 'failed.json'));
  await fs.access(path.join(runRoot, 'failed.notified.json'));
  assert.equal(await consumeUpdateFailure(userDataRoot), null);
});

test('manual update guide recommends warehouse export and import instead of copying userdata', () => {
  const guide = manualUpdateInstructions();
  assert.match(guide, /导出仓库/);
  assert.match(guide, /并入外部仓库/);
  assert.match(guide, /HamsterArchiver\.exe/);
  assert.doesNotMatch(guide, /复制.*userdata/i);
  const englishGuide = manualUpdateInstructions('en-US');
  assert.match(englishGuide, /Import external warehouse/i);
  assert.doesNotMatch(englishGuide, /copy.*userdata/i);
});

test('installed manual update guide uses the newer Setup package and stable app identity', () => {
  const guide = manualUpdateInstructions('zh-CN', 'installed');
  assert.match(guide, /HamsterArchiver-Setup-vX\.Y\.Z-win-x64\.exe/);
  assert.match(guide, /升级当前用户下的已有安装/);
  assert.match(guide, /保留用户数据/);
  assert.doesNotMatch(guide, /导出仓库/);
});

test('Windows updater completes a real PowerShell handshake and writes failure diagnostics', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-powershell-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applicationRoot = path.join(root, 'application');
  const packageRoot = path.join(root, 'package');
  const runRoot = path.join(root, 'run');
  await Promise.all([
    fs.mkdir(applicationRoot, { recursive: true }),
    fs.mkdir(packageRoot, { recursive: true }),
    fs.mkdir(runRoot, { recursive: true })
  ]);
  const result = await launchUpdate({
    prepared: { runRoot, applicationRoot, packageRoot, version: '4.1.2' },
    targetPid: 2_147_483_647
  });
  await fs.access(result.startedFile);
  const failurePath = path.join(runRoot, 'failed.json');
  let failureCreated = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(failurePath);
      failureCreated = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(failureCreated, true);
  assert.match(await fs.readFile(path.join(runRoot, 'update.log'), 'utf8'), /更新失败/);
});

test('Windows updater survives the launcher process exiting after the handshake', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-update-survival-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const applicationRoot = path.join(root, 'application');
  const packageRoot = path.join(root, 'package');
  const runRoot = path.join(root, 'run');
  await Promise.all([
    fs.mkdir(applicationRoot, { recursive: true }),
    fs.mkdir(packageRoot, { recursive: true }),
    fs.mkdir(runRoot, { recursive: true })
  ]);
  const fixturePath = path.join(root, 'launcher-fixture.js');
  const updateManagerPath = path.resolve(__dirname, '..', 'src', 'core', 'update-manager.js');
  await fs.writeFile(fixturePath, `'use strict';\nconst { launchUpdate } = require(${JSON.stringify(updateManagerPath)});\nlaunchUpdate({ prepared: ${JSON.stringify({ runRoot, applicationRoot, packageRoot, version: '4.1.2' })}, targetPid: process.pid }).then(() => process.exit(0)).catch((error) => { console.error(error.stack); process.exit(1); });\n`);
  await execFileAsync(process.execPath, [fixturePath], { windowsHide: true, timeout: 15_000 });
  const failurePath = path.join(runRoot, 'failed.json');
  let failureCreated = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(failurePath);
      failureCreated = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.equal(failureCreated, true);
});
