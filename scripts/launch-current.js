'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { makeLocalLayout } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const layout = makeLocalLayout(projectRoot);
const executable = path.join(layout.currentBuild, 'HamsterArchiver.exe');

if (!fs.existsSync(executable)) {
  console.error(`没有可启动的当前构建：${executable}`);
  console.error('请先运行 npm run release:local。');
  process.exitCode = 1;
} else {
  const child = spawn(executable, [], {
    cwd: layout.currentBuild,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  console.log(`已启动：${executable}`);
}
