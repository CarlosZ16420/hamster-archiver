'use strict';

const { compactReleaseNotesPayload, selectLocalizedMarkdownSection } = require('./release-notes');
const UPDATE_PROVIDER_CONFIG = require('../config/update-providers.json');
const { expectedReleaseAssetNames } = require('./sync-cnb-release-assets');

const RELEASES_URL = 'https://github.com/CarlosZ16420/hamster-archiver/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/CarlosZ16420/hamster-archiver/releases/latest';
const RELEASES_API = LATEST_RELEASE_API.replace(/\/latest$/, '');
const USER_AGENT = 'hamster-archiver-update-checker';

function versionParts(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function isStableRelease(release, stableBranch = '') {
  if (!release || typeof release !== 'object' || release.draft || release.prerelease) return false;
  if (!/^v?\d+\.\d+\.\d+$/i.test(String(release.tag_name || '').trim())) return false;
  return !stableBranch || String(release.target_commitish || '').trim() === stableBranch;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error('发行源返回了无法识别的版本号。');
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  const prerelease = (value) => String(value).replace(/^v/i, '').split('+')[0].split('-').slice(1).join('-');
  const ap = prerelease(left), bp = prerelease(right);
  if (ap === bp) return 0;
  if (!ap || !bp) return ap ? -1 : 1;
  const ai = ap.split('.'), bi = bp.split('.');
  for (let i = 0; i < Math.max(ai.length, bi.length); i += 1) {
    if (ai[i] === bi[i]) continue;
    if (ai[i] === undefined || bi[i] === undefined) return ai[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(ai[i]), bn = /^\d+$/.test(bi[i]);
    if (an && bn) return Number(ai[i]) > Number(bi[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return ai[i] > bi[i] ? 1 : -1;
  }
  return 0;
}

function appendQuery(url, values) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(values)) parsed.searchParams.set(key, String(value));
  return parsed.href;
}

function requireHttpsUrl(value, label) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error(`${label}不是有效 URL。`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(`${label}必须是不含凭证的 HTTPS URL。`);
  return parsed.href;
}

function parseHostList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function resolveCnbConfig(cnb = UPDATE_PROVIDER_CONFIG.cnb, environment = process.env) {
  if (UPDATE_PROVIDER_CONFIG.schemaVersion !== 2) {
    return { configured: false, reason: '内置更新来源配置版本不受支持，已安全跳过 CNB 回退。' };
  }
  const discoveryMode = environment.HAMSTER_CNB_DISCOVERY_MODE || cnb?.discoveryMode || 'api';
  const latestApiUrl = environment.HAMSTER_CNB_LATEST_RELEASE_API || cnb?.latestApiUrl || '';
  const releasesApiUrl = environment.HAMSTER_CNB_RELEASES_API || cnb?.releasesApiUrl || '';
  const releasesUrl = environment.HAMSTER_CNB_RELEASES_URL || cnb?.releasesUrl || '';
  if (!['api', 'release-page-redirect'].includes(discoveryMode)) {
    return { configured: false, reason: 'CNB 回退配置使用了不受支持的版本发现方式。' };
  }
  if (!latestApiUrl && !releasesApiUrl && !releasesUrl) {
    return { configured: false, reason: '未配置 CNB 最新版本地址和发布页，已安全跳过 CNB 回退。' };
  }
  if (!latestApiUrl || !releasesUrl || (discoveryMode === 'api' && !releasesApiUrl)) {
    return { configured: false, reason: discoveryMode === 'api'
      ? 'CNB API 回退配置不完整；必须同时配置最新 Release API、历史 API 和发布页。'
      : 'CNB 公开发布页回退配置不完整；必须同时配置 latest 跳转地址和发布页。' };
  }
  try {
    const normalized = {
      configured: true,
      discoveryMode,
      latestApiUrl: requireHttpsUrl(latestApiUrl, 'CNB 最新 Release API'),
      releasesApiUrl: releasesApiUrl ? requireHttpsUrl(releasesApiUrl, 'CNB Release 历史 API') : '',
      releasesUrl: requireHttpsUrl(releasesUrl, 'CNB 发布页')
    };
    normalized.configSchemaVersion = UPDATE_PROVIDER_CONFIG.schemaVersion;
    normalized.downloadHosts = parseHostList(environment.HAMSTER_CNB_DOWNLOAD_HOSTS || cnb?.downloadHosts);
    for (const url of [normalized.latestApiUrl, normalized.releasesApiUrl, normalized.releasesUrl].filter(Boolean)) {
      normalized.downloadHosts.push(new URL(url).hostname.toLowerCase());
    }
    normalized.downloadHosts = [...new Set(normalized.downloadHosts)];
    return normalized;
  } catch (error) {
    return { configured: false, reason: `CNB 回退配置无效：${error.message}` };
  }
}

function releasePage(adapter, release) {
  if (release?.html_url) return String(release.html_url);
  if (adapter.provider === 'cnb' && release?.tag_name) {
    return `${adapter.releasesUrl.replace(/\/$/, '')}/tag/${encodeURIComponent(release.tag_name)}`;
  }
  return adapter.releasesUrl;
}

function displayRelease(release, adapter = { provider: 'github', releasesUrl: RELEASES_URL }) {
  const body = String(release.body || '').slice(0, 128_000);
  const localized = {};
  for (const locale of ['zh-CN', 'en-US']) {
    const text = selectLocalizedMarkdownSection(body, locale).trim();
    const heading = locale === 'zh-CN' ? '(?:中文|简体中文|zh(?:-CN)?|Chinese)' : '(?:English|en(?:-US)?)';
    localized[locale] = { text, untranslated: Boolean(text) && !new RegExp(`^#{1,6}\\s+${heading}\\s*#*\\s*$`, 'im').test(body) };
  }
  return {
    version: String(release.tag_name || '').replace(/^v/i, ''),
    publishedAt: release.published_at || '',
    notes: localized,
    truncated: String(release.body || '').length > body.length,
    provider: adapter.provider,
    releaseUrl: releasePage(adapter, release)
  };
}

function normalizeAssetDigest(asset, provider) {
  if (provider === 'cnb' && String(asset?.hash_algo || '').toLowerCase() === 'sha256') {
    return `sha256:${String(asset.hash_value || '')}`;
  }
  return String(asset?.digest || '');
}

function createGithubAdapter() {
  return {
    provider: 'github',
    label: 'GitHub',
    latestApiUrl: LATEST_RELEASE_API,
    releasesApiUrl: RELEASES_API,
    releasesUrl: RELEASES_URL,
    downloadHosts: ['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com'],
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    historyUrl: (page) => appendQuery(RELEASES_API, { per_page: 100, page })
  };
}

function createCnbAdapter(config) {
  const redirectDiscovery = config.discoveryMode === 'release-page-redirect';
  return {
    provider: 'cnb',
    label: 'CNB',
    ...config,
    headers: { Accept: redirectDiscovery ? 'text/html' : 'application/vnd.cnb.api+json', 'User-Agent': USER_AGENT },
    historyUrl: config.releasesApiUrl ? (page) => appendQuery(config.releasesApiUrl, { page, page_size: 100 }) : null
  };
}

function releaseFromCnbRedirect(response, adapter) {
  const location = response.headers?.get?.('location');
  if (!location) throw new Error('CNB latest 跳转缺少 Location');
  let target;
  let releases;
  try {
    target = new URL(location, adapter.latestApiUrl);
    releases = new URL(adapter.releasesUrl);
  } catch {
    throw new Error('CNB latest 跳转地址无效');
  }
  const prefix = `${releases.pathname.replace(/\/$/, '')}/tag/`;
  if (target.protocol !== 'https:' || target.username || target.password || target.origin !== releases.origin ||
      !target.pathname.startsWith(prefix)) {
    throw new Error('CNB latest 跳转离开了配置的公开 Release 页面');
  }
  let tag;
  try { tag = decodeURIComponent(target.pathname.slice(prefix.length)); } catch { tag = ''; }
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error('CNB latest 跳转缺少有效版本标签');
  }
  const downloadBase = `${adapter.releasesUrl.replace(/\/$/, '')}/latest/download/`;
  const assets = expectedReleaseAssetNames(tag).map(name => ({
    name,
    browser_download_url: `${downloadBase}${encodeURIComponent(name)}`,
    size: 0
  }));
  return {
    tag_name: tag,
    name: `Hamster Archiver ${tag}`,
    body: '',
    published_at: '',
    draft: false,
    prerelease: false,
    html_url: target.href,
    assets
  };
}

async function fetchLatestRelease(adapter, fetchImpl, timeoutMs, stableBranch = '') {
  if (stableBranch && adapter.provider === 'github') {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      for (let page = 1; page <= 10; page += 1) {
        const response = await fetchImpl(adapter.historyUrl(page), {
          headers: adapter.headers,
          redirect: 'follow',
          signal
        });
        if (!response.ok) throw new Error(`${adapter.label} 更新检查失败（HTTP ${response.status}）`);
        let releases;
        try { releases = await response.json(); } catch (error) {
          throw new Error(`${adapter.label} Release 响应解析失败：${error.message}`);
        }
        if (!Array.isArray(releases)) throw new Error(`${adapter.label} Release 响应缺少有效的正式版本`);
        const release = releases.find((item) => isStableRelease(item, stableBranch));
        if (release) return release;
        if (releases.length < 100) break;
      }
    } catch (error) {
      if (/^GitHub /.test(error.message)) throw error;
      const kind = error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时' : `连接失败：${error.message}`;
      throw new Error(`${adapter.label} ${kind}`);
    }
    const error = new Error(`${adapter.label} Release 响应缺少 ${stableBranch} 分支的有效正式版本`);
    error.code = 'UPDATE_STABLE_RELEASE_NOT_FOUND';
    throw error;
  }
  const requestUrl = adapter.latestApiUrl;
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      headers: adapter.headers,
      redirect: adapter.discoveryMode === 'release-page-redirect' ? 'manual' : 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const kind = error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时' : `连接失败：${error.message}`;
    throw new Error(`${adapter.label} ${kind}`);
  }
  if (adapter.discoveryMode === 'release-page-redirect' && [301, 302, 303, 307, 308].includes(response.status)) {
    return releaseFromCnbRedirect(response, adapter);
  }
  if (!response.ok) throw new Error(`${adapter.label} 更新检查失败（HTTP ${response.status}）`);
  let payload;
  try { payload = await response.json(); } catch (error) {
    throw new Error(`${adapter.label} Release 响应解析失败：${error.message}`);
  }
  const release = payload;
  if (!isStableRelease(release, stableBranch)) {
    throw new Error(`${adapter.label} Release 响应缺少有效的正式版本`);
  }
  return release;
}

async function collectReleaseHistory({ release, currentVersion, fetchImpl, timeoutMs, adapter, stableBranch = '', distributionMode = 'portable' }) {
  const latest = { ...displayRelease(release, adapter), asset: selectReleaseAsset(release, distributionMode, adapter) };
  const versions = new Map([[latest.version, latest]]);
  const signal = AbortSignal.timeout(timeoutMs);
  let complete = false;
  if (typeof adapter.historyUrl !== 'function') {
    return { releases: [...versions.values()], historyIncomplete: true };
  }
  try {
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetchImpl(adapter.historyUrl(page), { headers: adapter.headers, signal });
      if (!response.ok) break;
      const releases = await response.json();
      if (!Array.isArray(releases)) break;
      for (const item of releases) {
        if (!isStableRelease(item, adapter.provider === 'cnb' && !item.target_commitish ? '' : stableBranch)) continue;
        if (compareVersions(item.tag_name, currentVersion) > 0 && compareVersions(item.tag_name, release.tag_name) <= 0) {
          const entry = displayRelease(item, adapter);
          versions.set(entry.version, { ...entry, rollback: false, asset: selectReleaseAsset(item, distributionMode, adapter) });
        }
      }
      if (releases.length < 100) { complete = true; break; }
    }
  } catch { /* Latest release remains usable when history is unavailable. */ }
  return { releases: [...versions.values()].sort((a, b) => compareVersions(b.version, a.version)), historyIncomplete: !complete };
}

function selectReleaseAsset(release, distributionMode, adapter) {
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const select = (expectedAssetName) => {
    expectedAssetName = expectedAssetName.toLowerCase();
    const archiveAsset = assets.find((asset) => String(asset.name || '').toLowerCase() === expectedAssetName);
    const archiveName = String(archiveAsset?.name || '').toLowerCase();
    const digestAsset = archiveAsset && assets.find((asset) => {
      const name = String(asset.name || '').toLowerCase();
      return name === `${archiveName}.sha256` || name === `${archiveName}.sha256.txt`;
    });
    const downloadUrl = archiveAsset?.browser_download_url || archiveAsset?.brower_download_url || '';
    const digestDownloadUrl = digestAsset?.browser_download_url || digestAsset?.brower_download_url || '';
    return archiveAsset ? {
      name: String(archiveAsset.name || ''),
      downloadUrl: String(downloadUrl),
      size: Number(archiveAsset.size) || 0,
      digest: normalizeAssetDigest(archiveAsset, adapter.provider),
      digestDownloadUrl: String(digestDownloadUrl),
      provider: adapter.provider
    } : null;
  };
  if (distributionMode === 'mac') return select(`HamsterArchiver-v${latestVersion}-mac-universal.dmg`);
  if (distributionMode === 'installed') return select(`HamsterArchiver-Setup-v${latestVersion}-win-x64.exe`);
  const zip = select(`HamsterArchiver-v${latestVersion}-win-x64.zip`);
  const sevenZip = select(`HamsterArchiver-v${latestVersion}-win-x64.7z`);
  if (sevenZip?.downloadUrl && (/^(?:sha256:)?[a-f0-9]{64}$/i.test(sevenZip.digest) || sevenZip.digestDownloadUrl)) {
    return zip?.downloadUrl ? { ...sevenZip, fallbackAsset: zip } : sevenZip;
  }
  return zip;
}

function isMacRelease(release) {
  return Boolean(release && !release.draft && (
    (release.prerelease === true && /^v\d+\.\d+\.\d+-beta\.mac\.\d+$/.test(release.tag_name || '')) ||
    isStableRelease(release, 'main')));
}

async function checkMacForUpdates({ currentVersion, fetchImpl, timeoutMs, includeHistory }) {
  const adapter = createGithubAdapter();
  const versions = new Map();
  let complete = false;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let page = 1; page <= 10; page += 1) {
    try {
      const response = await fetchImpl(adapter.historyUrl(page), { headers: adapter.headers, signal });
      if (!response.ok) throw new Error(`GitHub 更新检查失败（HTTP ${response.status}）`);
      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error('GitHub Release 响应解析失败。');
      for (const release of releases) {
        if (!isMacRelease(release)) continue;
        const asset = selectReleaseAsset(release, 'mac', adapter);
        // A Windows release or incomplete Mac upload must never be offered.
        if (!asset?.downloadUrl || (!asset.digestDownloadUrl && !/^sha256:[a-f0-9]{64}$/i.test(asset.digest))) continue;
        versions.set(release.tag_name, release);
      }
      if (releases.length < 100) { complete = true; break; }
    } catch (error) {
      if (!versions.size) throw error;
      break;
    }
  }
  const releases = [...versions.values()].sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  if (!releases.length) return { currentVersion, latestVersion: null, updateAvailable: false,
    distributionMode: 'mac', releaseUrl: RELEASES_URL, releaseNotes: '', releases: [],
    historyIncomplete: !complete, installable: false, asset: null, provider: 'github' };
  const history = { releases: includeHistory ? releases.map(release => ({
    ...displayRelease(release, adapter), rollback: compareVersions(release.tag_name, currentVersion) < 0,
    asset: selectReleaseAsset(release, 'mac', adapter)
  })) : [], historyIncomplete: !complete };
  return normalizeRelease({ release: releases[0], adapter, currentVersion, distributionMode: 'mac', history });
}

function selectCheckedRelease(checked, version) {
  if (!checked || typeof version !== 'string') throw new Error('请重新检查更新。');
  const entry = checked.releases?.find(release => release.version === version);
  if (version !== checked.latestVersion && !entry) throw new Error('请重新检查更新。');
  const selected = version === checked.latestVersion ? checked : { ...checked,
    latestVersion: version, asset: entry.asset, releaseUrl: entry.releaseUrl,
    releaseNotes: Object.fromEntries(Object.entries(entry.notes || {}).map(([locale, notes]) => [locale, notes.text])) };
  const direction = compareVersions(version, checked.currentVersion);
  if (!selected.asset?.downloadUrl || direction === 0 || (checked.distributionMode !== 'mac' && direction < 0)) {
    throw new Error('请选择可安装的其他版本。');
  }
  return { ...selected, installable: true, rollback: direction < 0 };
}

function normalizeRelease({ release, adapter, currentVersion, distributionMode, history }) {
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  const asset = selectReleaseAsset(release, distributionMode, adapter);
  return {
    ...history,
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: releasePage(adapter, release),
    releaseNotes: compactReleaseNotesPayload(release.body),
    distributionMode,
    installable: Boolean(asset?.downloadUrl),
    asset,
    provider: adapter.provider,
    source: {
      provider: adapter.provider,
      latestApiUrl: adapter.latestApiUrl,
      releasesApiUrl: adapter.releasesApiUrl,
      releasesUrl: adapter.releasesUrl,
      configSchemaVersion: adapter.configSchemaVersion || 1,
      discoveryMode: adapter.discoveryMode || 'api',
      downloadHosts: [...adapter.downloadHosts]
    }
  };
}

async function checkForUpdates({
  currentVersion,
  distributionMode = 'portable',
  includeHistory = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8_000,
  cnb = UPDATE_PROVIDER_CONFIG.cnb,
  environment = process.env,
  stableBranch = ''
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持联网检查更新。');
  if (distributionMode === 'mac') return checkMacForUpdates({ currentVersion, fetchImpl, timeoutMs, includeHistory });
  const normalizedDistributionMode = distributionMode === 'mac' ? 'mac' : distributionMode === 'installed' ? 'installed' : 'portable';
  const github = createGithubAdapter();
  let release;
  let githubFailure;
  try {
    release = await fetchLatestRelease(github, fetchImpl, timeoutMs, stableBranch);
  } catch (error) {
    githubFailure = error;
    if (error.code === 'UPDATE_STABLE_RELEASE_NOT_FOUND') {
      throw new Error(`在线更新未找到 ${stableBranch} 分支的正式版本：${githubFailure.message}`);
    }
    try {
      return await checkCnbForUpdates({ currentVersion, distributionMode: normalizedDistributionMode,
        includeHistory, fetchImpl, timeoutMs, cnb, environment, stableBranch });
    } catch (cnbFailure) {
      throw new Error(`检查更新失败：${githubFailure.message}；${cnbFailure.message}`);
    }
  }
  const updateAvailable = compareVersions(release.tag_name, currentVersion) > 0;
  const history = includeHistory && updateAvailable
    ? await collectReleaseHistory({ release, currentVersion, fetchImpl, timeoutMs, adapter: github, stableBranch, distributionMode: normalizedDistributionMode })
    : { releases: [], historyIncomplete: false };
  return normalizeRelease({ release, adapter: github, currentVersion, distributionMode: normalizedDistributionMode, history });
}

async function checkCnbForUpdates({ currentVersion, distributionMode = 'portable', includeHistory = false,
  fetchImpl = globalThis.fetch, timeoutMs = 8_000, cnb = UPDATE_PROVIDER_CONFIG.cnb,
  environment = process.env, stableBranch = 'main', expectedVersion = '' } = {}) {
  const config = resolveCnbConfig(cnb, environment);
  if (!config.configured) throw new Error(config.reason);
  const adapter = createCnbAdapter(config);
  const release = await fetchLatestRelease(adapter, fetchImpl, timeoutMs);
  // The configured mirror only publishes stable releases. Reject conflicting
  // branch metadata when available; public latest redirects expose only a tag.
  if (!isStableRelease(release) || (stableBranch && release.target_commitish &&
      String(release.target_commitish).trim() !== stableBranch)) {
    throw new Error('CNB Release 响应缺少有效的正式版本');
  }
  if (expectedVersion && String(release.tag_name).replace(/^v/i, '') !== String(expectedVersion).replace(/^v/i, '')) {
    throw new Error('CNB 镜像版本与已确认的更新版本不一致，请重新检查更新。');
  }
  const history = includeHistory && compareVersions(release.tag_name, currentVersion) > 0
    ? await collectReleaseHistory({ release, currentVersion, fetchImpl, timeoutMs, adapter, stableBranch, distributionMode })
    : { releases: [], historyIncomplete: false };
  return normalizeRelease({ release, adapter, currentVersion, distributionMode, history });
}

module.exports = {
  LATEST_RELEASE_API,
  RELEASES_API,
  RELEASES_URL,
  UPDATE_PROVIDER_CONFIG,
  checkForUpdates,
  checkCnbForUpdates,
  collectReleaseHistory,
  compareVersions,
  createCnbAdapter,
  createGithubAdapter,
  displayRelease,
  isStableRelease,
  isMacRelease,
  selectCheckedRelease,
  normalizeRelease,
  releaseFromCnbRedirect,
  resolveCnbConfig,
  selectReleaseAsset
};
