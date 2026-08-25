'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { makeLocalLayout, isPathInside } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const localLayout = makeLocalLayout(projectRoot);
const forbiddenDirectories = new Set([
  '.workbuddy', 'Developer', 'dist', 'locales', 'nuts', 'nuts-staging',
  'resources', 'userdata', 'userData', 'user-data', '待处理文件', '构造测试目录'
]);
const allowedDirectories = new Set([
  '.agents', '.git', '.github', 'assets', 'docs', 'node_modules',
  'README.assets', 'scripts', 'src', 'test', 'tools'
]);
const runtimeFilePatterns = [
  /^HamsterArchiv(?:e|er)\.exe$/i,
  /^chrome_\d+_percent\.pak$/i,
  /^(?:d3dcompiler|dxcompiler|dxil|ffmpeg|libEGL|libGLESv2|vk_swiftshader|vulkan-1).*\.(?:dll|json)$/i,
  /^(?:icudtl\.dat|LICENSES\.chromium\.html|release-manifest\.json|resources\.pak|snapshot_blob\.bin|v8_context_snapshot\.bin|version)$/i
];
const errors = [];

for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (forbiddenDirectories.has(entry.name)) {
      errors.push(`根目录不应包含 ${entry.name}/，请迁移到 ${localLayout.root}`);
    } else if (!allowedDirectories.has(entry.name)) {
      errors.push(`根目录存在未登记目录：${entry.name}/`);
    }
  } else if (runtimeFilePatterns.some((pattern) => pattern.test(entry.name))) {
    errors.push(`根目录不应包含运行产物：${entry.name}`);
  }
}
if (isPathInside(projectRoot, localLayout.root) ||
    path.resolve(localLayout.root) === projectRoot) {
  errors.push('HAMSTER_LOCAL_ROOT 必须位于源码仓库之外');
}
if (errors.length) {
  console.error('工作区结构检查未通过：');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`工作区结构检查通过；本地资料根目录：${localLayout.root}`);
}
