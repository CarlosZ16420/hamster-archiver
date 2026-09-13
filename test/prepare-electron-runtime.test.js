'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { hashFile } = require('../src/core/tool-integrity');
const {
  findVerifiedCachedArchive,
  getCacheRoots,
  parseArguments,
  verifyFile
} = require('../scripts/prepare-electron-runtime');

test('Electron runtime preparation keeps Windows rename fallbacks path-safe', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'scripts', 'prepare-electron-runtime.js'), 'utf8');
  assert.match(source, /async function renameWithRetry/);
  assert.match(source, /\['EPERM', 'EACCES', 'EBUSY'\]\.includes\(error\.code\)/);
  assert.match(source, /HAMSTER_ELECTRON_RENAME_SOURCE: sourcePath/);
  assert.match(source, /HAMSTER_ELECTRON_RENAME_DESTINATION: destinationPath/);
  assert.match(source, /Move-Item -LiteralPath \$env:HAMSTER_ELECTRON_RENAME_SOURCE/);
});

test('Electron runtime preparation requires explicit download authorization', () => {
  assert.deepEqual(parseArguments([]), { allowDownload: false });
  assert.deepEqual(parseArguments(['--allow-download']), { allowDownload: true });
  assert.throws(() => parseArguments(['--unexpected']), /未知 Electron 运行时准备参数/);
});

test('Electron cache roots honor an explicit cache before the platform default', () => {
  const roots = getCacheRoots({
    electron_config_cache: 'C:\\explicit-electron-cache',
    LOCALAPPDATA: 'C:\\local-app-data'
  });
  assert.deepEqual(roots, [
    path.resolve('C:\\explicit-electron-cache'),
    path.resolve('C:\\local-app-data', 'electron', 'Cache')
  ]);
});

test('Electron preparation selects only a checksum-verified cached archive', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-electron-cache-test-'));
  try {
    const archiveName = 'electron-v1.2.3-win32-x64.zip';
    const invalidDirectory = path.join(temporaryRoot, 'invalid');
    const validDirectory = path.join(temporaryRoot, 'valid');
    await fs.mkdir(invalidDirectory);
    await fs.mkdir(validDirectory);
    await fs.writeFile(path.join(invalidDirectory, archiveName), 'invalid');
    const validArchive = path.join(validDirectory, archiveName);
    await fs.writeFile(validArchive, 'verified-cache');
    const expectedSha256 = await hashFile(validArchive);

    assert.equal(
      await findVerifiedCachedArchive([temporaryRoot], archiveName, expectedSha256),
      validArchive
    );
    assert.equal(await verifyFile(validArchive, { sha256: expectedSha256 }), true);
    assert.equal(await verifyFile(validArchive, { sha256: '0'.repeat(64) }), false);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
