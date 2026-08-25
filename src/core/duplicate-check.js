'use strict';

const path = require('node:path');

// ---------------------------------------------------------------------------
// 相似度强度档位：数值越小越宽松。切换档位只需要重算关系，不需要迁移数据。
// reportThreshold   最终报告门槛；substringRatio 短串被长串包含时要求的最小长度比；
// coverageCap       词覆盖率的封顶（避免“短标题完全被包含”拿到 1.0 满分）；
// diceWeight        字符 bigram Dice 的降权系数；idfPower 越大，常见题材词降权越狠；
// videoNameNeedsSupport / videoSizeNeedsSupport 要求视频证据有伴生证据才能独立定案。
// ---------------------------------------------------------------------------
const DEFAULT_SIMILARITY_STRENGTH = 'standard';

const STRENGTH_PRESETS = {
  loose: {
    label: '宽松',
    reportThreshold: 0.45,
    substringRatio: 0.5,
    coverageCap: 0.92,
    diceWeight: 0.85,
    idfPower: 0.7,
    videoNameMin: 0.45,
    videoNameWeight: 0.94,
    videoNameNeedsSupport: false,
    videoSizeScore: 0.96,
    videoSizeNeedsSupport: false,
    supportFloor: 0.3,
    topVideos: 20
  },
  standard: {
    label: '标准',
    reportThreshold: 0.5,
    substringRatio: 0.65,
    coverageCap: 0.9,
    diceWeight: 0.8,
    idfPower: 1,
    videoNameMin: 0.5,
    videoNameWeight: 0.85,
    videoNameNeedsSupport: true,
    videoSizeScore: 0.9,
    videoSizeNeedsSupport: true,
    supportFloor: 0.3,
    topVideos: 20
  },
  strict: {
    label: '严格',
    reportThreshold: 0.75,
    substringRatio: 0.85,
    coverageCap: 0.88,
    diceWeight: 0.75,
    idfPower: 1.3,
    videoNameMin: 0.6,
    videoNameWeight: 0.6,
    videoNameNeedsSupport: true,
    videoSizeScore: 0.85,
    videoSizeNeedsSupport: true,
    supportFloor: 0.5,
    topVideos: 12
  }
};

const SIMILARITY_STRENGTHS = Object.keys(STRENGTH_PRESETS);

function normalizeSimilarityStrength(value) {
  return STRENGTH_PRESETS[value] ? value : DEFAULT_SIMILARITY_STRENGTH;
}

// ---------------------------------------------------------------------------
// 词频统计（IDF）：由队列管理器在目录变化后注入。没有语料时所有词权重一致，
// 打分退化为无权重覆盖率，行为仍然可预测。
// ---------------------------------------------------------------------------
let termDocumentFrequencies = new Map();
let termCorpusSize = 0;

function setTermStatistics(frequencies, total) {
  termDocumentFrequencies = frequencies instanceof Map ? frequencies : new Map();
  termCorpusSize = Math.max(0, Number(total) || 0);
}

function termWeight(token, idfPower, statistics = null) {
  const frequencies = statistics?.frequencies instanceof Map
    ? statistics.frequencies
    : termDocumentFrequencies;
  const corpusSize = statistics
    ? Math.max(0, Number(statistics.total) || 0)
    : termCorpusSize;
  const rawFrequency = frequencies.get(token) || 0;
  // 词频超过语料一半后不再继续降权：小语料里“两边都有”不代表“平庸”，
  // 否则只有两条记录时所有共享词都会被打到最低权重。
  const frequency = Math.min(rawFrequency, Math.ceil(corpusSize / 2));
  const idf = Math.log((corpusSize + 1) / (frequency + 0.5));
  return Math.max(idf, 0.05) ** idfPower;
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------
function normalizeName(value) {
  const parsed = path.parse(value.normalize('NFKC').toLowerCase()).name;
  return parsed.replace(/[\s_.\-()[\]{}【】（）]+/g, '');
}

function normalizeEntryPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function findTaskNameMatches(task, catalog) {
  const target = normalizeName(task.displayName);
  if (!target || !isMeaningfulTitle(target)) return [];
  const matches = [];
  for (const record of catalog) {
    if ([record.displayName, record.title].filter(Boolean).some((name) => normalizeName(name) === target)) {
      matches.push({
        archiveId: record.id,
        displayName: record.displayName,
        archiveBaseName: record.archiveBaseName
      });
    }
  }
  return matches.slice(0, 20);
}

function findExactFileMatches(manifest, catalog) {
  const index = new Map();
  for (const record of catalog) {
    for (const file of record.manifest || []) {
      if (!file.md5) continue;
      const key = `${file.size}:${file.md5}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push({
        archiveId: record.id,
        archiveName: record.archiveBaseName,
        archivedTask: record.displayName,
        relativePath: file.relativePath
      });
    }
  }

  const matches = [];
  for (const file of manifest) {
    const previous = index.get(`${file.size}:${file.md5}`);
    if (!previous) continue;
    matches.push({
      sourceRelativePath: file.relativePath,
      md5: file.md5,
      size: file.size,
      previous: previous.slice(0, 5)
    });
    if (matches.length >= 100) break;
  }
  return matches;
}

const GENERIC_TITLES = new Set([
  '新建文件夹', '未命名文件夹', '视频', '照片', '图片', '相册', 'video', 'videos', 'image', 'images', 'photo', 'photos', 'img',
  'sample', 'making', 'menu', 'bonus', 'trailer', '预告', '花絮', '正片'
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mts', '.m2ts', '.ts'
]);

const DEFAULT_SIMILARITY_IGNORE_TERMS = [
  'FC2', 'PPV', 'S1', 'SOD', 'SOD CREATE', 'MOODYZ', 'PRESTIGE', 'IDEA POCKET',
  'IDEAPOCKET', 'MADONNA', 'ATTACKERS', 'FALENO', 'FALENO STAR', 'KAWAII',
  'E-BODY', 'WANZ', 'WANZ FACTORY', 'DAS', 'MIDE', 'MGS', 'CARIBBEANCOM',
  '1PONDO', 'HEYZO', 'PACOPACOMAMA', 'TOKYO HOT', 'HONNAKA', 'HMP', 'KMP',
  'MAX-A', 'ALICE JAPAN', 'CRYSTAL-EIZOU', 'GLORY QUEST', 'PREMIUM', 'OPPAI',
  'TAMEIKE GORO', 'KIRA KIRA', 'NANPA JAPAN', 'GIGA', 'ROCKET', 'NATURAL HIGH'
];

function parseSimilarityIgnoreTerms(value) {
  const lines = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  return [...new Set(lines
    .map((line) => String(line).replace(/\s+#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.normalize('NFKC').toLowerCase()))]
    .sort((left, right) => right.length - left.length);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 排除词只需在词表载入时编译一次，之后所有标题复用同一批 RegExp。
function buildIgnoreTermPattern(term) {
  const chunks = term.match(/[\p{Script=Han}a-z0-9]+/gu) || [];
  if (chunks.length === 0) return null;
  const body = chunks.map(escapeRegularExpression).join('[^\\p{Script=Han}a-z0-9]*');
  const leftBoundary = /^[a-z0-9]/i.test(chunks[0]) ? '(?<![a-z0-9])' : '';
  const rightBoundary = /[a-z0-9]$/i.test(chunks.at(-1)) ? '(?![a-z0-9])' : '';
  return new RegExp(`${leftBoundary}${body}${rightBoundary}`, 'giu');
}

function stripDomainNoise(value) {
  return String(value || '').replace(
    /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}(?=$|[^a-z0-9])/giu,
    ' '
  );
}

// ---------------------------------------------------------------------------
// 分词：优先用运行环境自带的 Intl.Segmenter（Electron/Node 自带 ICU，无新增依赖），
// 不可用时退化为汉字 bigram + 拉丁词。词是 IDF 加权的最小单位，单字虚词不参与。
// ---------------------------------------------------------------------------
const wordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'word' })
  : null;

const HAN_CHARACTER = /\p{Script=Han}/u;
const LATIN_WORD_RUN = /[a-z]{3,}/g;
const DIGIT_RUN = /\d{2,}/g;

function pushToken(tokens, seen, token) {
  if (!seen.has(token)) {
    seen.add(token);
    tokens.push(token);
  }
}

// 两位数字（日期、卷号碎片）是最低区分度的词元，只保留三位以上（编号、年份）。
function pushDigitToken(tokens, seen, digits) {
  if (digits.length >= 3) pushToken(tokens, seen, `#${digits}`);
}

function tokenizeBase(base) {
  const tokens = [];
  const seen = new Set();
  if (wordSegmenter) {
    for (const { segment, isWordLike } of wordSegmenter.segment(base)) {
      if (!isWordLike) continue;
      const value = segment.toLowerCase();
      if (/^\d+$/.test(value)) {
        pushDigitToken(tokens, seen, value);
        continue;
      }
      if (HAN_CHARACTER.test(value)) {
        if ([...value].length >= 2) pushToken(tokens, seen, value);
        continue;
      }
      if (/^[a-z]+$/.test(value)) {
        if (value.length >= 3) pushToken(tokens, seen, value);
        continue;
      }
      for (const match of value.matchAll(LATIN_WORD_RUN)) pushToken(tokens, seen, match[0]);
      for (const match of value.matchAll(DIGIT_RUN)) pushDigitToken(tokens, seen, match[0]);
    }
    return tokens;
  }
  for (const match of base.matchAll(LATIN_WORD_RUN)) pushToken(tokens, seen, match[0]);
  for (const match of base.matchAll(DIGIT_RUN)) pushDigitToken(tokens, seen, match[0]);
  const hanCharacters = [...base].filter((character) => HAN_CHARACTER.test(character));
  for (const pair of bigrams(hanCharacters)) pushToken(tokens, seen, pair);
  return tokens;
}

// ---------------------------------------------------------------------------
// 打分器：按排除词表缓存解析结果（含分词），同一标题在整个会话内只解析一次。
// ---------------------------------------------------------------------------
function bigrams(characters) {
  const result = new Set();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

function isMeaningfulParts(parts) {
  if (!parts.compact || GENERIC_TITLES.has(parts.compact)) return false;
  const hanCount = parts.han.length;
  const latinCount = parts.latinWords.join('').length;
  // 纯数字编号、分隔符和被排除的厂牌词没有语义，不能仅凭数字片段重合判相似。
  // 完全相同的名称仍由精确名称检查处理，大小和 MD5 检查也不受影响。
  return hanCount >= 2 || latinCount >= 6;
}

function createSimilarityScorer(ignoreTerms, statistics = null) {
  const termPatterns = parseSimilarityIgnoreTerms(ignoreTerms)
    .map(buildIgnoreTermPattern)
    .filter(Boolean);
  const partsCache = new Map();

  function parts(value) {
    const key = String(value ?? '');
    let cached = partsCache.get(key);
    if (cached) return cached;
    cached = computeParts(key);
    if (partsCache.size >= 5000) partsCache.clear();
    partsCache.set(key, cached);
    return cached;
  }

  function computeParts(value) {
    const rawBase = path.parse(String(value || '').normalize('NFKC').toLowerCase()).name;
    let base = stripDomainNoise(rawBase);
    for (const pattern of termPatterns) base = base.replace(pattern, ' ');
    const compact = base.replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
    const han = [...compact].filter((character) => HAN_CHARACTER.test(character));
    const latinWords = base.match(LATIN_WORD_RUN) || [];
    const tokens = compact ? tokenizeBase(base) : [];
    return { base, compact, han, latinWords, tokens };
  }

  function isMeaningful(value) {
    return isMeaningfulParts(parts(value));
  }

  function titleSimilarity(left, right, preset = STRENGTH_PRESETS[DEFAULT_SIMILARITY_STRENGTH]) {
    const a = parts(left);
    const b = parts(right);
    if (!isMeaningfulParts(a) || !isMeaningfulParts(b)) return 0;
    if (a.compact === b.compact) return 1;

    const shorter = a.compact.length <= b.compact.length ? a.compact : b.compact;
    const longer = shorter === a.compact ? b.compact : a.compact;
    if (shorter.length >= 4 && longer.includes(shorter) &&
        shorter.length / longer.length >= preset.substringRatio) return 0.9;

    let score = 0;
    const bWeights = new Map();
    let sumB = 0;
    for (const token of b.tokens) {
      const weight = termWeight(token, preset.idfPower, statistics);
      bWeights.set(token, weight);
      sumB += weight;
    }
    let sumA = 0;
    let sharedWeight = 0;
    let sharedTokenCount = 0;
    for (const token of a.tokens) {
      const weight = termWeight(token, preset.idfPower, statistics);
      sumA += weight;
      const other = bWeights.get(token);
      if (other !== undefined) {
        sharedWeight += weight < other ? weight : other;
        sharedTokenCount += 1;
      }
    }
    if (sharedWeight > 0) {
      // 使用双向加权覆盖率，避免“短标题/格式词的全部词元都出现在长标题里”时，
      // 仅按较短一侧作分母而得到虚高分。长度接近的分卷变体仍会接近 1，
      // 只有一个泛词相同或一长一短的不同作品则会自然降到报告线以下。
      score = Math.min(preset.coverageCap, (2 * sharedWeight) / Math.max(1e-9, sumA + sumB));
    }

    // 汉字 bigram 兜底：分词不一致或语序重排时仍然能识别同一批用字。
    if (score < preset.coverageCap && a.han.length >= 4 && b.han.length >= 4) {
      const aSet = new Set(a.han);
      const bSet = new Set(b.han);
      const commonCharacters = [...aSet].filter((character) => bSet.has(character)).length;
      const aBigrams = bigrams(a.han);
      const bBigrams = bigrams(b.han);
      const commonBigrams = [...aBigrams].filter((item) => bBigrams.has(item)).length;
      if (commonCharacters >= 3 && commonBigrams >= 2) {
        const dice = (2 * commonBigrams) / Math.max(1, aBigrams.size + bBigrams.size);
        score = Math.max(score, Math.min(preset.coverageCap, dice * preset.diceWeight));
      }
    }
    // 标准与严格档不让一个孤立共享词独立定案；宽松档仍保留召回能力。
    if (sharedTokenCount === 1 && preset.videoNameNeedsSupport) {
      return 0;
    }
    return score;
  }

  return { parts, isMeaningful, titleSimilarity };
}

const scorerCache = new Map();

function scorerToken(ignoreTerms) {
  if (Array.isArray(ignoreTerms)) return `a${ignoreTerms.join('\u0001')}`;
  if (typeof ignoreTerms === 'string') return `s${ignoreTerms}`;
  return 's';
}

function scorerFor(ignoreTerms) {
  const token = scorerToken(ignoreTerms);
  let scorer = scorerCache.get(token);
  if (!scorer) {
    if (scorerCache.size >= 8) scorerCache.clear();
    scorer = createSimilarityScorer(ignoreTerms);
    scorerCache.set(token, scorer);
  }
  return scorer;
}

function videoEntries(subject) {
  if (subject.sourceType === 'video' && !(subject.manifest || []).length) {
    return [{ name: subject.displayName || subject.title || '', size: Number(subject.totalBytes || subject.originalBytes) || 0 }];
  }
  return (subject.manifest || [])
    .filter((file) => VIDEO_EXTENSIONS.has(String(file.extension || path.extname(file.name || file.relativePath || '')).toLowerCase()))
    .map((file) => ({ name: file.name || path.basename(file.relativePath || ''), size: Number(file.size) || 0 }));
}

function topVideosBySize(videos, limit) {
  if (videos.length <= limit) return videos;
  return [...videos].sort((left, right) => (right.size || 0) - (left.size || 0)).slice(0, limit);
}

function addTextCandidateKeys(keys, value, scorer) {
  const parts = scorer.parts(value);
  if (!isMeaningfulParts(parts)) return;
  // 只用汉字 bigram、拉丁词和长数字串做召回键：短数字 bigram（如“20”“10”）
  // 在日期和编号里到处出现，既拖慢检索又把真正相关的候选挤出限量。
  for (const pair of bigrams(parts.han)) keys.add(`text:${pair}`);
  for (const word of parts.latinWords) keys.add(`word:${word}`);
  for (const token of parts.tokens) {
    const digits = token.match(/^#(\d{3,})$/);
    if (digits) keys.add(`num:${digits[1]}`);
  }
}

function similarityCandidateKeys(subject, ignoreTerms = []) {
  const scorer = scorerFor(ignoreTerms);
  const keys = new Set();
  addTextCandidateKeys(keys, subject.title || subject.displayName || '', scorer);
  for (const video of videoEntries(subject)) {
    addTextCandidateKeys(keys, video.name, scorer);
    if (video.size > 0) keys.add(`video-size:${video.size}`);
  }
  return [...keys];
}

function videoNameTokens(scorer, videos) {
  const tokens = new Set();
  for (const video of videos) {
    for (const token of scorer.parts(video.name).tokens) tokens.add(token);
  }
  return tokens;
}

function sharesAnyToken(left, right) {
  if (left.size === 0 || right.size === 0) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function findSimilarProjects(subject, candidates, ignoreTerms = [], strength = DEFAULT_SIMILARITY_STRENGTH, scorerOverride = null) {
  const scorer = scorerOverride || scorerFor(ignoreTerms);
  const preset = STRENGTH_PRESETS[strength] || STRENGTH_PRESETS[DEFAULT_SIMILARITY_STRENGTH];
  const subjectTitle = subject.title || subject.displayName || '';
  const subjectVideos = topVideosBySize(videoEntries(subject), preset.topVideos);
  const subjectVideoTokens = videoNameTokens(scorer, subjectVideos);
  const subjectSizes = new Set(subjectVideos.filter((video) => video.size > 0).map((video) => video.size));
  const matches = [];
  for (const candidate of candidates || []) {
    const candidateId = candidate.id || candidate.jobId;
    if (!candidateId || candidateId === subject.id || candidateId === subject.jobId) continue;
    const candidateTitle = candidate.title || candidate.displayName || '';
    let score = scorer.titleSimilarity(subjectTitle, candidateTitle, preset);
    const reasons = [];
    if (score > 0) reasons.push(score === 1 ? '标题一致' : '标题相似');

    // 视频证据：只比对按大小取样的头部视频，且先用名字词元做预筛，
    // 没有任何共同词元时跳过 O(n×m) 的逐对打分（大小比对仍然保留）。
    const candidateVideos = topVideosBySize(videoEntries(candidate), preset.topVideos);
    let bestVideoScore = 0;
    let matchedSubjectVideos = 0;
    let sizeMatched = false;
    if (subjectVideos.length > 0 && candidateVideos.length > 0) {
      for (const video of candidateVideos) {
        if (video.size > 0 && subjectSizes.has(video.size)) {
          sizeMatched = true;
          break;
        }
      }
      const sharesNameTokens = sharesAnyToken(subjectVideoTokens, videoNameTokens(scorer, candidateVideos));
      if (sharesNameTokens) {
        for (const subjectVideo of subjectVideos) {
          let videoMatched = false;
          for (const candidateVideo of candidateVideos) {
            const videoScore = scorer.titleSimilarity(subjectVideo.name, candidateVideo.name, preset);
            if (videoScore > bestVideoScore) bestVideoScore = videoScore;
            if (!videoMatched && videoScore >= preset.videoNameMin) videoMatched = true;
          }
          if (videoMatched) matchedSubjectVideos += 1;
        }
      }
    }

    // 伴生证据：标准/严格档要求视频证据不能单独立案，避免“同名附加视频”
    // （例如 sample）或分卷固定大小造成的误报。
    const supported = score >= preset.supportFloor || matchedSubjectVideos >= 2;
    if (bestVideoScore >= preset.videoNameMin && (!preset.videoNameNeedsSupport || supported)) {
      score = Math.max(score, bestVideoScore * preset.videoNameWeight);
      reasons.push('包含标题相似的视频');
    }
    if (sizeMatched && (!preset.videoSizeNeedsSupport || supported)) {
      score = Math.max(score, preset.videoSizeScore);
      reasons.push('视频大小完全一致');
    }
    if (score < preset.reportThreshold || reasons.length === 0) continue;
    matches.push({
      id: candidateId,
      title: candidateTitle,
      score: Number(score.toFixed(3)),
      reasons: [...new Set(reasons)]
    });
  }
  return matches.sort((left, right) => right.score - left.score).slice(0, 20);
}

// 供 IDF 统计使用：一个条目（标题 + 头部视频名）包含的去重词元。
function documentTerms(subject, ignoreTerms = []) {
  const scorer = scorerFor(ignoreTerms);
  const tokens = new Set();
  for (const token of scorer.parts(subject.title || subject.displayName || '').tokens) tokens.add(token);
  for (const video of topVideosBySize(videoEntries(subject), 20)) {
    for (const token of scorer.parts(video.name).tokens) tokens.add(token);
  }
  return [...tokens];
}

function titleSimilarity(left, right, ignoreTerms = [], strength = DEFAULT_SIMILARITY_STRENGTH) {
  return scorerFor(ignoreTerms).titleSimilarity(left, right, STRENGTH_PRESETS[strength]);
}

function isMeaningfulTitle(value, ignoreTerms = []) {
  return scorerFor(ignoreTerms).isMeaningful(value);
}

function textMatchRanges(value, candidateValue, ignoreTerms = []) {
  const source = String(value || '');
  const candidate = String(candidateValue || '');
  const scorer = scorerFor(ignoreTerms);
  // 单字母、单汉字、纯编号等低信息名称不能把整行标红。它们即使完全相同，
  // 也不足以单独证明两个目录或文件相似。
  if (!scorer.isMeaningful(source) || !scorer.isMeaningful(candidate)) return [];
  if (titleSimilarity(source, candidate, ignoreTerms) < 0.45) return [];

  const ignored = parseSimilarityIgnoreTerms(ignoreTerms);
  const isIgnored = (token) => ignored.some((term) => {
    const compactTerm = term.replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
    const compactToken = token.toLocaleLowerCase().replace(/[^\p{Script=Han}a-z0-9]+/gu, '');
    return compactTerm && (compactToken === compactTerm || compactToken.includes(compactTerm));
  });
  const candidateParts = scorer.parts(candidate);
  const candidateHan = new Set(candidateParts.han);
  const candidateWords = candidateParts.latinWords;
  const ranges = [];

  for (const match of source.matchAll(/[\p{Script=Han}]+|[a-z]{3,}/giu)) {
    const token = match[0];
    if (isIgnored(token)) continue;
    if (/^\p{Script=Han}+$/u.test(token)) {
      for (let offset = 0; offset < token.length; offset += 1) {
        if (candidateHan.has(token[offset].normalize('NFKC').toLocaleLowerCase())) {
          ranges.push([match.index + offset, match.index + offset + 1]);
        }
      }
    } else {
      const lower = token.normalize('NFKC').toLocaleLowerCase();
      if (candidateWords.some((word) => word === lower ||
          (word.length >= 5 && (word.includes(lower) || lower.includes(word))))) {
        ranges.push([match.index, match.index + token.length]);
      }
    }
  }

  if (ranges.length === 0) return [[0, source.length]];
  const merged = [];
  for (const range of ranges.sort((left, right) => left[0] - right[0])) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function entryName(relativePath) {
  const parts = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || '';
}

function findSimilarEntryMatches(subject, candidates, ignoreTerms = []) {
  const matches = new Map();
  const subjectDirectories = (subject.directories || []).map((relativePath) => ({
    kind: 'directory', relativePath: normalizeEntryPath(relativePath), name: entryName(relativePath)
  }));
  const subjectFiles = (subject.manifest || []).map((file) => ({
    kind: 'file', relativePath: normalizeEntryPath(file.relativePath), name: file.name || entryName(file.relativePath), file
  }));

  const textIndex = new Map();
  const exactFileIndex = new Map();
  const videoSizeIndex = new Map();
  const addIndex = (index, key, entry) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(entry);
  };
  for (const candidate of candidates || []) {
    const common = { recordId: candidate.id, title: candidate.title || candidate.displayName || '' };
    for (const relativePath of candidate.directories || []) {
      const entry = { ...common, kind: 'directory', relativePath: normalizeEntryPath(relativePath), name: entryName(relativePath) };
      for (const key of similarityCandidateKeys({ title: entry.name }, ignoreTerms)) addIndex(textIndex, `directory:${key}`, entry);
    }
    for (const file of candidate.manifest || []) {
      const entry = { ...common, kind: 'file', relativePath: normalizeEntryPath(file.relativePath), name: file.name || entryName(file.relativePath), file };
      for (const key of similarityCandidateKeys({ title: entry.name }, ignoreTerms)) addIndex(textIndex, `file:${key}`, entry);
      if (file.md5 && Number(file.size) >= 0) addIndex(exactFileIndex, `${Number(file.size)}:${String(file.md5).toLocaleLowerCase()}`, entry);
      if (VIDEO_EXTENSIONS.has(String(file.extension || path.extname(entry.name)).toLocaleLowerCase()) && Number(file.size) > 0) {
        addIndex(videoSizeIndex, String(Number(file.size)), entry);
      }
    }
  }

  for (const sourceDirectory of subjectDirectories) {
    const targets = new Set(similarityCandidateKeys({ title: sourceDirectory.name }, ignoreTerms)
      .flatMap((key) => textIndex.get(`directory:${key}`) || []));
    for (const targetDirectory of targets) {
      const ranges = textMatchRanges(sourceDirectory.name, targetDirectory.name, ignoreTerms);
      if (ranges.length === 0) continue;
      const key = `directory:${sourceDirectory.relativePath}`;
      const current = matches.get(key) || { kind: 'directory', relativePath: sourceDirectory.relativePath, ranges: [], matches: [] };
      current.ranges.push(...ranges);
      current.matches.push({ recordId: targetDirectory.recordId, title: targetDirectory.title, relativePath: targetDirectory.relativePath, reason: '目录名相似' });
      matches.set(key, current);
    }
  }

  for (const sourceFile of subjectFiles) {
    const targets = new Set(similarityCandidateKeys({ title: sourceFile.name }, ignoreTerms)
      .flatMap((key) => textIndex.get(`file:${key}`) || []));
    if (sourceFile.file.md5) {
      for (const target of exactFileIndex.get(`${Number(sourceFile.file.size)}:${String(sourceFile.file.md5).toLocaleLowerCase()}`) || []) targets.add(target);
    }
    if (VIDEO_EXTENSIONS.has(String(sourceFile.file.extension || path.extname(sourceFile.name)).toLocaleLowerCase()) && Number(sourceFile.file.size) > 0) {
      for (const target of videoSizeIndex.get(String(Number(sourceFile.file.size))) || []) targets.add(target);
    }
    for (const targetFile of targets) {
        const exactContent = sourceFile.file.md5 && targetFile.file.md5 &&
          String(sourceFile.file.md5).toLocaleLowerCase() === String(targetFile.file.md5).toLocaleLowerCase() &&
          Number(sourceFile.file.size) === Number(targetFile.file.size);
        const sameVideoSize = VIDEO_EXTENSIONS.has(String(sourceFile.file.extension || path.extname(sourceFile.name)).toLocaleLowerCase()) &&
          VIDEO_EXTENSIONS.has(String(targetFile.file.extension || path.extname(targetFile.name)).toLocaleLowerCase()) &&
          Number(sourceFile.file.size) > 0 && Number(sourceFile.file.size) === Number(targetFile.file.size);
        const ranges = exactContent || sameVideoSize
          ? [[0, sourceFile.name.length]]
          : textMatchRanges(sourceFile.name, targetFile.name, ignoreTerms);
        if (ranges.length === 0) continue;
        const key = `file:${sourceFile.relativePath}`;
        const current = matches.get(key) || { kind: 'file', relativePath: sourceFile.relativePath, ranges: [], matches: [] };
        current.ranges.push(...ranges);
        current.matches.push({
          recordId: targetFile.recordId,
          title: targetFile.title,
          relativePath: targetFile.relativePath,
          reason: exactContent ? '文件内容完全一致' : sameVideoSize ? '视频大小完全一致' : '文件名相似'
        });
        matches.set(key, current);
    }
  }

  return [...matches.values()].map((entry) => {
    const merged = [];
    for (const range of entry.ranges.sort((left, right) => left[0] - right[0])) {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
    }
    return {
      ...entry,
      ranges: merged,
      matches: entry.matches.filter((match, index, items) => items.findIndex((candidate) =>
        candidate.recordId === match.recordId && candidate.relativePath === match.relativePath && candidate.reason === match.reason
      ) === index).slice(0, 20)
    };
  });
}

function fuzzyTextScore(query, text) {
  const needle = scorerFor([]).parts(query).compact;
  const haystack = scorerFor([]).parts(text).compact;
  if (!needle) return 1;
  if (!haystack) return 0;
  if (haystack === needle) return 1;
  if (haystack.startsWith(needle)) return 0.95;
  if (haystack.includes(needle)) return 0.9;
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return Math.max(0.55, 0.82 - ((haystack.length - needle.length) / Math.max(20, haystack.length)));
  }
  const needleBigrams = bigrams([...needle]);
  const haystackBigrams = bigrams([...haystack]);
  const common = [...needleBigrams].filter((item) => haystackBigrams.has(item)).length;
  const dice = (2 * common) / Math.max(1, needleBigrams.size + haystackBigrams.size);
  return dice >= 0.35 ? dice * 0.8 : 0;
}

module.exports = {
  DEFAULT_SIMILARITY_IGNORE_TERMS,
  DEFAULT_SIMILARITY_STRENGTH,
  SIMILARITY_STRENGTHS,
  STRENGTH_PRESETS,
  createSimilarityScorer,
  documentTerms,
  findExactFileMatches,
  findSimilarEntryMatches,
  findSimilarProjects,
  findTaskNameMatches,
  fuzzyTextScore,
  isMeaningfulTitle,
  normalizeName,
  normalizeSimilarityStrength,
  parseSimilarityIgnoreTerms,
  setTermStatistics,
  similarityCandidateKeys,
  titleSimilarity
};
