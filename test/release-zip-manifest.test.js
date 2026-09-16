'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { readPortableZipManifest, assertManifestCommit } = require('../scripts/release-publish');
const { version } = require('../package.json');

test('same-version ZIP must contain the expected commit, regardless of staging metadata', {
  skip: process.platform !== 'win32'
}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-zip-manifest-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const packageRoot = path.join(source, `HamsterArchiver-v${version}-win-x64`);
  await fs.mkdir(packageRoot, { recursive: true });
  const oldCommit = 'a'.repeat(40);
  const newCommit = 'b'.repeat(40);
  await fs.writeFile(path.join(packageRoot, 'release-manifest.json'), JSON.stringify({ version, commit: oldCommit }));
  const zip = path.join(directory, 'portable.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:HAMSTER_TEST_ZIP_SOURCE, $env:HAMSTER_TEST_ZIP_OUTPUT)"], {
    env: { ...process.env, HAMSTER_TEST_ZIP_SOURCE: source, HAMSTER_TEST_ZIP_OUTPUT: zip },
    windowsHide: true, timeout: 60000
  });
  // Refreshing the loose manifest must not make an old archive acceptable.
  await fs.writeFile(path.join(packageRoot, 'release-manifest.json'), JSON.stringify({ version, commit: newCommit }));
  const shipped = readPortableZipManifest(zip);
  assert.equal(shipped.commit, oldCommit);
  assert.throws(() => assertManifestCommit(shipped, newCommit), /expected commit\/version/);
  assert.doesNotThrow(() => assertManifestCommit(shipped, oldCommit));
});
