'use strict';

const { execFileSync } = require('node:child_process');

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000
  }).trim();
}

function parseArgs(argv) {
  const options = { waitSeconds: 0 };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--repo', '--wait-seconds'].includes(name) || !value) {
      throw new Error('Use --repo OWNER/REPO [--wait-seconds 0].');
    }
    if (name === '--repo') options.repo = value;
    else options.waitSeconds = Number(value);
  }
  if (!['CarlosZ16420/hamster-archive', 'CarlosZ16420/hamster-archiver'].includes(options.repo)) {
    throw new Error('Source CI receipts are restricted to the two Hamster GitHub repositories.');
  }
  if (!Number.isSafeInteger(options.waitSeconds) || options.waitSeconds < 0 || options.waitSeconds > 600) {
    throw new Error('CI receipt wait must be between 0 and 600 seconds.');
  }
  return options;
}

function classifyRuns(runs, commit) {
  const matching = (Array.isArray(runs) ? runs : []).filter(runItem =>
    runItem?.head_sha === commit && ['push', 'pull_request'].includes(runItem.event)
  );
  const successful = matching
    .filter(runItem => runItem.status === 'completed' && runItem.conclusion === 'success')
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))[0];
  return {
    successful: successful || null,
    active: matching.some(runItem => runItem.status !== 'completed')
  };
}

async function waitForReceipt({ loadRuns, commit, waitSeconds, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (true) {
    const classified = classifyRuns(await loadRuns(), commit);
    if (classified.successful) return classified.successful;
    if (!classified.active || Date.now() >= deadline) return null;
    await delay(Math.min(15000, Math.max(0, deadline - Date.now())));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const commit = run('git', ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('The checked-out release commit is invalid.');
  const receipt = await waitForReceipt({
    commit,
    waitSeconds: options.waitSeconds,
    loadRuns: async () => JSON.parse(run('gh', [
      'api', '--method', 'GET',
      `repos/${options.repo}/actions/workflows/ci.yml/runs`,
      '-f', `head_sha=${commit}`,
      '-f', 'per_page=100'
    ])).workflow_runs
  });
  if (!receipt) {
    console.error(`No successful exact-commit CI receipt was found for ${commit}; select the requested QA tier without restarting the release.`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    commit,
    workflowRunId: receipt.id,
    url: receipt.html_url,
    conclusion: receipt.conclusion
  }));
}

if (require.main === module) main().catch(error => {
  console.error(`Source CI receipt verification failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { classifyRuns, parseArgs, waitForReceipt };
