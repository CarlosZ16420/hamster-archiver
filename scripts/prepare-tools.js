#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { dependencyLock, verifyToolchain } = require('./verify-toolchain');

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(__dirname, '..');

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadPinnedSource(source, targetPath) {
  const url = new URL(source.url);
  if (url.protocol !== 'https:') throw new Error('第三方工具只允许从锁定的 HTTPS 地址下载。');
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const handle = await fsp.open(targetPath, 'w');
  try {
    for await (const chunk of response.body) await handle.write(chunk);
  } finally {
    await handle.close();
  }
  const digest = await hashFile(targetPath);
  if (digest !== source.sha256) throw new Error(`来源包 SHA-256 校验失败：${url}`);
}

async function extractArchive(sevenZipPath, archivePath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await execFileAsync(sevenZipPath, ['x', archivePath, `-o${destination}`, '-y'], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

async function findFile(root, expectedName) {
  const matches = [];
  async function walk(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.name.toLowerCase() === expectedName.toLowerCase()) matches.push(candidate);
    }
  }
  await walk(root);
  if (matches.length === 0) throw new Error(`来源包中找不到 ${expectedName}。`);
  return matches.sort((a, b) => a.length - b.length)[0];
}

async function replaceFile(sourcePath, relativeTarget) {
  const targetPath = path.join(projectRoot, relativeTarget);
  const incomingPath = targetPath + '.incoming';
  const backupPath = targetPath + '.previous';
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.copyFile(sourcePath, incomingPath);
  await fsp.rm(backupPath, { force: true });
  let backedUp = false;
  try {
    await fsp.rename(targetPath, backupPath);
    backedUp = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fsp.rename(incomingPath, targetPath);
    await fsp.rm(backupPath, { force: true });
  } catch (error) {
    await fsp.rm(incomingPath, { force: true }).catch(() => {});
    if (backedUp) await fsp.rename(backupPath, targetPath).catch(() => {});
    throw error;
  }
}

async function writeBuildInfo() {
  const sevenZip = dependencyLock.bundledTools.sevenZip;
  const ffmpeg = dependencyLock.bundledTools.ffmpeg;
  await fsp.writeFile(path.join(projectRoot, 'tools', '7zip', 'BUILD-INFO.txt'), [
    `7-Zip ${sevenZip.version} for Windows ${sevenZip.architecture}`,
    `Official source: ${sevenZip.source.url}`,
    `Source installer SHA-256: ${sevenZip.source.sha256}`,
    'Files used by Hamster Archiver: 7z.exe and 7z.dll',
    'License: GNU LGPL with the documented 7z.dll restrictions; see License.txt.',
    ''
  ].join('\n'), 'utf8');
  await fsp.writeFile(path.join(projectRoot, 'tools', 'ffmpeg', 'BUILD-INFO.txt'), [
    `FFmpeg ${ffmpeg.version} for Windows ${ffmpeg.architecture}`,
    `Immutable source: ${ffmpeg.source.url}`,
    `Source archive SHA-256: ${ffmpeg.source.sha256}`,
    'The application and release package use ffmpeg.exe only. FFprobe is not required or distributed.',
    'License: GPLv3; see LICENSE and README.txt in this directory.',
    ''
  ].join('\n'), 'utf8');
}

async function main() {
  if (process.platform !== 'win32') throw new Error('内置工具准备流程目前只支持 Windows x64。');
  const sevenZipOnly = process.argv.includes('--seven-zip-only');
  const bootstrapSevenZip = path.join(projectRoot, dependencyLock.bundledTools.sevenZip.executable);
  await fsp.access(bootstrapSevenZip);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'hamster-toolchain-'));
  try {
    const sevenZipSource = path.join(tempRoot, '7zip-installer.exe');
    const sevenZipExtract = path.join(tempRoot, '7zip');
    await downloadPinnedSource(dependencyLock.bundledTools.sevenZip.source, sevenZipSource);
    await extractArchive(bootstrapSevenZip, sevenZipSource, sevenZipExtract);
    const preparedSevenZip = await findFile(sevenZipExtract, '7z.exe');
    await replaceFile(preparedSevenZip, 'tools/7zip/7z.exe');
    await replaceFile(await findFile(sevenZipExtract, '7z.dll'), 'tools/7zip/7z.dll');
    await replaceFile(await findFile(sevenZipExtract, 'License.txt'), 'tools/7zip/License.txt');

    if (!sevenZipOnly) {
      const ffmpegSource = path.join(tempRoot, 'ffmpeg.7z');
      const ffmpegExtract = path.join(tempRoot, 'ffmpeg');
      await downloadPinnedSource(dependencyLock.bundledTools.ffmpeg.source, ffmpegSource);
      await extractArchive(preparedSevenZip, ffmpegSource, ffmpegExtract);
      await replaceFile(await findFile(ffmpegExtract, 'ffmpeg.exe'), 'tools/ffmpeg/ffmpeg.exe');
      await replaceFile(await findFile(ffmpegExtract, 'LICENSE'), 'tools/ffmpeg/LICENSE');
      await replaceFile(await findFile(ffmpegExtract, 'README.txt'), 'tools/ffmpeg/README.txt');
    }
    await writeBuildInfo();
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
  await verifyToolchain({ requireInstalledPackages: false, requireTools: true });
  console.log(sevenZipOnly
    ? '7-Zip 已从锁定来源恢复，全部内置工具通过版本检查。'
    : '7-Zip 与 FFmpeg 已从锁定来源恢复并通过版本检查。');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { downloadPinnedSource, extractArchive, findFile, hashFile };
