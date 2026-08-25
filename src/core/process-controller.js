'use strict';

const { spawn } = require('node:child_process');
const { CancelledError } = require('./archive-engine-errors');

const PROCESS_CONTROL_TIMEOUT_MS = 8_000;

function runPowerShellEncoded(script, {
  spawnImpl = spawn,
  timeoutMs = PROCESS_CONTROL_TIMEOUT_MS
} = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const appendOutput = (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-64 * 1024);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    child.on('error', finish);
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`Windows 进程控制失败（${code}）：${output.trim()}`));
    });
    const timer = setTimeout(() => {
      const error = new Error(`Windows 进程控制在 ${Math.ceil(timeoutMs / 1000)} 秒内没有响应，已停止等待。`);
      error.code = 'PROCESS_CONTROL_TIMEOUT';
      finish(error);
      try { child.kill(); } catch {}
    }, timeoutMs);
  });
}

async function controlWindowsProcess(pid, action, {
  timeoutMs = PROCESS_CONTROL_TIMEOUT_MS
} = {}) {
  if (process.platform !== 'win32') {
    process.kill(pid, action === 'suspend' ? 'SIGSTOP' : 'SIGCONT');
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('无效的进程编号。');
  const nativeMethod = action === 'suspend' ? 'NtSuspendProcess' : 'NtResumeProcess';
  const script = `
$definition = 'using System; using System.Runtime.InteropServices; public static class HamsterNativeProcess { [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId); [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle); [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr processHandle); [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr processHandle); }'
Add-Type -TypeDefinition $definition
$handle = [HamsterNativeProcess]::OpenProcess(0x0800, $false, ${pid})
if ($handle -eq [IntPtr]::Zero) { exit 2 }
try {
  $status = [HamsterNativeProcess]::${nativeMethod}($handle)
  if ($status -ne 0) { exit 3 }
} finally {
  [void][HamsterNativeProcess]::CloseHandle($handle)
}`;
  await runPowerShellEncoded(script, { timeoutMs });
}

class PauseController {
  constructor(processControl = controlWindowsProcess) {
    this.processControl = processControl;
    this.paused = false;
    this.childPid = null;
    this.processSuspended = false;
    this.waiters = new Set();
  }

  async attach(pid) {
    this.childPid = pid;
    this.processSuspended = false;
    if (this.paused) {
      await this.processControl(pid, 'suspend');
      if (this.childPid === pid) this.processSuspended = true;
    }
  }

  detach(pid) {
    if (this.childPid !== pid) return;
    this.childPid = null;
    this.processSuspended = false;
  }

  async pause() {
    if (this.paused) return;
    this.paused = true;
    try {
      if (this.childPid) {
        await this.processControl(this.childPid, 'suspend');
        this.processSuspended = true;
      }
    } catch (error) {
      this.paused = false;
      throw error;
    }
  }

  async resume() {
    if (!this.paused && !this.processSuspended) return;
    if (this.childPid && this.processSuspended) {
      await this.processControl(this.childPid, 'resume');
    }
    this.processSuspended = false;
    this.paused = false;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  async waitIfPaused(signal) {
    while (this.paused) {
      if (signal?.aborted) throw new CancelledError();
      await new Promise((resolve, reject) => {
        const abort = () => {
          this.waiters.delete(resume);
          reject(new CancelledError());
        };
        const resume = () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        };
        this.waiters.add(resume);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

module.exports = {
  PROCESS_CONTROL_TIMEOUT_MS,
  PauseController,
  controlWindowsProcess,
  runPowerShellEncoded
};
