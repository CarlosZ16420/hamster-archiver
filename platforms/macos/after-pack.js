'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../../package.json');
const { createFileIntegrityEntries } = require('../../src/core/tool-integrity');
const { compactReleaseNotesPayload } = require('../../src/core/release-notes');
const { createAutomationManifest } = require('../../src/core/automation-definitions');
const { sevenZip } = require('./tool-lock.json');

const projectRoot = path.resolve(__dirname, '..', '..');
const integrityPaths = [
  'app/package.json', 'app/src/main.js', 'app/src/preload.js',
  'app/src/core/archive-engine.js', 'app/src/core/queue-manager.js',
  'app/src/core/sqlite-repository.js', 'app/src/core/storage-paths.js',
  'app/src/core/startup-integrity.js', 'app/src/core/tool-integrity.js',
  'app/src/core/hamster-cli.js', 'app/src/core/mcp-client.js',
  'app/src/renderer/index.html', 'app/src/renderer/app.js',
  'app/src/renderer/i18n.js', 'app/assets/app-icon.png',
  'hamster', 'HamsterArchiver-MCP', 'tools/7zip/License.txt',
  'docs/CLI.md', 'docs/MCP.md', 'docs/AI-QUICKSTART.md',
  'docs/AI-TROUBLESHOOTING.md', 'docs/AI-TASK-RECEIPT-v2.schema.json',
  'integrations/codex/hamster-archiver/SKILL.md',
  'integrations/codex/hamster-archiver/agents/openai.yaml',
  'LICENSE', 'ai-capabilities.json'
];

function bundleResourcesPath(context) {
  return path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') throw new Error('The macOS pack hook received a different platform.');
  const resources = bundleResourcesPath(context);
  await Promise.all(['hamster', 'HamsterArchiver-MCP', 'tools/7zip/7zz'].map((name) =>
    fs.chmod(path.join(resources, name), 0o755)));
  await fs.writeFile(path.join(resources, 'ai-capabilities.json'),
    `${JSON.stringify(createAutomationManifest(packageJson.version, {
      platform: 'darwin-universal',
      launchers: { cli: 'hamster', mcp: 'HamsterArchiver-MCP' }
    }), null, 2)}\n`);
  const summary = JSON.parse(await fs.readFile(path.join(projectRoot, 'docs', 'releases',
    `release-summary-v${packageJson.version}.json`), 'utf8'));
  if (summary.version !== packageJson.version || !summary.notes?.['zh-CN']?.length || !summary.notes?.['en-US']?.length) {
    throw new Error('The macOS package requires a matching bilingual release summary.');
  }
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const builtAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'],
    { cwd: projectRoot, encoding: 'utf8' }).trim();
  const manifest = {
    schemaVersion: 2,
    name: `HamsterArchiver-v${packageJson.version}-mac-universal`,
    version: packageJson.version,
    platform: 'darwin-universal',
    distributionMode: 'installed',
    commit,
    builtAt,
    releaseNotes: compactReleaseNotesPayload(summary.notes),
    installedUserData: 'Electron userData directory',
    toolchain: { electron: packageJson.devDependencies.electron, sevenZip: sevenZip.version },
    integrity: { algorithm: 'sha256', files: await createFileIntegrityEntries(resources, integrityPaths) }
  };
  await fs.writeFile(path.join(resources, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};
module.exports.bundleResourcesPath = bundleResourcesPath;
