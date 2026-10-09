'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const { repairWindowsSandboxAccess } = require('../src/core/windows-sandbox-access');

const execute = promisify(execFile);
function canonicalSddl(sddl) {
  const start = sddl.indexOf('(');
  const entries = [];
  let depth = 0;
  let entryStart = start;
  for (let index = start; index < sddl.length; index++) {
    if (sddl[index] === '(') { if (depth === 0) entryStart = index; depth++; }
    if (sddl[index] === ')' && --depth === 0) entries.push(sddl.slice(entryStart, index + 1));
  }
  return sddl.slice(0, start) + entries.sort().join('');
}
async function powershell(script) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execute(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15_000 });
  return JSON.parse(stdout.trim());
}

test('Windows repair adds only runtime access, preserves conditional/protected ACLs and leaves data untouched',
  { skip: process.platform !== 'win32' }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-sandbox-access-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const executable = path.join(root, 'HamsterArchiver.exe');
    for (const name of ['HamsterArchiver.exe', 'icudtl.dat', 'ffmpeg.dll', 'private.txt']) {
      await fs.writeFile(path.join(root, name), 'synthetic fixture');
    }
    await fs.mkdir(path.join(root, 'userdata'));
    await fs.writeFile(path.join(root, 'userdata', 'data.txt'), 'synthetic data');
    assert.deepEqual(await repairWindowsSandboxAccess(executable), { changed: 0, failed: 0, blocked: 0 });
    const encodedRoot = Buffer.from(root, 'utf8').toString('base64');
    const setup = `
$ErrorActionPreference = 'Stop'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))
$fakeSid = 'S-1-15-2-111-222-333-444-555-666-777'
& (Join-Path $env:SystemRoot 'System32\\icacls.exe') $root '/grant' ('*' + $fakeSid + ':(OI)(CI)(RX)') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Fixture ACL failed' }
$target = Join-Path $root 'icudtl.dat'
$acl = [IO.File]::GetAccessControl($target)
$sddl = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
$sddl += '(XA;;0x1200a9;;;BU;(WIN://SYSAPPID Contains "Example.ShellExtension_example"))'
$acl.SetSecurityDescriptorSddlForm($sddl, [Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $true)
[IO.File]::SetAccessControl($target, $acl)
'true'
`;
    const inspect = `
$ErrorActionPreference = 'Stop'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))
$result = @{}
foreach ($name in @('.', 'HamsterArchiver.exe', 'icudtl.dat', 'ffmpeg.dll', 'private.txt', 'userdata\\data.txt')) {
  $target = Join-Path $root $name
  $acl = if ($name -eq '.') { [IO.Directory]::GetAccessControl($target) } else { [IO.File]::GetAccessControl($target) }
  $result[$name] = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
}
$result | ConvertTo-Json -Compress
`;
    await powershell(setup);
    // Reproduce a stale child ACL: the parent permits BU writes, while the
    // runtime files still contain the earlier inherited read/execute rights.
    // A permission repair must not refresh those unrelated inherited grants.
    await powershell(`
$ErrorActionPreference = 'Stop'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))
& (Join-Path $env:SystemRoot 'System32\\icacls.exe') $root '/grant' '*S-1-5-32-545:(OI)(CI)(RX,WD,AD)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Fixture parent ACL failed' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HamsterFixtureSecurity {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetFileSecurityW(string path, uint information, byte[] descriptor);
}
'@
foreach ($name in @('HamsterArchiver.exe', 'ffmpeg.dll')) {
  $target = Join-Path $root $name
  $acl = [IO.File]::GetAccessControl($target)
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
  foreach ($ace in $descriptor.DiscretionaryAcl) {
    if ($ace -is [Security.AccessControl.QualifiedAce] -and
      $ace.SecurityIdentifier.Value -eq 'S-1-5-32-545' -and
      $ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed) {
      $ace.AccessMask = $ace.AccessMask -band (-bnot 6)
    }
  }
  $descriptor.SetFlags($descriptor.ControlFlags -bor [Security.AccessControl.ControlFlags]::DiscretionaryAclAutoInheritRequired)
  $bytes = [byte[]]::new($descriptor.BinaryLength)
  $descriptor.GetBinaryForm($bytes, 0)
  if (-not [HamsterFixtureSecurity]::SetFileSecurityW($target, 4, $bytes)) { throw 'Fixture child ACL failed' }
}
'true'
`);
    const before = await powershell(inspect);
    assert.match(before['.'], /\(A;OICI;0x1200af;;;BU\)/);
    assert.match(before['HamsterArchiver.exe'], /\(A;ID;0x1200a9;;;BU\)/);
    assert.deepEqual(await repairWindowsSandboxAccess(executable), { changed: 3, failed: 0, blocked: 0 });
    const after = await powershell(inspect);
    for (const name of ['.', 'private.txt', 'userdata\\data.txt']) assert.equal(after[name], before[name], name);
    for (const name of ['HamsterArchiver.exe', 'icudtl.dat', 'ffmpeg.dll']) {
      const permission = name.endsWith('.dat') ? 'FR' : '0x1200a9';
      assert.equal(canonicalSddl(after[name].replace(`(A;;${permission};;;S-1-15-2-2)`, '')),
        canonicalSddl(before[name]), name);
    }
    assert.match(after['icudtl.dat'], /D:P/);
    assert.match(after['icudtl.dat'], /Example.ShellExtension_example/);
    assert.deepEqual(await repairWindowsSandboxAccess(executable), { changed: 0, failed: 0, blocked: 0 });
    await fs.writeFile(path.join(root, 'd3dcompiler_47.dll'), 'synthetic protected runtime');
    await powershell(`
$ErrorActionPreference = 'Stop'
$root = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedRoot}'))
& (Join-Path $env:SystemRoot 'System32\\icacls.exe') (Join-Path $root 'd3dcompiler_47.dll') '/deny' '*S-1-3-4:(WDAC)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Fixture denial failed' }
'true'
`);
    assert.deepEqual(await repairWindowsSandboxAccess(executable), { changed: 0, failed: 1, blocked: 1 });
  });
