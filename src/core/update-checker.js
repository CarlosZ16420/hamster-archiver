'use strict';

const { compactReleaseNotesPayload } = require('./release-notes');

const RELEASES_URL = 'https://github.com/CarlosZ16420/hamster-archiver/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/CarlosZ16420/hamster-archiver/releases/latest';

function versionParts(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error('GitHub 返回了无法识别的版本号。');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates({
  currentVersion,
  distributionMode = 'portable',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持联网检查更新。');
  let response;
  try {
    response = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hamster-archiver-update-checker' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`检查更新超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或代理设置。`);
    }
    throw new Error(`无法连接 GitHub：${error.message}`);
  }
  if (response.status === 404) {
    return { currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: RELEASES_URL };
  }
  if (!response.ok) throw new Error(`GitHub 更新检查失败（HTTP ${response.status}）。`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const normalizedDistributionMode = distributionMode === 'installed' ? 'installed' : 'portable';
  const expectedAssetName = (normalizedDistributionMode === 'installed'
    ? `HamsterArchiver-Setup-v${latestVersion}-win-x64.exe`
    : `HamsterArchiver-v${latestVersion}-win-x64.zip`).toLowerCase();
  const archiveAsset = assets.find((asset) => String(asset.name || '').toLowerCase() === expectedAssetName);
  const archiveName = String(archiveAsset?.name || '').toLowerCase();
  const digestAsset = archiveAsset && assets.find((asset) => {
    const name = String(asset.name || '').toLowerCase();
    return name === `${archiveName}.sha256` || name === `${archiveName}.sha256.txt`;
  });
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: release.html_url || RELEASES_URL,
    releaseNotes: compactReleaseNotesPayload(release.body),
    distributionMode: normalizedDistributionMode,
    installable: Boolean(archiveAsset?.browser_download_url),
    asset: archiveAsset ? {
      name: String(archiveAsset.name || ''),
      downloadUrl: String(archiveAsset.browser_download_url || ''),
      size: Number(archiveAsset.size) || 0,
      digest: String(archiveAsset.digest || ''),
      digestDownloadUrl: String(digestAsset?.browser_download_url || '')
    } : null
  };
}

module.exports = { LATEST_RELEASE_API, RELEASES_URL, checkForUpdates, compareVersions };
