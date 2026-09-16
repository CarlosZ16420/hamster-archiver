'use strict';

const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { assertWindowsHostContext, completeDraft, completePublishedRelease, errorText, getReleaseByTag, publishCompleteDraft, releaseArtifacts, releaseState, run, verifyFiles } = require('./release-publish');
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
  if (result.channel === 'stable' && result.qa === 'none') throw new Error('A stable Release must run formal QA; use targeted, full, or auto.');
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

function repoFromOrigin(commandRunner = run) {
  const remote = commandRunner('git', ['config', '--get', 'remote.origin.url']).replace(/\.git$/i, '');
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  if (!match) throw new Error('Could not infer a GitHub repository from origin; pass --repo OWNER/REPO.');
  return match[1];
}

function assertGithubAccess(repo, commandRunner = run, context = {}) {
  assertWindowsHostContext(context.env, context.platform);
  try {
    commandRunner('gh', ['api', `repos/${repo}`, '--method', 'GET', '--silent']);
  } catch (cause) {
    const details = errorText(cause);
    let code = 'GITHUB_ACCESS_CHECK_FAILED';
    let guidance = 'Check the reported GitHub API or CLI configuration error before retrying.';
    if (/HTTP\s*(?:403|404|422)\b|\bstatus\s*(?:403|404|422)\b|resource not accessible|permission denied/i.test(details)) {
      code = 'GITHUB_REPOSITORY_ACCESS_FAILED';
      guidance = 'Check the repository name, account permissions and API configuration; do not log in again automatically.';
    } else if (/HTTP\s*401\b|bad credentials|SEC_E_NO_CREDENTIALS|credential manager|not logged|gh auth login|GH_TOKEN/i.test(details)) {
      code = 'GITHUB_CREDENTIALS_UNAVAILABLE';
      guidance = 'Check the existing account in the normal Windows host credential context; do not search token locations or log in automatically.';
    } else if (/\bEOF\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|TLS|SSL|schannel|handshake|certificate|timed?\s*out|connection|no such host|proxy/i.test(details)) {
      code = 'GITHUB_NETWORK_FAILED';
      guidance = 'Check direct connectivity, DNS and TLS. This does not prove credentials are missing; do not add a proxy or disable certificate verification automatically.';
    }
    const error = new Error(`GitHub access check failed for ${repo} (${code}). ${guidance}`);
    error.code = code;
    error.cause = cause;
    throw error;
  }
}

function runInherited(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: 'inherit',
      windowsHide: true,
      timeout: options.timeout
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}.`));
    });
  });
}

async function buildCurrent() {
  const npmCli = String(process.env.npm_execpath || '').trim();
  if (!npmCli) throw new Error('Start with npm run release so the local Current builder can be located.');
  await runInherited(process.execPath, [npmCli, 'run', 'release:local'], { timeout: 1800000 });
}

async function runRemoteAndCurrent(remoteAction) {
  // Dispatch the cloud path first, then let the independent local Current build overlap it.
  const remotePromise = Promise.resolve(remoteAction());
  const currentPromise = buildCurrent();
  const [current, remote] = await Promise.allSettled([currentPromise, remotePromise]);
  if (current.status === 'rejected' || remote.status === 'rejected') {
    const details = [];
    if (remote.status === 'rejected') details.push(`cloud: ${remote.reason.message}`);
    if (current.status === 'rejected') details.push(`Current: ${current.reason.message}`);
    const error = new Error(details.join(' | '));
    error.runId = remote.status === 'rejected' ? remote.reason.runId : undefined;
    throw error;
  }
}

async function cloud(options) {
  const requestId = { tag: options.tag, id: randomUUID() };
  // Dispatch the current workflow definition, checking out the immutable tag inside it.
  const workflowArguments = ['workflow', 'run', 'package.yml', '--repo', options.repo, '--ref', 'main',
    '-f', `tag=${options.tag}`, '-f', `publish=${options.channel === 'stable'}`, '-f', `qa_level=${options.qa}`,
    '-f', `release_kind=${options.releaseKind}`, '-f', `request_id=${requestId.id}`];
  if (options.retryTest) workflowArguments.push('-f', `retry_test_file=${options.retryTest.replace(/\\/g, '/')}`);
  if (options.resumeRun) workflowArguments.push('-f', `resume_run_id=${options.resumeRun}`);
  run('gh', workflowArguments);
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
  if (current.conclusion !== 'success') {
    const error = new Error(`Cloud build ${current.id} ended: ${current.conclusion}.`);
    error.runId = current.id;
    throw error;
  }
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
  const commit = run('git', ['rev-parse', 'HEAD']);
  const checkpoint = await openCheckpoint({ version, commit, request: { target: options.repo, mode: 'local' } });
  const qaLevel = options.releaseKind === 'major' ? 'full' : options.qa === 'auto' ? 'targeted' : options.qa;
  const qaStrength = { none: 0, targeted: 1, full: 2 };
  await runStage(checkpoint, 'qa', async () => {
    if (options.resumeRun) {
      const receipt = JSON.parse(run('gh', [
        'run', 'view', options.resumeRun, '--repo', options.repo,
        '--json', 'displayTitle,jobs,url'
      ]));
      if (!receipt.displayTitle?.startsWith(`Windows release ${options.tag} / `)) {
        throw new Error(`Cloud run ${options.resumeRun} is not the requested ${options.tag} release run.`);
      }
      const qaJob = receipt.jobs?.find(job => job.name === 'qa');
      if (!qaJob || qaJob.conclusion !== 'success') {
        throw new Error(`Cloud run ${options.resumeRun} does not contain a successful formal QA job.`);
      }
      return { level: qaLevel, source: 'cloud', runId: options.resumeRun, url: receipt.url };
    }
    const qaArguments = [path.join('scripts', 'qa-plan.js'), '--execute', '--base', 'previous-release', '--level', qaLevel];
    run(process.execPath, qaArguments, { stdio: 'inherit', timeout: 1800000 });
    if (qaLevel === 'full') {
      const npmCli = String(process.env.npm_execpath || '').trim();
      if (!npmCli) throw new Error('Start with npm run release -- --mode local.');
      run(process.execPath, [npmCli, 'run', 'publish:check'], { stdio: 'inherit', timeout: 1800000 });
      run(process.execPath, [npmCli, 'run', 'verify:tools'], { stdio: 'inherit', timeout: 1800000 });
    }
    return { level: qaLevel, source: 'local' };
  }, { reusable: receipt => qaStrength[receipt.result?.level] >= qaStrength[qaLevel] });

  try {
    await verifyFiles();
    console.log('Reusing the complete exact-commit release bundle; no QA or package build was repeated.');
    await buildCurrent();
  } catch (reuseError) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Start with npm run release -- --mode local.');
    console.log(`No reusable local release bundle was found (${reuseError.message}). Building Current and formal files without repeating QA.`);
    run(process.execPath, [npmCli, 'run', 'release:local', '--', '--outputs', 'current,zip,installer'], {
      stdio: 'inherit', timeout: 1800000
    });
    await verifyFiles();
  }
  await runStage(checkpoint, 'publish-private', () => releaseArtifacts(options.repo, options.tag), {
    reusable: () => releaseState(options.repo, options.tag).state === 'complete-published'
  });
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  try {
    assertWindowsHostContext();
    options.repo ||= repoFromOrigin();
    assertGithubAccess(options.repo);
    if (options.channel === 'stable') {
      const existing = releaseState(options.repo, options.tag);
      if (existing.state === 'complete-published') {
        console.log(`Release is already published and complete: ${existing.release.html_url}`);
        await buildCurrent();
        return;
      }
      if (existing.state === 'complete-draft') {
        await runRemoteAndCurrent(() => publishCompleteDraft(options.repo, options.tag, existing.release));
        return;
      }
    }
    if (options.mode === 'cloud' && options.channel === 'stable') {
      await runRemoteAndCurrent(() => cloud(options));
    } else if (options.mode === 'cloud') await cloud(options);
    else await local(options);
  } catch (error) {
    console.error(`Release did not complete: ${error.message}`);
    if (error.code === 'WINDOWS_HOST_CONTEXT_REQUIRED' || error.code?.startsWith('GITHUB_')) {
      console.error('Stopped before dispatch or upload. No login, token search, proxy change or automatic retry was attempted. Local maintenance must start in the normal Windows host credential context.');
    } else if (error.runId) {
      console.error(`Retry failed jobs once with "gh run rerun ${error.runId} --failed --repo ${options.repo}". If cloud publication remains unavailable, use "npm run release -- --mode local --repo ${options.repo} --resume-run ${error.runId}"; its successful QA receipt is reused.`);
    } else {
      console.error('Correct the reported configuration error before one retry. If the same root cause appears again, stop and report it instead of restarting the release.');
    }
    throw error;
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { assertGithubAccess, buildCurrent, findRequest, inferredReleaseKind, optionsFrom, repoFromOrigin, runRemoteAndCurrent };
