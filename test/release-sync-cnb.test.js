'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ReadableStream } = require('node:stream/web');
const test = require('node:test');
const {
  createCnbClient,
  createGithubClient,
  planCnbUploads,
  prepareGithubBundle,
  requestJson,
  requestWithTrustedRedirects,
  syncReleaseBundle,
  validateConfig,
  withRetry
} = require('../scripts/release-sync-cnb');
const { expectedReleaseAssetNames } = require('../src/core/sync-cnb-release-assets');

function bundle() {
  return {
    tag: 'v4.6.1',
    name: 'Hamster Archiver v4.6.1',
    body: '## 中文\nCNB 镜像。\n## English\nCNB mirror.',
    assets: [
      ['HamsterArchiver-v4.6.1-win-x64.zip', 'a'],
      ['HamsterArchiver-v4.6.1-win-x64.zip.sha256', 'b'],
      ['HamsterArchiver-Setup-v4.6.1-win-x64.exe', 'c'],
      ['HamsterArchiver-Setup-v4.6.1-win-x64.exe.sha256', 'd']
    ].map(([name, seed]) => ({ name, path: `X:/${name}`, size: 10, digest: seed.repeat(64) }))
  };
}

function remoteAsset(asset) {
  return { name: asset.name, size: asset.size, hash_algo: 'sha256', hash_value: asset.digest };
}

test('CNB preflight requires an explicit target, token and upload-host allowlist', () => {
  const source = 'CarlosZ16420/hamster-archiver';
  const enabled = { CNB_SYNC_ENABLED: 'true' };
  assert.throws(() => validateConfig({ tag: 'v4.6.1', githubRepo: source, cnbRepo: 'group/repo' }, {}), /disabled/);
  assert.throws(() => validateConfig({ tag: 'v4.6.1', githubRepo: 'owner/repo', cnbRepo: 'group/repo' }, enabled), /authoritative/);
  assert.throws(() => validateConfig({ tag: 'v4.6.1', githubRepo: source }, enabled), /CNB_REPO_SLUG/);
  assert.throws(() => validateConfig({ tag: 'v4.6.1', githubRepo: source, cnbRepo: 'group/repo' }, enabled), /CNB_TOKEN/);
  assert.throws(() => validateConfig({ tag: 'v4.6.1', githubRepo: source, cnbRepo: 'group/repo' }, { ...enabled, CNB_TOKEN: 'secret' }), /CNB_UPLOAD_HOSTS/);
  const config = validateConfig({ tag: 'v4.6.1', githubRepo: source, cnbRepo: 'group/repo' }, {
    CNB_SYNC_ENABLED: 'true',
    CNB_TOKEN: 'secret',
    CNB_UPLOAD_HOSTS: 'upload.cnb.cool,storage.example'
  });
  assert.equal(config.enabled, true);
  assert.equal(config.makeLatest, false);
  assert.equal(config.cnbRepo, 'group/repo');
  assert.equal(config.apiBase, 'https://api.cnb.cool');
  assert.equal(config.uploadHosts.has('storage.example'), true);
});

test('CNB synchronization is default-disabled before any remote operation', async () => {
  let calls = 0;
  const result = await syncReleaseBundle(bundle(), {
    getTag: async () => { calls += 1; }
  });
  assert.equal(result.disabled, true);
  assert.match(result.reason, /CNB_SYNC_ENABLED=true/);
  assert.equal(calls, 0);
  assert.throws(() => createCnbClient({ enabled: false }), /disabled/);
});

test('Mac Beta configuration accepts only the dedicated channel and never promotes latest', () => {
  const options = { tag: 'v4.8.6-beta.mac.1', githubRepo: 'CarlosZ16420/hamster-archiver', cnbRepo: 'group/repo', makeLatest: 'true' };
  const environment = { CNB_SYNC_ENABLED: 'true', CNB_TOKEN: 'test-token', CNB_UPLOAD_HOSTS: 'upload.cnb.cool' };
  assert.equal(validateConfig(options, environment).makeLatest, false);
  for (const tag of ['v4.8.6-beta.task.1', 'v4.8.6-beta.mac.0', 'v4.8.6-beta.mac.1-extra', 'v4.8.6-beta.mac']) {
    assert.throws(() => validateConfig({ ...options, tag }, environment), /exact/);
  }
  assert.equal(expectedReleaseAssetNames('v4.8.6').length, 6);
  assert.equal(expectedReleaseAssetNames('v4.8.4').length, 4);
  assert.equal(expectedReleaseAssetNames('v4.8.0-beta.mac.2').length, 2);
});

test('Mac Beta bundle preparation verifies all four original attachments and preserves prerelease', async () => {
  const tag = 'v4.8.6-beta.mac.1';
  const names = expectedReleaseAssetNames(tag);
  assert.deepEqual(names, [
    `HamsterArchiver-${tag}-mac-universal.dmg`, `HamsterArchiver-${tag}-mac-universal.dmg.sha256`,
    `HamsterArchiver-${tag}-mac-universal.zip`, `HamsterArchiver-${tag}-mac-universal.zip.sha256`
  ]);
  const payloads = new Map();
  for (const name of names.filter(name => !name.endsWith('.sha256'))) {
    const bytes = Buffer.from(`original ${name}`);
    payloads.set(name, bytes);
    payloads.set(`${name}.sha256`, Buffer.from(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}\n`));
  }
  const release = {
    tag_name: tag, name: `Hamster Archiver ${tag}`, body: bundle().body,
    draft: false, prerelease: true, published_at: '2026-10-09T06:51:43Z',
    assets: names.map(name => ({ name, size: payloads.get(name).length, browser_download_url: `https://github.com/${name}` }))
  };
  let downloads = 0;
  const client = {
    getRelease: async () => release,
    downloadAsset: async (asset, target) => { downloads += 1; await fs.writeFile(target, payloads.get(asset.name)); }
  };
  const prepared = await prepareGithubBundle({ tag }, client);
  try {
    assert.equal(prepared.bundle.prerelease, true);
    assert.deepEqual(prepared.bundle.assets.map(asset => asset.name), names);
    assert.equal(downloads, 4);
  } finally {
    await prepared.cleanup();
  }
  const sidecar = names[1];
  payloads.set(sidecar, Buffer.from(`${'0'.repeat(64)}  ${names[0]}\n`));
  await assert.rejects(() => prepareGithubBundle({ tag }, client), /checksum attachment does not verify/);
  const beforeInvalid = downloads;
  for (const overrides of [{ draft: true }, { prerelease: false }, { tag_name: 'v4.8.5-beta.mac.1' }, { assets: release.assets.slice(1) }]) {
    await assert.rejects(() => prepareGithubBundle({ tag }, { ...client, getRelease: async () => ({ ...release, ...overrides }) }));
  }
  assert.equal(downloads, beforeInvalid);
});

test('Mac Beta CNB creation and retry preserve prerelease and never promote latest', async () => {
  const source = { ...bundle(), tag: 'v4.8.6-beta.mac.1', prerelease: true };
  source.assets = expectedReleaseAssetNames(source.tag).map((name, index) => ({ name, size: 10, digest: String(index + 1).repeat(64) }));
  let release;
  let publishOptions;
  const client = {
    getTag: async () => ({ name: source.tag }),
    getRelease: async () => release,
    createRelease: async payload => { release = { id: 'mac-beta', ...payload, assets: [] }; return release; },
    uploadAsset: async (current, asset) => { current.assets.push(remoteAsset(asset)); },
    publishRelease: async (current, options) => { publishOptions = options; current.draft = false; }
  };
  const first = await syncReleaseBundle(source, client, { enabled: true, makeLatest: true });
  assert.equal(first.release.prerelease, true);
  assert.equal(first.release.make_latest, 'false');
  assert.deepEqual(publishOptions, { makeLatest: false });
  assert.equal(first.uploaded.length, 4);
  const second = await syncReleaseBundle(source, client, { enabled: true, makeLatest: true });
  assert.deepEqual(second.uploaded, []);
  assert.equal(second.skipped.length, 4);
  release.prerelease = false;
  await assert.rejects(() => syncReleaseBundle(source, client, { enabled: true }), /invalid release metadata/);
});

test('same-name same-digest CNB assets are skipped and conflicts stop without overwrite', () => {
  const local = bundle().assets;
  assert.deepEqual(planCnbUploads(local, [remoteAsset(local[0])]).map(item => item.name), local.slice(1).map(item => item.name));
  assert.throws(() => planCnbUploads(local, [{ ...remoteAsset(local[0]), hash_value: 'f'.repeat(64) }]), /conflicting or unverifiable/);
  assert.throws(() => planCnbUploads(local, [{ name: local[0].name, size: 10 }]), /conflicting or unverifiable/);
});

test('transient CNB upload failure retries without rebuilding and a complete rerun skips all files', async () => {
  const source = bundle();
  let release = null;
  let firstAssetAttempts = 0;
  const client = {
    getTag: async () => ({ name: source.tag }),
    getRelease: async () => release,
    createRelease: async payload => {
      release = { id: 'release-1', ...payload, assets: [] };
      return release;
    },
    publishRelease: async current => { current.draft = false; },
    uploadAsset: async (_release, asset) => {
      if (asset === source.assets[0] && firstAssetAttempts++ === 0) {
        const error = new Error('temporary storage outage');
        error.retryable = true;
        throw error;
      }
      release.assets.push(remoteAsset(asset));
    }
  };
  const first = await syncReleaseBundle(source, client, { attempts: 2, delay: async () => {}, enabled: true });
  assert.equal(first.created, true);
  assert.equal(first.release.draft, false);
  assert.equal(first.release.make_latest, 'false');
  assert.equal(first.uploaded.length, 4);
  assert.equal(firstAssetAttempts, 2);
  const second = await syncReleaseBundle(source, client, { attempts: 2, delay: async () => {}, enabled: true });
  assert.equal(second.created, false);
  assert.deepEqual(second.uploaded, []);
  assert.equal(second.skipped.length, 4);
});

test('CNB note or asset conflict is rejected before any upload', async () => {
  const source = bundle();
  let uploads = 0;
  const conflicting = {
    id: 'release-1',
    tag_name: source.tag,
    name: source.name,
    body: source.body,
    draft: true,
    prerelease: false,
    assets: [{ ...remoteAsset(source.assets[0]), hash_value: 'f'.repeat(64) }]
  };
  await assert.rejects(() => syncReleaseBundle(source, {
    getTag: async () => ({ name: source.tag }),
    getRelease: async () => conflicting,
    uploadAsset: async () => { uploads += 1; }
  }, { attempts: 2, delay: async () => {}, enabled: true }), /conflicting or unverifiable/);
  assert.equal(uploads, 0);
});

test('missing CNB public-snapshot tag stops before creating a Release', async () => {
  let creates = 0;
  await assert.rejects(() => syncReleaseBundle(bundle(), {
    getTag: async () => null,
    createRelease: async () => { creates += 1; }
  }, { attempts: 1, enabled: true }), /Source or tags were not pushed/);
  assert.equal(creates, 0);
});

test('retry helper retries only explicitly retryable failures', async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls += 1;
    if (calls < 2) { const error = new Error('retry'); error.status = 503; throw error; }
    return 'ok';
  }, { attempts: 2, delay: async () => {} });
  assert.equal(value, 'ok');
  assert.equal(calls, 2);
  await assert.rejects(() => withRetry(async () => { throw new Error('conflict'); }, { attempts: 2 }), /conflict/);
});

test('ambiguous create, upload and publish responses are read back and are not repeated after verified success', async () => {
  const source = bundle();
  let release = null;
  let creates = 0;
  let uploads = 0;
  let publishes = 0;
  const events = [];
  const client = {
    getTag: async () => ({ name: source.tag }),
    getRelease: async () => {
      events.push('read');
      return release;
    },
    createRelease: async payload => {
      creates += 1;
      events.push('create');
      release = { id: 'release-2', ...payload, assets: [] };
      const error = new Error('create response lost');
      error.retryable = true;
      throw error;
    },
    uploadAsset: async (_current, asset) => {
      uploads += 1;
      events.push(`upload:${asset.name}`);
      release.assets.push(remoteAsset(asset));
      const error = new Error('confirmation response lost');
      error.retryable = true;
      throw error;
    },
    publishRelease: async () => {
      publishes += 1;
      release.draft = false;
      const error = new Error('publish response lost');
      error.retryable = true;
      throw error;
    }
  };
  const result = await syncReleaseBundle(source, client, { attempts: 2, delay: async () => {}, enabled: true });
  assert.equal(result.release.draft, false);
  assert.equal(creates, 1);
  assert.equal(uploads, 4);
  assert.equal(publishes, 1);
  assert.equal(events[events.indexOf('create') + 1], 'read');
  for (const asset of source.assets) {
    assert.equal(events.filter(event => event === `upload:${asset.name}`).length, 1);
  }
});

test('historical synchronization does not promote latest unless explicitly requested', async () => {
  async function synchronize(makeLatest) {
    const source = bundle();
    const release = {
      id: 'release-latest-policy',
      tag_name: source.tag,
      name: source.name,
      body: source.body,
      draft: true,
      prerelease: false,
      assets: source.assets.map(remoteAsset)
    };
    let publishOptions;
    await syncReleaseBundle(source, {
      getTag: async () => ({ name: source.tag }),
      getRelease: async () => release,
      publishRelease: async (current, options) => {
        publishOptions = options;
        current.draft = false;
      }
    }, { attempts: 1, enabled: true, ...(makeLatest === undefined ? {} : { makeLatest }) });
    return publishOptions;
  }

  assert.deepEqual(await synchronize(), { makeLatest: false });
  assert.deepEqual(await synchronize(true), { makeLatest: true });
});

test('CNB publication request encodes make_latest only from the explicit caller choice', async () => {
  const payloads = [];
  const client = createCnbClient({
    enabled: true,
    cnbRepo: 'group/repo',
    apiBase: 'https://api.cnb.cool',
    token: 'test-token',
    uploadHosts: new Set(['upload.cnb.cool']),
    requestTimeoutMs: 1_000
  }, async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return { status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  const release = { id: 'release-1', name: 'Release', body: 'notes' };
  await client.publishRelease(release);
  await client.publishRelease(release, { makeLatest: true });
  await client.publishRelease({ ...release, prerelease: true }, { makeLatest: true });
  assert.deepEqual(payloads.map(payload => payload.make_latest), ['false', 'true', 'false']);
  assert.deepEqual(payloads.map(payload => payload.prerelease), [false, false, true]);
});

test('a single request attempt times out during fetch or JSON response-body reading and remains retryable', async () => {
  const hosts = new Set(['api.github.com']);
  const fetchTimeout = await requestWithTrustedRedirects(
    'https://api.github.com/release',
    {},
    'GitHub lookup',
    async () => new Promise(() => {}),
    hosts,
    5,
    20
  ).catch(error => error);
  assert.equal(fetchTimeout.name, 'TimeoutError');
  assert.equal(fetchTimeout.retryable, true);

  const bodyTimeout = await requestJson(
    'https://api.github.com/release',
    {},
    [200],
    'GitHub lookup',
    async () => ({ status: 200, headers: { get: () => null }, json: async () => new Promise(() => {}) }),
    hosts,
    20
  ).catch(error => error);
  assert.equal(bodyTimeout.name, 'TimeoutError');
  assert.equal(bodyTimeout.retryable, true);
});

test('JSON response-body transport failures are marked retryable', async () => {
  const error = await requestJson(
    'https://api.github.com/release',
    {},
    [200],
    'GitHub lookup',
    async () => ({
      status: 200,
      headers: { get: () => null },
      json: async () => { throw new Error('socket closed while reading body'); }
    }),
    new Set(['api.github.com']),
    500
  ).catch(caught => caught);
  assert.match(error.message, /response body could not be read as JSON/);
  assert.equal(error.retryable, true);
});

test('an interrupted GitHub attachment stream is retried from a clean target file', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-cnb-stream-test-'));
  const targetPath = path.join(tempRoot, 'asset.zip');
  let downloads = 0;
  const client = createGithubClient({
    githubRepo: 'CarlosZ16420/hamster-archiver',
    githubToken: '',
    attempts: 2,
    requestTimeoutMs: 1_000
  }, async () => {
    downloads += 1;
    const currentAttempt = downloads;
    return {
      status: 200,
      headers: { get: () => null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(currentAttempt === 1 ? 'partial' : 'complete'));
          if (currentAttempt === 1) controller.error(new Error('attachment stream disconnected'));
          else controller.close();
        }
      })
    };
  });
  try {
    await client.downloadAsset({ name: 'asset.zip', browser_download_url: 'https://github.com/asset.zip' }, targetPath);
    assert.equal(downloads, 2);
    assert.equal(await fs.readFile(targetPath, 'utf8'), 'complete');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('sync redirects are validated before the next host is contacted and network failures are retryable', async () => {
  const calls = [];
  await assert.rejects(() => requestWithTrustedRedirects('https://github.com/file', {}, 'asset', async (url, options) => {
    calls.push({ url, redirect: options.redirect });
    return { status: 302, headers: { get: () => 'https://evil.example/file' } };
  }, new Set(['github.com'])), /allowlist/);
  assert.deepEqual(calls, [{ url: 'https://github.com/file', redirect: 'manual' }]);
  const networkError = await requestWithTrustedRedirects('https://github.com/file', {}, 'asset', async () => {
    throw new Error('socket closed');
  }, new Set(['github.com'])).catch(error => error);
  assert.equal(networkError.retryable, true);
});

test('workflow is default-disabled, repository-guarded, checks out github.sha, and scopes CNB_TOKEN to the two CNB write steps', async () => {
  const workflow = await fs.readFile(path.resolve(__dirname, '..', '.github', 'workflows', 'sync-cnb-release.yml'), 'utf8');
  assert.match(workflow, /if: github\.repository == 'CarlosZ16420\/hamster-archiver' && vars\.CNB_SYNC_ENABLED == 'true'/);
  assert.match(workflow, /vars\.CNB_SYNC_ENABLED != 'true'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.release\.tag_name/);
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf('- name: Ensure')), /CNB_TOKEN:/);
  assert.equal((workflow.match(/CNB_TOKEN: \$\{\{ secrets\.CNB \}\}/g) || []).length, 2);
  assert.match(workflow.slice(workflow.indexOf('- name: Ensure'), workflow.indexOf('- name: Mirror')), /CNB_TOKEN: \$\{\{ secrets\.CNB \}\}/);
  assert.match(workflow.slice(workflow.indexOf('- name: Mirror')), /CNB_TOKEN: \$\{\{ secrets\.CNB \}\}/);
  assert.match(workflow, /CNB_SYNC_ENABLED: 'true'/);
  assert.match(workflow, /CNB_MAKE_LATEST: \$\{\{ !contains\(github\.event\.release\.tag_name \|\| inputs\.tag, '-'\) && \(github\.event_name == 'release' \|\| inputs\.make_latest\) \}\}/);
  assert.match(workflow, /--make-latest "\$CNB_MAKE_LATEST"/);
  assert.doesNotMatch(workflow, /CNB_TOKEN_PERMISSION|repo-code:rw/);
});

test('workflow selects stable and Mac Beta releases and retries without promoting Mac Beta', async () => {
  const workflow = await fs.readFile(path.resolve(__dirname, '..', '.github', 'workflows', 'sync-cnb-release.yml'), 'utf8');
  const conditions = [...workflow.matchAll(/if: >-\s+\$\{\{ ([\s\S]*?) \}\}/g)].map(match => match[1]);
  const latest = /CNB_MAKE_LATEST: \$\{\{ (.*?) \}\}/.exec(workflow)[1];
  const evaluate = (expression, github, inputs, vars) => Function('github', 'inputs', 'vars', 'contains', `return (${expression});`)(github, inputs, vars, (value, part) => String(value || '').includes(part));
  for (const event of ['release', 'workflow_dispatch']) {
    for (const [tag, allowed] of [['v4.8.6', true], ['v4.8.6-beta.mac.1', true], ['v4.8.6-beta.task.1', false]]) {
      const github = { repository: 'CarlosZ16420/hamster-archiver', event_name: event, event: { release: event === 'release' ? { tag_name: tag, prerelease: tag.includes('-') } : {} } };
      const inputs = { tag, make_latest: true };
      assert.equal(evaluate(conditions[1], github, inputs, { CNB_SYNC_ENABLED: 'true' }), allowed);
      assert.equal(evaluate(conditions[0], github, inputs, {}), allowed);
      assert.equal(evaluate(conditions[1], { ...github, repository: 'CarlosZ16420/hamster-archive' }, inputs, { CNB_SYNC_ENABLED: 'true' }), false);
      assert.equal(evaluate(latest, github, inputs, {}), tag === 'v4.8.6');
      if (event === 'release' && tag === 'v4.8.6') {
        github.event.release.prerelease = true;
        assert.equal(evaluate(conditions[1], github, inputs, { CNB_SYNC_ENABLED: 'true' }), false);
      }
    }
  }
});
