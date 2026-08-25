'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: projectRoot,
  encoding: 'utf8'
}).split('\0').filter(Boolean);

const files = tracked.filter((name) => /\.(?:c?js|mjs)$/i.test(name));
for (const relativePath of files) {
  execFileSync(process.execPath, ['--check', relativePath], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
}
console.log(`JavaScript 语法检查通过：${files.length} 个待提交或已跟踪文件。`);
