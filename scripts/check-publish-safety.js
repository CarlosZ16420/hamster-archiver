'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const candidates = execFileSync(
  'git',
  ['-c', `safe.directory=${projectRoot.replace(/\\/g, '/')}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: projectRoot, encoding: 'utf8' }
).split('\0').filter(Boolean);
const exportIgnoreOutput = execFileSync(
  'git',
  ['-c', `safe.directory=${projectRoot.replace(/\\/g, '/')}`, 'check-attr', '-z', '--stdin', 'export-ignore'],
  {
    cwd: projectRoot,
    encoding: 'utf8',
    input: `${candidates.join('\0')}\0`
  }
).split('\0');
const exportIgnoredPaths = new Set();
for (let index = 0; index + 2 < exportIgnoreOutput.length; index += 3) {
  const [candidate, attribute, value] = exportIgnoreOutput.slice(index, index + 3);
  if (attribute === 'export-ignore' && value === 'set') {
    exportIgnoredPaths.add(candidate.replace(/\\/g, '/'));
  }
}

const forbiddenPaths = [
  /(^|\/)(saves|nuts|processed|archive-staging|userdata|user-data|userData|待处理文件|零碎文件|压缩暂存目录)(\/|$)/i,
  /(^|\/)(?:BUG\d*)(\/|$)/i,
  /\.(?:sqlite(?:-wal|-shm)?|db|7z(?:\.\d+)?)$/i,
  /(^|\/)\.env(?:\.|$)/i
];
const forbiddenExactNames = new Set(['readmeglmversion.md']);
const secretPatterns = [
  { label: 'Windows 用户目录', pattern: /[A-Za-z]:\\Users\\[^\\\s"']+/i },
  {
    label: '本机 Codex 工作区绝对路径',
    pattern: /[A-Za-z]:\\CodexWorkspace\\/i,
    allowWhenExportIgnored: true
  },
  { label: 'GitHub token', pattern: /(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]{20,}/ },
  { label: '私钥', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];
const textExtensions = new Set([
  '.cjs', '.cmd', '.css', '.cs', '.csproj', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.txt', '.yml', '.yaml'
]);
const errors = [];

for (const relativePath of candidates) {
  const normalized = relativePath.replace(/\\/g, '/');
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  if (forbiddenExactNames.has(normalized.toLowerCase()) || forbiddenPaths.some((pattern) => pattern.test(normalized))) {
    errors.push(`${relativePath}：属于运行数据、归档成品或本机配置`);
    continue;
  }
  const stats = fs.statSync(absolutePath);
  if (stats.size > 95 * 1024 * 1024) {
    errors.push(`${relativePath}：${(stats.size / 1024 / 1024).toFixed(1)} MiB，接近或超过 GitHub 普通 Git 限制`);
  }
  if (!textExtensions.has(path.extname(relativePath).toLowerCase()) || stats.size > 5 * 1024 * 1024) continue;
  const content = fs.readFileSync(absolutePath, 'utf8');
  for (const { label, pattern, allowWhenExportIgnored = false } of secretPatterns) {
    if (allowWhenExportIgnored && exportIgnoredPaths.has(normalized)) continue;
    if (pattern.test(content)) errors.push(`${relativePath}：检测到${label}`);
  }
}

if (errors.length > 0) {
  console.error('发布安全检查未通过：');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`发布安全检查通过：检查了 ${candidates.length} 个待提交或已跟踪文件。`);
  console.log('提醒：用户设置、仓库数据库、日志和归档密码都不应进入 Git 历史。');
}
