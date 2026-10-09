'use strict';

const path = require('node:path');

// Only shipped Electron runtime files. Never grant inherited directory access:
// portable user data can live beside the executable.
const RUNTIME_FILES = Object.freeze([
  'HamsterArchiver.exe', 'icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin',
  'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll',
  'libEGL.dll', 'libGLESv2.dll', 'vk_swiftshader.dll', 'vulkan-1.dll'
]);

function repairScript(executablePath) {
  const encodedRoot = Buffer.from(path.dirname(executablePath), 'utf8').toString('base64');
  const encodedFiles = Buffer.from(JSON.stringify(RUNTIME_FILES), 'utf8').toString('base64');
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))
$names = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedFiles}')))
function Initialize-RuntimeSecurity {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HamsterRuntimeSecurity {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetFileSecurityW(string path, uint information, byte[] descriptor);
}
'@
}
$sid = 'S-1-15-2-2'
$changed = 0
$failed = 0
$blocked = 0
foreach ($name in $names) {
  $target = Join-Path $root $name
  if (-not [IO.File]::Exists($target)) { continue }
  try {
    if (([IO.File]::GetAttributes($target) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    $security = [IO.File]::GetAccessControl($target, [Security.AccessControl.AccessControlSections]::Access)
    $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($security.GetSecurityDescriptorBinaryForm(), 0)
    $hasPackageAce = $false
    $hasRuntimeAccess = $false
    $executable = [IO.Path]::GetExtension($name) -in @('.exe', '.dll')
    $required = if ($executable) { 0x1200a9 } else { 0x120089 }
    foreach ($ace in $descriptor.DiscretionaryAcl) {
      if ($ace -isnot [Security.AccessControl.QualifiedAce] -or $ace.IsCallback -or
          $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or
          ([int]$ace.AceFlags -band 8) -ne 0) { continue }
      $identity = $ace.SecurityIdentifier.Value
      if ($identity -match '^S-1-15-(2|3)-[0-9]+-[0-9]+-') { $hasPackageAce = $true }
      if ($identity -eq $sid -and ($ace.AccessMask -band $required) -eq $required) { $hasRuntimeAccess = $true }
    }
    if (-not $hasPackageAce -or $hasRuntimeAccess) { continue }
    if (-not ('HamsterRuntimeSecurity' -as [type])) { Initialize-RuntimeSecurity }
    # Keep the raw ACEs, including callback conditions and inherited entries.
    # icacls/SetNamedSecurityInfo can refresh stale inheritance from the parent,
    # granting unrelated accounts additional rights while adding this one ACE.
    $insert = 0
    while ($insert -lt $descriptor.DiscretionaryAcl.Count -and
      ([int]$descriptor.DiscretionaryAcl[$insert].AceFlags -band 16) -eq 0) { $insert++ }
    $entry = [Security.AccessControl.CommonAce]::new(
      [Security.AccessControl.AceFlags]::None,
      [Security.AccessControl.AceQualifier]::AccessAllowed, $required,
      [Security.Principal.SecurityIdentifier]::new($sid), $false, $null)
    $descriptor.DiscretionaryAcl.InsertAce($insert, $entry)
    # The low-level file setter avoids parent-ACL propagation. Preserve the
    # existing auto-inherited control bit by supplying its request bit too.
    if (($descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInherited) -ne 0) {
      $descriptor.SetFlags($descriptor.ControlFlags -bor [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInheritRequired)
    }
    $bytes = [byte[]]::new($descriptor.BinaryLength)
    $descriptor.GetBinaryForm($bytes, 0)
    try {
      if ([HamsterRuntimeSecurity]::SetFileSecurityW($target, 4, $bytes)) { $changed++ }
      else { $failed++; $blocked++ }
    } catch { $failed++; $blocked++ }
  } catch { $failed++ }
}
@{ changed = $changed; failed = $failed; blocked = $blocked } | ConvertTo-Json -Compress
`;
}

function repairWindowsSandboxAccess(executablePath, { execFileSync } = {}) {
  const execute = execFileSync || require('node:child_process').execFileSync;
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const powerShell = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(repairScript(executablePath), 'utf16le').toString('base64');
  const stdout = execute(powerShell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
  ], { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] });
  const result = JSON.parse(stdout.trim());
  if (!Number.isInteger(result.changed) || !Number.isInteger(result.failed) || !Number.isInteger(result.blocked)) {
    throw new Error('Invalid Windows sandbox access result');
  }
  return result;
}

module.exports = { repairWindowsSandboxAccess };
