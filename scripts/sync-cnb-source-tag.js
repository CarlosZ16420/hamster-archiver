'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--tag', '--github-repo', '--cnb-repo'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Use --tag vX.Y.Z --github-repo OWNER/REPO --cnb-repo GROUP/REPO.');
    }
    options[argv[index].slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return options;
}

function validateConfig(options, environment = process.env) {
  const tag = options.tag || environment.RELEASE_TAG || '';
  const githubRepo = options.githubRepo || environment.GITHUB_REPOSITORY || '';
  const cnbRepo = options.cnbRepo || environment.CNB_REPO_SLUG || '';
  const token = environment.CNB_TOKEN || '';
  if (environment.CNB_SYNC_ENABLED !== 'true') throw new Error('CNB synchronization is disabled.');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('The CNB source tag must be an exact vX.Y.Z tag.');
  if (githubRepo !== 'CarlosZ16420/hamster-archiver') {
    throw new Error('CNB source tags may come only from the public Hamster GitHub snapshot.');
  }
  if (cnbRepo.toLowerCase() !== 'carlosz16420/hamster-archive') {
    throw new Error('CNB source tag synchronization is restricted to the public Hamster CNB repository.');
  }
  if (!token) throw new Error('CNB_TOKEN is required to create a missing public source tag.');
  return { tag, githubRepo, cnbRepo, token };
}

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    ...options
  }).trim();
}

function remoteTagCommit(output, tag) {
  const entries = new Map(String(output || '').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [commit, ref] = line.trim().split(/\s+/, 2);
    return [ref, commit];
  }));
  return entries.get(`refs/tags/${tag}^{}`) || entries.get(`refs/tags/${tag}`) || '';
}

async function pushTagWithAskPass({ cnbUrl, tag, token, gitRunner = runGit }) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-cnb-git-'));
  const windows = process.platform === 'win32';
  const askPassPath = path.join(temporaryRoot, windows ? 'askpass.cmd' : 'askpass.sh');
  const askPass = windows
    ? '@echo off\r\necho %~1 | findstr /I "Username" >nul\r\nif errorlevel 1 (echo %CNB_TOKEN%) else (echo cnb)\r\n'
    : '#!/bin/sh\ncase "$1" in *Username*) printf "%s\\n" cnb ;; *) printf "%s\\n" "$CNB_TOKEN" ;; esac\n';
  try {
    await fs.writeFile(askPassPath, askPass, { encoding: 'utf8', mode: 0o700 });
    if (!windows) await fs.chmod(askPassPath, 0o700);
    gitRunner(['push', cnbUrl, `refs/tags/${tag}:refs/tags/${tag}`], {
      env: { ...process.env, CNB_TOKEN: token, GIT_ASKPASS: askPassPath, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function ensureCnbSourceTag(config, dependencies = {}) {
  const gitRunner = dependencies.gitRunner || runGit;
  const tagRef = `refs/tags/${config.tag}`;
  const peeledTagRef = `${tagRef}^{}`;
  const githubUrl = `https://github.com/${config.githubRepo}.git`;
  const cnbUrl = `https://cnb.cool/${config.cnbRepo}`;
  const localCommit = gitRunner(['rev-parse', `${config.tag}^{commit}`]);
  const githubCommit = remoteTagCommit(gitRunner(['ls-remote', githubUrl, tagRef, peeledTagRef]), config.tag);
  if (!githubCommit || githubCommit !== localCommit) {
    throw new Error('The local public source tag does not match the authoritative GitHub tag.');
  }
  const before = remoteTagCommit(gitRunner(['ls-remote', cnbUrl, tagRef, peeledTagRef]), config.tag);
  if (before) {
    if (before !== localCommit) throw new Error('CNB already contains a different commit for this version tag; it was not overwritten.');
    return { created: false, tag: config.tag, commit: localCommit };
  }
  const pushTag = dependencies.pushTag || (parameters => pushTagWithAskPass({ ...parameters, gitRunner }));
  await pushTag({ cnbUrl, tag: config.tag, token: config.token });
  const after = remoteTagCommit(gitRunner(['ls-remote', cnbUrl, tagRef, peeledTagRef]), config.tag);
  if (after !== localCommit) throw new Error('CNB tag push completed without a matching read-back.');
  return { created: true, tag: config.tag, commit: localCommit };
}

async function main() {
  const config = validateConfig(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(await ensureCnbSourceTag(config), null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(`CNB source tag synchronization failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { ensureCnbSourceTag, parseArgs, remoteTagCommit, validateConfig };
