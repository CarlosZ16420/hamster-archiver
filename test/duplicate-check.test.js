'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  documentTerms,
  findExactFileMatches,
  findSimilarEntryMatches,
  findSimilarProjects,
  findTaskNameMatches,
  fuzzyTextScore,
  normalizeName,
  setTermStatistics,
  similarityCandidateKeys,
  titleSimilarity
} = require('../src/core/duplicate-check');

test('name normalization supports simple suspected duplicate checks', () => {
  assert.equal(normalizeName('示例 目录_01.mp4'), normalizeName('示例-目录 01.MP4'));
  const matches = findTaskNameMatches({ displayName: '示例 目录_01.mp4' }, [{
    id: 'archive-1',
    displayName: '示例-目录 01.MP4',
    archiveBaseName: 'archive.7z'
  }]);
  assert.equal(matches.length, 1);
});

test('exact duplicate check uses file size and MD5 together', () => {
  const matches = findExactFileMatches([{
    relativePath: 'new/video.mp4', size: 99, md5: 'abc'
  }], [{
    id: 'archive-1',
    displayName: 'old',
    archiveBaseName: 'old.7z',
    manifest: [
      { relativePath: 'old/video.mp4', size: 99, md5: 'abc' },
      { relativePath: 'other.mp4', size: 100, md5: 'abc' }
    ]
  }]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].previous[0].relativePath, 'old/video.mp4');
});

test('local title similarity detects reordered Chinese meaning but ignores generic titles', () => {
  assert.ok(titleSimilarity('王佳乐北京旅行记录', '北京王佳乐旅行纪录') >= 0.45);
  assert.equal(titleSimilarity('新建文件夹', '新建文件夹'), 0);
  assert.equal(titleSimilarity('a.mp4', 'a.mp4'), 0);
  assert.equal(titleSimilarity('sample.mp4', 'sample.mp4'), 0);
  assert.equal(findTaskNameMatches({ displayName: '视频' }, [{ id: 'old', displayName: '视频' }]).length, 0);
});

test('latin substring tricks no longer inflate similarity', () => {
  // 曾经的误报机制：长词包含短词（softgirldiana ⊃ girl）按整词长度计分，
  // 再叠加 +0.35 底薪分，两个无关条目被打到 0.68。
  assert.equal(titleSimilarity('[OnlyFans] @softgirldiana', '18eighteen Blaire Ivory The Principals Bad Girl'), 0);
  // 同系列不同作品：共享少量常见词不应达到报告线。
  assert.ok(titleSimilarity(
    '[OnlyFans] Playful Innocence Audrey And Lily Slut Training.mp4',
    '[OnlyFans] Playful Innocence Fuck Dolls With Lilly.mp4'
  ) < 0.45);
});

test('shared genre vocabulary stays below report threshold once weighted by corpus', () => {
  const corpus = Array.from({ length: 12 }, (_, index) => ({
    title: `${index}月泄密流出反差少妇第${index}期完全不同内容${index}号`,
    manifest: []
  }));
  const frequencies = new Map();
  for (const record of corpus) {
    for (const token of documentTerms(record, [])) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
  }
  setTermStatistics(frequencies, corpus.length);
  try {
    // 题材词（泄密/流出）在语料里高频 → IDF 降权；两段不同内容不再判相似。
    assert.ok(titleSimilarity('精品泄密流出北京大学生自制', '白金泄密流出上海少妇直播') < 0.45);
    // 独特人名仍然可以跨语序识别。
    assert.ok(titleSimilarity('小惠在北京上大学', '北京小惠的大学生活') >= 0.45);
  } finally {
    setTermStatistics(new Map(), 0);
  }
});

test('fuzzy title matching supports separated terms and exact video-size evidence', () => {
  assert.ok(fuzzyTextScore('美女台湾', '美女旅行到台湾') >= 0.45);
  const subject = {
    id: 'new', title: '北京大学生自制剧集', sourceType: 'directory',
    manifest: [{ name: '片段A.mp4', extension: '.mp4', size: 1234 }]
  };
  const candidate = {
    id: 'old', title: '上海白领访谈实录', sourceType: 'directory',
    manifest: [{ name: '完全不同.mp4', extension: '.mp4', size: 1234 }]
  };
  // 宽松档保留旧行为：大小一致可以单独作为证据。
  const loose = findSimilarProjects(subject, [candidate], [], 'loose');
  assert.equal(loose.length, 1);
  assert.ok(loose[0].reasons.includes('视频大小完全一致'));
  // 标准档要求伴生证据，避免分卷固定块大小造成的误报。
  assert.deepEqual(findSimilarProjects(subject, [candidate]), []);
  // 标题互证时，大小重新成为有力佐证。
  const supported = findSimilarProjects({
    id: 'new2', title: '小惠北京巡演完整版', sourceType: 'directory',
    manifest: [{ name: '小惠北京巡演完整版.mp4', extension: '.mp4', size: 1234 }]
  }, [{
    id: 'old2', title: '小惠北京巡演完整版 二', sourceType: 'directory',
    manifest: [{ name: '小惠北京巡演完整版2.mp4', extension: '.mp4', size: 1234 }]
  }]);
  assert.equal(supported.length, 1);
  assert.ok(supported[0].reasons.includes('视频大小完全一致'));
});

test('similarity ignore terms remove common maker-name noise without changing exact evidence', () => {
  assert.ok(titleSimilarity('PRESTIGE 东京', 'PRESTIGE 大阪', [], 'loose') >= 0.45);
  assert.equal(titleSimilarity('PRESTIGE 东京', 'PRESTIGE 大阪', ['PRESTIGE'], 'loose'), 0);
  const matches = findSimilarProjects({
    id: 'new', title: 'FC2 PPV 东京', sourceType: 'video', totalBytes: 456
  }, [{
    id: 'old', title: 'FC2 PPV 大阪', sourceType: 'video', totalBytes: 456
  }], ['FC2', 'PPV'], 'loose');
  assert.equal(matches.length, 1);
  assert.ok(matches[0].reasons.includes('视频大小完全一致'));
});

test('similarity ignore terms are case-insensitive', () => {
  assert.equal(titleSimilarity('ONLY 东京旅行', 'only 大阪旅行', ['Only']), 0);
  assert.equal(
    similarityCandidateKeys({ title: 'ONLY-12345' }, ['only']).some((key) => key.startsWith('text:') || key.startsWith('word:')),
    false
  );
});

test('similar directory entries report exact paths and highlight ranges', () => {
  const subject = {
    directories: ['旅行/王佳乐北京学习'],
    manifest: [{ relativePath: '旅行/台湾旅行记录.mp4', name: '台湾旅行记录.mp4', extension: '.mp4', size: 20, md5: 'abc' }]
  };
  const candidate = {
    id: 'other', title: '另一项目', directories: ['整理/北京王佳乐学习生活'],
    manifest: [{ relativePath: '整理/台湾旅行记录-备份.mp4', name: '台湾旅行记录-备份.mp4', extension: '.mp4', size: 20, md5: 'abc' }]
  };
  const matches = findSimilarEntryMatches(subject, [candidate], []);
  assert.ok(matches.some((entry) => entry.kind === 'directory' && entry.relativePath === '旅行/王佳乐北京学习' && entry.ranges.length > 0));
  assert.ok(matches.some((entry) => entry.kind === 'file' && entry.relativePath === '旅行/台湾旅行记录.mp4' &&
    entry.matches.some((match) => match.reason === '文件内容完全一致')));
});

test('original root folder names expose highlight ranges for the one-click whitelist action', () => {
  const matches = findSimilarEntryMatches({
    sourceType: 'directory',
    displayName: '王佳乐北京旅行完整记录',
    directories: [],
    manifest: []
  }, [{
    id: 'other',
    title: '另一项目',
    sourceType: 'directory',
    displayName: '王佳乐北京旅行备份记录',
    directories: [],
    manifest: []
  }]);

  const root = matches.find((entry) => entry.kind === 'directory' && entry.relativePath === '');
  assert.ok(root?.ranges.length > 0);
  assert.ok(root.matches.some((match) => match.reason === '目录名相似' && match.relativePath === ''));
});

test('a short title or one shared boilerplate term cannot mark unrelated projects as duplicates', () => {
  assert.equal(titleSimilarity(
    '呻吟',
    '百度云泄密沈阳学院派美女与男朋友的视频流出叫床呻吟超大声1080P高清版'
  ), 0);
  assert.ok(titleSimilarity(
    '【采精小蝴蝶】ai高清+原版HD',
    '顶级聚会付费福利全集高清1080P原版首发'
  ) < 0.5);
  assert.deepEqual(findSimilarProjects({
    id: 'short', title: '小二先生创可贴', sourceType: 'directory', manifest: []
  }, [{
    id: 'long', title: '【糖心VLOG】小二先生的另一部完全不同作品', sourceType: 'directory', manifest: []
  }]), []);
});

test('single-character titles and directory names never become 100 percent similarity evidence', () => {
  assert.equal(titleSimilarity('P', 'p'), 0);
  assert.deepEqual(findSimilarProjects(
    { id: 'short-a', title: 'P', sourceType: 'manual', manifest: [] },
    [{ id: 'short-b', title: 'p', sourceType: 'manual', manifest: [] }]
  ), []);
  assert.deepEqual(findSimilarEntryMatches(
    { directories: ['P'], manifest: [] },
    [{ id: 'other', title: '另一项目', directories: ['p'], manifest: [] }]
  ), []);
});

test('similar entry paths are normalized for Windows directory trees', () => {
  const matches = findSimilarEntryMatches({
    directories: ['旅行\\王佳乐北京学习'],
    manifest: [{ relativePath: '旅行\\台湾旅行记录.mp4', name: '台湾旅行记录.mp4', extension: '.mp4', size: 20, md5: 'abc' }]
  }, [{
    id: 'other', title: '另一项目', directories: ['整理\\北京王佳乐学习生活'],
    manifest: [{ relativePath: '整理\\台湾旅行记录-备份.mp4', name: '台湾旅行记录-备份.mp4', extension: '.mp4', size: 20, md5: 'abc' }]
  }]);

  assert.ok(matches.some((entry) => entry.kind === 'directory' && entry.relativePath === '旅行/王佳乐北京学习'));
  assert.ok(matches.some((entry) => entry.kind === 'file' && entry.relativePath === '旅行/台湾旅行记录.mp4'));
  assert.ok(matches.every((entry) => !entry.relativePath.includes('\\')));
});

test('ignored FC2 identifiers and shared download domains never create title similarity', () => {
  const names = [
    'FC2-PPV-4768873',
    'FC2-PPV-3275005',
    'FC2-PPV-4694056',
    'FC2-PPV-4721502',
    'FC2-PPV-4723700'
  ];
  const records = names.map((title, index) => ({
    id: `fc2-${index}`,
    title,
    displayName: title,
    sourceType: 'directory',
    manifest: [{
      name: `hhd800.com@${title}${index % 2 === 0 ? '' : '_1'}.mp4`,
      extension: '.mp4',
      size: 1_000_000 + index
    }]
  }));

  for (let left = 0; left < records.length; left += 1) {
    assert.equal(
      similarityCandidateKeys(records[left], ['FC2', 'PPV'])
        .some((key) => key.startsWith('text:') || key.startsWith('word:')),
      false
    );
    for (let right = left + 1; right < records.length; right += 1) {
      assert.equal(titleSimilarity(names[left], names[right], ['FC2', 'PPV']), 0);
      assert.deepEqual(findSimilarProjects(records[left], [records[right]], ['FC2', 'PPV']), []);
    }
  }
});

test('candidate recall keys skip digit bigram pollution but keep selective number runs', () => {
  const keys = similarityCandidateKeys({
    title: '2024年10月新品合集',
    displayName: '',
    sourceType: 'directory',
    manifest: [{ name: '08月20日(5).mp4', extension: '.mp4', size: 42 }]
  });
  assert.ok(keys.includes('num:2024'));
  assert.ok(keys.includes('video-size:42'));
  assert.ok(keys.some((key) => key.startsWith('text:')));
  // 纯数字 bigram（text:20、text:10）曾把 1/7 的记录拉进候选集。
  assert.ok(keys.every((key) => !/^text:\d+$/.test(key)));
});

test('strength presets report progressively fewer, higher-quality matches', () => {
  const subject = { id: 'new', title: '王佳乐北京旅行记录', sourceType: 'manual', manifest: [] };
  const candidate = { id: 'old', title: '北京王佳乐旅行纪录', sourceType: 'manual', manifest: [] };
  // 同一变体标题：宽松/标准报告为相似，严格档要求更高的置信度。
  assert.equal(findSimilarProjects(subject, [candidate], [], 'loose').length, 1);
  assert.equal(findSimilarProjects(subject, [candidate], [], 'standard').length, 1);
  assert.equal(findSimilarProjects(subject, [candidate], [], 'strict').length, 0);
  // 完全相同与分卷变体在任何档位都应保留。
  const identical = findSimilarProjects(
    { id: 'new', title: '重磅稀缺国内洗浴偷拍第6期大眼剃毛白虎萌妹子 [1]', sourceType: 'manual', manifest: [] },
    [{ id: 'old', title: '重磅稀缺国内洗浴偷拍第6期大眼剃毛白虎萌妹子 [3]', sourceType: 'manual', manifest: [] }],
    [], 'strict'
  );
  assert.equal(identical.length, 1);
});

test('repeated scoring is deterministic and unaffected by the parts cache', async () => {
  const first = titleSimilarity('王佳乐在北京上学', '北京王佳乐的学习生活');
  const filler = Array.from({ length: 300 }, (_, index) => titleSimilarity(`填充标题编号${index}`, `另一标题${index}完全不同`));
  assert.ok(filler.length === 300);
  assert.equal(titleSimilarity('王佳乐在北京上学', '北京王佳乐的学习生活'), first);
});
