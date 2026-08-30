'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const packageJson = require('../package.json');
const { hashFile } = require('../src/core/tool-integrity');
const { assertPathInsideLocalRoot, makeLocalLayout } = require('../src/core/local-paths');

const projectRoot = path.resolve(__dirname, '..');
const layout = makeLocalLayout(projectRoot);
const installedBuildName = `HamsterArchiver-v${packageJson.version}-win-x64-installed`;
const installedBuild = path.join(layout.stagingRoot, installedBuildName);
const installerName = `HamsterArchiver-Setup-v${packageJson.version}-win-x64.exe`;
const installerPath = path.join(layout.installerRoot, installerName);
const installerShaPath = `${installerPath}.sha256`;
const builderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || 'inherit'
  });
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Windows x64 安装版只能在 Windows x64 环境构建。');
  }
  for (const target of [installedBuild, layout.installerRoot, layout.installerStagingRoot]) {
    assertPathInsideLocalRoot(target, layout.root, '安装版构建目录');
  }
  await fsp.mkdir(layout.installerRoot, { recursive: true });
  await fsp.mkdir(layout.installerStagingRoot, { recursive: true });
  await fsp.rm(installerPath, { force: true });
  await fsp.rm(installerShaPath, { force: true });

  run(process.execPath, [path.join('scripts', 'build-release.js'), '--distribution=installed']);
  run(process.execPath, [builderCli,
    '--win', 'nsis:x64',
    '--prepackaged', installedBuild,
    '--config.appId=com.carlosz.hamsterarchiver',
    '--config.productName=Hamster Archiver',
    `--config.artifactName=${installerName}`,
    `--config.directories.output=${layout.installerRoot}`,
    '--config.win.icon=assets/app-icon.ico',
    '--config.win.requestedExecutionLevel=asInvoker',
    '--config.nsis.oneClick=false',
    '--config.nsis.perMachine=false',
    '--config.nsis.allowToChangeInstallationDirectory=true',
    '--config.nsis.createDesktopShortcut=true',
    '--config.nsis.createStartMenuShortcut=true',
    '--config.nsis.shortcutName=Hamster Archiver',
    '--config.nsis.uninstallDisplayName=Hamster Archiver',
    '--config.nsis.deleteAppDataOnUninstall=false'
  ]);

  const digest = await hashFile(installerPath);
  await fsp.writeFile(installerShaPath, `${digest} *${installerName}\r\n`, 'ascii');
  for (const auxiliary of [
    path.join(layout.installerRoot, 'builder-debug.yml'),
    path.join(layout.installerRoot, 'latest.yml'),
    `${installerPath}.blockmap`
  ]) {
    await fsp.rm(auxiliary, { force: true });
  }
  console.log(`安装程序：${installerPath}`);
  console.log(`SHA-256：${digest}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
