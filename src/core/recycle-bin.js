'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const RECYCLE_BIN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$TargetPath = [string]$env:HAMSTER_RECYCLE_TARGET
$Action = [string]$env:HAMSTER_RECYCLE_ACTION

function Normalize-Path([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  try { return [IO.Path]::GetFullPath($Value).TrimEnd([char[]]'\\/') }
  catch { return '' }
}

$target = Normalize-Path $TargetPath
if (-not $target) { Write-Output 'INVALID_PATH'; exit 2 }
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(10)
if ($null -eq $recycleBin) { Write-Output 'RECYCLE_BIN_UNAVAILABLE'; exit 6 }
$match = $null
foreach ($item in $recycleBin.Items()) {
  $deletedFrom = [string]$item.ExtendedProperty('System.Recycle.DeletedFrom')
  $itemName = [string]$item.ExtendedProperty('System.ItemNameDisplay')
  if ([string]::IsNullOrWhiteSpace($itemName)) { $itemName = [string]$item.Name }
  if ([string]::IsNullOrWhiteSpace($deletedFrom) -or [string]::IsNullOrWhiteSpace($itemName)) { continue }
  $candidate = Normalize-Path (Join-Path $deletedFrom $itemName)
  if ([StringComparer]::OrdinalIgnoreCase.Equals($candidate, $target)) { $match = $item; break }
}

if ($null -eq $match) { Write-Output 'NOT_FOUND'; exit 3 }
if ($Action -eq 'check') { Write-Output 'FOUND'; exit 0 }
if ($Action -ne 'restore') { Write-Output 'INVALID_ACTION'; exit 2 }
if (Test-Path -LiteralPath $TargetPath) { Write-Output 'TARGET_EXISTS'; exit 4 }
$verbs = @($match.Verbs())
$restoreVerb = $verbs | Where-Object { ([string]$_.Name -replace '&', '') -match 'restore|还原|恢复' } | Select-Object -First 1
if ($null -eq $restoreVerb) { Write-Output 'RESTORE_VERB_MISSING'; exit 7 }
$restoreVerb.DoIt()
for ($index = 0; $index -lt 150; $index += 1) {
  if (Test-Path -LiteralPath $TargetPath) { Write-Output 'RESTORED'; exit 0 }
  Start-Sleep -Milliseconds 100
}
Write-Output 'RESTORE_TIMEOUT'; exit 5
`;

const RECYCLE_BIN_BATCH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$targets = @((ConvertFrom-Json ([string]$env:HAMSTER_RECYCLE_TARGETS)))
$wanted = @{}
foreach ($value in $targets) {
  try {
    $normalized = [IO.Path]::GetFullPath([string]$value).TrimEnd([char[]]'\\/')
    $wanted[$normalized.ToLowerInvariant()] = $normalized
  } catch {}
}
$found = New-Object System.Collections.Generic.List[string]
$shell = New-Object -ComObject Shell.Application
$recycleBin = $shell.Namespace(10)
if ($null -eq $recycleBin) { throw 'RECYCLE_BIN_UNAVAILABLE' }
foreach ($item in $recycleBin.Items()) {
  $deletedFrom = [string]$item.ExtendedProperty('System.Recycle.DeletedFrom')
  $itemName = [string]$item.ExtendedProperty('System.ItemNameDisplay')
  if ([string]::IsNullOrWhiteSpace($itemName)) { $itemName = [string]$item.Name }
  if ([string]::IsNullOrWhiteSpace($deletedFrom) -or [string]::IsNullOrWhiteSpace($itemName)) { continue }
  try { $candidate = [IO.Path]::GetFullPath((Join-Path $deletedFrom $itemName)).TrimEnd([char[]]'\\/') }
  catch { continue }
  $key = $candidate.ToLowerInvariant()
  if ($wanted.ContainsKey($key)) { $found.Add($wanted[$key]); $wanted.Remove($key) }
}
ConvertTo-Json @($found) -Compress
`;

async function runRecycleBinAction(targetPath, action) {
  if (process.platform !== 'win32') {
    if (action === 'check') return false;
    throw new Error('自动复原回收站内容仅支持 Windows。');
  }
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', RECYCLE_BIN_SCRIPT
    ], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        HAMSTER_RECYCLE_TARGET: String(targetPath || ''),
        HAMSTER_RECYCLE_ACTION: action
      }
    });
    const output = String(stdout || '').trim();
    return action === 'check' ? output.includes('FOUND') : output.includes('RESTORED');
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
    if (Number(error.code) === 3 || output.includes('NOT_FOUND')) return false;
    if (Number(error.code) === 4 || output.includes('TARGET_EXISTS')) {
      throw new Error('原文件位置已经存在同名内容，无法从回收站复原。');
    }
    throw new Error(`Windows 回收站查询失败：${output || error.message}`);
  }
}

function isTrashItemPresent(originalPath) {
  return runRecycleBinAction(originalPath, 'check');
}

function restoreTrashItem(originalPath) {
  return runRecycleBinAction(originalPath, 'restore');
}

async function findTrashItems(originalPaths) {
  const targets = [...new Set((originalPaths || []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 100);
  if (targets.length === 0 || process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', RECYCLE_BIN_BATCH_SCRIPT
  ], {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, HAMSTER_RECYCLE_TARGETS: JSON.stringify(targets) }
  });
  const output = String(stdout || '').trim();
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
}

module.exports = { findTrashItems, isTrashItemPresent, restoreTrashItem };
