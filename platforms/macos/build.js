#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const packageJson = require('../../package.json');
const { hashFile, readAndVerifyReleaseManifest } = require('../../src/core/tool-integrity');
const { assertPathInsideLocalRoot, makeLocalLayout } = require('../../src/core/local-paths');
const { prepareTools } = require('./prepare-tools');
const afterPack = require('./after-pack');

const projectRoot = path.resolve(__dirname, '..', '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: projectRoot, encoding: 'utf8', stdio: 'inherit', ...options });
}

async function createMacIcon(iconDirectory) {
  const iconset = path.join(iconDirectory, 'HamsterArchiver.iconset');
  const icon = path.join(iconDirectory, 'HamsterArchiver.icns');
  const source = path.join(projectRoot, 'assets', 'app-icon.png');
  await fs.mkdir(iconset, { recursive: true });
  for (const [name, size] of [
    ['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64],
    ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512],
    ['512x512', 512], ['512x512@2x', 1024]
  ]) {
    run('sips', ['-z', String(size), String(size), source, '--out', path.join(iconset, `icon_${name}.png`)],
      { stdio: 'ignore' });
  }
  run('iconutil', ['--convert', 'icns', iconset, '--output', icon]);
  return icon;
}

async function findAppBundle(outputDirectory) {
  for (const directory of ['mac-universal', 'mac']) {
    const candidate = path.join(outputDirectory, directory, 'Hamster Archiver.app');
    try { if ((await fs.stat(candidate)).isDirectory()) return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('electron-builder did not create the expected macOS app bundle.');
}

async function smokeApp(bundle, outputDirectory, commit) {
  const executable = path.join(bundle, 'Contents', 'MacOS', 'Hamster Archiver');
  const resources = path.join(bundle, 'Contents', 'Resources');
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-mac-smoke-'));
  try {
    const integrityRoot = path.join(dataRoot, 'integrity-profile');
    const archiveSmokeRoot = path.join(dataRoot, 'archive-profile');
    await Promise.all([fs.mkdir(integrityRoot), fs.mkdir(archiveSmokeRoot)]);
    const integrityOutput = run(executable, [], { timeout: 120_000, stdio: 'pipe', env: {
      ...process.env, HAMSTER_STARTUP_INTEGRITY_TEST: '1', HAMSTER_SMOKE_USER_DATA_DIR: integrityRoot
    } });
    if (!integrityOutput.includes('HAMSTER_STARTUP_INTEGRITY_TEST_OK')) {
      throw new Error('The packaged app did not complete its real startup integrity check.');
    }
    const sourceRoot = path.join(dataRoot, 'source');
    const archiveRoot = path.join(dataRoot, 'archives');
    const warehouseRoot = path.join(dataRoot, 'warehouse');
    await fs.mkdir(path.join(sourceRoot, 'small-folder'), { recursive: true });
    await fs.mkdir(archiveRoot);
    await fs.writeFile(path.join(sourceRoot, 'small-folder', 'sample.txt'), 'Hamster macOS archive smoke fixture\n');
    const resultFile = path.join(dataRoot, 'result.json');
    let smokeOutput;
    try {
      smokeOutput = run(executable, [], { timeout: 120_000, stdio: 'pipe', env: {
        ...process.env, HAMSTER_SMOKE_TEST: '1', HAMSTER_SMOKE_MODE: 'minimal',
        HAMSTER_SMOKE_USER_DATA_DIR: archiveSmokeRoot, HAMSTER_SMOKE_RESULT_FILE: resultFile,
        HAMSTER_SMOKE_IMPORT_DIRECTORY: sourceRoot, HAMSTER_SMOKE_LIBRARY_DIR: archiveRoot,
        HAMSTER_SMOKE_WAREHOUSE_DIR: warehouseRoot, HAMSTER_SMOKE_TOOL_ROOT: resources
      } });
    } catch (error) {
      const result = await fs.readFile(resultFile, 'utf8').catch(() => 'not written');
      const files = await fs.readdir(archiveSmokeRoot, { recursive: true }).catch(() => []);
      const logFiles = files.filter((name) => /\.log$/i.test(name)).slice(0, 3);
      const logs = await Promise.all(logFiles.map(async (name) => ({ name,
        tail: (await fs.readFile(path.join(archiveSmokeRoot, name), 'utf8').catch(() => '')).slice(-3000)
      })));
      const diagnostic = {
        code: error.code || null,
        signal: error.signal || null,
        stdoutTail: String(error.stdout || '').slice(-6000),
        stderrTail: String(error.stderr || '').slice(-6000),
        resultTail: result.slice(-3000), files: files.slice(0, 30), logs
      };
      throw new Error(`The packaged Mac archive smoke failed: ${JSON.stringify(diagnostic)}`);
    }
    if (!smokeOutput.includes('HAMSTER_IMPORT_TEST_OK') || !smokeOutput.includes('HAMSTER_SMOKE_TEST_OK')) {
      throw new Error(`The packaged Mac app did not complete the real archive and renderer check: ${smokeOutput.slice(-4000)}`);
    }
    const result = JSON.parse(await fs.readFile(resultFile, 'utf8'));
    if (result.ok !== true || result.stage !== 'complete' || result.version !== packageJson.version) {
      throw new Error(`The macOS app did not complete its isolated startup check: ${JSON.stringify(result)}`);
    }
    await fs.writeFile(path.join(outputDirectory, 'smoke-result.json'), `${JSON.stringify({
      ok: true, stage: result.stage, version: result.version, commit,
      integrity: true, archive: true
    }, null, 2)}\n`);
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('A macOS runner is required to build a Mac release.');
  if (process.argv.slice(2).some((value) => value !== '--smoke')) throw new Error('Unknown macOS build argument.');
  if (run('git', ['status', '--porcelain'], { stdio: ['ignore', 'pipe', 'inherit'] }).trim()) {
    throw new Error('The macOS package must be built from a clean committed source tree.');
  }
  const commit = run('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const layout = makeLocalLayout(projectRoot);
  const outputDirectory = path.join(layout.buildRoot, 'macos', `v${packageJson.version}-${commit.slice(0, 12)}`);
  const cacheDirectory = path.join(layout.root, 'development', 'mac-tool-cache');
  for (const target of [outputDirectory, cacheDirectory]) assertPathInsideLocalRoot(target, layout.root);
  await fs.mkdir(outputDirectory, { recursive: true });
  const tools = await prepareTools(cacheDirectory);
  const icon = await createMacIcon(path.join(outputDirectory, 'icon'));
  const artifactName = `HamsterArchiver-v${packageJson.version}-mac-universal.\${ext}`;
  const artifacts = await build({
    targets: Platform.MAC.createTarget('dmg', Arch.universal),
    publish: 'never',
    config: {
      appId: 'com.carlosz.hamsterarchiver',
      productName: 'Hamster Archiver',
      artifactName,
      asar: false,
      npmRebuild: false,
      directories: { output: outputDirectory },
      files: ['package.json', 'src/**/*', 'assets/app-icon.png', 'assets/app-icon.ico'],
      extraMetadata: { productName: 'Hamster Archiver', distributionMode: 'installed' },
      extraResources: [
        { from: tools.binary, to: 'tools/7zip/7zz' },
        { from: tools.license, to: 'tools/7zip/License.txt' },
        { from: 'platforms/macos/launchers/hamster', to: 'hamster' },
        { from: 'platforms/macos/launchers/HamsterArchiver-MCP', to: 'HamsterArchiver-MCP' },
        { from: 'integrations', to: 'integrations', filter: ['**/*', '!windows-odr/**'] },
        { from: 'docs/CLI.md', to: 'docs/CLI.md' },
        { from: 'docs/MCP.md', to: 'docs/MCP.md' },
        { from: 'docs/AI-QUICKSTART.md', to: 'docs/AI-QUICKSTART.md' },
        { from: 'docs/AI-TROUBLESHOOTING.md', to: 'docs/AI-TROUBLESHOOTING.md' },
        { from: 'docs/AI-TASK-RECEIPT-v2.schema.json', to: 'docs/AI-TASK-RECEIPT-v2.schema.json' },
        { from: 'LICENSE', to: 'LICENSE' },
        { from: 'llms.txt', to: 'llms.txt' },
        { from: 'platforms/macos/README.md', to: 'README.md' }
      ],
      afterPack,
      mac: {
        target: ['dmg'],
        icon,
        category: 'public.app-category.utilities',
        identity: '-',
        hardenedRuntime: false,
        notarize: false,
        minimumSystemVersion: '12.0.0'
      },
      dmg: { sign: false }
    }
  });
  const bundle = await findAppBundle(outputDirectory);
  const resources = path.join(bundle, 'Contents', 'Resources');
  const manifest = await readAndVerifyReleaseManifest(resources);
  if (manifest.commit !== commit || manifest.platform !== 'darwin-universal') {
    throw new Error('The packaged source identity is not the requested macOS commit.');
  }
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle]);
  if (process.argv.includes('--smoke')) await smokeApp(bundle, outputDirectory, commit);
  const dmg = artifacts.filter((file) => file.endsWith('.dmg'));
  if (dmg.length !== 1) throw new Error(`Expected exactly one universal DMG, received ${dmg.length}.`);
  run('hdiutil', ['verify', dmg[0]]);
  const digest = await hashFile(dmg[0]);
  await fs.writeFile(`${dmg[0]}.sha256`, `${digest} *${path.basename(dmg[0])}\n`, 'ascii');
  console.log(JSON.stringify({ commit, version: packageJson.version, dmg: dmg[0], sha256: digest,
    signed: 'ad-hoc', notarized: false, smoke: process.argv.includes('--smoke') }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
