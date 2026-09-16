'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { makeLocalLayout } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const STAGES = Object.freeze([
  'source', 'qa', 'dependencies', 'build', 'smoke', 'zip', 'installer',
  'promote-current', 'publish-private', 'publish-public', 'mirror-cnb'
]);

function safePart(value) {
  const result = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (!result) throw new Error('Release checkpoint identity is empty.');
  return result;
}

function checkpointPath(identity, layout = makeLocalLayout(projectRoot)) {
  return path.join(layout.releaseRunsRoot, `${safePart(identity.version)}-${safePart(identity.commit).slice(0, 12)}.json`);
}

async function readCheckpoint(target) {
  try {
    return JSON.parse(await fsp.readFile(target, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCheckpoint(target, state) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  try {
    await fsp.rename(temporary, target);
  } catch (error) {
    if (process.platform !== 'win32' || !['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    await fsp.rm(target, { force: true });
    await fsp.rename(temporary, target);
  }
}

function assertIdentity(state, identity) {
  for (const key of ['version', 'commit']) {
    if (state[key] !== identity[key]) {
      throw new Error(`Release checkpoint ${key} does not match the requested release.`);
    }
  }
}

async function openCheckpoint(identity, options = {}) {
  const layout = options.layout || makeLocalLayout(projectRoot);
  const target = checkpointPath(identity, layout);
  let state = await readCheckpoint(target);
  if (state) {
    assertIdentity(state, identity);
    return { target, state };
  }
  state = {
    schemaVersion: 1,
    version: identity.version,
    commit: identity.commit,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    request: identity.request || {},
    stages: {}
  };
  await writeCheckpoint(target, state);
  return { target, state };
}

async function updateStage(checkpoint, stage, status, details = {}) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown release stage: ${stage}`);
  const now = new Date().toISOString();
  const prior = checkpoint.state.stages[stage] || { attempts: 0 };
  const attempts = status === 'running' ? prior.attempts + 1 : prior.attempts;
  checkpoint.state.stages[stage] = {
    ...prior,
    ...details,
    status,
    attempts,
    updatedAt: now
  };
  checkpoint.state.updatedAt = now;
  await writeCheckpoint(checkpoint.target, checkpoint.state);
  return checkpoint.state.stages[stage];
}

async function reusableStage(checkpoint, stage, predicate = () => true) {
  const receipt = checkpoint.state.stages[stage];
  return Boolean(receipt && receipt.status === 'success' && await predicate(receipt));
}

async function runStage(checkpoint, stage, action, options = {}) {
  if (await reusableStage(checkpoint, stage, options.reusable)) {
    console.log(`复用已完成阶段：${stage}`);
    return checkpoint.state.stages[stage].result;
  }
  await updateStage(checkpoint, stage, 'running', { error: null });
  try {
    const result = await action();
    await updateStage(checkpoint, stage, 'success', { completedAt: new Date().toISOString(), result: result ?? null });
    return result;
  } catch (error) {
    await updateStage(checkpoint, stage, 'failed', { error: error.message, failedAt: new Date().toISOString() });
    throw error;
  }
}

module.exports = {
  STAGES,
  checkpointPath,
  openCheckpoint,
  readCheckpoint,
  reusableStage,
  runStage,
  updateStage,
  writeCheckpoint
};
