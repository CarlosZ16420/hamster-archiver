'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const lock = require('./tool-lock.json');

function assertSevenZipVersion(output) {
  const reported = /7-Zip(?:\s+\(z\))?\s+(\d+\.\d+)\b/.exec(String(output))?.[1];
  if (reported !== lock.sevenZip.version) {
    throw new Error(`7-Zip executable version disagrees with its lock (reported ${reported || 'unknown'}).`);
  }
}

async function prepareTools(cacheRoot) {
  if (process.platform !== 'darwin') throw new Error('macOS tools must be prepared on macOS.');
  const archive = path.join(cacheRoot, `7z${lock.sevenZip.version.replace('.', '')}-mac.tar.xz`);
  const toolRoot = path.join(cacheRoot, `7zip-${lock.sevenZip.version}`);
  await fs.mkdir(cacheRoot, { recursive: true });
  let data;
  try { data = await fs.readFile(archive); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(lock.sevenZip.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`7-Zip download failed: HTTP ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.length > 16 * 1024 * 1024) throw new Error('7-Zip archive exceeds the expected size limit.');
    await fs.writeFile(archive, data, { flag: 'wx' });
  }
  const digest = crypto.createHash('sha256').update(data).digest('hex');
  if (digest !== lock.sevenZip.sha256) throw new Error('The official macOS 7-Zip archive failed SHA-256 verification.');
  await fs.mkdir(toolRoot, { recursive: true });
  execFileSync('tar', ['-xJf', archive, '-C', toolRoot, ...lock.sevenZip.files], { stdio: 'inherit' });
  const binary = path.join(toolRoot, '7zz');
  await fs.chmod(binary, 0o755);
  const architectures = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/);
  if (!architectures.includes('x86_64') || !architectures.includes('arm64')) {
    throw new Error(`Official 7-Zip binary is not universal: ${architectures.join(', ')}`);
  }
  const version = execFileSync(binary, ['i'], { encoding: 'utf8' });
  assertSevenZipVersion(version);
  return { root: toolRoot, binary, license: path.join(toolRoot, 'License.txt'), lock: lock.sevenZip };
}

module.exports = { assertSevenZipVersion, prepareTools };
