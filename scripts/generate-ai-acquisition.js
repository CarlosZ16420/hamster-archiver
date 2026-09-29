'use strict';

// Feed published `gh release view <tag> --json tagName,isDraft,isPrerelease,url,assets`
// metadata on stdin. Never infer a URL for an unpublished candidate.
const fs = require('node:fs/promises');
const path = require('node:path');

function generateAcquisition(metadata) {
  const tag = String(metadata?.tagName || '');
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || metadata.isDraft || metadata.isPrerelease) {
    throw new Error('A published stable Release tag is required.');
  }
  const version = tag.slice(1);
  const zipName = `HamsterArchiver-${tag}-win-x64.zip`;
  const checksumName = `${zipName}.sha256`;
  const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
  const zip = assets.find((asset) => asset.name === zipName && asset.state === 'uploaded');
  const checksum = assets.find((asset) => asset.name === checksumName && asset.state === 'uploaded');
  const expectedBase = `https://github.com/CarlosZ16420/hamster-archiver/releases/download/${tag}/`;
  if (!zip || !checksum || zip.url !== `${expectedBase}${zipName}` ||
      checksum.url !== `${expectedBase}${checksumName}` ||
      !/^sha256:[a-f0-9]{64}$/i.test(zip.digest || '')) {
    throw new Error('The published ZIP, checksum, URLs, or ZIP digest are incomplete.');
  }
  return [
    '# Windows 发行包获取 / Windows Release acquisition',
    '',
    `以下信息由已发布的 ${tag} Release 元数据生成。候选版本尚未发布时，这些链接仍指向 ${tag}，不代表候选包。`,
    `Generated from published ${tag} Release metadata. These links do not represent an unpublished candidate.`,
    '',
    `- 版本 / Version: **${version}**`,
    '- 平台 / Platform: **Windows x64**',
    `- 便携 ZIP / Portable ZIP: [${zipName}](${zip.url})`,
    `- 对应摘要 / Matching checksum: [${checksumName}](${checksum.url})`,
    `- ZIP SHA-256 (Release metadata): \`${zip.digest.slice(7).toLowerCase()}\``,
    `- 解压根目录 / Extracted root: \`HamsterArchiver-${tag}-win-x64/\``,
    '- 启动器 / CLI launcher: `hamster.cmd` at the extracted root',
    '- 离线指南 / Offline quick start: `docs/AI-QUICKSTART.md` inside the extracted root',
    '',
    '下载后先计算 ZIP 的 SHA-256，并与同名 `.sha256` 文件及上面的 Release 摘要核对。若不一致，停止使用该文件。GitHub 的 Source code 不是可运行包。',
    'Verify the downloaded ZIP against its matching `.sha256` file and the Release digest above. Stop on any mismatch. GitHub Source code is not a runnable package.',
    ''
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !path.isAbsolute(argv[0])) {
    throw new Error('Usage: generate-ai-acquisition.js <absolute-output-path> < release-metadata.json');
  }
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const output = generateAcquisition(JSON.parse(text));
  await fs.writeFile(argv[0], output, { encoding: 'utf8' });
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { generateAcquisition };
