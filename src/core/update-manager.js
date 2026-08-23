'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { verifyFileIntegrityEntries } = require('./tool-integrity');

const execFileAsync = promisify(execFile);
const UPDATE_LAUNCH_TIMEOUT_MS = 8_000;

const UPDATE_LAUNCHER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$workerScript = Join-Path $PSScriptRoot 'apply-update.ps1'
$powerShell = Join-Path $PSHOME 'powershell.exe'
$quotedWorker = '"' + $workerScript.Replace('"', '\"') + '"'
Start-Process -FilePath $powerShell -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$quotedWorker -WindowStyle Hidden | Out-Null
`;

const INSTALL_STAGE_ITEMS_SCRIPT = String.raw`
function Install-StageItems([object[]]$Items, [string]$DestinationRoot) {
  foreach ($item in $Items) {
    $destination = Join-Path $DestinationRoot $item.Name
    # Copy-Item nests a source directory when its destination directory already
    # exists (resources -> resources\resources). Remove the backed-up old item
    # first so the new directory is installed at the exact portable-app path.
    if (Test-Path -LiteralPath $destination) {
      Remove-Item -LiteralPath $destination -Recurse -Force
    }
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
  }
}
`;

const APPLY_UPDATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath([string]$env:HAMSTER_UPDATE_APP_ROOT)
$stageRoot = [IO.Path]::GetFullPath([string]$env:HAMSTER_UPDATE_STAGE_ROOT)
$runRoot = [IO.Path]::GetFullPath([string]$env:HAMSTER_UPDATE_RUN_ROOT)
$validationFile = [IO.Path]::GetFullPath([string]$env:HAMSTER_UPDATE_VALIDATION_FILE)
$startedFile = Join-Path $runRoot 'started.json'
$targetPid = [int]$env:HAMSTER_UPDATE_TARGET_PID
$version = [string]$env:HAMSTER_UPDATE_VERSION
$logFile = Join-Path $runRoot 'update.log'

function Normalize-Version([string]$Value) {
  $normalized = ([string]$Value).Trim()
  if ($normalized.StartsWith('v', [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalized = $normalized.Substring(1)
  }
  return $normalized
}

function Write-UpdateLog([string]$Message) {
  $stamp = (Get-Date).ToString('s')
  Add-Content -LiteralPath $logFile -Value "$stamp $Message" -Encoding UTF8
}

${INSTALL_STAGE_ITEMS_SCRIPT}

try {
  Set-Content -LiteralPath $startedFile -Value (@{ pid = $PID; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json) -Encoding UTF8
  Write-UpdateLog "等待主程序退出：PID $targetPid"
  $deadline = (Get-Date).AddSeconds(90)
  while ($null -ne (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if ($null -ne (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) { throw '主程序在 90 秒内没有退出。' }

  $backupRoot = Join-Path $runRoot 'rollback'
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $stageItems = @(Get-ChildItem -LiteralPath $stageRoot -Force | Where-Object { $_.Name -ne 'userdata' })
  foreach ($item in $stageItems) {
    $existing = Join-Path $appRoot $item.Name
    if (Test-Path -LiteralPath $existing) {
      Copy-Item -LiteralPath $existing -Destination (Join-Path $backupRoot $item.Name) -Recurse -Force
    }
  }
  Write-UpdateLog "已创建程序文件回滚副本。"

  Install-StageItems -Items $stageItems -DestinationRoot $appRoot
  Write-UpdateLog "已写入版本 $version 的程序文件，启动验证进程。"

  $newExe = Join-Path $appRoot 'HamsterArchiver.exe'
  if (-not (Test-Path -LiteralPath $newExe)) { throw '更新包中缺少 HamsterArchiver.exe。' }
  $child = Start-Process -FilePath $newExe -WorkingDirectory $appRoot -PassThru
  $validationDeadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $validationDeadline) {
    if (Test-Path -LiteralPath $validationFile) { break }
    if ($child.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $validationFile)) {
    if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    throw '新版本未在 45 秒内完成启动验证。'
  }
  $validatedVersion = [string]((Get-Content -LiteralPath $validationFile -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  if ((Normalize-Version $validatedVersion) -ne (Normalize-Version $version)) {
    if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    throw "启动验证版本不一致：期望 $version，实际 $validatedVersion。"
  }

  Set-Content -LiteralPath (Join-Path $runRoot 'completed.json') -Value (@{ version = $version; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json) -Encoding UTF8
  Write-UpdateLog '更新验证成功。'
  $cleanup = "Start-Sleep -Seconds 3; Remove-Item -LiteralPath '$($runRoot.Replace("'", "''"))' -Recurse -Force -ErrorAction SilentlyContinue"
  Start-Process powershell.exe -ArgumentList '-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',$cleanup -WindowStyle Hidden
}
catch {
  Write-UpdateLog "更新失败：$($_.Exception.Message)"
  $backupRoot = Join-Path $runRoot 'rollback'
  if (Test-Path -LiteralPath $backupRoot) {
    $stageItems = @(Get-ChildItem -LiteralPath $stageRoot -Force | Where-Object { $_.Name -ne 'userdata' })
    foreach ($item in $stageItems) {
      Remove-Item -LiteralPath (Join-Path $appRoot $item.Name) -Recurse -Force -ErrorAction SilentlyContinue
    }
    foreach ($item in Get-ChildItem -LiteralPath $backupRoot -Force) {
      Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $appRoot $item.Name) -Recurse -Force
    }
    Write-UpdateLog '已恢复旧版本程序文件。'
    $oldExe = Join-Path $appRoot 'HamsterArchiver.exe'
    if (Test-Path -LiteralPath $oldExe) { Start-Process -FilePath $oldExe -WorkingDirectory $appRoot }
  }
  Set-Content -LiteralPath (Join-Path $runRoot 'failed.json') -Value (@{ version = $version; error = $_.Exception.Message; failedAt = (Get-Date).ToString('o') } | ConvertTo-Json) -Encoding UTF8
}
`;

function manualUpdateInstructions(language = 'zh-CN') {
  if (language === 'en-US') {
    return [
      '1. In the old version, use Export warehouse to create a warehouse ZIP, then exit Hamster Archiver completely.',
      '2. Download the latest Windows x64 ZIP from GitHub Releases and extract it into a new directory. Do not replace only the EXE or overwrite a running directory.',
      '3. Run HamsterArchiver.exe from the new directory, open Warehouse, choose Import external warehouse, and select the ZIP exported in step 1.',
      '4. Verify the version, warehouse records and thumbnails. Keep the old program directory until the imported warehouse has been checked.'
    ].join('\n');
  }
  return [
    '1. 在旧版本的“仓库”中使用“导出仓库”生成仓库压缩包，然后完全退出 Hamster Archiver。',
    '2. 从 GitHub Releases 下载最新的 Windows x64 压缩包，完整解压到一个新文件夹；不要只替换 EXE，也不要覆盖正在运行的旧目录。',
    '3. 运行新目录中的 HamsterArchiver.exe，在“仓库”中选择“并入外部仓库”，导入第 1 步生成的仓库压缩包。',
    '4. 确认版本号、仓库记录和缩略图正常；完成核对前请保留旧程序目录。'
  ].join('\n');
}

function resolvePowerShellExecutable(environment = process.env, existsSync = fs.existsSync) {
  const windowsRoot = environment.SystemRoot || environment.WINDIR;
  if (windowsRoot) {
    const systemPowerShell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(systemPowerShell)) return systemPowerShell;
  }
  return 'powershell.exe';
}

function normalizeDigest(value) {
  const match = String(value || '').trim().match(/(?:sha256\s*[:=]\s*)?([a-f0-9]{64})/i);
  return match ? match[1].toLowerCase() : '';
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v(?=\d)/i, '');
}

async function fetchDigestSidecar(url, fetchImpl) {
  if (!url) return '';
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('SHA256 摘要地址不是受信任的 GitHub HTTPS 地址。');
  }
  const response = await fetchImpl(parsed.href, {
    headers: { Accept: 'text/plain', 'User-Agent': 'hamster-archiver-update-manager' }
  });
  if (!response.ok) throw new Error(`SHA256 摘要下载失败（HTTP ${response.status}）。`);
  return normalizeDigest(await response.text());
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadFile(url, targetPath, fetchImpl, onProgress = () => {}) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('更新包地址不是受信任的 GitHub HTTPS 地址。');
  }
  const response = await fetchImpl(parsed.href, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'hamster-archiver-update-manager' }
  });
  if (!response.ok) throw new Error(`更新包下载失败（HTTP ${response.status}）。`);
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) throw new Error('当前运行环境不支持流式下载更新包。');
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const handle = await fsp.open(targetPath, 'w');
  let downloadedBytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      await handle.write(result.value);
      downloadedBytes += result.value.byteLength;
      onProgress({ stage: 'downloading', downloadedBytes, totalBytes, percentage: totalBytes
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0 });
    }
  } finally {
    await handle.close();
  }
}

async function extractArchive(sevenZipPath, archivePath, destination) {
  await fsp.mkdir(destination, { recursive: true });
  await execFileAsync(sevenZipPath, ['x', archivePath, `-o${destination}`, '-y'], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function locatePackageRoot(extractRoot) {
  const candidates = [extractRoot];
  for (const entry of await fsp.readdir(extractRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(extractRoot, entry.name));
  }
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, 'HamsterArchiver.exe')) &&
        await exists(path.join(candidate, 'release-manifest.json'))) return candidate;
  }
  throw new Error('更新包目录结构无效，找不到程序文件。');
}

async function exists(targetPath) {
  try { await fsp.access(targetPath); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function prepareUpdate({ applicationRoot, userDataDirectory, sevenZipPath, currentVersion, release, fetchImpl, onProgress = () => {} }) {
  if (process.platform !== 'win32') throw new Error('自动更新目前仅支持 Windows 便携版。');
  if (!release?.asset?.downloadUrl) throw new Error('这个 Release 没有可用的 Windows 更新包。');
  const expectedDigest = normalizeDigest(release.asset.digest) ||
    await fetchDigestSidecar(release.asset.digestDownloadUrl, fetchImpl);
  if (!expectedDigest) throw new Error('Release 缺少 SHA256 摘要，已停止更新。');
  const version = String(release.latestVersion || '').replace(/[^0-9A-Za-z.-]/g, '_');
  const runRoot = path.join(path.resolve(userDataDirectory), 'updates', `${version}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  const archivePath = path.join(runRoot, 'package.zip');
  const extractRoot = path.join(runRoot, 'extracted');
  try {
    await fsp.mkdir(runRoot, { recursive: true });
    await downloadFile(release.asset.downloadUrl, archivePath, fetchImpl, onProgress);
    onProgress({ stage: 'verifying', downloadedBytes: release.asset.size || 0, totalBytes: release.asset.size || 0, percentage: 100 });
    const actualDigest = await hashFile(archivePath);
    if (actualDigest !== expectedDigest) throw new Error('更新包 SHA256 校验失败，文件可能已损坏。');
    await extractArchive(sevenZipPath, archivePath, extractRoot);
    const packageRoot = await locatePackageRoot(extractRoot);
    const manifest = JSON.parse(await fsp.readFile(path.join(packageRoot, 'release-manifest.json'), 'utf8'));
    if (normalizeVersion(manifest.version) !== normalizeVersion(release.latestVersion)) {
      throw new Error('更新包版本与 Release 标签不一致。');
    }
    if (manifest.schemaVersion !== 2) throw new Error('更新包发行清单版本不受支持。');
    await verifyFileIntegrityEntries(packageRoot, manifest.integrity?.files);
    onProgress({ stage: 'prepared', downloadedBytes: release.asset.size || 0, totalBytes: release.asset.size || 0, percentage: 100 });
    return { runRoot, packageRoot, archivePath, version: release.latestVersion, currentVersion, applicationRoot: path.resolve(applicationRoot) };
  } catch (error) {
    await fsp.rm(runRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function waitForUpdaterStart(child, startedFile, {
  timeoutMs = UPDATE_LAUNCH_TIMEOUT_MS,
  intervalMs = 100,
  existsImpl = exists,
  delayImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
} = {}) {
  let launchError = null;
  child.on('error', (error) => { launchError = error; });
  await new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onInitialError);
      resolve();
    };
    const onInitialError = (error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onInitialError);
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await existsImpl(startedFile)) return;
    if (launchError) throw launchError;
    if (child.exitCode !== null && child.exitCode !== undefined && child.exitCode !== 0) {
      throw new Error(`PowerShell 更新助手过早退出（代码 ${child.exitCode}）。`);
    }
    await delayImpl(intervalMs);
  }
  throw new Error(`PowerShell 更新助手在 ${Math.ceil(timeoutMs / 1000)} 秒内没有确认启动。`);
}

async function launchUpdate({ prepared, targetPid }, {
  spawnImpl = spawn,
  existsSyncImpl = fs.existsSync,
  startupTimeoutMs = UPDATE_LAUNCH_TIMEOUT_MS,
  startupPollIntervalMs = 100,
  existsImpl = exists,
  delayImpl
} = {}) {
  const validationFile = path.join(prepared.runRoot, 'validation.json');
  const scriptPath = path.join(prepared.runRoot, 'apply-update.ps1');
  const launcherScriptPath = path.join(prepared.runRoot, 'launch-update.ps1');
  const startedFile = path.join(prepared.runRoot, 'started.json');
  const launcherLogPath = path.join(prepared.runRoot, 'launcher.log');
  await fsp.writeFile(scriptPath, `\uFEFF${APPLY_UPDATE_SCRIPT}`, 'utf8');
  await fsp.writeFile(launcherScriptPath, `\uFEFF${UPDATE_LAUNCHER_SCRIPT}`, 'utf8');
  const launcherLogFd = fs.openSync(launcherLogPath, 'a');
  let child;
  try {
    child = spawnImpl(resolvePowerShellExecutable(process.env, existsSyncImpl), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcherScriptPath
    ], {
      // A detached Windows PowerShell process can exit with code 0 without running
      // -File. This attached broker uses Start-Process to create the independent
      // worker; the worker must then prove it started by writing started.json.
      detached: false,
      windowsHide: true,
      stdio: ['ignore', launcherLogFd, launcherLogFd],
      env: {
        ...process.env,
        HAMSTER_UPDATE_APP_ROOT: prepared.applicationRoot,
        HAMSTER_UPDATE_STAGE_ROOT: prepared.packageRoot,
        HAMSTER_UPDATE_RUN_ROOT: prepared.runRoot,
        HAMSTER_UPDATE_VALIDATION_FILE: validationFile,
        HAMSTER_UPDATE_TARGET_PID: String(targetPid),
        HAMSTER_UPDATE_VERSION: String(prepared.version)
      }
    });
  } finally {
    fs.closeSync(launcherLogFd);
  }

  try {
    await waitForUpdaterStart(child, startedFile, {
      timeoutMs: startupTimeoutMs,
      intervalMs: startupPollIntervalMs,
      existsImpl,
      ...(delayImpl ? { delayImpl } : {})
    });
  } catch (error) {
    if (child && child.exitCode === null) {
      try { child.kill(); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    let launcherOutput = '';
    try { launcherOutput = (await fsp.readFile(launcherLogPath, 'utf8')).trim().slice(-4_000); } catch {}
    const wrapped = new Error([
      `自动更新助手未能启动：${error.message}`,
      launcherOutput ? `PowerShell 输出：${launcherOutput}` : '',
      `诊断日志：${launcherLogPath}`
    ].filter(Boolean).join('\n'));
    wrapped.cause = error;
    throw wrapped;
  }
  child.unref();
  return {
    validationFile,
    startedFile,
    scriptPath,
    launcherScriptPath,
    launcherLogPath,
    runRoot: prepared.runRoot,
    updaterPid: child.pid
  };
}

async function consumeUpdateFailure(userDataDirectory) {
  const updatesRoot = path.join(path.resolve(userDataDirectory), 'updates');
  let entries;
  try { entries = await fsp.readdir(updatesRoot, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const failures = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runRoot = path.join(updatesRoot, entry.name);
    const failurePath = path.join(runRoot, 'failed.json');
    if (!(await exists(failurePath))) continue;
    // Keep the original failure file for diagnostics. A rename is not reliable
    // while PowerShell or antivirus software still has the file open; a durable
    // marker prevents the same failure from being shown on every startup.
    const notifiedPath = path.join(runRoot, 'failed.notified.json');
    const noticeStatePath = path.join(runRoot, 'failed.notice-state.json');
    if (await exists(notifiedPath) || await exists(noticeStatePath)) continue;
    let failure;
    try {
      const raw = (await fsp.readFile(failurePath, 'utf8')).replace(/^\uFEFF/, '');
      failure = JSON.parse(raw);
    } catch (error) {
      failure = {
        version: entry.name,
        error: `无法读取更新失败记录：${error.message}`,
        failedAt: '',
      };
    }
    const notification = { notifiedAt: new Date().toISOString(), version: failure.version || entry.name };
    try {
      // COPYFILE_EXCL makes this idempotent and does not require deleting or
      // renaming the source file, so a locked failed.json is still safe.
      await fsp.copyFile(failurePath, notifiedPath, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      try {
        await fsp.writeFile(noticeStatePath, JSON.stringify({ ...notification, error: error.message }), { encoding: 'utf8', flag: 'wx' });
      } catch (markerError) {
        // The notification is still returned this run. If both marker writes
        // are blocked, the next startup may retry, but the failure is never lost.
        failure.notificationPersistenceError = markerError.message;
      }
    }
    failures.push({ ...failure, runRoot, logPath: path.join(runRoot, 'update.log') });
  }
  failures.sort((left, right) => String(right.failedAt).localeCompare(String(left.failedAt)));
  return failures[0] || null;
}

async function cleanupSuccessfulUpdateRuns(userDataDirectory) {
  const updatesRoot = path.join(path.resolve(userDataDirectory), 'updates');
  let entries;
  try { entries = await fsp.readdir(updatesRoot, { withFileTypes: true }); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runRoot = path.join(updatesRoot, entry.name);
    if (await exists(path.join(runRoot, 'completed.json'))) {
      await fsp.rm(runRoot, { recursive: true, force: true });
    }
  }
}

module.exports = {
  normalizeDigest,
  normalizeVersion,
  hashFile,
  prepareUpdate,
  launchUpdate,
  cleanupSuccessfulUpdateRuns,
  consumeUpdateFailure,
  manualUpdateInstructions,
  resolvePowerShellExecutable,
  waitForUpdaterStart,
  APPLY_UPDATE_SCRIPT,
  UPDATE_LAUNCHER_SCRIPT,
  INSTALL_STAGE_ITEMS_SCRIPT
};
