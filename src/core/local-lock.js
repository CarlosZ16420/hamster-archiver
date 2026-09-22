'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function ownerIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

async function acquireLocalLock(target, identity = {}) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  let handle;
  try { handle = await fs.open(target, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recoveryPath = `${target}.recovery`;
    let recovery;
    try { recovery = await fs.open(recoveryPath, 'wx'); }
    catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      throw new Error(`Another coordinator is checking lock ownership: ${target}`);
    }
    try {
      const raw = await fs.readFile(target, 'utf8').catch(() => '');
      let owner;
      try { owner = JSON.parse(raw); } catch { owner = null; }
      if (!owner || ownerIsAlive(owner.pid)) {
        throw new Error(`Lock is active or its owner cannot be proved dead: ${target}; owner=${raw.slice(0, 200)}`);
      }
      const stale = `${target}.stale.${randomUUID()}`;
      await fs.rename(target, stale);
      await fs.rm(stale, { force: true });
    } finally {
      await recovery.close();
      await fs.rm(recoveryPath, { force: true });
    }
    handle = await fs.open(target, 'wx');
  }
  const owner = JSON.stringify({ ...identity, pid: process.pid, startedAt: new Date().toISOString() });
  try { await handle.writeFile(owner); }
  catch (error) { await handle.close(); await fs.rm(target, { force: true }); throw error; }
  return async () => {
    await handle.close();
    if (await fs.readFile(target, 'utf8').catch(() => '') === owner) await fs.rm(target, { force: true });
  };
}

module.exports = { acquireLocalLock, ownerIsAlive };
