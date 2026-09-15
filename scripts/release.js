'use strict';

const { randomUUID } = require('node:crypto');
const { completeDraft, completePublishedRelease, getReleaseByTag, publishCompleteDraft, releaseArtifacts, releaseState, run, verifyFiles } = require('./release-publish');
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
  let current;
  for (const waitMs of [15000, 30000, 60000]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(waitMs, remaining));
    const data = JSON.parse(run('gh', ['api', `repos/${options.repo}/actions/workflows/package.yml/runs?event=workflow_dispatch&per_page=100`]));
    current = findRequest(data.workflow_runs, requestId);
    if (current) break;
  }
  if (!current) throw new Error('The dispatched cloud run was not visible within the bounded wait. No second run was submitted.');
  console.log(`Cloud build: ${current.html_url}`);
  if (current.status !== 'completed') {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      run('gh', ['run', 'cancel', String(current.id), '--repo', options.repo]);
      throw new Error(`Cloud wait exceeded ${options.waitMinutes} minutes; cancellation was requested for run ${current.id}.`);
    }
    try {
      run('gh', ['run', 'watch', String(current.id), '--repo', options.repo, '--exit-status', '--interval', '30'], {
        stdio: ['ignore', 'inherit', 'inherit'], timeout: remaining
      });
    } catch (error) {
      const state = JSON.parse(run('gh', ['run', 'view', String(current.id), '--repo', options.repo, '--json', 'status,conclusion,url']));
      if (state.status !== 'completed' && Date.now() >= deadline) {
        run('gh', ['run', 'cancel', String(current.id), '--repo', options.repo]);
        throw new Error(`Cloud wait exceeded ${options.waitMinutes} minutes; cancellation was requested for run ${current.id}.`);
      }
      if (state.status !== 'completed') throw new Error(`Cloud run watch stopped before completion: ${error.message}`);
      current = { ...current, ...state };
    }
  }
  if (current.status !== 'completed' || !current.conclusion) {
    current = { ...current, ...JSON.parse(run('gh', ['run', 'view', String(current.id), '--repo', options.repo, '--json', 'status,conclusion,url'])) };
  }
  if (current.conclusion !== 'success') throw new Error(`Cloud build ${current.id} ended: ${current.conclusion}.`);
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

async function local(options) {
  // A local fallback must not race an already-running cloud upload.
  const data = JSON.parse(run('gh', ['api', `repos/${options.repo}/actions/workflows/package.yml/runs?per_page=100`]));
  if (data.workflow_runs.some(item => item.status !== 'completed' &&
      (item.display_title?.startsWith(`Windows release ${options.tag} / `) || item.head_branch === options.tag))) {
    throw new Error('A cloud build for this tag is still active. Cancel it and wait for completion before local mode.');
  }
  try {
    await verifyFiles();
    console.log('Reusing the complete locally verified release bundle for this exact commit; no tests or rebuild were repeated.');
  } catch (reuseError) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Start with npm run release -- --mode local.');
    console.log(`No reusable local release bundle was found (${reuseError.message}). Building and verifying once.`);
    run(process.execPath, [npmCli, 'run', 'release:local', '--', '--full-checks'], {
      stdio: 'inherit', timeout: 1800000
    });
  }
  await releaseArtifacts(options.repo, options.tag);
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
