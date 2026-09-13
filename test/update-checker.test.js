'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkForUpdates, compareVersions, resolveCnbConfig, UPDATE_PROVIDER_CONFIG } = require('../src/core/update-checker');

test('history paginates, sorts numerically, filters releases and selects the requested language', async () => {
  const release = { tag_name: 'v4.5.18', body: '## 中文\n- 修复归档。\n## English\n- Fix archives.' };
  const calls = [];
  const result = await checkForUpdates({
    currentVersion: '4.5.9', includeHistory: true,
    fetchImpl: async (url) => {
      calls.push(url);
      const payload = url.endsWith('/latest') ? release : url.endsWith('page=1')
        ? Array.from({ length: 100 }, () => ({ tag_name: 'v4.5.8' }))
        : [release, { tag_name: 'v4.5.10', body: '## 中文\n十。\n## English\nTen.' },
          { tag_name: 'v4.5.19' }, { tag_name: 'v4.5.9' }, { tag_name: 'v4.5.11', draft: true },
          { tag_name: 'v4.5.12', prerelease: true }, { tag_name: 'v4.5.13-beta' }, { tag_name: 'invalid' }];
      return { ok: true, json: async () => payload };
    }
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(result.releases.map((item) => item.version), ['4.5.18', '4.5.10']);
  assert.equal(result.historyIncomplete, false);
  assert.equal(result.releases[0].notes['zh-CN'].text, '- 修复归档。');
  assert.equal(result.releases[0].notes['en-US'].text, '- Fix archives.');
  assert.equal(result.releases[0].notes['zh-CN'].untranslated, false);
});

test('failed history retains latest notes and explicitly reports incomplete history', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.5.16', includeHistory: true,
    fetchImpl: async (url) => {
      if (!url.endsWith('/latest')) throw new Error('offline');
      return { ok: true, json: async () => ({ tag_name: 'v4.5.18', body: '## English\n- English only.' }) };
    }
  });
  assert.equal(result.historyIncomplete, true);
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].notes['zh-CN'].untranslated, true);
  assert.equal(result.releases[0].notes['en-US'].untranslated, false);
});

test('display notes preserve long lists beyond the native-dialog summary limit', () => {
  const { displayRelease } = require('../src/core/update-checker');
  const lines = Array.from({ length: 30 }, (_, i) => `- Change ${i}`).join('\n');
  const entry = displayRelease({ tag_name: 'v4.5.18', body: `## English\n${lines}` });
  assert.match(entry.notes['en-US'].text, /Change 29/);
  assert.equal(entry.truncated, false);
});

test('semantic versions are compared numerically', () => {
  assert.equal(compareVersions('2.0.0', '1.11.9'), 1);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
});

test('manual update check reports a newer GitHub release', async () => {
  const result = await checkForUpdates({
    currentVersion: '1.1.7',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v2.0.0',
        html_url: 'https://example.test/release',
        body: '- 新增更新说明。'
      })
    })
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.releaseNotes, '- 新增更新说明。');
});

test('4.2.0-era clients recognize v-prefixed 4.4.x releases', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.2.0',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v4.4.2',
        assets: [{
          name: 'HamsterArchiver-v4.4.2-win-x64.zip',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.4.2/HamsterArchiver-v4.4.2-win-x64.zip',
          size: 123,
          digest: 'sha256:' + 'b'.repeat(64)
        }]
      })
    })
  });
  assert.equal(result.latestVersion, '4.4.2');
  assert.equal(result.updateAvailable, true);
  assert.equal(result.installable, true);
});

test('update metadata exposes a matching Windows asset for installation', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.0.0',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v4.0.1',
        html_url: 'https://example.test/release',
        assets: [{
          name: 'HamsterArchiver-v4.0.1-win-x64.zip',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.0.1/HamsterArchiver-v4.0.1-win-x64.zip',
          size: 123,
          digest: 'sha256:' + 'a'.repeat(64)
        }, {
          name: 'HamsterArchiver-v4.0.1-win-x64.zip.sha256',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.0.1/HamsterArchiver-v4.0.1-win-x64.zip.sha256'
        }]
      })
    })
  });
  assert.equal(result.installable, true);
  assert.equal(result.asset.name, 'HamsterArchiver-v4.0.1-win-x64.zip');
  assert.equal(result.asset.size, 123);
  assert.match(result.asset.digestDownloadUrl, /\.zip\.sha256$/);
});

test('installed distribution selects the matching Setup executable and digest', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.5.16',
    distributionMode: 'installed',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v4.5.17',
        assets: [{
          name: 'HamsterArchiver-v4.5.17-win-x64.zip',
          browser_download_url: 'https://github.com/example/portable.zip'
        }, {
          name: 'HamsterArchiver-Setup-v4.5.17-win-x64.exe',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.5.17/HamsterArchiver-Setup-v4.5.17-win-x64.exe',
          size: 456,
          digest: 'sha256:' + 'c'.repeat(64)
        }, {
          name: 'HamsterArchiver-Setup-v4.5.17-win-x64.exe.sha256',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.5.17/HamsterArchiver-Setup-v4.5.17-win-x64.exe.sha256'
        }]
      })
    })
  });
  assert.equal(result.distributionMode, 'installed');
  assert.equal(result.installable, true);
  assert.equal(result.asset.name, 'HamsterArchiver-Setup-v4.5.17-win-x64.exe');
  assert.equal(result.asset.size, 456);
  assert.match(result.asset.digestDownloadUrl, /\.exe\.sha256$/);
});

test('update metadata can provide a sidecar digest when GitHub omits asset.digest', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.0.0',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v4.0.1',
        assets: [{
          name: 'HamsterArchiver-v4.0.1-win-x64.zip',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.0.1/HamsterArchiver-v4.0.1-win-x64.zip'
        }, {
          name: 'HamsterArchiver-v4.0.1-win-x64.zip.sha256',
          browser_download_url: 'https://github.com/CarlosZ16420/hamster-archiver/releases/download/v4.0.1/HamsterArchiver-v4.0.1-win-x64.zip.sha256'
        }]
      })
    })
  });
  assert.equal(result.asset.digest, '');
  assert.ok(result.asset.digestDownloadUrl);
});

test('update metadata ignores legacy or unrelated ZIP assets', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.1.2',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v4.2.0',
        html_url: 'https://example.test/release',
        assets: [{
          name: 'HamsterArchive-v4.2.0-win-x64.zip',
          browser_download_url: 'https://example.test/legacy.zip'
        }, {
          name: 'source-bundle.zip',
          browser_download_url: 'https://example.test/source.zip'
        }]
      })
    })
  });
  assert.equal(result.installable, false);
  assert.equal(result.asset, null);
});

const cnbConfig = {
  latestApiUrl: 'https://api.cnb.test/acme/hamster/-/releases/latest',
  releasesApiUrl: 'https://api.cnb.test/acme/hamster/-/releases',
  releasesUrl: 'https://cnb.test/acme/hamster/-/releases',
  downloadHosts: ['downloads.cnb.test']
};

test('bundled CNB endpoint configuration is versioned, read-only and empty until a real target is supplied', () => {
  assert.equal(UPDATE_PROVIDER_CONFIG.schemaVersion, 1);
  assert.deepEqual(UPDATE_PROVIDER_CONFIG.cnb, {
    latestApiUrl: '',
    releasesApiUrl: '',
    releasesUrl: '',
    downloadHosts: []
  });
  assert.equal(resolveCnbConfig(undefined, {}).configured, false);
  const overridden = resolveCnbConfig({ latestApiUrl: 'https://stale.test/latest' }, {
    HAMSTER_CNB_LATEST_RELEASE_API: cnbConfig.latestApiUrl,
    HAMSTER_CNB_RELEASES_API: cnbConfig.releasesApiUrl,
    HAMSTER_CNB_RELEASES_URL: cnbConfig.releasesUrl,
    HAMSTER_CNB_DOWNLOAD_HOSTS: 'downloads.cnb.test'
  });
  assert.equal(overridden.configured, true);
  assert.equal(overridden.latestApiUrl, cnbConfig.latestApiUrl);
  assert.equal(overridden.configSchemaVersion, 1);
});

function cnbRelease(version = '4.6.1') {
  const zip = `HamsterArchiver-v${version}-win-x64.zip`;
  return {
    tag_name: `v${version}`,
    body: '## 中文\n- CNB 镜像。\n## English\n- CNB mirror.',
    assets: [{
      name: zip,
      browser_download_url: `https://downloads.cnb.test/${zip}`,
      size: 321,
      hash_algo: 'sha256',
      hash_value: 'd'.repeat(64)
    }, {
      name: `${zip}.sha256`,
      browser_download_url: `https://downloads.cnb.test/${zip}.sha256`
    }]
  };
}

test('GitHub success, including already-current, never requests CNB', async () => {
  const calls = [];
  const result = await checkForUpdates({
    currentVersion: '4.6.0',
    cnb: cnbConfig,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ tag_name: 'v4.6.0', body: 'current' }) };
    }
  });
  assert.equal(result.provider, 'github');
  assert.equal(result.updateAvailable, false);
  assert.deepEqual(calls, ['https://api.github.com/repos/CarlosZ16420/hamster-archiver/releases/latest']);
});

test('GitHub timeout, 404, HTTP error and parse failure each fall back to CNB', async (t) => {
  const failures = {
    timeout: () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; },
    notFound: () => ({ ok: false, status: 404 }),
    http: () => ({ ok: false, status: 503 }),
    parse: () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
  };
  for (const [name, githubResponse] of Object.entries(failures)) {
    await t.test(name, async () => {
      const calls = [];
      const result = await checkForUpdates({
        currentVersion: '4.6.0',
        cnb: cnbConfig,
        fetchImpl: async (url) => {
          calls.push(url);
          if (url.includes('api.github.com')) return githubResponse();
          return { ok: true, status: 200, json: async () => cnbRelease() };
        }
      });
      assert.equal(result.provider, 'cnb');
      assert.equal(result.source.provider, 'cnb');
      assert.equal(result.latestVersion, '4.6.1');
      assert.equal(calls.length, 2);
    });
  }
});

test('CNB adapter normalizes version, notes, asset and digest metadata', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.6.0',
    cnb: cnbConfig,
    fetchImpl: async (url) => url.includes('api.github.com')
      ? { ok: false, status: 503 }
      : { ok: true, status: 200, json: async () => cnbRelease() }
  });
  assert.equal(result.releaseUrl, 'https://cnb.test/acme/hamster/-/releases/tag/v4.6.1');
  assert.match(result.releaseNotes, /CNB 镜像/);
  assert.equal(result.asset.provider, 'cnb');
  assert.equal(result.asset.digest, `sha256:${'d'.repeat(64)}`);
  assert.match(result.asset.digestDownloadUrl, /\.sha256$/);
});

test('CNB history failures retain the latest mirrored release', async () => {
  const result = await checkForUpdates({
    currentVersion: '4.6.0',
    includeHistory: true,
    cnb: cnbConfig,
    fetchImpl: async (url) => {
      if (url.includes('api.github.com')) return { ok: false, status: 500 };
      if (url.includes('/latest')) return { ok: true, status: 200, json: async () => cnbRelease() };
      throw new Error('history unavailable');
    }
  });
  assert.equal(result.historyIncomplete, true);
  assert.deepEqual(result.releases.map((item) => item.version), ['4.6.1']);
  assert.equal(result.releases[0].provider, 'cnb');
});

test('double-source failure reports both providers and missing CNB configuration safely', async () => {
  await assert.rejects(() => checkForUpdates({
    currentVersion: '4.6.0',
    environment: {},
    fetchImpl: async () => ({ ok: false, status: 503 })
  }), /GitHub.*503.*未配置 CNB/s);
  await assert.rejects(() => checkForUpdates({
    currentVersion: '4.6.0',
    cnb: cnbConfig,
    fetchImpl: async (url) => ({ ok: false, status: url.includes('github') ? 500 : 502 })
  }), /GitHub.*500.*CNB.*502/s);
});
