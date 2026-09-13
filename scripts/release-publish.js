'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashFile } = require('../src/core/tool-integrity');
const { makeLocalLayout } = require('../src/core/local-paths');
const version = require('../package.json').version;
const root = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'], ...options
  });
  return output == null ? '' : output.trim();
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--repo', '--tag'].includes(rest[i]) || !rest[i + 1]) throw new Error('Expected --repo OWNER/REPO --tag vX.Y.Z');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return options;
}

function validateTarget(repo, tag, commandRunner = run) {
  if (!/^CarlosZ16420\/hamster-archiv(?:e|er)$/.test(repo || '')) throw new Error('Choose an explicit Hamster repository.');
  if (tag !== `v${version}`) throw new Error(`Tag must match package version v${version}.`);
  if (commandRunner('git', ['status', '--porcelain'])) throw new Error('Commit changes before releasing.');
  const head = commandRunner('git', ['rev-parse', 'HEAD']);
  const localTag = commandRunner('git', ['rev-parse', `${tag}^{commit}`]);
  if (head !== localTag) throw new Error('HEAD must be the version tag commit. Do not move an existing release tag.');
  const remote = JSON.parse(commandRunner('gh', ['api', `repos/${repo}/commits/${tag}`]));
  if (remote.sha !== head) throw new Error('Remote version tag differs from this checkout.');
  return head;
}

function findReleaseByTag(releases, tag) {
  return releases.find(release => release?.tag_name === tag);
}

function getRelease(repo, tag, commandRunner = run) {
  for (let page = 1; page <= 100; page += 1) {
    const pageReleases = JSON.parse(commandRunner('gh', ['api', `repos/${repo}/releases?per_page=100&page=${page}`]));
    if (!Array.isArray(pageReleases)) throw new Error('GitHub release listing returned an invalid response.');
    const match = findReleaseByTag(pageReleases, tag);
    if (match) return match;
    if (pageReleases.length < 100) break;
    if (page === 100) throw new Error('GitHub release listing exceeded the pagination limit.');
  }
  return null;
}

function getReleaseByTag(repo, tag, commandRunner = run) {
  try {
    const release = JSON.parse(commandRunner('gh', ['api', `repos/${repo}/releases/tags/${tag}`]));
    if (release && release.tag_name === tag) return release;
  } catch {
    // Drafts can be briefly absent from the direct endpoint; use the
    // authenticated paginated listing as a bounded fallback.
  }
  return getRelease(repo, tag, commandRunner);
}

function preflight(repo, tag, commandRunner = run) {
  validateTarget(repo, tag, commandRunner);
  const release = getRelease(repo, tag, commandRunner);
  if (release && !release.draft) throw new Error('This version is already published; historical releases will not be overwritten.');
  return release;
}

async function verifyFiles() {
  const layout = makeLocalLayout(root);
  const head = run('git', ['rev-parse', 'HEAD']);
  for (const manifestPath of [
    path.join(layout.currentBuild, 'release-manifest.json'),
    path.join(layout.stagingRoot, `HamsterArchiver-v${version}-win-x64-installed`, 'release-manifest.json')
  ]) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.version !== version || manifest.commit !== head) throw new Error('Build manifest does not match current commit/version.');
  }
  const binaries = [
    path.join(layout.packageRoot, `HamsterArchiver-v${version}-win-x64.zip`),
    path.join(layout.installerRoot, `HamsterArchiver-Setup-v${version}-win-x64.exe`)
  ];
  const assets = [];
  for (const file of binaries) {
    const checksumFile = `${file}.sha256`;
    const checksum = (await fs.readFile(checksumFile, 'ascii')).trim();
    const digest = await hashFile(file);
    if (checksum !== `${digest} *${path.basename(file)}`) throw new Error(`Checksum mismatch: ${path.basename(file)}`);
    for (const target of [file, checksumFile]) {
      const stat = await fs.stat(target);
      if (!stat.size) throw new Error(`Empty release file: ${target}`);
      assets.push({ path: target, name: path.basename(target), size: stat.size, digest: `sha256:${await hashFile(target)}` });
    }
  }
  return assets;
}

function planUploads(local, remote) {
  return local.filter(asset => {
    const existing = remote.find(item => item.name === asset.name);
    if (!existing) return true;
    if (existing.size !== asset.size || existing.digest !== asset.digest) {
      throw new Error(`Draft contains a different ${asset.name}. Inspect the draft before retrying; no file was overwritten.`);
    }
    return false;
  });
}

function expectedReleaseAssetNames(tag) {
  const names = [`HamsterArchiver-${tag}-win-x64.zip`, `HamsterArchiver-Setup-${tag}-win-x64.exe`];
  return names.flatMap(name => [name, `${name}.sha256`]);
}

function completeDraft(release, tag) {
  return Boolean(release?.draft && expectedReleaseAssetNames(tag).every(name =>
    release.assets?.some(asset => asset.name === name && asset.size > 0 && /^sha256:[a-f0-9]{64}$/.test(asset.digest || ''))));
}

async function readReleaseNotes(repo, tag, sourceRoot = root) {
  const prefix = repo === 'CarlosZ16420/hamster-archiver' ? 'public-release-notes' : 'release-notes';
  const notes = path.join(sourceRoot, 'docs', 'releases', `${prefix}-${tag}.md`);
  const body = await fs.readFile(notes, 'utf8');
  const sections = body.replace(/\r\n?/g, '\n').split(/^## /m);
  for (const heading of ['中文', 'English']) {
    if (!sections.some(section => section.startsWith(`${heading}\n`) && section.slice(heading.length).trim())) {
      throw new Error('Release notes require non-empty Chinese and English sections.');
    }
  }
  return { notes, body };
}

function assertDraftNotes(release, body) {
  if (release && String(release.body || '').replace(/\r\n?/g, '\n').trim() !== body.replace(/\r\n?/g, '\n').trim()) {
    throw new Error('Draft notes differ from the reviewed release notes. Reconcile the draft before uploading assets.');
  }
}

async function upload(repo, tag) {
  let release = preflight(repo, tag);
  const { notes, body } = await readReleaseNotes(repo, tag);
  assertDraftNotes(release, body);
  const assets = await verifyFiles();
  if (!release) {
    run('gh', ['release', 'create', tag, '--repo', repo, '--draft', '--verify-tag', '--title', `Hamster Archiver ${tag}`, '--notes-file', notes]);
    release = getReleaseByTag(repo, tag);
  }
  if (!release?.draft) throw new Error('Release is no longer a draft.');
  const pending = planUploads(assets, release.assets || []);
  for (const asset of pending) {
    if (!getRelease(repo, tag)?.draft) throw new Error('Release was published during upload. Stopping.');
    run('gh', ['release', 'upload', tag, asset.path, '--repo', repo], { timeout: 600000 });
  }
  const final = getRelease(repo, tag);
  assertDraftNotes(final, body);
  if (!final?.draft || planUploads(assets, final.assets || []).length) throw new Error('Release draft verification failed.');
  console.log(`Complete Release draft (EXE + ZIP + two checksums): ${final.html_url}`);
  console.log('Review the draft and publish it when ready. Nothing was published automatically.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'verify') console.log(JSON.stringify(await verifyFiles(), null, 2));
  else if (options.command === 'preflight') {
    if (completeDraft(preflight(options.repo, options.tag), options.tag)) {
      throw new Error('A complete draft already exists. Review it instead of building again.');
    }
  }
  else if (options.command === 'upload') await upload(options.repo, options.tag);
  else throw new Error('Use preflight, verify, or upload.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { assertDraftNotes, readReleaseNotes, completeDraft, expectedReleaseAssetNames, findReleaseByTag, getRelease, getReleaseByTag, parseArgs, planUploads, preflight, run, upload, validateTarget, verifyFiles };
