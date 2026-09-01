'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  queueSimilarityEvidenceText,
  shouldApplyTaskProgress,
  shouldShowDuplicateConfirmation,
  similarityProgressPresentation,
  summarizeScanSkips,
  sourceDispositionPresentation
} = require('../src/renderer/ui-state');

test('late running progress cannot overwrite a duplicate-review or auto-skip terminal state', () => {
  assert.equal(shouldApplyTaskProgress(
    { status: 'inventorying' }, { stage: 'inventorying' }
  ), true);
  assert.equal(shouldApplyTaskProgress(
    { status: 'awaiting_duplicate_confirmation' }, { stage: 'inventorying' }
  ), false);
  assert.equal(shouldApplyTaskProgress(
    { status: 'skipped_duplicate' }, { stage: 'inventorying' }
  ), false);
  assert.equal(shouldApplyTaskProgress(
    { status: 'compressing' }, { stage: 'inventorying' }
  ), false);
});

test('similarity evidence distinguishes identical content from a complete project duplicate', () => {
  assert.equal(queueSimilarityEvidenceText({
    exactFileCount: 12,
    exactDirectoryCount: 3,
    similarFileCount: 1,
    similarDirectoryCount: 2,
    reasons: ['项目完全重复', '项目名称完全一致']
  }), '项目完全重复');
  assert.equal(queueSimilarityEvidenceText({
    exactFileCount: 1,
    exactDirectoryCount: 0,
    similarFileCount: 0,
    similarDirectoryCount: 1,
    reasons: ['文件内容完全一致', '目录名相似']
  }), '1 个文件内容完全一致 · 1 个目录名称相似');
});

test('identical file content marks both the file name and MD5 in the shared directory tree', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /hasIdenticalContent[\s\S]*match\.reason === '文件内容完全一致'/);
  assert.match(app, /hasIdenticalContent && \/\^\[a-f0-9\]\{32\}\$\/i\.test\(md5\)/);
  assert.match(app, /exact-duplicate-mark exact-content-md5/);
});

test('source disposition chip has exact text and color state for every selection', () => {
  assert.deepEqual(sourceDispositionPresentation(true, false), {
    state: 'trash', label: '归档后移入回收站'
  });
  assert.deepEqual(sourceDispositionPresentation(false, true), {
    state: 'move', label: '归档后移动原文件'
  });
  assert.deepEqual(sourceDispositionPresentation(false, false), {
    state: 'keep', label: '归档后不移动原文件'
  });
  assert.deepEqual(sourceDispositionPresentation(true, true), {
    state: 'trash', label: '归档后移入回收站'
  });
});

test('source disposition chip uses danger colors only for the trash state', () => {
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  assert.match(styles, /\.safety-chip\.trash-enabled\s*\{[^}]*color:\s*var\(--danger-fg\)[^}]*background:\s*var\(--danger-bg\)/s);
  assert.match(styles, /\.safety-chip\s*\{[^}]*color:\s*var\(--ok-fg\)[^}]*background:\s*var\(--ok-bg\)/s);
});

test('queue scan actions stay grouped and right-aligned', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const actionGroup = html.match(/<div class="button-row queue-actions">([\s\S]*?)<span class="queue-action-break"/);

  assert.ok(actionGroup, 'queue scan action group should exist');
  assert.match(actionGroup[1], /id="add-folder"[\s\S]*id="add-video"[\s\S]*id="scan-source"/);
  assert.match(styles, /\.queue-title \.queue-actions\s*\{[^}]*justify-content:\s*flex-end;/s);
});

test('maintenance paths are selectable and usage guide is the final footer action', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(html, /id="user-data-path"[^>]*spellcheck="false"/);
  assert.match(html, /id="user-data-path"[^>]*readonly/);
  assert.match(html, /id="select-user-data"[^>]*>切换<\/button>/);
  assert.doesNotMatch(app, /userDataPathDirty|changeUserDataLocation\(requestedPath\)/);
  assert.match(preload, /changeUserDataLocation:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('user-data:change-location'\)/);
  assert.match(main, /ipcMain\.handle\('user-data:change-location', async \(event\)[\s\S]*?dialog\.showOpenDialog/);
  assert.match(html, /id="archive-staging-directory"[^>]*><button data-pick="archive-staging-directory"/);
  assert.match(html, /欢迎反馈<\/button>[\s\S]*id="open-usage-guide"[^>]*>使用说明<\/button>[\s\S]*<\/footer>/);
});

test('run log keeps messages in the list instead of duplicating the latest message in the header', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.doesNotMatch(html, /id="digest-log"/);
  assert.doesNotMatch(app, /digest\.textContent\s*=\s*`\$\{latestTime\}/);
  assert.match(app, /for \(const entry of \[\.\.\.logs\]\.reverse\(\)\)/);
  assert.match(html, /03 · 运行日志/);
  assert.doesNotMatch(html, /03 · 运行记录/);
});

test('scan skip summary separates filtering, root files, links and unreadable items', () => {
  assert.deepEqual(summarizeScanSkips([
    { reason: '低于过滤阈值 100 MB' },
    { reason: '低于过滤阈值 100 MB' },
    { reason: '根级非视频文件' },
    { reason: '已跳过链接或重解析点' },
    { reason: '无法读取：access denied', code: 'EACCES' },
    { reason: '未知类型' }
  ]), {
    total: 6,
    smallItems: 2,
    smallItemThresholdMb: '100',
    rootNonVideoFiles: 1,
    links: 1,
    unreadable: 1,
    other: 1
  });
});

test('scan progress ignores late events after the matching scan request completes', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(app, /activeScanToken = scanToken;[\s\S]*scanSource\([^\n]+scanToken\)[\s\S]*activeScanToken = null/);
  assert.match(app, /if \(!activeScanToken \|\| String\(progress\.scanToken \|\| ''\) !== activeScanToken\) return/);
  assert.match(preload, /scanSource: \(intakeDirectory, scanToken\).*'source:scan', intakeDirectory, scanToken/);
  assert.match(main, /queueManager\.scanSource\(intakeDirectory, scanToken\)/);
});

test('similarity rebuild completion advances stale chunk progress to 100 percent', () => {
  assert.deepEqual(similarityProgressPresentation({
    active: true, completed: 98, total: 100, elapsedMs: 4_900
  }), {
    complete: false,
    percent: 98,
    label: '正在重算 98% · 预计剩余 1 秒'
  });
  assert.deepEqual(similarityProgressPresentation({
    active: false, completed: 100, total: 100, elapsedMs: 5_000
  }), {
    complete: true,
    percent: 100,
    label: '重算完成 · 用时 5.0 秒'
  });
});

test('similarity settings use the standard nested background without a repeated strength label', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.doesNotMatch(html, /id="similarity-strength-label"/);
  assert.match(html, /<span>相似度强度<\/span>/);
  assert.match(styles, /\.similarity-terms-setting\s*\{[^}]*border:\s*1px solid var\(--line-soft\)[^}]*background:\s*var\(--panel-nested\)/s);
  assert.match(styles, /\.similarity-rebuild-setting\s*\{[^}]*border:\s*1px solid var\(--line-soft\)[^}]*background:\s*var\(--panel-nested\)/s);
  assert.doesNotMatch(app, /rebuildSimilarity\.disabled\s*&&\s*!progress\?\.active/);
});

test('theme picker exposes Forest and Twilight, migrates old values and keeps semantic contrast', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(html, /<option value="forest">森林<\/option>/);
  assert.match(html, /<option value="twilight">暮光<\/option>/);
  assert.doesNotMatch(html, /青瓷|暮紫|value="celadon"|value="plum"/);
  assert.match(app, /THEME_VALUES = \['classic', 'day', 'night', 'forest', 'twilight'\]/);
  assert.match(app, /THEME_ALIASES = Object\.freeze\(\{ celadon: 'forest', plum: 'twilight' \}\)/);
  assert.match(app, /const migratedTheme = THEME_ALIASES\[theme\] \|\| theme/);
  assert.match(main, /const themes = \['classic', 'day', 'night', 'forest', 'twilight'\]/);
  assert.doesNotMatch(styles, /body\[data-theme="(?:celadon|plum)"\]/);

  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (left, right) => {
    const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (bright + 0.05) / (dark + 0.05);
  };
  for (const theme of ['forest', 'twilight']) {
    const block = styles.match(new RegExp(`body\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, 's'))?.[1] || '';
    const variables = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)]
      .map((match) => [match[1], match[2].toLowerCase()]));
    assert.match(block, /color-scheme:\s*(?:light|dark)/);
    for (const required of ['ink', 'muted', 'paper', 'panel', 'field', 'line', 'accent', 'accent-soft',
      'focus-ring', 'ok-fg', 'ok-bg', 'warn-fg', 'warn-bg', 'danger-fg', 'danger-bg',
      'info-fg', 'info-bg', 'neutral-fg', 'neutral-bg', 'on-accent']) {
      assert.match(block, new RegExp(`--${required}:`), `${theme} is missing --${required}`);
    }
    assert.ok(contrast(variables.ink, variables.panel) >= 7, `${theme} primary text contrast`);
    assert.ok(contrast(variables.muted, variables.panel) >= 4.5, `${theme} secondary text contrast`);
    assert.ok(contrast(variables['on-accent'], variables.accent) >= 4.5, `${theme} accent action contrast`);
    for (const state of ['ok', 'warn', 'danger', 'info']) {
      assert.ok(contrast(variables[`${state}-fg`], variables[`${state}-bg`]) >= 4.5,
        `${theme} ${state} prompt contrast`);
    }
    assert.equal(new Set(['ok-bg', 'warn-bg', 'danger-bg', 'info-bg', 'neutral-bg']
      .map((name) => variables[name])).size, 5, `${theme} prompt colors must remain distinct`);
  }
  assert.match(styles, /\.language-toggle:hover\s*\{[^}]*background:\s*var\(--accent-soft\)/s);
  assert.match(styles, /\.theme-picker option\s*\{[^}]*color:\s*var\(--ink\)[^}]*background:\s*var\(--field\)/s);
  assert.doesNotMatch(styles, /var\(--(?:panel-strong|input-bg)\)/);
});

test('duplicate continuation appears in every actionable duplicate state but never for warehouse compression or large-task confirmation', () => {
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'awaiting_confirmation', confirmationReasons: ['name_match']
  }), true);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', confirmationReasons: ['name_match'], similarityPreflightBlocking: false
  }), false);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', automaticDuplicateCheckPending: true
  }), true);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', stageText: '等待内容完全一致核验', confirmationReasons: ['name_match']
  }), true);
  assert.equal(shouldShowDuplicateConfirmation({ status: 'awaiting_duplicate_confirmation' }), true);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'awaiting_confirmation', confirmationReasons: ['large_task', 'name_match']
  }), false);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', automaticDuplicateCheckPending: true, sourceCatalogRecordId: 'warehouse-record'
  }), false);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', automaticDuplicateCheckPending: true, duplicateConfirmedAt: '2026-08-30T00:00:00.000Z'
  }), true);
  assert.equal(shouldShowDuplicateConfirmation({
    status: 'queued', automaticDuplicateCheckPending: true, exactDuplicateOverrideAt: '2026-08-30T00:00:00.000Z'
  }), false);
});

test('paused work exposes a toolbar cancel action and large-folder sampling is user configurable', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /id="cancel-current"[^>]*hidden>取消当前任务<\/button>/);
  assert.match(app, /#cancel-current'\)\.hidden = !\(state\.paused && currentJob\)/);
  assert.match(app, /window\.archiveApp\.cancelTask\(jobId\)/);
  assert.match(html, /id="large-folder-md5-sample-limit"[^>]*value="200"/);
  assert.match(app, /largeFolderMd5SampleLimit: Number\(elements\.largeFolderMd5SampleLimit\.value\)/);
});

test('manual package update is offered from check for updates instead of a separate header button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.doesNotMatch(html, /id="install-local-update"/);
  assert.match(main, /buttons: english \? \['Manual update', 'Close'\] : \['手动更新', '关闭'\]/);
  assert.match(main, /\['Automatic update', 'Manual update', 'Open release page', 'Later'\]/);
});

test('manual update checks and successful restarts both surface release notes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const checker = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'update-checker.js'), 'utf8');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'update-manager.js'), 'utf8');

  assert.match(checker, /releaseNotes:\s*compactReleaseNotesPayload\(release\.body\)/);
  assert.match(main, /appendReleaseNotes\([\s\S]*result\.releaseNotes/);
  assert.match(main, /showUpdateSuccessDialog\(pendingUpdateSuccess\)/);
  assert.match(manager, /HAMSTER_UPDATE_NOTICE_FILE:\s*noticeFile/);
});

test('safety halt uses the shared styled dialog instead of a bare warning box', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(html, /id="trash-safety-dialog"[^>]*safety-dialog/);
  assert.match(html, /class="safety-dialog-hero"/);
  assert.match(html, /class="safety-dialog-checklist"/);
  assert.match(styles, /\.safety-dialog-hero\s*\{/);
  assert.match(styles, /\.safety-dialog-status\s*\{/);
});

test('backup location remains manually editable even before recording is enabled', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const control = app.match(/function updateBackupLocationControl\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.doesNotMatch(control, /backupLocation\.disabled/);
  assert.match(control, /backupLocation\.required = enabled/);
});

test('renderer confirmations use one themed dialog instead of browser confirm boxes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /id="confirm-dialog"[^>]*confirm-dialog/);
  assert.doesNotMatch(app, /window\.confirm\(/);
  assert.match(app, /function confirmUser\(message, options = \{\}\)/);
});

test('compact settings copy and activity colors follow the current UI specification', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  for (const removed of ['备份位置词条', '将已备份文件移动到', '关闭后保留已有相似关系，新入库项目不再计算',
    '集中保存设置、仓库数据库、缩略图、已处理文件和当前用户的一份运行日志；切换时保留旧目录',
    '点击任务行的复选框可进行批量操作']) {
    assert.doesNotMatch(html, new RegExp(removed));
  }
  assert.match(html, />切换时保留旧目录，确认后重启应用生效<\/small>/);
  assert.doesNotMatch(html, /多选可进行批量操作/);
  assert.match(html, /id="auto-skip-exact-duplicates"/);
  assert.match(html, /id="similarity-report-enabled"[^>]*checked/);
  assert.match(html, /id="queue-similarity-report-dialog"/);
  assert.match(html, /每个文件都有有效 MD5[^<]*文件数量、相对路径、大小和 MD5 全部一致/);
  assert.match(html, /class="queue-threshold-clause"[\s\S]*?id="large-folder-file-threshold"[\s\S]*?>的文件夹，<\/span><\/span>/);
  assert.match(app, /actionButton\('相似报告', 'similarity-report'/);
  assert.doesNotMatch(app, /Ctrl.*多选/);
  assert.ok(
    app.indexOf("actionButton('确认重复并继续'") < app.indexOf("actionButton('取消'"),
    'duplicate continuation must remain immediately before cancel in the action order'
  );
  assert.match(app, /exact-duplicate-mark/);
  assert.match(app, /row\.classList\.toggle\('exact-entry', hasExactDuplicate\)/);
  assert.match(app, /const similar = !exact && overlaps\(redRanges, start, end\)/);
  assert.match(app, /workspace-page' && suspendedQueueSimilarityReport && activeQueueSimilarityReportJobId/);
  assert.match(styles, /\.virtual-tree-row\.exact-entry\s*\{[^}]*background:\s*var\(--warn-bg\)/s);
  assert.doesNotMatch(styles, /\.virtual-tree-row\.exact-entry\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /\.exact-duplicate-mark\s*\{[^}]*border:\s*1px solid var\(--amber\)/s);
  assert.match(styles, /\.virtual-tree-row\.directory\s*\{[^}]*color:\s*var\(--ink\)[^}]*background:\s*var\(--panel\)/s);
  assert.match(styles, /\.virtual-tree-row\.directory > \.virtual-tree-icon\s*\{[^}]*color:\s*var\(--muted\)[^}]*background:\s*var\(--panel-tint\)/s);
  assert.match(styles, /\.virtual-tree-row\.directory\.collapsible:not\(\.similar-entry\):not\(\.exact-entry\):hover\s*\{[^}]*background:\s*var\(--neutral-bg\)/s);
  assert.doesNotMatch(styles, /\.virtual-tree-row\.directory\.collapsible[^\{]*:hover\s*\{[^}]*(?:accent|danger)/s);
  assert.match(styles, /\.catalog-text-row:hover\s*\{[^}]*background:\s*var\(--neutral-bg\)/s);
  assert.doesNotMatch(styles, /\.catalog-text-row:hover\s*\{[^}]*(?:accent|danger)/s);
  assert.match(styles, /\.catalog-text-row\.active,\s*\.catalog-text-row\.selected\s*\{[^}]*background:\s*var\(--ok-bg\)/s);
  assert.match(styles, /\.catalog-text-row\.selected\s*\{[^}]*box-shadow:\s*inset 3px 0 var\(--ok-fg\)/s);
  assert.doesNotMatch(styles, /\.catalog-text-row:hover,\s*\.catalog-text-row\.active/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8'),
    /inspectSmokeVisualColorStates[\s\S]*hoverBackground === result\.neutralHoverBackground[\s\S]*directoryIconColor === result\.mutedColor/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8'),
    /CSS\.forcePseudoState[\s\S]*forcedPseudoClasses:\s*\['hover'\]/);
  assert.match(app, /const host = mark\.closest\('dialog\[open\]'\) \|\| document\.body/);
  assert.match(styles, /\.queue-similarity-directory \.virtual-directory-tree\s*\{[^}]*height:\s*240px/s);
  assert.match(styles, /\.location-panel \.help-tip::after\s*\{[^}]*left:\s*-72px;[^}]*width:\s*min\(300px,/s);
  const activityBlocks = [...styles.matchAll(/--activity-1:\s*(#[0-9a-f]{6})[\s\S]*?--activity-4:\s*(#[0-9a-f]{6})/gi)];
  assert.equal(activityBlocks.length, 5);
  for (const [, low, high] of activityBlocks) {
    const greenDominates = (hex) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const red = value >> 16;
      const green = (value >> 8) & 255;
      const blue = value & 255;
      return green > red && green > blue;
    };
    assert.equal(greenDominates(low), true, `${low} should be green-led`);
    assert.equal(greenDominates(high), true, `${high} should be green-led`);
  }
});

test('warehouse selection and search recovery update in place without rebuilding the result list', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(app, /function syncCatalogItemState\(\)/);
  assert.match(app, /activeCatalogId = recordId;\s*syncCatalogItemState\(\);/);
  assert.doesNotMatch(app, /activeCatalogId = recordId;\s*renderCatalog\(currentCatalogResults\);/);
  assert.match(app, /catalogSearch\.addEventListener\('search', runCatalogSearchNow\)/);
  assert.match(app, /selectAllCatalog\.addEventListener\('change',[\s\S]*?syncCatalogItemState\(\);/);
  assert.match(html, /class="brand-icon" src="\.\.\/\.\.\/assets\/app-icon\.ico" width="32" height="32"/);
  assert.match(styles, /\.catalog-detail \.archive-heading\s*\{\s*background:\s*var\(--panel\)/);
  assert.match(styles, /\.compression-options-row\s*\{[^}]*border-top:\s*1px dashed var\(--line-strong\)/s);
  assert.doesNotMatch(styles, /\.archive-password-setting\s*\{[^}]*border-top:/s);
});

test('catalog detail rendering ignores stale rapid-selection responses', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /let catalogDetailRequest = 0/);
  assert.match(app, /requestId !== catalogDetailRequest \|\| activeCatalogId !== recordId\) return/);
  assert.match(app, /record\.id !== activeCatalogId\) return/);
});

test('catalog tag filter always includes the possible-duplicate virtual option', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /new Option\('可能重复', possibleDuplicateFilter\)/);
  assert.match(app, /possibleDuplicateFilter = '__possible_duplicate__'/);
});

test('catalog single and bulk tag editors share comma-aware autocomplete', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(html, /<script src="tag-autocomplete\.js"><\/script>/);
  assert.match(html, /id="bulk-tags-input"[^>]*>/);
  assert.match(app, /function tagAutocompleteOptions\(\)/);
  assert.match(app, /label: t\('标签自动补全'\)/);
  assert.match(app, /acceptHint: t\('按 Tab 补全'\)/);
  assert.match(app, /bindTagAutocomplete\(elements\.bulkTagsInput, tagAutocompleteOptions\(\)\)/);
  assert.match(app, /bindTagAutocomplete\(tagsInput, tagAutocompleteOptions\(\)\)/);
});

test('queue settings lock and roll back while processing is active', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.match(app, /function setConfigControlsLocked\(locked\)/);
  assert.match(app, /setConfigControlsLocked\(state\.running\)/);
  assert.match(app, /if \(currentState\?\.running\) \{[\s\S]*?renderConfig\(currentState\.config\)[\s\S]*?return null;/);
  assert.match(app, /else if \(currentState\?\.config\) \{[\s\S]*?renderConfig\(currentState\.config\)/);
});

test('recent native dialogs follow the selected interface language', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  for (const englishLabel of [
    'Archive tasks are still running',
    'Choose the 7-Zip program',
    'Choose warehouse location (saves)',
    'Export warehouse as an archive',
    'Choose an external warehouse archive',
    'Video files'
  ]) {
    assert.match(main, new RegExp(`english \\? '${englishLabel.replace(/[()]/g, '\\$&')}'`));
  }
});

test('name-similarity highlights expose a guarded one-click whitelist action', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(app, /match\.reason === '目录名相似' \|\| match\.reason === '文件名相似'/);
  assert.match(app, /mark\.dataset\.whitelistTerm = mark\.textContent/);
  assert.match(app, /similarityWhitelistInput\.value = term/);
  assert.match(app, /window\.archiveApp\.addSimilarityIgnoreTerm\(term\)/);
  assert.match(app, /event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(html, /id="similarity-whitelist-dialog"/);
  assert.match(html, /以下词汇在相似度计算中将被忽略/);
  assert.match(html, /id="similarity-whitelist-input"[^>]*required/);
  assert.doesNotMatch(main, /checkboxLabel: isEnglish \? 'Do not remind me again' : '下次不再提醒'/);
  assert.match(styles, /\.similarity-whitelist-action\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*1000;/s);
  assert.match(styles, /\.similarity-whitelist-dialog \.dialog-help\s*\{/);
});

test('warehouse browsing keeps compact controls, root folders, backup locations and keyboard paging visible', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(styles, /\.similarity-rebuild-setting > \.button\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(app, /record\.sourceType === 'directory' \? record\.displayName : ''/);
  assert.match(app, /'标签', '备份位置', '入库时间'/);
  assert.match(app, /backupCell\.textContent = record\.backupLocation \|\| '—'/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight'\]\.includes\(event\.key\)/);
  assert.match(styles, /\.activity-cell\[data-level="0"\][^\{]*\{[^}]*background:\s*#fff;/s);
});
