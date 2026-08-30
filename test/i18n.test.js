'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// The live renderer tree is excluded from the public snapshot, so resolve it
// dynamically and skip cleanly when only the snapshot is present.
const candidates = [
  path.join(__dirname, '..', 'src', 'renderer'),
  path.join(__dirname, '..', 'resources', 'app', 'src', 'renderer')
];
const rendererDir = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'i18n.js')));

if (!rendererDir) {
  test('renderer i18n dictionary', { skip: 'renderer tree with i18n.js not present' }, () => {});
} else {
  const i18n = require(path.join(rendererDir, 'i18n.js'));
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

  test('dictionary builds without duplicate entries or broken patterns', () => {
    // buildExact/buildPatterns throw at require time; reaching here means the
    // tables are consistent. Sanity-check the exported shape as well.
    assert.ok(Object.keys(i18n.exact).length > 500, 'dictionary should stay comprehensive');
    assert.ok(i18n.patterns.length > 100, 'pattern table should stay comprehensive');
    for (const [pattern, replacement] of i18n.patterns) {
      assert.ok(pattern instanceof RegExp, `pattern must be a RegExp: ${pattern}`);
      assert.equal(typeof replacement, 'string', `replacement must be a string for ${pattern}`);
    }
  });

  test('english values never contain untranslated Chinese', () => {
    for (const [source, target] of Object.entries(i18n.exact)) {
      assert.equal(typeof target, 'string', `entry "${source}" must map to a string`);
      assert.ok(!CJK.test(target), `"${source}" still contains Chinese: ${target}`);
    }
    for (const [, replacement] of i18n.patterns) {
      assert.ok(!CJK.test(replacement), `pattern replacement still contains Chinese: ${replacement}`);
    }
    for (const [, target] of i18n.stageFragments) {
      assert.ok(!CJK.test(target), `stage fragment target still contains Chinese: ${target}`);
    }
  });

  test('translate is a no-op for Chinese locale', () => {
    i18n.setLocale('zh-CN');
    assert.equal(i18n.translate('仓库'), '仓库');
    assert.equal(i18n.translate('任意未收录的句子'), '任意未收录的句子');
  });

  test('exact, pattern and recursive-capture translations', () => {
    i18n.setLocale('en-US');
    assert.equal(i18n.translate('保存设置'), 'Save settings');
    assert.equal(i18n.translate('一键加入白名单'), 'Add to whitelist');
    assert.equal(
      i18n.translate('以下词汇在相似度计算中将被忽略'),
      'The following term will be ignored in similarity calculations'
    );
    assert.equal(
      i18n.translate('与仓库内项目完全一致，已自动跳过'),
      'Identical to a warehouse project; auto-skipped'
    );
    assert.equal(
      i18n.translate('“PRESTIGE”已加入相似度白名单；已有关系不会自动重算'),
      '“PRESTIGE” added to the similarity whitelist; existing relations were not recalculated'
    );
    assert.equal(i18n.translate('第 2 / 7 页'), 'Page 2 / 7');
    // Captured groups are translated recursively (拖放 is an exact entry).
    assert.equal(i18n.translate('已通过拖放加入 3 个任务'), 'Added 3 tasks via Drop');
    assert.equal(i18n.translate('无法打开仓库：系统错误'), 'Could not open the Warehouse: 系统错误');
    // Composed undo labels resolve through nested patterns.
    assert.equal(
      i18n.translate('撤回：修改“旅行相册”的整理信息'),
      'Undo: Edit organization details of “旅行相册”'
    );
    // Regression: hours/minutes estimates used to lose the unit suffix.
    assert.equal(
      i18n.translate('已完成 2/5 项 · 预计还需 3 小时 12 分钟'),
      'Completed 2/5 items · estimated time remaining: 3 hours 12 minutes'
    );
  });

  test('stage fragments translate queue stage wording', () => {
    i18n.setLocale('en-US');
    assert.equal(
      i18n.translateStage('正在加密压缩并生成 10.5 GB (16x1.00g) 分卷'),
      'Encrypting and compressing and creating 10.5 GB (16x1.00g) volumes'
    );
    assert.equal(
      i18n.translateStage('已确认，等待库内项目压缩'),
      'Confirmed; queued for warehouse item compression'
    );
    assert.equal(
      i18n.translateStage('发现 3 个相似项目 · 等待手动确认'),
      'Found 3 similar items · Awaiting manual confirmation'
    );
    assert.equal(
      i18n.translateStage('2 个精确重复文件 · 1 个相似文件 · 项目名称完全一致'),
      '2 exact duplicate files · 1 similar files · Identical project name'
    );
    assert.equal(
      i18n.translateStage('正在压缩 · 已完成 1/4 项 · 预计还需 3 小时 12 分钟'),
      'Compressing · Completed 1/4 items · estimated time remaining: 3 hours 12 minutes'
    );
    assert.equal(
      i18n.translateStage('开始调用 7-Zip；本任务未设置密码。'),
      'Starting 7-Zip; this task has no password.'
    );
  });

  test('dynamic DOM translation includes the inserted root and preserves user data', () => {
    i18n.setLocale('en-US');
    const previousNode = global.Node;
    const previousNodeFilter = global.NodeFilter;
    const previousDocument = global.document;
    global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    global.NodeFilter = { SHOW_TEXT: 4 };
    global.document = {
      createTreeWalker: () => ({ nextNode: () => null })
    };
    try {
      const insertedText = {
        nodeType: Node.TEXT_NODE,
        nodeValue: '保存设置',
        parentElement: { closest: () => null }
      };
      i18n.translateDom(insertedText);
      assert.equal(insertedText.nodeValue, 'Save settings');

      const userText = {
        nodeType: Node.TEXT_NODE,
        nodeValue: '视频',
        parentElement: { closest: (selector) => selector === '[data-i18n-user-text]' ? {} : null }
      };
      i18n.translateDom(userText);
      assert.equal(userText.nodeValue, '视频', 'user titles and tags must never be translated');

      const attributes = new Map([['aria-label', '标签自动补全']]);
      const insertedElement = {
        nodeType: Node.ELEMENT_NODE,
        closest: () => null,
        matches: () => true,
        querySelectorAll: () => [],
        hasAttribute: (name) => attributes.has(name),
        getAttribute: (name) => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value)
      };
      i18n.translateDom(insertedElement);
      assert.equal(attributes.get('aria-label'), 'Tag autocomplete');
    } finally {
      if (previousNode === undefined) delete global.Node;
      else global.Node = previousNode;
      if (previousNodeFilter === undefined) delete global.NodeFilter;
      else global.NodeFilter = previousNodeFilter;
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      i18n.setLocale('zh-CN');
    }
  });

  test('runtime queue and archive logs have English coverage', () => {
    i18n.setLocale('en-US');
    const messages = [
      '开始调用 7-Zip；密码参数已隐藏。',
      '开始调用 7-Zip；本任务未设置密码。',
      '相似项目关系重建失败：disk error',
      '开始全局重算仓库相似关系…',
      '已按当前设置完成全局重算。',
      '回收站复核暂时不可用：item · system error',
      '用户已核对压缩体积异常，并确认入库。',
      '用户删除了大小异常成品；源项目未移动、未删除。',
      '用户已确认回收站安全警告；队列仍保持停止，后续任务需手动重新开始。',
      '卡顿规避：已跳过 17 个小于 128 KB 的极小文件，不计算 MD5。',
      '运行中的任务已安全取消。'
    ];
    for (const message of messages) {
      assert.ok(!CJK.test(i18n.translateStage(message)), `runtime log is not translated: ${message}`);
    }
  });

  test('every static Chinese string in index.html is translatable', () => {
    i18n.setLocale('en-US');
    // Extract markup-free text first (entities stay encoded so `<`/`>` inside
    // attribute-free text cannot look like tags), then decode each candidate
    // the way the live DOM would present it.
    const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const decodeEntities = (value) => value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    const allowlist = new Set([
      // Symbols and layout-only text nodes never need entries.
      '!', '⇄', '·', '⌄', '×', '＋', '--:--', '1'
    ]);
    const uncovered = [];
    const consider = (raw) => {
      const value = decodeEntities(raw).trim();
      if (!value || allowlist.has(value) || !CJK.test(value)) return;
      const translated = i18n.translate(value);
      if (translated === value) uncovered.push(value);
    };
    for (const match of body.matchAll(/>([^<>]+)</g)) consider(match[1]);
    for (const match of body.matchAll(/\b(?:placeholder|title|aria-label|data-tooltip)="([^"]*)"/g)) {
      consider(match[1]);
    }
    assert.deepEqual(uncovered, [], 'index.html strings missing from the i18n dictionary');
  });
}
