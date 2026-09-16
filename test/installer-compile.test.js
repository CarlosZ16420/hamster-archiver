'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

// Opt-in compiler regression: uses existing locked tools, never downloads or runs an installer.
const nsisDir = process.env.HAMSTER_TEST_NSIS_DIR;
const pluginsDir = process.env.HAMSTER_TEST_NSIS_PLUGINS;
const root = path.resolve(__dirname, '..');
const headers = path.join(root, 'node_modules/app-builder-lib/templates/nsis/include');

for (const pluginsFirst of [false, true]) {
  test(`custom installer pages compile with plugins loaded ${pluginsFirst ? 'before' : 'after'} the include`, {
    skip: process.platform !== 'win32' || !nsisDir || !pluginsDir
  }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hamster-nsis-regression-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, 'compile-only.exe');
    const pluginLine = `!addplugindir /x86-unicode "${pluginsDir}"`;
    const source = `Unicode true
Name "Hamster compiler regression"
OutFile "${output}"
RequestExecutionLevel user
!addincludedir "${headers}"
!include "StdUtils.nsh"
!define APP_FILENAME "HamsterArchiver"
!define PRODUCT_FILENAME "HamsterArchiver"
!macro _isUpdated _a _b _t _f
  \${StdUtils.TestParameter} $R9 "updated"
  StrCmp "$R9" "true" \`\${_t}\` \`\${_f}\`
!macroend
!define isUpdated \`"" isUpdated ""\`
${pluginsFirst ? pluginLine : ''}
!include "${path.join(root, 'scripts/installer-custom.nsh')}"
${pluginsFirst ? '' : pluginLine}
!include "MUI2.nsh"
Var newDesktopLink
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
Section
  StrCpy $newDesktopLink "$DESKTOP\\Hamster Archiver.lnk"
  !insertmacro customInstall
  WriteUninstaller "$TEMP\\hamster-compile-only-uninstaller.exe"
SectionEnd
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd
`;
    const script = path.join(directory, 'compile-only.nsi');
    await fs.writeFile(script, source, 'utf8');
    try {
      execFileSync(path.join(nsisDir, 'Bin/makensis.exe'), ['-WX', '-INPUTCHARSET', 'UTF8', script], {
        env: { ...process.env, NSISDIR: nsisDir }, encoding: 'utf8', windowsHide: true, timeout: 60000
      });
    } catch (error) {
      assert.fail(`${error.stdout || ''}\n${error.stderr || error.message}`);
    }
    assert.ok((await fs.stat(output)).size > 0);
  });
}
