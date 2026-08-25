'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  similarityProgressPresentation,
  sourceDispositionPresentation
} = require('../src/renderer/ui-state');

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

  assert.match(html, /id="select-user-data"[^>]*>选择<\/button>/);
  assert.match(html, /id="archive-staging-directory"[^>]*><button data-pick="archive-staging-directory"/);
  assert.match(html, /欢迎反馈<\/button>[\s\S]*id="open-usage-guide"[^>]*>使用说明<\/button>[\s\S]*<\/footer>/);
});

test('run history keeps log messages in the list instead of duplicating the latest message in the header', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');

  assert.doesNotMatch(html, /id="digest-log"/);
  assert.doesNotMatch(app, /digest\.textContent\s*=\s*`\$\{latestTime\}/);
  assert.match(app, /for \(const entry of \[\.\.\.logs\]\.reverse\(\)\)/);
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

test('theme picker exposes the two curated themes with complete style blocks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  assert.match(html, /<option value="celadon">青瓷<\/option>/);
  assert.match(html, /<option value="plum">暮紫<\/option>/);
  assert.match(app, /THEME_VALUES = \['classic', 'day', 'night', 'celadon', 'plum'\]/);
  assert.match(styles, /body\[data-theme="celadon"\]\s*\{[^}]*--accent:/s);
  assert.match(styles, /body\[data-theme="plum"\]\s*\{[^}]*--accent:/s);
});

test('manual package update is offered from check for updates instead of a separate header button', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.doesNotMatch(html, /id="install-local-update"/);
  assert.match(main, /buttons: english \? \['Manual update', 'Close'\] : \['手动更新', '关闭'\]/);
  assert.match(main, /\['Automatic update', 'Manual update', 'Open release page', 'Later'\]/);
});

test('compact settings copy and activity colors follow the current UI specification', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

  for (const removed of ['备份位置词条', '将已备份文件移动到', '关闭后保留已有相似关系，新入库项目不再计算',
    '集中保存设置、仓库数据库、缩略图、已处理文件和当前用户的一份运行日志；切换时保留旧目录',
    '点击任务行的复选框可进行批量操作']) {
    assert.doesNotMatch(html, new RegExp(removed));
  }
  assert.match(html, />切换时保留旧目录<\/small>/);
  assert.match(html, />多选可进行批量操作<\/span>/);
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

test('catalog detail rendering ignores stale rapid-selection responses', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /let catalogDetailRequest = 0/);
  assert.match(app, /requestId === catalogDetailRequest && activeCatalogId === recordId/);
  assert.match(app, /record\.id !== activeCatalogId\) return/);
});

test('catalog tag filter always includes the possible-duplicate virtual option', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /new Option\('可能重复', possibleDuplicateFilter\)/);
  assert.match(app, /possibleDuplicateFilter = '__possible_duplicate__'/);
});
