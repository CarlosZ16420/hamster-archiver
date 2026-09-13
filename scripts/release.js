'use strict';

const { randomUUID } = require('node:crypto');
const { completeDraft, completePublishedRelease, getReleaseByTag, publishCompleteDraft, releaseState, run, upload } = require('./release-publish');
const version = require('../package.json').version;

function optionsFrom(argv) {
  const result = { mode: 'cloud', tag: `v${version}`, waitMinutes: 30 };
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--mode', '--repo', '--wait-minutes'].includes(argv[i]) || !argv[i + 1]) throw new Error('Use --mode cloud|local --repo OWNER/REPO --wait-minutes 30');
    const key = argv[i] === '--wait-minutes' ? 'waitMinutes' : argv[i].slice(2);
    result[key] = key === 'waitMinutes' ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!['cloud', 'local'].includes(result.mode)) throw new Error('Mode must be cloud or local.');
  if (!Number.isFinite(result.waitMinutes) || result.waitMinutes < 1 || result.waitMinutes > 60) throw new Error('Wait limit must be 1–60 minutes.');
  return result;
}

function findRequest(runs, requestId) {
  return runs.find(item => item.display_title === `Windows release ${requestId.tag} / ${requestId.id}`);
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cloud(options) {
  const requestId = { tag: options.tag, id: randomUUID() };
  // Dispatch the current workflow definition, checking out the immutable tag inside it.
  run('gh', ['workflow', 'run', 'package.yml', '--repo', options.repo, '--ref', 'main',
    '-f', `tag=${options.tag}`, '-f', 'publish=true', '-f', 'retain_artifact=false', '-f', `request_id=${requestId.id}`]);
  const deadline = Date.now() + options.waitMinutes * 60000;
  let runId;
  while (Date.now() < deadline) {
    const data = JSON.parse(run('gh', ['api', `repos/${options.repo}/actions/workflows/package.yml/runs?event=workflow_dispatch&per_page=100`]));
    const current = findRequest(data.workflow_runs, requestId);
    if (current) {
      if (!runId) console.log(`Cloud build: ${current.html_url}`);
      runId = current.id;
      if (current.status === 'completed') {
        if (current.conclusion !== 'success') throw new Error(`Cloud build ${runId} ended: ${current.conclusion}.`);
        const release = getReleaseByTag(options.repo, options.tag);
        if (completePublishedRelease(release, options.tag)) {
          console.log(`Cloud Release published: ${release.html_url}`);
          return;
        }
        if (completeDraft(release, options.tag)) {
          await publishCompleteDraft(options.repo, options.tag, release);
          return;
        }
        throw new Error('Cloud run succeeded but neither a complete published Release nor a complete draft was found.');
      }
    }
    await delay(10000);
  }
  if (runId) {
    run('gh', ['run', 'cancel', String(runId), '--repo', options.repo]);
    console.error(`Cancellation requested for run ${runId}. Confirm it has stopped before using local mode.`);
  }
  throw new Error(`Cloud wait exceeded ${options.waitMinutes} minutes. No automatic retry or local build was started.`);
}

async function local(options) {
  // A local fallback must not race an already-running cloud upload.
  const data = JSON.parse(run('gh', ['api', `repos/${options.repo}/actions/workflows/package.yml/runs?per_page=100`]));
  if (data.workflow_runs.some(item => item.status !== 'completed' &&
      (item.display_title?.startsWith(`Windows release ${options.tag} / `) || item.head_branch === options.tag))) {
    throw new Error('A cloud build for this tag is still active. Cancel it and wait for completion before local mode.');
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Start with npm run release -- --mode local.');
  for (const args of [['release:local', '--', '--full-checks'], ['build:installer']]) {
    run(process.execPath, [npmCli, 'run', ...args], { stdio: 'inherit', timeout: 1800000 });
  }
  const draft = await upload(options.repo, options.tag);
  await publishCompleteDraft(options.repo, options.tag, draft);
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  options.repo ||= run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const existing = releaseState(options.repo, options.tag);
  if (existing.state === 'complete-published') {
    console.log(`Release is already published and complete: ${existing.release.html_url}`);
    return;
  }
  if (existing.state === 'complete-draft') {
    await publishCompleteDraft(options.repo, options.tag, existing.release);
    return;
  }
  try {
    if (options.mode === 'cloud') await cloud(options);
    else await local(options);
  } catch (error) {
    console.error(`Release did not complete: ${error.message}`);
    console.error(`Inspect the Actions run and remote Release state first. Use local fallback only after the cloud run has stopped and no complete published Release exists: npm run release -- --mode local --repo ${options.repo}`);
    throw error;
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { optionsFrom, findRequest };
