'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashFile } = require('../src/core/tool-integrity');
const { makeLocalLayout } = require('../src/core/local-paths');
const { openCheckpoint, runStage } = require('./release-checkpoint');
const version = require('../package.json').version;
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const RELEASE_READ_BACK_DELAY_MS = 30000;

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
    if (!['--repo', '--tag', '--from-repo'].includes(rest[i]) || !rest[i + 1]) {
      throw new Error('Expected --repo OWNER/REPO --tag vX.Y.Z [--from-repo OWNER/REPO]');
    }
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

function errorText(error) {
  return String(error?.stderr || error?.message || error || '').trim();
}

function isTransientUploadError(error) {
  return /\bEOF\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|connection (?:was )?reset|timed?\s*out|HTTP\s*(?:408|429|500|502|503|504)|status\s*(?:408|429|500|502|503|504)/i.test(errorText(error));
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

async function readReleaseWithOneDelayedRetry(repo, tag, accept, commandRunner = run, wait = delay, waitMs = RELEASE_READ_BACK_DELAY_MS) {
  let release = getReleaseByTag(repo, tag, commandRunner);
  if (accept(release)) return release;
  await wait(waitMs);
  release = getReleaseByTag(repo, tag, commandRunner);
  return release;
}

function preflight(repo, tag, commandRunner = run) {
  validateTarget(repo, tag, commandRunner);
  const release = getReleaseByTag(repo, tag, commandRunner);
  if (release && !release.draft) throw new Error('This version is already published; historical releases will not be overwritten.');
  return release;
}

async function verifyFiles(expectedCommit = run('git', ['rev-parse', 'HEAD'])) {
  const layout = makeLocalLayout(root);
  const portableStaging = path.join(layout.stagingRoot, `HamsterArchiver-v${version}-win-x64`);
  const portableManifest = await fs.access(path.join(portableStaging, 'release-manifest.json'))
    .then(() => path.join(portableStaging, 'release-manifest.json'))
    .catch(() => path.join(layout.currentBuild, 'release-manifest.json'));
  for (const manifestPath of [
    portableManifest,
    path.join(layout.stagingRoot, `HamsterArchiver-v${version}-win-x64-installed`, 'release-manifest.json')
  ]) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.version !== version || manifest.commit !== expectedCommit) {
      throw new Error('Build manifest does not match the expected commit/version.');
    }
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
    const fileStat = await fs.stat(file);
    const checksumStat = await fs.stat(checksumFile);
    if (!fileStat.size || !checksumStat.size) throw new Error(`Empty release file: ${file}`);
    assets.push({ path: file, name: path.basename(file), size: fileStat.size, digest: `sha256:${digest}` });
    assets.push({ path: checksumFile, name: path.basename(checksumFile), size: checksumStat.size, digest: `sha256:${await hashFile(checksumFile)}` });
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

async function downloadVerifiedReleaseAssets(repo, tag, commandRunner = run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `hamster-release-mirror-${tag}-`));
  const names = expectedReleaseAssetNames(tag);
  try {
    commandRunner('gh', [
      'release', 'download', tag, '--repo', repo, '--dir', directory, '--clobber',
      ...names.flatMap(name => ['--pattern', name])
    ], { timeout: 1800000 });
    const assets = [];
    for (const name of names) {
      const target = path.join(directory, name);
      const stat = await fs.stat(target);
      if (!stat.isFile() || !stat.size) throw new Error(`Downloaded Release asset is empty: ${name}`);
      assets.push({ path: target, name, size: stat.size, digest: `sha256:${await hashFile(target)}` });
    }
    for (const binary of assets.filter(asset => !asset.name.endsWith('.sha256'))) {
      const sidecar = assets.find(asset => asset.name === `${binary.name}.sha256`);
      const text = await fs.readFile(sidecar.path, 'ascii');
      if (text.trim() !== `${binary.digest.slice(7)} *${binary.name}`) {
        throw new Error(`Downloaded Release checksum does not match: ${binary.name}`);
      }
    }
    return { assets, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function validateMirrorTarget(sourceRepo, targetRepo, tag, commandRunner = run) {
  if (sourceRepo !== 'CarlosZ16420/hamster-archive' || targetRepo !== 'CarlosZ16420/hamster-archiver') {
    throw new Error('Release mirroring is restricted to the private Hamster source and public snapshot repositories.');
  }
  if (tag !== `v${version}`) throw new Error(`Tag must match package version v${version}.`);
  if (commandRunner('git', ['status', '--porcelain'])) throw new Error('Commit changes before mirroring a release.');
  const sourceCommit = commandRunner('git', ['rev-parse', `${tag}^{commit}`]);
  const remoteSource = JSON.parse(commandRunner('gh', ['api', `repos/${sourceRepo}/commits/${tag}`]));
  if (remoteSource.sha !== sourceCommit) throw new Error('The private remote tag differs from the local version tag.');
  const remoteTarget = JSON.parse(commandRunner('gh', ['api', `repos/${targetRepo}/commits/${tag}`]));
  const snapshotSource = /^Snapshot ([a-f0-9]{12})(?::|$)/i
    .exec(String(remoteTarget?.commit?.message || '').trim())?.[1]?.toLowerCase();
  if (snapshotSource !== sourceCommit.slice(0, 12).toLowerCase()) {
    throw new Error('The public version tag is not a snapshot of the private release commit.');
  }
  return sourceCommit;
}

function assertMatchingReleaseAssets(localAssets, release, tag) {
  if (!completePublishedRelease(release, tag)) {
    throw new Error('The private source Release is not a complete published stable Release.');
  }
  if (planUploads(localAssets, release.assets || []).length !== 0) {
    throw new Error('The private source Release is missing one or more locally verified assets.');
  }
}

function expectedReleaseAssetNames(tag) {
  const names = [`HamsterArchiver-${tag}-win-x64.zip`, `HamsterArchiver-Setup-${tag}-win-x64.exe`];
  return names.flatMap(name => [name, `${name}.sha256`]);
}

function hasCompleteReleaseAssets(release, tag) {
  const expected = expectedReleaseAssetNames(tag);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.length === expected.length && expected.every(name =>
    assets.some(asset => asset.name === name && asset.size > 0 && /^sha256:[a-f0-9]{64}$/.test(asset.digest || '')));
}

function completeDraft(release, tag) {
  return Boolean(release?.draft && !release.prerelease && hasCompleteReleaseAssets(release, tag));
}

function completePublishedRelease(release, tag) {
  return Boolean(release && !release.draft && !release.prerelease && hasCompleteReleaseAssets(release, tag));
}

function releaseState(repo, tag, commandRunner = run) {
  validateTarget(repo, tag, commandRunner);
  const release = getReleaseByTag(repo, tag, commandRunner);
  if (!release) return { state: 'missing', release: null };
  if (completeDraft(release, tag)) return { state: 'complete-draft', release };
  if (release.draft) return { state: 'partial-draft', release };
  if (completePublishedRelease(release, tag)) return { state: 'complete-published', release };
  throw new Error('A published Release exists but is incomplete or marked as a prerelease; it will not be overwritten.');
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
    throw new Error('Release notes differ from the reviewed release notes. Reconcile them before continuing.');
  }
}

async function publishCompleteDraft(repo, tag, release = getReleaseByTag(repo, tag), commandRunner = run, sourceRoot = root, wait = delay, waitMs = RELEASE_READ_BACK_DELAY_MS) {
  if (!completeDraft(release, tag)) throw new Error('A complete Release draft was not found.');
  const { body } = await readReleaseNotes(repo, tag, sourceRoot);
  assertDraftNotes(release, body);
  commandRunner('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
  const published = await readReleaseWithOneDelayedRetry(
    repo, tag, candidate => completePublishedRelease(candidate, tag), commandRunner, wait, waitMs
  );
  assertDraftNotes(published, body);
  if (!completePublishedRelease(published, tag)) {
    throw new Error('GitHub Release publication was not visible as a complete stable release after one delayed read-back.');
  }
  console.log(`Published GitHub Release (EXE + ZIP + two checksums): ${published.html_url}`);
  return published;
}

async function uploadAssetWithRecovery(repo, tag, asset, body, commandRunner = run, wait = delay, waitMs = RELEASE_READ_BACK_DELAY_MS) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      commandRunner('gh', ['release', 'upload', tag, asset.path, '--repo', repo], { timeout: 600000 });
      return null;
    } catch (error) {
      if (!isTransientUploadError(error)) throw error;
      lastError = error;
      await wait(waitMs);
      const observed = getReleaseByTag(repo, tag, commandRunner);
      assertDraftNotes(observed, body);
      if (observed && planUploads([asset], observed.assets || []).length === 0) return observed;
      if (observed && !observed.draft) {
        throw new Error('Release was published before all verified assets were uploaded. Stopping without overwriting it.');
      }
    }
  }
  throw new Error(`Release asset upload failed after one delayed retry: ${asset.name}: ${errorText(lastError)}`);
}

async function releaseArtifacts(repo, tag, dependencies = {}) {
  const commandRunner = dependencies.commandRunner || run;
  const fileVerifier = dependencies.fileVerifier || verifyFiles;
  const sourceRoot = dependencies.sourceRoot || root;
  const wait = dependencies.wait || delay;
  const waitMs = dependencies.waitMs ?? RELEASE_READ_BACK_DELAY_MS;
  let release = dependencies.preflightRelease
    ? dependencies.preflightRelease()
    : preflight(repo, tag, commandRunner);
  const { notes, body } = await readReleaseNotes(repo, tag, sourceRoot);
  assertDraftNotes(release, body);
  if (completePublishedRelease(release, tag)) {
    console.log(`Release is already published and complete: ${release.html_url}`);
    return release;
  }
  const assets = await fileVerifier();
  if (!release) {
    try {
      commandRunner('gh', [
        'release', 'create', tag, '--repo', repo, '--verify-tag', '--title', `Hamster Archiver ${tag}`,
        '--notes-file', notes, ...assets.map(asset => asset.path)
      ], { timeout: 1800000 });
    } catch (error) {
      // A failed CLI upload can still have created a partial draft, or even
      // completed remotely before the connection closed. Read back once after
      // a fixed delay, then resume only the verified missing assets.
      await wait(waitMs);
      release = getReleaseByTag(repo, tag, commandRunner);
      if (!release) {
        throw new Error(`GitHub CLI did not complete the Release and no resumable draft was visible after one delayed read-back: ${errorText(error)}`);
      }
    }
    if (!release) {
      release = await readReleaseWithOneDelayedRetry(
        repo, tag, candidate => completePublishedRelease(candidate, tag), commandRunner, wait, waitMs
      );
    }
    assertDraftNotes(release, body);
    if (completePublishedRelease(release, tag)) {
      console.log(`Published GitHub Release (EXE + ZIP + two checksums): ${release.html_url}`);
      return release;
    }
  }
  if (!release) throw new Error('GitHub Release was not visible after one delayed read-back.');
  if (!release.draft) throw new Error('A published Release exists but is incomplete or marked as a prerelease; it will not be overwritten.');
  const pending = planUploads(assets, release.assets || []);
  for (const asset of pending) {
    const observed = await uploadAssetWithRecovery(repo, tag, asset, body, commandRunner, wait, waitMs);
    if (observed && !observed.draft) {
      if (completePublishedRelease(observed, tag)) return observed;
      throw new Error('Release was published before all verified assets were uploaded. Stopping without overwriting it.');
    }
  }
  const final = await readReleaseWithOneDelayedRetry(
    repo, tag, candidate => completeDraft(candidate, tag) || completePublishedRelease(candidate, tag),
    commandRunner, wait, waitMs
  );
  assertDraftNotes(final, body);
  if (completePublishedRelease(final, tag)) return final;
  if (!completeDraft(final, tag)) throw new Error('Release draft verification failed after one delayed read-back.');
  return publishCompleteDraft(repo, tag, final, commandRunner, sourceRoot, wait, waitMs);
}

async function mirrorReleaseArtifacts(sourceRepo, targetRepo, tag, dependencies = {}) {
  const commandRunner = dependencies.commandRunner || run;
  const sourceRoot = dependencies.sourceRoot || root;
  const wait = dependencies.wait || delay;
  const waitMs = dependencies.waitMs ?? RELEASE_READ_BACK_DELAY_MS;
  const sourceCommit = validateMirrorTarget(sourceRepo, targetRepo, tag, commandRunner);
  const existingTarget = getReleaseByTag(targetRepo, tag, commandRunner);
  if (completePublishedRelease(existingTarget, tag)) return existingTarget;
  const checkpoint = await openCheckpoint({ version, commit: sourceCommit, request: { sourceRepo, targetRepo, tag } });
  return runStage(checkpoint, 'publish-public', async () => {
    const downloaded = dependencies.fileVerifier
      ? { assets: await dependencies.fileVerifier(sourceCommit), cleanup: async () => {} }
      : await downloadVerifiedReleaseAssets(sourceRepo, tag, commandRunner);
    try {
      assertMatchingReleaseAssets(downloaded.assets, getReleaseByTag(sourceRepo, tag, commandRunner), tag);
      return await releaseArtifacts(targetRepo, tag, {
        commandRunner,
        fileVerifier: async () => downloaded.assets,
        sourceRoot,
        wait,
        waitMs,
        preflightRelease: () => {
          const release = getReleaseByTag(targetRepo, tag, commandRunner);
          if (release && !release.draft) {
            if (completePublishedRelease(release, tag)) return release;
            throw new Error('The public Release exists but is incomplete or marked as a prerelease.');
          }
          return release;
        }
      });
    } finally {
      await downloaded.cleanup();
    }
  }, { reusable: () => completePublishedRelease(getReleaseByTag(targetRepo, tag, commandRunner), tag) });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'verify') console.log(JSON.stringify(await verifyFiles(), null, 2));
  else if (options.command === 'state') console.log(releaseState(options.repo, options.tag).state);
  else if (options.command === 'preflight') {
    if (completeDraft(preflight(options.repo, options.tag), options.tag)) {
      throw new Error('A complete draft already exists. Publish it directly instead of building again.');
    }
  }
  else if (options.command === 'release' || options.command === 'upload') await releaseArtifacts(options.repo, options.tag);
  else if (options.command === 'mirror') {
    if (!options['from-repo']) throw new Error('Mirror requires --from-repo OWNER/REPO.');
    await mirrorReleaseArtifacts(options['from-repo'], options.repo, options.tag);
  }
  else if (options.command === 'publish') {
    validateTarget(options.repo, options.tag);
    await publishCompleteDraft(options.repo, options.tag);
  }
  else throw new Error('Use state, preflight, verify, release, mirror, or publish.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { assertDraftNotes, assertMatchingReleaseAssets, readReleaseNotes, completeDraft, completePublishedRelease, downloadVerifiedReleaseAssets, errorText, expectedReleaseAssetNames, findReleaseByTag, getRelease, getReleaseByTag, hasCompleteReleaseAssets, isTransientUploadError, mirrorReleaseArtifacts, parseArgs, planUploads, preflight, publishCompleteDraft, readReleaseWithOneDelayedRetry, releaseArtifacts, releaseState, run, uploadAssetWithRecovery, validateMirrorTarget, validateTarget, verifyFiles };
