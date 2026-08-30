'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(projectRoot, name), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const version = packageJson.version;
const errors = [];

if (lock.version !== version || lock.packages?.['']?.version !== version) {
  errors.push('package-lock.json 与 package.json 版本不一致');
}
if (!read('CHANGELOG.md').includes(`## ${version}`)) {
  errors.push(`CHANGELOG.md 缺少 ${version} 正式章节`);
}
for (const readme of ['README.md', 'README.en.md']) {
  const content = read(readme);
  if (!content.includes(`version-${version}-`) ||
      !content.includes(`HamsterArchiver-v${version}-win-x64/`)) {
    errors.push(`${readme} 的版本徽章或目录示例未更新为 ${version}`);
  }
}
const releaseNotes = path.join(projectRoot, 'docs', 'releases', `release-notes-v${version}.md`);
if (!fs.existsSync(releaseNotes)) {
  errors.push(`缺少 docs/releases/release-notes-v${version}.md`);
}
const releaseSummaryPath = path.join(projectRoot, 'docs', 'releases', `release-summary-v${version}.json`);
if (!fs.existsSync(releaseSummaryPath)) {
  errors.push(`缺少 docs/releases/release-summary-v${version}.json`);
} else {
  try {
    const releaseSummary = JSON.parse(fs.readFileSync(releaseSummaryPath, 'utf8'));
    if (releaseSummary.schemaVersion !== 1 || releaseSummary.version !== version) {
      errors.push(`release-summary-v${version}.json 的结构版本或产品版本不一致`);
    }
    for (const locale of ['zh-CN', 'en-US']) {
      if (!Array.isArray(releaseSummary.notes?.[locale]) || releaseSummary.notes[locale].length === 0) {
        errors.push(`release-summary-v${version}.json 缺少 ${locale} 更新内容`);
      }
    }
  } catch (error) {
    errors.push(`release-summary-v${version}.json 无法解析：${error.message}`);
  }
}
if (process.argv.includes('--tag')) {
  const tag = execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8'
  }).trim();
  if (tag !== `v${version}`) errors.push(`HEAD 标签应为 v${version}，实际为 ${tag || '无'}`);
}
if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`版本一致性检查通过：${version}`);
}
