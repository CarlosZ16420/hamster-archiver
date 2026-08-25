'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  PauseController,
  controlWindowsProcess,
  runPowerShellEncoded
} = require('../src/core/process-controller');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('cooperative pause blocks and resume releases work', async () => {
  const calls = [];
  const controller = new PauseController(async (pid, action) => calls.push({ pid, action }));
  controller.attach(1234);
  await controller.pause();
  let released = false;
  const waiting = controller.waitIfPaused().then(() => { released = true; });
  await delay(20);
  assert.equal(released, false);
  await controller.resume();
  await waiting;
  assert.equal(released, true);
  assert.deepEqual(calls, [
    { pid: 1234, action: 'suspend' },
    { pid: 1234, action: 'resume' }
  ]);
});

test('Windows process control stops waiting after its timeout', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let killed = false;
  child.kill = () => { killed = true; };
  await assert.rejects(() => runPowerShellEncoded('Get-Process', {
    spawnImpl: () => child,
    timeoutMs: 15
  }), (error) => error.code === 'PROCESS_CONTROL_TIMEOUT');
  assert.equal(killed, true);
});

test('Windows native pause suspends and resumes a real child process', {
  skip: process.platform !== 'win32'
}, async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => console.log(Date.now()), 20)'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  });
  t.after(() => child.kill());
  let ticks = 0;
  child.stdout.on('data', (chunk) => {
    ticks += chunk.toString('utf8').split('\n').filter(Boolean).length;
  });

  const waitForTicks = async (minimum, timeoutMs = 4000) => {
    const startedAt = Date.now();
    while (ticks < minimum) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`等待子进程输出超时：需要至少 ${minimum} 次输出，当前 ${ticks} 次`);
      }
      await delay(25);
    }
  };

  const controller = new PauseController((pid, action) => (
    controlWindowsProcess(pid, action, { timeoutMs: 30_000 })
  ));
  controller.attach(child.pid);
  await waitForTicks(2);
  await controller.pause();
  const pausedTicks = ticks;
  await delay(300);
  assert.equal(ticks, pausedTicks);
  await controller.resume();
  await waitForTicks(pausedTicks + 1);
});
