'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertMatchingReleaseAssets, completeDraft, completePublishedRelease, downloadVerifiedReleaseAssets, expectedReleaseAssetNames, findReleaseByTag, getRelease, getReleaseByTag, hasCompleteReleaseAssets, isTransientUploadError, planUploads, parseArgs, preflight, publishCompleteDraft, releaseArtifacts, releaseState, uploadAssetWithRecovery, validateMirrorTarget } = require('../scripts/release-publish');
const { optionsFrom, findRequest } = require('../scripts/release');
const { readReleaseNotes, assertDraftNotes } = require('../scripts/release-publish');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('public releases cannot fall back to latest private patch notes or empty translations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-public-notes-'));
  try {
    const directory = path.join(root, 'docs', 'releases');
    await fs.mkdir(directory, { recursive: true });
    const privateBody = '## 中文\n单版本。\n## English\nSingle patch.';
    await fs.writeFile(path.join(directory, 'release-notes-v1.0.0.md'), privateBody);
    assert.equal((await readReleaseNotes('CarlosZ16420/hamster-archive', 'v1.0.0', root)).body, privateBody);
    await assert.rejects(readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root), { code: 'ENOENT' });
    const publicPath = path.join(directory, 'public-release-notes-v1.0.0.md');
    await fs.writeFile(publicPath, '## 中文\n完整范围。\n## English\n');
    await assert.rejects(readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root), /non-empty/);
    const publicBody = '## 中文\n完整范围。\n## English\nCumulative changes.';
    await fs.writeFile(publicPath, publicBody);
    assert.equal((await readReleaseNotes('CarlosZ16420/hamster-archiver', 'v1.0.0', root)).body, publicBody);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('draft continuation and read-back reject stale release text', () => {
  assert.throws(() => assertDraftNotes({ body: 'Old patch notes' }, 'Cumulative notes'), /Release notes differ/);
  assert.doesNotThrow(() => assertDraftNotes({ body: '## 中文\r\n说明\r\n' }, '## 中文\n说明\n'));
});

test('release lookup matches exact tags, including drafts', () => {
  const releases = [
    { tag_name: 'v4.5.18', draft: false },
    { tag_name: 'v4.6.0', draft: true, id: 7 },
    { tag_name: 'v4.60', draft: true, id: 8 }
  ];
  assert.equal(findReleaseByTag(releases, 'v4.6.0').id, 7);
  assert.equal(findReleaseByTag(releases, 'v4.6.1'), undefined);
});

test('release lookup paginates drafts and stops at the first exact match', () => {
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args[1]);
    if (args[1].includes('&page=1')) return JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ tag_name: `v0.0.${id}` })));
    if (args[1].includes('&page=2')) return JSON.stringify([{ tag_name: 'v4.6.0', draft: true, id: 9 }]);
    throw new Error('unexpected page');
  };
  assert.equal(getRelease('CarlosZ16420/hamster-archiver', 'v4.6.0', runner).id, 9);
  assert.equal(calls.length, 2);

  const firstPage = getRelease('CarlosZ16420/hamster-archiver', 'v4.5.18', (_command, args) => {
    calls.push(args[1]);
    return JSON.stringify([{ tag_name: 'v4.5.18', draft: false, id: 10 }]);
  });
  assert.equal(firstPage.id, 10);
  assert.equal(calls.at(-1).includes('page=2'), false);
});

test('release lookup returns null for a short page and rejects malformed pages', () => {
  const short = getRelease('CarlosZ16420/hamster-archiver', 'v4.6.1', () => JSON.stringify([]));
  assert.equal(short, null);
  assert.throws(() => getRelease('CarlosZ16420/hamster-archiver', 'v4.6.1', () => JSON.stringify({})), /invalid response/);
});

test('release lookup prefers the direct tag endpoint and falls back to the paginated list', () => {
  const direct = getReleaseByTag('CarlosZ16420/hamster-archiver', 'v4.6.1', (_command, args) => {
    assert.match(args[1], /releases\/tags\/v4\.6\.1$/);
    return JSON.stringify({ tag_name: 'v4.6.1', draft: true, id: 11 });
  });
  assert.equal(direct.id, 11);

  const fallback = getReleaseByTag('CarlosZ16420/hamster-archiver', 'v4.6.1', (_command, args) => {
    if (args[1].endsWith('/releases/tags/v4.6.1')) throw new Error('HTTP 404');
    return JSON.stringify([{ tag_name: 'v4.6.1', draft: true, id: 12 }]);
  });
  assert.equal(fallback.id, 12);
});

test('preflight preserves published refusal and returns a draft through injected GitHub calls', () => {
  const tag = `v${require('../package.json').version}`;
  const runnerFor = release => (command, args) => {
    if (command === 'git' && args[0] === 'status') return '';
    if (command === 'git' && args[0] === 'rev-parse') return 'abc123';
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) return JSON.stringify({ sha: 'abc123' });
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/releases?')) return JSON.stringify([release]);
    throw new Error(`unexpected call: ${command} ${args.join(' ')}`);
  };
  assert.throws(() => preflight('CarlosZ16420/hamster-archiver', tag, runnerFor({ tag_name: tag, draft: false })), /already published/);
  assert.equal(preflight('CarlosZ16420/hamster-archiver', tag, runnerFor({ tag_name: tag, draft: true })).draft, true);
});

test('draft resume skips identical assets and uploads only missing files', () => {
  const zip = { name: 'app.zip', size: 42, digest: 'sha256:abc' };
  const exe = { name: 'app.exe', size: 50, digest: 'sha256:def' };
  assert.deepEqual(planUploads([zip, exe], [zip]), [exe]);
});

test('release publication and CNB mirroring share the exact four expected attachment names', () => {
  assert.deepEqual(expectedReleaseAssetNames('v4.6.1'), [
    'HamsterArchiver-v4.6.1-win-x64.zip',
    'HamsterArchiver-v4.6.1-win-x64.zip.sha256',
    'HamsterArchiver-Setup-v4.6.1-win-x64.exe',
    'HamsterArchiver-Setup-v4.6.1-win-x64.exe.sha256'
  ]);
});

test('public GitHub Release mirroring requires the exact private snapshot mapping', () => {
  const tag = `v${require('../package.json').version}`;
  const runner = (_command, args) => {
    if (args[0] === 'status') return '';
    if (args[0] === 'rev-parse') return 'abc123def4567890';
    if (args[1] === `repos/CarlosZ16420/hamster-archive/commits/${tag}`) {
      return JSON.stringify({ sha: 'abc123def4567890' });
    }
    if (args[1] === `repos/CarlosZ16420/hamster-archiver/commits/${tag}`) {
      return JSON.stringify({ sha: 'public123', commit: { message: 'Snapshot abc123def456: release' } });
    }
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  assert.equal(validateMirrorTarget(
    'CarlosZ16420/hamster-archive', 'CarlosZ16420/hamster-archiver', tag, runner
  ), 'abc123def4567890');
  assert.throws(() => validateMirrorTarget(
    'CarlosZ16420/hamster-archiver', 'CarlosZ16420/hamster-archive', tag, runner
  ), /restricted/);
});

function completeRelease(tag, draft) {
  return {
    tag_name: tag,
    draft,
    prerelease: false,
    body: '## 中文\n完整说明。\n## English\nComplete notes.',
    html_url: `https://github.test/releases/tag/${tag}`,
    assets: expectedReleaseAssetNames(tag).map((name, index) => ({
      name,
      size: index + 1,
      digest: `sha256:${String(index + 1).repeat(64)}`
    }))
  };
}

async function makeReleaseNotes(tag, body = '## 中文\n完整说明。\n## English\nComplete notes.') {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-release-flow-'));
  const notesDir = path.join(sourceRoot, 'docs', 'releases');
  await fs.mkdir(notesDir, { recursive: true });
  await fs.writeFile(path.join(notesDir, `release-notes-${tag}.md`), body);
  return sourceRoot;
}

function localAssets(tag) {
  return expectedReleaseAssetNames(tag).map((name, index) => ({
    name,
    path: path.join('C:\\release', name),
    size: index + 1,
    digest: `sha256:${String(index + 1).repeat(64)}`
  }));
}

test('public mirroring accepts only the four byte-identical private Release assets', () => {
  const tag = 'v4.6.8';
  const assets = localAssets(tag);
  assert.doesNotThrow(() => assertMatchingReleaseAssets(assets, completeRelease(tag, false), tag));
  assert.throws(() => assertMatchingReleaseAssets(assets, { ...completeRelease(tag, false), assets: [] }, tag), /complete published/);
});

test('public mirroring downloads the private bundle without invoking a build', async () => {
  const tag = 'v4.6.8';
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args);
    const directory = args[args.indexOf('--dir') + 1];
    for (const name of expectedReleaseAssetNames(tag).filter(name => !name.endsWith('.sha256'))) {
      require('node:fs').writeFileSync(path.join(directory, name), name);
      const digest = require('node:crypto').createHash('sha256').update(name).digest('hex');
      require('node:fs').writeFileSync(path.join(directory, `${name}.sha256`), `${digest} *${name}\r\n`);
    }
    return '';
  };
  const downloaded = await downloadVerifiedReleaseAssets('CarlosZ16420/hamster-archive', tag, runner);
  try {
    assert.equal(downloaded.assets.length, 4);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 3), ['release', 'download', tag]);
    assert.ok(!calls[0].includes('build'));
  } finally {
    await downloaded.cleanup();
  }
});

function releaseRunner(tag, getCurrentRelease, onReleaseCommand = () => {}) {
  return (command, args, options) => {
    if (command === 'git' && args[0] === 'status') return '';
    if (command === 'git' && args[0] === 'rev-parse') return 'abc123';
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) return JSON.stringify({ sha: 'abc123' });
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/releases/tags/')) return JSON.stringify(getCurrentRelease());
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/releases?')) {
      const release = getCurrentRelease();
      return JSON.stringify(release ? [release] : []);
    }
    if (command === 'gh' && args[0] === 'release') return onReleaseCommand(args, options);
    throw new Error(`unexpected call: ${command} ${args.join(' ')}`);
  };
}

test('complete means exactly four verified assets in either draft or published state', () => {
  const tag = 'v4.6.1';
  const draft = completeRelease(tag, true);
  assert.equal(hasCompleteReleaseAssets(draft, tag), true);
  assert.equal(completeDraft(draft, tag), true);
  assert.equal(completePublishedRelease(draft, tag), false);
  assert.equal(completePublishedRelease({ ...draft, draft: false }, tag), true);
  assert.equal(hasCompleteReleaseAssets({ ...draft, assets: [...draft.assets, { name: 'unexpected.bin', size: 1, digest: `sha256:${'a'.repeat(64)}` }] }, tag), false);
});

test('release state treats complete published releases as success and complete drafts as publishable', () => {
  const tag = `v${require('../package.json').version}`;
  const runnerFor = release => (command, args) => {
    if (command === 'git' && args[0] === 'status') return '';
    if (command === 'git' && args[0] === 'rev-parse') return 'abc123';
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/commits/')) return JSON.stringify({ sha: 'abc123' });
    if (command === 'gh' && args[0] === 'api' && args[1].includes('/releases/tags/')) return JSON.stringify(release);
    throw new Error(`unexpected call: ${command} ${args.join(' ')}`);
  };
  assert.equal(releaseState('CarlosZ16420/hamster-archive', tag, runnerFor(completeRelease(tag, true))).state, 'complete-draft');
  assert.equal(releaseState('CarlosZ16420/hamster-archive', tag, runnerFor(completeRelease(tag, false))).state, 'complete-published');
  assert.throws(() => releaseState('CarlosZ16420/hamster-archive', tag, runnerFor({ ...completeRelease(tag, false), assets: [] })), /incomplete/);
});

test('a complete draft publishes directly with notes read-back and no local artifact verification', async () => {
  const tag = 'v1.0.0';
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-direct-publish-'));
  try {
    const notesDir = path.join(sourceRoot, 'docs', 'releases');
    await fs.mkdir(notesDir, { recursive: true });
    await fs.writeFile(path.join(notesDir, `release-notes-${tag}.md`), '## 中文\n完整说明。\n## English\nComplete notes.');
    let release = completeRelease(tag, true);
    const calls = [];
    const runner = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'gh' && args[0] === 'release' && args[1] === 'edit') {
        release = { ...release, draft: false };
        return '';
      }
      if (command === 'gh' && args[0] === 'api' && args[1].includes('/releases/tags/')) return JSON.stringify(release);
      throw new Error(`unexpected call: ${command} ${args.join(' ')}`);
    };
    const published = await publishCompleteDraft('CarlosZ16420/hamster-archive', tag, release, runner, sourceRoot);
    assert.equal(published.draft, false);
    assert.equal(calls.filter(call => call[0] === 'gh' && call[1] === 'release').length, 1);
  } finally { await fs.rm(sourceRoot, { recursive: true, force: true }); }
});

test('a missing Release uses the GitHub CLI native create-with-assets transaction and finishes published', async () => {
  const tag = `v${require('../package.json').version}`;
  const sourceRoot = await makeReleaseNotes(tag);
  const assets = localAssets(tag);
  let release = null;
  let createArgs;
  const runner = releaseRunner(tag, () => release, args => {
    if (args[1] !== 'create') throw new Error(`unexpected release command: ${args.join(' ')}`);
    createArgs = args;
    release = completeRelease(tag, false);
    return 'https://github.test/release';
  });
  try {
    const published = await releaseArtifacts('CarlosZ16420/hamster-archive', tag, {
      commandRunner: runner, fileVerifier: async () => assets, sourceRoot, wait: async () => {}, waitMs: 0
    });
    assert.equal(published.draft, false);
    assert.equal(createArgs.includes('--draft'), false);
    assert.deepEqual(assets.map(asset => asset.path).filter(assetPath => createArgs.includes(assetPath)), assets.map(asset => asset.path));
  } finally { await fs.rm(sourceRoot, { recursive: true, force: true }); }
});

test('a partial draft uploads only missing verified assets and publishes in the same operation', async () => {
  const tag = `v${require('../package.json').version}`;
  const sourceRoot = await makeReleaseNotes(tag);
  const assets = localAssets(tag);
  let release = { ...completeRelease(tag, true), assets: [completeRelease(tag, true).assets[0]] };
  const uploaded = [];
  const runner = releaseRunner(tag, () => release, args => {
    if (args[1] === 'upload') {
      const asset = assets.find(item => item.path === args[3]);
      uploaded.push(asset.name);
      release = { ...release, assets: [...release.assets, asset] };
      return '';
    }
    if (args[1] === 'edit') {
      release = { ...release, draft: false };
      return '';
    }
    throw new Error(`unexpected release command: ${args.join(' ')}`);
  });
  try {
    const published = await releaseArtifacts('CarlosZ16420/hamster-archive', tag, {
      commandRunner: runner, fileVerifier: async () => assets, sourceRoot, wait: async () => {}, waitMs: 0
    });
    assert.equal(published.draft, false);
    assert.deepEqual(uploaded, assets.slice(1).map(asset => asset.name));
  } finally { await fs.rm(sourceRoot, { recursive: true, force: true }); }
});

test('a failed native create resumes the draft it left behind instead of creating another Release', async () => {
  const tag = `v${require('../package.json').version}`;
  const sourceRoot = await makeReleaseNotes(tag);
  const assets = localAssets(tag);
  let release = null;
  let creates = 0;
  let waits = 0;
  const runner = releaseRunner(tag, () => release, args => {
    if (args[1] === 'create') {
      creates += 1;
      release = { ...completeRelease(tag, true), assets: [assets[0]] };
      const error = new Error('connection closed');
      error.stderr = 'Post https://uploads.github.com/: EOF';
      throw error;
    }
    if (args[1] === 'upload') {
      const asset = assets.find(item => item.path === args[3]);
      release = { ...release, assets: [...release.assets, asset] };
      return '';
    }
    if (args[1] === 'edit') {
      release = { ...release, draft: false };
      return '';
    }
    throw new Error(`unexpected release command: ${args.join(' ')}`);
  });
  try {
    const published = await releaseArtifacts('CarlosZ16420/hamster-archive', tag, {
      commandRunner: runner, fileVerifier: async () => assets, sourceRoot,
      wait: async () => { waits += 1; }, waitMs: 0
    });
    assert.equal(published.draft, false);
    assert.equal(creates, 1);
    assert.equal(waits, 1);
  } finally { await fs.rm(sourceRoot, { recursive: true, force: true }); }
});

test('an ambiguous EOF upload performs one delayed read-back and does not upload an asset twice', async () => {
  const tag = `v${require('../package.json').version}`;
  const asset = localAssets(tag)[0];
  const body = '## 中文\n完整说明。\n## English\nComplete notes.';
  let release = { ...completeRelease(tag, true), body, assets: [] };
  let uploads = 0;
  let waits = 0;
  const runner = releaseRunner(tag, () => release, args => {
    if (args[1] !== 'upload') throw new Error(`unexpected release command: ${args.join(' ')}`);
    uploads += 1;
    release = { ...release, assets: [asset] };
    const error = new Error('upload failed');
    error.stderr = 'Post https://uploads.github.com/: EOF';
    throw error;
  });
  const observed = await uploadAssetWithRecovery('CarlosZ16420/hamster-archive', tag, asset, body, runner, async () => { waits += 1; }, 0);
  assert.equal(observed.assets[0].name, asset.name);
  assert.equal(uploads, 1);
  assert.equal(waits, 1);
  assert.equal(isTransientUploadError({ stderr: 'HTTP 503 Service Unavailable' }), true);
  assert.equal(isTransientUploadError(new Error('permission denied')), false);
});

test('a transient upload failure retries exactly once when delayed read-back confirms the asset is absent', async () => {
  const tag = `v${require('../package.json').version}`;
  const asset = localAssets(tag)[0];
  const body = '## 中文\n完整说明。\n## English\nComplete notes.';
  let release = { ...completeRelease(tag, true), body, assets: [] };
  let uploads = 0;
  let waits = 0;
  const runner = releaseRunner(tag, () => release, args => {
    if (args[1] !== 'upload') throw new Error(`unexpected release command: ${args.join(' ')}`);
    uploads += 1;
    if (uploads === 1) {
      const error = new Error('read ECONNRESET');
      error.stderr = 'read ECONNRESET';
      throw error;
    }
    release = { ...release, assets: [asset] };
    return '';
  });
  const observed = await uploadAssetWithRecovery('CarlosZ16420/hamster-archive', tag, asset, body, runner, async () => { waits += 1; }, 0);
  assert.equal(observed, null);
  assert.equal(uploads, 2);
  assert.equal(waits, 1);
});

test('draft resume refuses conflicting or unverifiable files without overwriting', () => {
  const asset = { name: 'app.zip', size: 42, digest: 'sha256:abc' };
  for (const remote of [{ ...asset, size: 43 }, { ...asset, digest: 'sha256:other' }, { name: asset.name, size: 42 }]) {
    assert.throws(() => planUploads([asset], [remote]), /no file was overwritten/);
  }
});

test('cloud launcher uses exact request identity rather than another run of the same version', () => {
  const runs = [{ id: 1, display_title: 'Windows release v1.0.0 / earlier' }, { id: 2, display_title: 'Windows release v1.0.0 / current' }];
  assert.equal(findRequest(runs, { tag: 'v1.0.0', id: 'current' }).id, 2);
  assert.equal(findRequest(runs, { tag: 'v1.0.0', id: 'missing' }), undefined);
});

test('release mode and polling are explicit and bounded', () => {
  assert.equal(optionsFrom([]).mode, 'cloud');
  assert.equal(optionsFrom([]).channel, 'stable');
  assert.equal(optionsFrom([]).qa, 'auto');
  assert.equal(optionsFrom([]).releaseKind, 'patch');
  assert.equal(optionsFrom(['--mode', 'local']).mode, 'local');
  assert.equal(optionsFrom(['--release-kind', 'major']).releaseKind, 'major');
  assert.equal(optionsFrom(['--channel', 'validation']).channel, 'validation');
  assert.equal(optionsFrom(['--retry-test', 'test/release-local.test.js']).retryTest, 'test/release-local.test.js');
  for (const value of ['NaN', '0', '1000']) assert.throws(() => optionsFrom(['--wait-minutes', value]));
  assert.throws(() => optionsFrom(['--mode', 'auto']));
  assert.throws(() => parseArgs(['upload', '--repo']));
});
