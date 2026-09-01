'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { checkForUpdates, compareVersions } = require('../src/core/update-checker');

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
