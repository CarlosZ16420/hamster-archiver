'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { checkForUpdates, compareVersions, selectCheckedRelease } = require('../src/core/update-checker');
const { validateMacBundle, validateMacZipListing, macBundleFromResources, prepareMacUpdate, prepareLocalMacUpdate } = require('../src/core/mac-update-manager');
const { applyMacUpdate } = require('../src/core/mac-update-worker');
const { createFileIntegrityEntries } = require('../src/core/tool-integrity');

function release(version, options = {}) {
  const name = `HamsterArchiver-v${version}-mac-universal.dmg`;
  return { tag_name: `v${version}`, prerelease: true, target_commitish: 'main',
    html_url: `https://github.com/CarlosZ16420/hamster-archiver/releases/tag/v${version}`,
    body: '## 中文\n- 测试更新。\n## English\n- Test update.',
    assets: [{ name, browser_download_url: `https://github.com/release/${name}`, digest: `sha256:${'a'.repeat(64)}` }], ...options };
}

test('Mac lists older Betas even when already current and sorts Beta numbers numerically', async () => {
  const payload = [release('4.8.0-beta.mac.2'), release('4.8.0-beta.mac.10'),
    release('4.8.0-beta.mac.11', { draft: true }), release('4.8.1-beta.other.1'),
    release('4.8.4', { prerelease: false, assets: [] })];
  const result = await checkForUpdates({ currentVersion: '4.8.0-beta.mac.10', distributionMode: 'mac', includeHistory: true,
    fetchImpl: async () => ({ ok: true, json: async () => payload }) });
  assert.equal(result.updateAvailable, false);
  assert.deepEqual(result.releases.map(item => item.version), ['4.8.0-beta.mac.10', '4.8.0-beta.mac.2']);
  const selected = selectCheckedRelease(result, '4.8.0-beta.mac.2');
  assert.equal(selected.rollback, true);
  assert.match(selected.asset.name, /beta\.mac\.2/);
  assert.match(selected.releaseNotes['en-US'], /Test update/);
  assert.throws(() => selectCheckedRelease(result, '4.8.0-beta.mac.1'), /重新检查/);
  assert.throws(() => selectCheckedRelease(result, '4.8.0-beta.mac.10'), /其他版本/);
});

test('Mac pagination retains validated choices on a later history failure without CNB fallback', async () => {
  const payload = Array.from({ length: 100 }, (_, i) => release(`4.8.0-beta.mac.${i + 1}`));
  let calls = 0;
  const result = await checkForUpdates({ currentVersion: '4.8.0-beta.mac.2', distributionMode: 'mac', includeHistory: true,
    fetchImpl: async url => {
      assert.match(url, /api.github.com/);
      if (++calls > 1) throw new Error('network failure');
      return { ok: true, json: async () => payload };
    } });
  assert.equal(result.latestVersion, '4.8.0-beta.mac.100');
  assert.equal(result.historyIncomplete, true);
  assert.equal(calls, 2);
});

test('Mac rejects incomplete uploads and does not fall back to Windows mirrors on a network failure', async () => {
  const result = await checkForUpdates({ currentVersion: '4.8.0-beta.mac.1', distributionMode: 'mac',
    fetchImpl: async () => ({ ok: true, json: async () => [release('4.8.0-beta.mac.2', { assets: [{
      name: 'HamsterArchiver-v4.8.0-beta.mac.2-mac-universal.dmg', browser_download_url: 'https://github.com/file'
    }] })] }) });
  assert.equal(result.installable, false);
  let calls = 0;
  await assert.rejects(checkForUpdates({ currentVersion: '4.8.0-beta.mac.1', distributionMode: 'mac',
    fetchImpl: async () => { calls++; throw new Error('offline'); } }), /offline/);
  assert.equal(calls, 1);
  assert.equal(compareVersions('4.8.0-beta.mac.10', '4.8.0-beta.mac.2'), 1);
  assert.equal(compareVersions('4.8.0', '4.8.0-beta.mac.99'), 1);
});

test('Windows choices retain the stable-only rule and prohibit downgrades', () => {
  const checked = { distributionMode: 'installed', currentVersion: '4.8.2', latestVersion: '4.8.4',
    asset: { downloadUrl: 'https://github.com/latest' }, releases: [
      { version: '4.8.3', asset: { downloadUrl: 'https://github.com/previous' } },
      { version: '4.8.1', asset: { downloadUrl: 'https://github.com/older' } }
    ] };
  assert.equal(selectCheckedRelease(checked, '4.8.3').latestVersion, '4.8.3');
  assert.throws(() => selectCheckedRelease(checked, '4.8.1'), /其他版本/);
});

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mac-update-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runRoot = path.join(root, 'data', 'updates', 'mac-candidate');
  const applicationBundle = path.join(root, 'Applications', 'Hamster Archiver.app');
  const packageRoot = path.join(runRoot, 'Hamster Archiver.app');
  await fs.mkdir(applicationBundle, { recursive: true });
  await fs.writeFile(path.join(applicationBundle, 'old.txt'), 'original app');
  await fs.mkdir(path.join(packageRoot, 'Contents', 'Resources', 'app'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'Contents', 'Resources', 'app', 'package.json'), JSON.stringify({ version: '4.8.0-beta.mac.2' }));
  await fs.writeFile(path.join(root, 'data', 'settings.json'), 'user data must stay');
  const info = await fs.lstat(applicationBundle);
  const control = { runRoot, applicationBundle, packageRoot, targetPid: 123456,
    version: '4.8.0-beta.mac.2', targetIdentity: { dev: info.dev, ino: info.ino } };
  const calls = [];
  const executeImpl = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command.endsWith('ditto')) await fs.cp(args[0], args[1], { recursive: true, errorOnExist: true });
    if (command.endsWith('Hamster Archiver')) return { stdout: 'HAMSTER_STARTUP_INTEGRITY_TEST_OK' };
    return { stdout: '' };
  };
  return { root, control, calls, executeImpl };
}

test('Mac replacement verifies a fresh profile, preserves data and retains the original app', async t => {
  const f = await fixture(t);
  await applyMacUpdate(f.control, { alive: () => false, executeImpl: f.executeImpl });
  assert.equal(await fs.readFile(path.join(f.root, 'data', 'settings.json'), 'utf8'), 'user data must stay');
  const validation = f.calls.find(call => call.command.endsWith('Hamster Archiver'));
  assert.equal(validation.options.env.HAMSTER_STARTUP_INTEGRITY_TEST, '1');
  assert.equal(validation.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(validation.options.env.HAMSTER_SMOKE_USER_DATA_DIR, path.join(f.control.runRoot, 'validation-profile'));
  const completed = JSON.parse(await fs.readFile(path.join(f.control.runRoot, 'completed.json'), 'utf8'));
  assert.equal(await fs.readFile(path.join(completed.backup, 'old.txt'), 'utf8'), 'original app');
  assert.equal(f.calls.at(-1).command, '/usr/bin/open');
});

test('failed isolated Mac startup leaves the installed application and user data untouched', async t => {
  const f = await fixture(t);
  await assert.rejects(applyMacUpdate(f.control, { alive: () => false, executeImpl: async (...args) => {
    if (args[0].endsWith('Hamster Archiver')) throw new Error('invalid new app');
    return f.executeImpl(...args);
  } }), /invalid new app/);
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
  assert.equal(await fs.readFile(path.join(f.root, 'data', 'settings.json'), 'utf8'), 'user data must stay');
  assert.match(await fs.readFile(path.join(f.control.runRoot, 'failed.json'), 'utf8'), /invalid new app/);
});

test('a Mac app that has not exited is never replaced or killed', async t => {
  const f = await fixture(t);
  await assert.rejects(applyMacUpdate(f.control, { alive: () => true, exitTimeoutMs: 0, executeImpl: f.executeImpl }), /did not exit safely/);
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
});

test('Mac replacement refuses a changed target and a staged app with another version', async t => {
  const f = await fixture(t);
  await assert.rejects(applyMacUpdate({ ...f.control, targetIdentity: { dev: -1, ino: -1 } }, { alive: () => false, executeImpl: f.executeImpl }), /changed after confirmation/);
  await fs.writeFile(path.join(f.control.packageRoot, 'Contents', 'Resources', 'app', 'package.json'), JSON.stringify({ version: '4.8.0-beta.mac.9' }));
  await assert.rejects(applyMacUpdate(f.control, { alive: () => false, executeImpl: f.executeImpl }), /version changed/);
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
});

test('Mac bundle checks integrity, platform, version, identity and signature before replacement', async t => {
  const f = await fixture(t);
  const resources = path.join(f.control.packageRoot, 'Contents', 'Resources');
  const manifest = { schemaVersion: 2, platform: 'darwin-universal', commit: 'b'.repeat(40), version: f.control.version,
    integrity: { files: await createFileIntegrityEntries(resources, ['app/package.json']) } };
  await fs.writeFile(path.join(resources, 'release-manifest.json'), JSON.stringify(manifest));
  let signatureChecked = false;
  const command = async name => {
    if (name.endsWith('codesign')) signatureChecked = true;
    return { stdout: 'com.carlosz.hamsterarchiver\n' };
  };
  await validateMacBundle(f.control.packageRoot, f.control.version, command);
  assert.equal(signatureChecked, true);
  assert.equal(macBundleFromResources(resources), f.control.packageRoot);
  assert.throws(() => macBundleFromResources(f.root), /无法确定/);
  await assert.rejects(validateMacBundle(f.control.packageRoot, '4.8.0-beta.mac.3', command), /版本或平台/);
  await fs.writeFile(path.join(resources, 'app', 'package.json'), '{}');
  await assert.rejects(validateMacBundle(f.control.packageRoot, f.control.version, command), /完整性|校验|大小/);
});

test('Mac rollback requires explicit confirmation before downloads or filesystem changes', async () => {
  await assert.rejects(prepareMacUpdate({ currentVersion: '4.8.0-beta.mac.10',
    release: { latestVersion: '4.8.0-beta.mac.2' } }, { platform: 'darwin' }), /先确认/);
});

test('Mac installer downloads, hashes and stages only the selected verified DMG', async t => {
  const f = await fixture(t);
  const resources = path.join(f.control.packageRoot, 'Contents', 'Resources');
  await fs.writeFile(path.join(resources, 'release-manifest.json'), JSON.stringify({ schemaVersion: 2,
    platform: 'darwin-universal', version: f.control.version, commit: 'c'.repeat(40),
    integrity: { files: await createFileIntegrityEntries(resources, ['app/package.json']) } }));
  const content = Buffer.from('verified DMG fixture');
  const digest = require('node:crypto').createHash('sha256').update(content).digest('hex');
  const name = `HamsterArchiver-v${f.control.version}-mac-universal.dmg`;
  const calls = [];
  const prepared = await prepareMacUpdate({ applicationRoot: path.join(f.control.applicationBundle, 'Contents', 'Resources'),
    userDataDirectory: path.join(f.root, 'profile'), currentVersion: '4.8.0-beta.mac.1',
    release: { latestVersion: f.control.version, provider: 'github', asset: { name,
      downloadUrl: 'https://github.com/fixture.dmg', digest: `sha256:${digest}` } },
    fetchImpl: async () => new Response(content)
  }, { platform: 'darwin', executeImpl: async (command, args) => {
    calls.push([command, args]);
    if (command.endsWith('hdiutil') && args[0] === 'attach') {
      const mount = args[args.indexOf('-mountpoint') + 1];
      await fs.cp(f.control.packageRoot, path.join(mount, 'Hamster Archiver.app'), { recursive: true });
    }
    if (command.endsWith('ditto')) await fs.cp(args[0], args[1], { recursive: true });
    return { stdout: command.endsWith('plutil') ? 'com.carlosz.hamsterarchiver' : '' };
  } });
  assert.equal(prepared.digest, digest);
  assert.equal(prepared.version, f.control.version);
  assert.equal(prepared.targetIdentity.ino, f.control.targetIdentity.ino);
  assert.equal(calls.filter(([name]) => name.endsWith('codesign')).length, 2);
  assert.equal(calls.at(-1)[1][0], 'detach');
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
});

test('Mac refuses to replace an app reopened during isolated validation', async t => {
  const f = await fixture(t);
  await assert.rejects(applyMacUpdate(f.control, { alive: () => false, executeImpl: async (command, ...args) => {
    if (command.endsWith('/ps')) return { stdout: `42 ${path.join(f.control.applicationBundle, 'Contents', 'MacOS', 'Hamster Archiver')}` };
    return f.executeImpl(command, ...args);
  } }), /reopened during/);
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
});

test('an ambiguous Mac launch failure preserves the newly installed and previous apps', async t => {
  const f = await fixture(t);
  await assert.rejects(applyMacUpdate(f.control, { alive: () => false, executeImpl: async (command, ...args) => {
    if (command.endsWith('/open')) throw new Error('Launch Services failed after request');
    return f.executeImpl(command, ...args);
  } }), /Launch Services/);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.control.applicationBundle, 'Contents', 'Resources', 'app', 'package.json'), 'utf8')).version, f.control.version);
  const failure = JSON.parse(await fs.readFile(path.join(f.control.runRoot, 'failed.json'), 'utf8'));
  assert.equal(await fs.readFile(path.join(failure.backup, 'old.txt'), 'utf8'), 'original app');
  assert.equal(await fs.readFile(path.join(f.root, 'data', 'settings.json'), 'utf8'), 'user data must stay');
});

test('real Mac DMG staging and application replacement preserve an isolated Warehouse', {
  skip: process.platform !== 'darwin' || !process.env.HAMSTER_MAC_UPDATE_TEST_BUNDLE
}, async t => {
  const execute = require('node:util').promisify(require('node:child_process').execFile);
  const bundle = await fs.realpath(process.env.HAMSTER_MAC_UPDATE_TEST_BUNDLE);
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'Contents', 'Resources', 'release-manifest.json'), 'utf8'));
  const directory = path.resolve(bundle, '..', '..');
  const dmg = path.join(directory, `HamsterArchiver-v${manifest.version}-mac-universal.dmg`);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mac-native-update-'));
  const root = await fs.realpath(temporary);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installed = path.join(root, 'Applications', 'Hamster Archiver.app');
  const data = path.join(root, 'profile');
  await fs.mkdir(path.dirname(installed), { recursive: true });
  await execute('/usr/bin/ditto', [bundle, installed]);
  await fs.mkdir(data);
  await fs.writeFile(path.join(data, 'warehouse-fixture.json'), '{"records":3}');
  const digest = await require('../src/core/update-manager').hashFile(dmg);
  const prepared = await prepareMacUpdate({ applicationRoot: path.join(installed, 'Contents', 'Resources'),
    userDataDirectory: data, currentVersion: '0.0.0', release: {
      latestVersion: manifest.version, provider: 'github', asset: { name: path.basename(dmg),
        downloadUrl: 'https://github.com/isolated-native-fixture.dmg', digest: `sha256:${digest}` }
    }, fetchImpl: async () => new Response(await fs.readFile(dmg)) });
  let opened = false;
  await applyMacUpdate({ ...prepared, targetPid: process.pid }, {
    alive: () => false, executeImpl: async (command, args, options) => {
      if (command === '/usr/bin/open') { opened = true; return { stdout: '' }; }
      return execute(command, args, options);
    }
  });
  assert.equal(opened, true);
  assert.equal(await fs.readFile(path.join(data, 'warehouse-fixture.json'), 'utf8'), '{"records":3}');
  await validateMacBundle(installed, manifest.version);
  assert.equal(JSON.parse(await fs.readFile(path.join(prepared.runRoot, 'completed.json'), 'utf8')).version, manifest.version);
});

test('Mac DMG preparation stays isolated from Windows format and mirror fallback', async () => {
  const { prepareOnlineUpdate } = require('../src/core/update-manager');
  const chosen = { distributionMode: 'mac', provider: 'github', latestVersion: '4.8.4-beta.mac.1',
    asset: { name: 'HamsterArchiver-v4.8.4-beta.mac.1-mac-universal.dmg',
      downloadUrl: 'https://github.com/fixture.dmg', digest: 'sha256:' + 'a'.repeat(64) } };
  let mirrorCalls = 0;
  const checkCnbImpl = async () => { mirrorCalls++; throw new Error('Windows mirror must not be requested'); };
  const prepared = await prepareOnlineUpdate({ release: chosen }, { checkCnbImpl,
    prepareImpl: async options => {
      assert.equal(options.release, chosen);
      assert.equal(options.confirmedDigest, 'a'.repeat(64));
      return { digest: 'a'.repeat(64) };
    } });
  assert.equal(prepared.release, chosen);
  await assert.rejects(prepareOnlineUpdate({ release: chosen }, { checkCnbImpl,
    prepareImpl: async () => { throw Object.assign(new Error('Mac offline'), { code: 'UPDATE_DOWNLOAD_NETWORK_ERROR' }); }
  }), /Mac offline/);
  assert.equal(mirrorCalls, 0);
});

test('local Mac ZIP listing permits app-contained framework links and rejects escaping writes', () => {
  const listing = names => names.map(name => `Path = ${name}`).join('\n\n');
  const link = 'Path = Hamster Archiver.app/Contents/Frameworks/Example.framework/Versions/Current\nSymbolic Link = A';
  assert.doesNotThrow(() => validateMacZipListing(listing(['Hamster Archiver.app',
    'Hamster Archiver.app/Contents/Frameworks/Example.framework/Versions/A/file']) + '\n\n' + link));
  for (const name of ['../outside', '/absolute', 'Hamster Archiver.app/../outside', 'Other.app/file']) {
    assert.throws(() => validateMacZipListing(listing([name])));
  }
  assert.throws(() => validateMacZipListing(listing(['Hamster Archiver.app/file', 'Hamster Archiver.app/file'])), /重复/);
  assert.throws(() => validateMacZipListing('Path = Hamster Archiver.app/link\nSymbolic Link = ../../outside'), /应用包外/);
  assert.throws(() => validateMacZipListing(link + '\n\n' + listing([
    'Hamster Archiver.app/Contents/Frameworks/Example.framework/Versions/Current/file'])), /链接目录/);
  const nativeName = 'Hamster Archiver.app/Contents/Frameworks/Example.framework/Versions/Current';
  const native = `Path = ${nativeName}\nAttributes =  lrwxrwxrwx\nSize = 1`;
  assert.deepEqual(validateMacZipListing(native), [{ name: nativeName, size: 1 }]);
  assert.doesNotThrow(() => validateMacZipListing(native, new Map([[nativeName, 'A']])));
  assert.throws(() => validateMacZipListing(native, new Map()), /应用包外/);
  assert.throws(() => validateMacZipListing(native, new Map([[nativeName, '/outside']])), /应用包外/);
});

test('Mac ZIP resolves link chains before parent traversal and rejects filesystem aliases', () => {
  const root = 'Hamster Archiver.app';
  const entry = name => `Path = ${root}/${name}`;
  const link = (name, target) => `${entry(name)}\nSymbolic Link = ${target}`;
  assert.throws(() => validateMacZipListing([link('pivot', '.'), link('escape', 'pivot/../outside')].join('\n\n')), /应用包外/);
  assert.throws(() => validateMacZipListing([link('Pivot', '.'), entry('pivot/file')].join('\n\n')), /链接目录/);
  assert.throws(() => validateMacZipListing([link('dir/link', '.'), entry('dir//link/file')].join('\n\n')), /不安全/);
  assert.throws(() => validateMacZipListing([link('caf\u00e9', '.'), entry('cafe\u0301/file')].join('\n\n')), /链接目录/);
  assert.throws(() => validateMacZipListing([entry('File'), entry('file')].join('\n\n')), /重复/);
  assert.throws(() => validateMacZipListing([link('a', 'b'), link('b', 'a')].join('\n\n')), /无效的链接/);
  assert.throws(() => validateMacZipListing(`Path = ${root}\nSymbolic Link = .`), /应用包外/);
  assert.doesNotThrow(() => validateMacZipListing([link('dir/link', '../file'), entry('file')].join('\n\n')));
  assert.doesNotThrow(() => validateMacZipListing([
    link('Framework/Versions/Current', 'A'), link('Framework/Resources', 'Versions/Current/Resources'),
    entry('Framework/Versions/A/Resources/file')
  ].join('\n\n')));
  const nativeNames = ['pivot', 'escape'].map(name => `${root}/${name}`);
  const native = nativeNames.map((name, index) => `Path = ${name}\nAttributes =  lrwxrwxrwx\nSize = ${index ? 16 : 1}`).join('\n\n');
  assert.equal(validateMacZipListing(native).length, 2);
  assert.throws(() => validateMacZipListing(native, new Map([
    [nativeNames[0], '.'], [nativeNames[1], 'pivot/../outside']
  ])), /应用包外/);
});

for (const extension of ['dmg', 'zip']) test(`local Mac ${extension.toUpperCase()} verifies its sidecar and bundle without networking or replacing user data`, async t => {
  const f = await fixture(t);
  const resources = path.join(f.control.packageRoot, 'Contents', 'Resources');
  const releaseNotes = { 'zh-CN': ['本地更新'], 'en-US': ['Local update'] };
  await fs.writeFile(path.join(resources, 'release-manifest.json'), JSON.stringify({ schemaVersion: 2,
    platform: 'darwin-universal', version: f.control.version, commit: 'c'.repeat(40), releaseNotes,
    integrity: { files: await createFileIntegrityEntries(resources, ['app/package.json']) } }));
  const packagePath = path.join(f.root, `HamsterArchiver-v${f.control.version}-mac-universal.${extension}`);
  await fs.writeFile(packagePath, 'local Mac package fixture');
  const digest = await require('../src/core/update-manager').hashFile(packagePath);
  await fs.writeFile(`${packagePath}.sha256`, `${digest} *${path.basename(packagePath)}\n`);
  const calls = [];
  const options = { applicationRoot: path.join(f.control.applicationBundle, 'Contents', 'Resources'),
    userDataDirectory: path.join(f.root, 'profile'), currentVersion: '4.8.0-beta.mac.1',
    packagePath, sevenZipPath: '/bundled/7zz', fetchImpl: () => { throw new Error('Local updating must stay offline'); } };
  const dependencies = { platform: 'darwin', executeImpl: async (command, args) => {
    calls.push([command, args]);
    if (command === '/bundled/7zz') return { stdout: 'Path = Hamster Archiver.app/Contents/Resources/app/package.json\n' };
    if (command.endsWith('hdiutil') && args[0] === 'attach') {
      await fs.cp(f.control.packageRoot, path.join(args[args.indexOf('-mountpoint') + 1], 'Hamster Archiver.app'), { recursive: true });
    }
    if (command.endsWith('ditto')) {
      if (args[0] === '-x') await fs.cp(f.control.packageRoot, path.join(args.at(-1), 'Hamster Archiver.app'), { recursive: true });
      else await fs.cp(args[0], args[1], { recursive: true });
    }
    return { stdout: command.endsWith('plutil') ? 'com.carlosz.hamsterarchiver' : '' };
  } };
  const prepared = await prepareLocalMacUpdate(options, dependencies);
  assert.equal(prepared.source, 'package');
  assert.equal(prepared.digest, digest);
  assert.deepEqual(prepared.releaseNotes, releaseNotes);
  assert.equal(await fs.readFile(path.join(f.control.applicationBundle, 'old.txt'), 'utf8'), 'original app');
  assert.equal(await fs.readFile(packagePath, 'utf8'), 'local Mac package fixture');
  assert.equal(calls.filter(([command]) => command.endsWith('codesign')).length, 2);
  calls.length = 0;
  await fs.writeFile(`${packagePath}.sha256`, `${'0'.repeat(64)} *${path.basename(packagePath)}\n`);
  await assert.rejects(prepareLocalMacUpdate(options, dependencies), /SHA256 校验失败/);
  assert.equal(calls.length, 0, 'A damaged archive must never be opened or extracted');
  await fs.unlink(`${packagePath}.sha256`);
  await assert.rejects(prepareLocalMacUpdate(options, dependencies), /同一目录/);
  await assert.rejects(prepareLocalMacUpdate({ ...options, currentVersion: f.control.version }, dependencies), /高于/);
  await assert.rejects(prepareLocalMacUpdate({ ...options, packagePath: path.join(f.root, 'renamed.zip') }, dependencies), /文件名/);
});

test('real Mac ZIP staging uses the packaged archive and verified framework links', {
  skip: process.platform !== 'darwin' || !process.env.HAMSTER_MAC_UPDATE_TEST_BUNDLE
}, async t => {
  const execute = require('node:util').promisify(require('node:child_process').execFile);
  const bundle = await fs.realpath(process.env.HAMSTER_MAC_UPDATE_TEST_BUNDLE);
  const manifest = JSON.parse(await fs.readFile(path.join(bundle, 'Contents', 'Resources', 'release-manifest.json'), 'utf8'));
  const packagePath = path.join(path.resolve(bundle, '..', '..'), `HamsterArchiver-v${manifest.version}-mac-universal.zip`);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mac-native-zip-update-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installed = path.join(root, 'Applications', 'Hamster Archiver.app');
  await fs.mkdir(path.dirname(installed), { recursive: true });
  await execute('/usr/bin/ditto', [bundle, installed]);
  const userDataDirectory = path.join(root, 'profile');
  await fs.mkdir(userDataDirectory);
  await fs.writeFile(path.join(userDataDirectory, 'settings.json'), '{"example":true}');
  const prepared = await prepareLocalMacUpdate({ applicationRoot: path.join(installed, 'Contents', 'Resources'),
    userDataDirectory, currentVersion: '0.0.0', packagePath,
    sevenZipPath: path.join(installed, 'Contents', 'Resources', 'tools', '7zip', '7zz') });
  await validateMacBundle(prepared.packageRoot, manifest.version);
  assert.equal(prepared.source, 'package');
  assert.equal(await fs.readFile(path.join(userDataDirectory, 'settings.json'), 'utf8'), '{"example":true}');
});

test('Mac local package IPC opens the DMG/ZIP picker and requires restart confirmation even for an installed app', async () => {
  const main = await fs.readFile(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const start = main.indexOf('async function runLocalPackageUpdate(');
  const source = main.slice(start, main.indexOf('function assertTrustedSender(', start));
  const ipcStart = main.indexOf("  handleIpc('app:update-from-package'");
  const ipcSource = main.slice(ipcStart, main.indexOf("  handleIpc('user-data:change-location'", ipcStart));
  let pickerOptions, preparedOptions, confirmation, handler, trustedEvent;
  const prepared = { version: '4.8.5-beta.mac.1', source: 'package' };
  const context = vm.createContext({
    process: { platform: 'darwin' },
    app: { isPackaged: true, getVersion: () => '4.8.0-beta.mac.2', getPath: () => '/Downloads' },
    isSmokeTest: false, isInstalledDistribution: true,
    applicationRoot: '/Applications/Hamster Archiver.app/Contents/Resources',
    queueManager: { running: false, config: { language: 'en-US', userDataDirectory: '/Profile', sevenZipPath: 'tools/7zip/7zz' } },
    mainWindow: {},
    dialog: { showOpenDialog: async (_owner, options) => {
      pickerOptions = options; return { canceled: false, filePaths: ['/Downloads/selected.zip'] };
    } },
    resolveApplicationPath: (root, file) => `${root}/${file}`,
    prepareLocalMacUpdate: async options => { preparedOptions = options; return prepared; },
    prepareLocalUpdate: () => { throw new Error('Mac must not use the Windows portable preparer'); },
    prepareLocalInstalledUpdate: () => { throw new Error('Mac must not use the Windows installer preparer'); },
    promptAndLaunchPreparedInstaller: () => { throw new Error('Mac must not launch a Windows installer'); },
    promptAndLaunchPreparedUpdate: async options => { confirmation = options; return { staged: true }; },
    handleIpc: (channel, callback) => { assert.equal(channel, 'app:update-from-package'); handler = callback; },
    assertTrustedSender: event => { trustedEvent = event; },
    runLoggedAction: (_description, action) => action(),
    appendRuntimeLog: async () => {}
  });
  vm.runInContext(`let checkedUpdate = null; let updateInstallInFlight = false;\n${source}\n${ipcSource}`, context);
  const event = { senderFrame: { url: 'file:///app/index.html' } };
  const result = await handler(event);
  assert.equal(trustedEvent, event);
  assert.deepEqual(Array.from(pickerOptions.filters[0].extensions), ['dmg', 'zip']);
  assert.equal(preparedOptions.packagePath, '/Downloads/selected.zip');
  assert.equal(preparedOptions.currentVersion, '4.8.0-beta.mac.2');
  assert.equal(confirmation.prepared, prepared);
  assert.equal(result.staged, true);
  assert.equal(result.action, 'manual');
});
