'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { readAndVerifyReleaseManifest } = require('./tool-integrity');
const { compareVersions, isMacRelease } = require('./update-checker');
const { downloadFile, fetchDigestSidecar, hashFile, normalizeDigest, resolveDownloadTrust,
  writeUpdateSuccessNotice, waitForUpdaterStart } = require('./update-manager');

const execute = promisify(execFile);

function validateMacZipListing(listing, linkTargets) {
  const blocks = String(listing).replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const entries = new Set();
  const links = new Map();
  const unreadLinks = [];
  const canonical = name => name.normalize('NFD').toLowerCase();
  for (const block of blocks) {
    const fields = Object.fromEntries(block.split('\n').map(line => {
      const separator = line.indexOf(' = ');
      return separator < 0 ? [] : [line.slice(0, separator), line.slice(separator + 3)];
    }).filter(pair => pair.length));
    const name = fields.Path;
    const normalized = name?.replace(/\/$/, '');
    if (!normalized || normalized.includes('\\') || normalized.includes('\0') ||
        normalized.split('/').some(part => !part || part === '..' || part === '.')) {
      throw new Error('Mac ZIP 包含不安全的路径。');
    }
    if (name !== 'Hamster Archiver.app' && !name.startsWith('Hamster Archiver.app/')) {
      throw new Error('Mac ZIP 必须只包含 Hamster Archiver.app。');
    }
    const identity = canonical(normalized);
    if (entries.has(identity)) throw new Error('Mac ZIP 包含重复路径。');
    entries.add(identity);
    if (/(?:^|\s)l[rwxstST-]{9}/.test(fields.Attributes || '') && !('Symbolic Link' in fields)) {
      if (!/^\d+$/.test(fields.Size || '') || Number(fields.Size) < 1 || Number(fields.Size) > 4096) {
        throw new Error('Mac ZIP 包含无效的链接内容。');
      }
      unreadLinks.push({ name, size: Number(fields.Size) });
      fields['Symbolic Link'] = linkTargets?.get(name);
    }
    for (const key of ['Symbolic Link', 'Hard Link']) {
      if (!(key in fields)) continue;
      const link = fields[key];
      links.set(identity, link);
      if (link === undefined && linkTargets === undefined) continue;
      if (typeof link !== 'string' || !link || link.startsWith('/') || link.includes('\\') || link.includes('\0')) {
        throw new Error('Mac ZIP 包含指向应用包外的链接。');
      }
    }
  }
  for (const link of links.keys()) {
    if ([...entries].some(name => name.startsWith(`${link}/`))) throw new Error('Mac ZIP 不能在链接目录下写入文件。');
  }
  // Resolve each link before processing a following '..', as the filesystem
  // does. Normalizing the target first would hide escapes through other links.
  function resolve(components, ancestors = new Set()) {
    let resolved = [];
    for (const component of components) {
      if (!component || component === '.') continue;
      if (component === '..') {
        if (resolved.length <= 1) throw new Error('Mac ZIP 包含指向应用包外的链接。');
        resolved.pop();
        continue;
      }
      resolved.push(canonical(component));
      if (resolved[0] !== canonical('Hamster Archiver.app')) throw new Error('Mac ZIP 包含指向应用包外的链接。');
      const identity = resolved.join('/');
      if (links.has(identity) && links.get(identity) !== undefined) {
        if (ancestors.has(identity) || ancestors.size >= 256) throw new Error('Mac ZIP 包含无效的链接内容。');
        resolved = resolve([...resolved.slice(0, -1), ...links.get(identity).split('/')], new Set([...ancestors, identity]));
      }
    }
    if (!resolved.length) throw new Error('Mac ZIP 包含指向应用包外的链接。');
    return resolved;
  }
  for (const [link, target] of links) {
    if (target !== undefined) resolve(link.split('/'));
  }
  if (!entries.size) throw new Error('Mac ZIP 没有有效的应用内容。');
  return unreadLinks;
}

function macBundleFromResources(resources) {
  const bundle = path.resolve(resources, '..', '..');
  if (!bundle.endsWith('.app') || path.resolve(resources) !== path.join(bundle, 'Contents', 'Resources')) {
    throw new Error('无法确定 Mac 应用位置，请从可写目录中的应用副本启动。');
  }
  return bundle;
}

async function validateMacBundle(bundle, expectedVersion, executeImpl = execute) {
  const info = await fs.lstat(bundle);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Mac 更新包的应用目录无效。');
  const resources = path.join(bundle, 'Contents', 'Resources');
  const manifest = await readAndVerifyReleaseManifest(resources);
  if (manifest.platform !== 'darwin-universal' || manifest.version !== expectedVersion || !/^[a-f0-9]{40}$/.test(manifest.commit || '')) {
    throw new Error('Mac 更新包版本或平台与已选择的发行不一致。');
  }
  const metadata = JSON.parse(await fs.readFile(path.join(resources, 'app', 'package.json'), 'utf8'));
  if (metadata.version !== expectedVersion) throw new Error('Mac 应用版本与发行清单不一致。');
  const identity = await executeImpl('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')]);
  if (String(identity.stdout).trim() !== 'com.carlosz.hamsterarchiver') throw new Error('Mac 应用标识不匹配。');
  await executeImpl('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  return manifest;
}

async function prepareMacUpdate({ applicationRoot, userDataDirectory, currentVersion, release, fetchImpl,
  onProgress = () => {}, rollbackConfirmed = false, packagePath = '', sevenZipPath = '' },
  { platform = process.platform, executeImpl = execute } = {}) {
  if (platform !== 'darwin') throw new Error('Mac 更新安装需要 macOS。');
  const version = release?.latestVersion;
  if (!isMacRelease({ tag_name: `v${version}`, prerelease: /-beta\.mac\.\d+$/.test(version || ''), target_commitish: 'main' })) {
    throw new Error('请选择有效的 Mac 发行版本。');
  }
  const rollback = compareVersions(version, currentVersion) < 0;
  if (version === currentVersion || (rollback && !rollbackConfirmed)) throw new Error('回退需要先确认数据兼容性风险。');
  const applicationBundle = macBundleFromResources(applicationRoot);
  if (applicationBundle.startsWith('/Volumes/') || applicationBundle.includes('/AppTranslocation/')) {
    throw new Error('请先将应用移到“应用程序”或其他可写目录，再安装更新。');
  }
  const targetInfo = await fs.lstat(applicationBundle);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink() || await fs.realpath(applicationBundle) !== applicationBundle) {
    throw new Error('Mac 应用位置包含符号链接，已停止自动替换。');
  }
  await fs.access(path.dirname(applicationBundle), require('node:fs').constants.W_OK);
  const dataRoot = path.resolve(userDataDirectory);
  if (dataRoot === applicationBundle || dataRoot.startsWith(`${applicationBundle}${path.sep}`)) throw new Error('用户资料不能位于将被替换的应用包内。');
  const trust = packagePath ? null : resolveDownloadTrust(release);
  if (trust && trust.provider !== 'github') throw new Error('Mac 更新仅使用 GitHub 发行。');
  const zip = packagePath && path.extname(packagePath).toLowerCase() === '.zip';
  const expectedName = `HamsterArchiver-v${version}-mac-universal.${zip ? 'zip' : 'dmg'}`;
  if (release.asset?.name !== expectedName || (!packagePath && !release.asset.downloadUrl)) throw new Error('这个发行没有匹配的 Mac DMG。');
  const expectedDigest = normalizeDigest(release.asset.digest) || await fetchDigestSidecar(release.asset.digestDownloadUrl, fetchImpl, trust);
  if (!expectedDigest) throw new Error('Release 缺少 SHA256 摘要，已停止更新。');
  const runRoot = path.join(dataRoot, 'updates', `mac-${version}-${crypto.randomUUID()}`);
  const archivePath = path.join(runRoot, expectedName);
  const mountRoot = path.join(runRoot, 'mount');
  const packageRoot = path.join(runRoot, 'Hamster Archiver.app');
  let mounted = false;
  try {
    await fs.mkdir(mountRoot, { recursive: true });
    if (packagePath) {
      onProgress({ stage: 'copying', percentage: 0 });
      await fs.copyFile(packagePath, archivePath);
    } else await downloadFile(release.asset.downloadUrl, archivePath, fetchImpl, onProgress, trust);
    onProgress({ stage: 'verifying', percentage: 100 });
    if (await hashFile(archivePath) !== expectedDigest) throw new Error('更新包 SHA256 校验失败，文件可能已损坏。');
    if (zip) {
      if (!sevenZipPath) throw new Error('Mac ZIP 更新需要内置的 7-Zip 工具。');
      const listing = await executeImpl(sevenZipPath, ['l', '-slt', '-ba', archivePath], { maxBuffer: 32 * 1024 * 1024 });
      const links = validateMacZipListing(listing.stdout);
      const targets = new Map();
      for (const link of links) {
        const content = await executeImpl(sevenZipPath, ['x', '-so', archivePath, link.name], { maxBuffer: 4096 });
        if (Buffer.byteLength(String(content.stdout)) !== link.size) throw new Error('Mac ZIP 包含无效的链接内容。');
        targets.set(link.name, String(content.stdout));
      }
      validateMacZipListing(listing.stdout, targets);
      await executeImpl('/usr/bin/ditto', ['-x', '-k', archivePath, mountRoot]);
    } else {
      await executeImpl('/usr/bin/hdiutil', ['verify', archivePath]);
      await executeImpl('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountRoot, archivePath]);
      mounted = true;
    }
    await validateMacBundle(path.join(mountRoot, 'Hamster Archiver.app'), version, executeImpl);
    await executeImpl('/usr/bin/ditto', [path.join(mountRoot, 'Hamster Archiver.app'), packageRoot]);
    const manifest = await validateMacBundle(packageRoot, version, executeImpl);
    if (mounted) {
      await executeImpl('/usr/bin/hdiutil', ['detach', mountRoot]);
      mounted = false;
    }
    onProgress({ stage: 'prepared', percentage: 100 });
    return { runRoot, packageRoot, archivePath, applicationBundle, version, currentVersion, rollback,
      targetIdentity: { dev: targetInfo.dev, ino: targetInfo.ino }, source: packagePath ? 'package' : 'automatic',
      ...(packagePath ? {} : { provider: 'github' }),
      digest: expectedDigest, releaseUrl: release.releaseUrl, releaseNotes: packagePath ? manifest.releaseNotes : release.releaseNotes };
  } catch (error) {
    // A mount that could not detach is preserved, never recursively removed.
    if (mounted) {
      try { await executeImpl('/usr/bin/hdiutil', ['detach', mountRoot]); mounted = false; } catch {}
    }
    if (!mounted) await fs.rm(runRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function prepareLocalMacUpdate(options, dependencies = {}) {
  if ((dependencies.platform || process.platform) !== 'darwin') throw new Error('Mac 更新安装需要 macOS。');
  const packagePath = path.resolve(String(options.packagePath || '').trim());
  const match = /^HamsterArchiver-v(\d+\.\d+\.\d+(?:-beta\.mac\.[1-9]\d*)?)-mac-universal\.(dmg|zip)$/.exec(path.basename(packagePath));
  if (!match) throw new Error('请选择文件名符合 Mac 发行规则的 DMG 或 ZIP 更新包。');
  const version = match[1];
  if (compareVersions(version, options.currentVersion) <= 0) throw new Error('本地更新包版本必须高于当前版本。');
  const info = await fs.lstat(packagePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('所选更新包不是文件。');
  let sidecar;
  try { sidecar = await fs.readFile(`${packagePath}.sha256`, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('请将更新包与同名 .sha256 校验文件放在同一目录。');
    throw error;
  }
  const digestMatch = /^([a-f0-9]{64})\s+\*?([^\r\n]+)\s*$/i.exec(sidecar.trim());
  if (!digestMatch || digestMatch[2] !== path.basename(packagePath)) throw new Error('本地更新包的 SHA256 校验文件无效。');
  return prepareMacUpdate({ ...options, packagePath, release: {
    latestVersion: version, asset: { name: path.basename(packagePath), digest: digestMatch[1] }
  } }, dependencies);
}

async function launchMacUpdate({ prepared, targetPid }, { spawnImpl = spawn } = {}) {
  const script = path.join(prepared.runRoot, 'mac-update-worker.js');
  await fs.copyFile(path.join(__dirname, 'mac-update-worker.js'), script);
  await writeUpdateSuccessNotice(prepared);
  const control = { ...prepared, targetPid };
  const controlFile = path.join(prepared.runRoot, 'control.json');
  await fs.writeFile(controlFile, JSON.stringify(control), { mode: 0o600 });
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const child = spawnImpl(process.execPath, [script, controlFile], {
    detached: true, stdio: 'ignore', env: environment, cwd: prepared.runRoot
  });
  await waitForUpdaterStart(child, path.join(prepared.runRoot, 'started.json'));
  child.unref();
  return { runRoot: prepared.runRoot, updaterPid: child.pid };
}

module.exports = { macBundleFromResources, validateMacBundle, validateMacZipListing, prepareMacUpdate, prepareLocalMacUpdate, launchMacUpdate };
