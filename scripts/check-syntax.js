'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(process.env.HAMSTER_QA_WORKSPACE || path.resolve(__dirname, '..'));
const configuredGit = String(process.env.HAMSTER_GIT_EXECUTABLE || '').trim();
if (configuredGit && (!path.isAbsolute(configuredGit) || !require('node:fs').existsSync(configuredGit))) {
  throw new Error('HAMSTER_GIT_EXECUTABLE must name an existing absolute executable.');
}
const gitExecutable = configuredGit || 'git';
const requested = process.argv.slice(2).filter(Boolean);
const tracked = requested.length > 0 ? requested : execFileSync(
  gitExecutable, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: projectRoot,
    encoding: 'utf8'
  }
).split('\0').filter(Boolean);

const files = tracked.filter((name) => /\.(?:c?js|mjs)$/i.test(name));
for (const relativePath of files) {
  execFileSync(process.execPath, ['--check', relativePath], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
}
console.log(`JavaScript 语法检查通过：${files.length} 个${requested.length > 0 ? '指定' : '待提交或已跟踪'}文件。`);
