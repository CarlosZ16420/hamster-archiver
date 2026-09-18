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
      assert.ok(['string', 'function'].includes(typeof replacement), `replacement must be a string or function for ${pattern}`);
    }
  });

  test('english values never contain untranslated Chinese', () => {
    for (const [source, target] of Object.entries(i18n.exact)) {
      assert.equal(typeof target, 'string', `entry "${source}" must map to a string`);
      assert.ok(!CJK.test(target), `"${source}" still contains Chinese: ${target}`);
    }
    for (const [, replacement] of i18n.patterns) {
      assert.ok(!CJK.test(String(replacement)), `pattern replacement still contains Chinese: ${replacement}`);
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
    assert.equal(i18n.translate('一键加入白名单'), 'Ignore Term');
    assert.equal(i18n.translate('未评分'), 'Unrated');
    assert.equal(i18n.translate('随机漫步'), 'Surprise Me');
    assert.equal(i18n.translate('所选目录已经不存在。'), 'Selected folder no longer exists.');
    assert.equal(i18n.translate('入库'), 'Added');
    assert.equal(
      i18n.translate('扫描时会把所选目录下的每个文件夹或视频分别加入队列，跳过其他根级文件；启用小项目过滤时，低于当前阈值的项目也不会入队（默认 100 MB）'),
      'Queues each folder/video. Skips other top-level files and items under the limit (default 100 MB).'
    );
    assert.equal(
      i18n.translate('以下词汇在相似度计算中将被忽略'),
      'Ignored in similarity checks'
    );
    assert.equal(
      i18n.translate('与仓库内项目完全一致，已自动跳过'),
      'Identical to a Warehouse item; auto-skipped'
    );
    assert.equal(i18n.translate('等待下次入库'), 'Next Run');
    assert.equal(i18n.translate('2 个低于 100 MB 的小项目'), '2 small items below 100 MB');
    assert.equal(
      i18n.translate('有多个项目低于当前 50 MB 的入库阈值。'),
      'Multiple items are below the current 50 MB minimum item size.'
    );
    assert.equal(
      i18n.translate('“tiny-project”项目低于 50 MB 的入库阈值，已跳过。'),
      'Skipped “tiny-project”: below the 50 MB minimum item size.'
    );
    assert.equal(
      i18n.translate('“PRESTIGE”已加入相似度白名单；已有关系不会自动重算'),
      'Added “PRESTIGE” to ignore list; existing links unchanged.'
    );
    assert.equal(i18n.translate('第 2 / 7 页'), 'Page 2 / 7');
    // Captured groups are translated recursively (拖放 is an exact entry).
    assert.equal(i18n.translate('已通过拖放加入 3 个任务'), 'Added 3 tasks via Drop');
    assert.equal(i18n.translate('无法打开仓库：系统错误'), 'Couldn’t open the Warehouse: 系统错误');
    // Composed undo labels resolve through nested patterns.
    assert.equal(
      i18n.translate('撤回：修改“旅行相册”的整理信息'),
      'Undo: Edit details for “旅行相册”'
    );
    // Regression: hours/minutes estimates used to lose the unit suffix.
    assert.equal(
      i18n.translate('已完成 2/5 项 · 预计还需 3 小时 12 分钟'),
      '2/5 done · ~3h 12m left'
    );
    assert.equal(
      i18n.translate('已验证成品发布完成：同盘重命名 3 个文件，用时 42 毫秒。'),
      'Archive published: renamed 3 files on the same drive in 42 ms.'
    );
    assert.equal(
      i18n.translate('已验证成品发布完成：跨盘复制 2 个文件，用时 125.5 毫秒。'),
      'Archive published: copied 2 files across drives in 125.5 ms.'
    );
    assert.equal(i18n.translate('已选择 1 项'), 'Selected 1 item');
    assert.equal(i18n.translate('1 个文件 · 1 卷'), '1 file · 1 volume');
    assert.equal(i18n.translate('1 小时 1 分钟'), '1 hour 1 minute');
    assert.equal(i18n.translate('发现 1 个相似候选'), 'Found 1 similar candidate');
    assert.equal(
      i18n.translate('设置已保存；变更：压缩格式、压缩密码（内容未记录）。'),
      'Settings saved; changed: archive format, archive password (value not logged).'
    );
    assert.equal(
      i18n.translate('用户数据区切换完成：D:\\Old → E:\\New；方式：复制当前数据。'),
      'User data area switched: D:\\Old → E:\\New; mode: copied current data.'
    );
    assert.equal(
      i18n.translate('已重新载入 3 个排除词，并更新相似项目关系。'),
      'Reloaded 3 ignore terms; similarity updated.'
    );
  });

  test('folder feedback and backup confirmation keep user names and locations intact in English', () => {
    i18n.setLocale('en-US');
    assert.equal(i18n.translate('压缩包：未压缩'), 'Archive: uncompressed');
    assert.equal(i18n.translate('逐项确认'), 'Review Each Item');
    assert.equal(i18n.translate('缩略图视图 · 中 · 再次点击切换大小'), 'Thumbnail View · Medium · Click again to change size');
    assert.equal(i18n.translate('仓库与本地目录内容一致'), '仓库 matches the local folder contents');
    assert.equal(i18n.translate('项目“仓库”与本地目录内容一致；未重建预览，也未改写仓库内容。'), '“仓库” matches the local folder contents; previews and Warehouse contents were not rebuilt.');
    assert.equal(i18n.translate('原项目记录的备份位置为：旧盘，当前压缩设置的备份位置为：新盘，备份位置是否更新？'), 'The item’s original backup location is: 旧盘. The current compression backup location is: 新盘. Update the backup location?');
    assert.equal(i18n.translate('所选项目有2项的备份位置与当前压缩设置不同，当前压缩设置为“备份位置：新盘”，是否将项目备份位置更新为当前设置？'), '2 selected items have a different backup location. The current compression setting is “Backup location: 新盘”. Update the items’ backup locations to this setting?');
  });

  test('warehouse density, selection actions and off-page counts translate in both directions', () => {
    const labels = ['缩略图视图', '小', '中', '大', '全选当前页', '取消全部选择', '输入仓库页码', '返回仓库工具栏', '批量操作', '入库时间 ↓', '入库时间 ↑', '第'];
    i18n.setLocale('en-US');
    for (const label of labels) assert.ok(!CJK.test(i18n.translate(label)), label);
    assert.equal(i18n.translate('其中 1 项不在当前页'), '1 item on other pages');
    assert.equal(i18n.translate('其中 2 项不在当前页'), '2 items on other pages');
    assert.equal(i18n.translate('/ 9 页 · 共 208 项'), '/ 9 · 208 items total');
    i18n.setLocale('zh-CN');
    for (const label of labels) assert.equal(i18n.translate(label), label);
    assert.equal(i18n.translate('其中 2 项不在当前页'), '其中 2 项不在当前页');
    assert.equal(i18n.translate('/ 9 页 · 共 208 项'), '/ 9 页 · 共 208 项');
  });

  test('pattern captures preserve user text unless explicitly marked as UI copy', () => {
    i18n.setLocale('en-US');
    assert.equal(
      i18n.translate('撤回：修改“仓库”的整理信息'),
      'Undo: Edit details for “仓库”'
    );
    assert.equal(i18n.translate('选择 设置'), 'Select 设置');
    assert.equal(
      i18n.translate('已把 2 条仓库内容的备份位置修改为：视频。'),
      'Changed 2 backup locations to: 视频'
    );
    assert.equal(
      i18n.translate('无法打开仓库：所选目录已经不存在。'),
      'Couldn’t open the Warehouse: Selected folder no longer exists.'
    );
  });

  test('dynamic renderer and safety messages have complete English output', () => {
    i18n.setLocale('en-US');
    const messages = [
      '正在生成缩略图 · 已处理 2/30 · 视频抽帧 1/3 · sample.mp4',
      '缩略图阶段耗时：125 ms · {"video-frame":{"count":3,"elapsedMs":100}}',
      '入库阶段耗时：相似关系 12 ms · 仓库写入 20 ms · 更新记录 2',
      '视频抽帧达到处理时限，保留已生成的预览：sample.mp4',
      '缩略图尝试达到上限，保留已生成的预览：90/100',
      '已跳过无法生成的视频帧：sample.mp4 · 2/3 · 媒体处理超时：ffmpeg.exe',
      '已跳过无法生成预览的媒体：sample.png · ENOENT',
      'FFmpeg 视频抽帧失败，改用系统缩略图：sample.mp4 · ENOENT',
      '“sample.png”不是支持的 PNG、JPEG、WebP 或 GIF 图片。',
      '“sample.png”超过 25 MB。',
      '无法读取“sample.png”。',
      '已移动到：D:\\Archive',
      '其中 2 项记录为已移动或已进入回收站；复原失败时会保留对应仓库记录和压缩包。',
      '相似度引擎已更新（强度：标准），正在后台重建相似项目关系…',
      '用户已确认任务风险；大任务将按 10 GiB 分卷。',
      '已验证入库并复制到完成位置，但原位置副本未能删除，请手动核对',
      '源文件后处理已经执行，但处理结果未能写回仓库：仓库记录保存失败。请勿重试归档，并按运行日志核对源文件位置。',
      '自动跳过项目完全重复的任务“Project A”：Project B、Project C；源文件和仓库均未修改，队列项已删除。',
      '界面加载失败 (-105)：NAME_NOT_RESOLVED',
      '完整性清单包含不安全路径：../app.js',
      '发行包关键文件 SHA-256 校验失败：resources/app.asar',
      '发行清单缺少关键文件完整性记录。',
      '无法确认源项目是否保留在回收站，且原位置已经不存在。队列已安全停止，请立即检查回收站。'
    ];
    for (const message of messages) {
      const translated = i18n.translateStage(message);
      assert.ok(!CJK.test(translated), `dynamic message is not fully translated: ${message} -> ${translated}`);
    }
  });

  test('stage fragments translate queue stage wording', () => {
    i18n.setLocale('en-US');
    assert.equal(
      i18n.translateStage('正在加密压缩并生成 10.5 GB (16x1.00g) 分卷'),
      'Encrypting/compressing and creating 10.5 GB (16x1.00g) volumes'
    );
    assert.equal(
      i18n.translateStage('已确认，等待库内项目压缩'),
      'Confirmed; Warehouse compression queued.'
    );
    assert.equal(i18n.translateStage('等待下次入库'), 'Next Run');
    assert.equal(
      i18n.translateStage('发现 3 个相似项目 · 等待手动确认'),
      'Found 3 similar items · Awaiting manual confirmation'
    );
    assert.ok(!CJK.test(i18n.translateStage(
      '名称存在仓库候选 · 发现 2 个相似候选 · 等待选择入库方式'
    )));
    assert.equal(
      i18n.translateStage('2 个文件内容完全一致 · 1 个文件名称相似 · 项目名称完全一致'),
      '2 exact-match files · 1 file name is similar · Exact project name'
    );
    assert.equal(
      i18n.translateStage('正在压缩 · 已完成 1/4 项 · 预计还需 3 小时 12 分钟'),
      'Compressing · 1/4 done · ~3h 12m left'
    );
    assert.equal(
      i18n.translateStage('开始调用 7-Zip；本任务未设置密码。'),
      'Starting 7-Zip. No password set.'
    );
  });

  test('queue status badges translate in both locales and survive runtime language switches', () => {
    const app = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
    assert.match(
      app,
      /statusCell\.append\(makeStage\('span', `status \$\{job\.status\}`, jobStatusLabel\(job\)\)\)/,
      'dynamic status badges must use the queue-stage translation channel'
    );
    assert.match(
      app,
      /\? '待选入库方式'\s*:\s*job\?\.status === 'queued' && job\?\.taskKind === 'catalog_refresh'\s*\? '等待更新目录'\s*:\s*statusLabel\(job\?\.status\)/,
      'the special badge must remain presentation-only and other statuses must use statusLabel'
    );

    const previousNode = global.Node;
    const previousNodeFilter = global.NodeFilter;
    const previousDocument = global.document;
    global.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
    global.NodeFilter = { SHOW_TEXT: 4 };
    const badges = [];
    const body = {
      nodeType: Node.ELEMENT_NODE,
      matches: () => false,
      querySelectorAll: () => [],
      children: []
    };
    const makeBadge = (source) => {
      const badge = {
        nodeType: Node.ELEMENT_NODE,
        matches: () => false,
        querySelectorAll: () => []
      };
      const badgeText = {
        nodeType: Node.TEXT_NODE,
        nodeValue: source,
        parentElement: { closest: (selector) => selector === '[data-i18n-stage]' ? badge : null }
      };
      badge.textNode = badgeText;
      badges.push(badge);
      body.children.push(badge);
      return badge;
    };
    global.document = {
      body,
      documentElement: { lang: '' },
      createTreeWalker: (root) => {
        const textNodes = root === body
          ? body.children.map((badge) => badge.textNode)
          : root.textNode ? [root.textNode] : [];
        let index = 0;
        return { nextNode: () => textNodes[index++] || null };
      }
    };

    try {
      i18n.setLocale('zh-CN');
      const chineseBadge = makeBadge('待选入库方式');
      i18n.translateDom(chineseBadge);
      assert.equal(chineseBadge.textNode.nodeValue, '待选入库方式');

      i18n.setLocale('en-US');
      assert.equal(chineseBadge.textNode.nodeValue, 'Choose archive mode');
      const regeneratedEnglishBadge = makeBadge('待选入库方式');
      i18n.translateDom(regeneratedEnglishBadge);
      assert.equal(regeneratedEnglishBadge.textNode.nodeValue, 'Choose archive mode');

      const queuedBadge = makeBadge('等待压缩');
      i18n.translateDom(queuedBadge);
      assert.equal(queuedBadge.textNode.nodeValue, 'Queued');
      const completedBadge = makeBadge('已完成');
      i18n.translateDom(completedBadge);
      assert.equal(completedBadge.textNode.nodeValue, 'Completed');
      assert.equal(badges.length, 4, 'only the intended status badge instances should be created');
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
      '内容完全一致候选核验达到读取预算，未完成的候选已转为人工复核；不会自动跳过。',
      '内容完全一致候选已提前排除；读取 3 个文件后停止完整核验。',
      '用户已确认相似报告，任务复用已生成清单并重新进入队列。',
      '用户已确认内容完全一致提示，任务复用已生成清单并重新进入队列。',
      '发现 内容完全一致候选待人工核对，已延后等待确认',
      '已选择压缩入库，共 3 个任务。',
      '当前不在定时运行时段；已记录入库方式，队列将在计划开始时间自动运行。',
      '队列已进入定时等待。',
      '运行中的任务已安全取消。'
    ];
    for (const message of messages) {
      assert.ok(!CJK.test(i18n.translateStage(message)), `runtime log is not translated: ${message}`);
    }
  });

  test('exact dictionary keys are live source text or documented non-literal compatibility entries', () => {
    const sourceRoot = path.dirname(rendererDir);
    const collect = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? collect(target) : [target];
    });
    const corpus = collect(sourceRoot)
      .filter((filePath) => /\.(?:html|js)$/.test(filePath) && path.resolve(filePath) !== path.resolve(path.join(rendererDir, 'i18n.js')))
      .map((filePath) => fs.readFileSync(filePath, 'utf8')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&'));
    const documented = new Set(i18n.nonLiteralExactSources);
    const unused = Object.keys(i18n.exact)
      .filter((source) => !corpus.some((content) => content.includes(source)))
      .filter((source) => !documented.has(source));
    assert.deepEqual(unused, [], 'remove stale dictionary keys or document why runtime constructs them');
    const unusedStageFragments = i18n.stageFragments
      .map(([source]) => source)
      .filter((source) => !corpus.some((content) => content.includes(source)));
    assert.deepEqual(unusedStageFragments, [], 'remove stale queue-stage fragments');
    for (const source of documented) {
      assert.ok(i18n.exact[source], `documented non-literal source must exist: ${source}`);
    }
  });

  test('native file dialogs and startup errors select the active UI language', () => {
    const mainPath = path.join(path.dirname(rendererDir), 'main.js');
    if (!fs.existsSync(mainPath)) return;
    const main = fs.readFileSync(mainPath, 'utf8');
    assert.match(main, /title: english \? 'Choose a folder' : '选择文件夹'/);
    assert.match(main, /title: english \? 'Choose a video' : '选择视频'/);
    assert.match(main, /english \? 'Application failed to start' : '程序启动失败'/);
    assert.match(main, /nativeText\(error\.message, english\)/);
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
      '!', '⇄', '·', '⌄', '×', '＋', '--:--', '1',
      // The onboarding language picker keeps its bilingual labels fixed.
      '语言/Language', '中文'
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

  test('onboarding and discovery labels keep the intended compact copy', () => {
    const app = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
    assert.match(html, /id="random-walk"[^>]*>随机漫步<\/button>/);
    assert.doesNotMatch(html, /随机漫步\s*·\s*换一个/);
    assert.match(html, /aria-label="语言\/Language"[\s\S]*?<span>语言\/Language<\/span>/);
    assert.doesNotMatch(app, /🐹/, 'onboarding celebration must not include a hamster emoji');
  });
}
