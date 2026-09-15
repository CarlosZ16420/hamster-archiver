'use strict';

const { randomUUID } = require('node:crypto');
const { completeDraft, completePublishedRelease, getReleaseByTag, publishCompleteDraft, releaseArtifacts, releaseState, run, verifyFiles } = require('./release-publish');
const { openCheckpoint, runStage } = require('./release-checkpoint');
const version = require('../package.json').version;

function inferredReleaseKind(value) {
  const [, minor, patch] = String(value).split('.').map(Number);
  return minor === 0 && patch === 0 ? 'major' : patch === 0 ? 'minor' : 'patch';
}

function optionsFrom(argv) {
  const result = { mode: 'cloud', channel: 'stable', tag: `v${version}`, waitMinutes: 30, qa: 'auto', releaseKind: inferredReleaseKind(version), resumeRun: '', retryTest: '' };
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--mode', '--channel', '--tag', '--repo', '--wait-minutes', '--qa', '--release-kind', '--resume-run', '--retry-test'].includes(argv[i]) || !argv[i + 1]) {
      throw new Error('Use --mode cloud|local --channel stable|validation --repo OWNER/REPO --release-kind patch|minor|major --qa auto|none|targeted|full --retry-test FILE --resume-run RUN_ID --wait-minutes 30');
    }
    const key = argv[i] === '--wait-minutes' ? 'waitMinutes' : argv[i] === '--resume-run' ? 'resumeRun' : argv[i] === '--retry-test' ? 'retryTest' :
      argv[i] === '--release-kind' ? 'releaseKind' : argv[i].slice(2);
    result[key] = key === 'waitMinutes' ? Number(argv[i + 1]) : argv[i + 1];
  }
  if (!['cloud', 'local'].includes(result.mode)) throw new Error('Mode must be cloud or local.');
  if (!['stable', 'validation'].includes(result.channel)) throw new Error('Channel must be stable or validation.');
  if (result.mode === 'local' && result.channel === 'validation') throw new Error('The validation channel uses the cloud artifact checkpoint.');
  if (result.channel === 'stable' && result.tag !== `v${version}`) throw new Error(`Stable tag must match package version v${version}.`);
  if (!/^[A-Za-z0-9._-]+$/.test(result.tag)) throw new Error('Tag or validation ref contains unsupported characters.');
  if (!['auto', 'none', 'targeted', 'full'].includes(result.qa)) throw new Error('QA must be auto, none, targeted, or full.');
  if (!['patch', 'minor', 'major'].includes(result.releaseKind)) throw new Error('Release kind must be patch, minor, or major.');
  if (result.resumeRun && !/^\d+$/.test(result.resumeRun)) throw new Error('Resume run must be a numeric GitHub Actions run ID.');
  if (result.retryTest && !/^test\/[a-z0-9-]+\.test\.js$/i.test(result.retryTest.replace(/\\/g, '/'))) {
    throw new Error('Retry test must be one catalogued test/*.test.js file.');
  }
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
    '-f', `tag=${options.tag}`, '-f', `publish=${options.channel === 'stable'}`, '-f', `qa_level=${options.qa}`,
    '-f', `release_kind=${options.releaseKind}`, '-f', `retry_test_file=${options.retryTest.replace(/\\/g, '/')}`,
    '-f', `resume_run_id=${options.resumeRun}`, '-f', `request_id=${requestId.id}`]);
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
      throw new Error(`Cloud wait exceeded ${options.waitMinutes} minutes; run ${current.id} continues remotely and was not restarted or cancelled.`);
    }
    try {
      run('gh', ['run', 'watch', String(current.id), '--repo', options.repo, '--exit-status', '--interval', '30'], {
        stdio: ['ignore', 'inherit', 'inherit'], timeout: remaining
      });
    } catch (error) {
      const state = JSON.parse(run('gh', ['run', 'view', String(current.id), '--repo', options.repo, '--json', 'status,conclusion,url']));
      if (state.status !== 'completed' && Date.now() >= deadline) {
        throw new Error(`Cloud wait exceeded ${options.waitMinutes} minutes; run ${current.id} continues remotely and was not restarted or cancelled.`);
      }
      if (state.status !== 'completed') throw new Error(`Cloud run watch stopped before completion: ${error.message}`);
      current = { ...current, ...state };
    }
  }
  if (current.status !== 'completed' || !current.conclusion) {
    current = { ...current, ...JSON.parse(run('gh', ['run', 'view', String(current.id), '--repo', options.repo, '--json', 'status,conclusion,url'])) };
  }
  if (current.conclusion !== 'success') throw new Error(`Cloud build ${current.id} ended: ${current.conclusion}.`);
  if (options.channel === 'validation') {
    console.log(`Validation bundle ready in Actions run ${current.html_url}; it expires after one day and no Release was created.`);
    return;
  }
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
  if (options.repo !== 'CarlosZ16420/hamster-archive') {
    throw new Error('Public releases must mirror the private Release assets; they cannot run a separate local build.');
  }
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
    const qa = options.releaseKind === 'major' ? 'full' : options.qa === 'auto' ? 'targeted' : options.qa;
    run(process.execPath, [npmCli, 'run', 'release:local', '--', '--outputs', 'zip,installer', '--qa', qa], {
      stdio: 'inherit', timeout: 1800000
    });
  }
  const commit = run('git', ['rev-parse', 'HEAD']);
  const checkpoint = await openCheckpoint({ version, commit, request: { target: options.repo, mode: 'local' } });
  await runStage(checkpoint, 'publish-private', () => releaseArtifacts(options.repo, options.tag), {
    reusable: () => releaseState(options.repo, options.tag).state === 'complete-published'
  });
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  options.repo ||= run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (options.channel === 'stable') {
    const existing = releaseState(options.repo, options.tag);
    if (existing.state === 'complete-published') {
      console.log(`Release is already published and complete: ${existing.release.html_url}`);
      return;
    }
    if (existing.state === 'complete-draft') {
      await publishCompleteDraft(options.repo, options.tag, existing.release);
      return;
    }
  }
  try {
    if (options.mode === 'cloud') await cloud(options);
    else await local(options);
  } catch (error) {
    console.error(`Release did not complete: ${error.message}`);
    console.error(`Retry only the failed cloud jobs with "gh run rerun RUN_ID --failed --repo ${options.repo}". If the original run cannot be retried, reuse its one-day bundle with "npm run release -- --repo ${options.repo} --resume-run RUN_ID".`);
    throw error;
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { optionsFrom, findRequest, inferredReleaseKind };
