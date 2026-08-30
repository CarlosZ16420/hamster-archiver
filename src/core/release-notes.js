'use strict';

const MAX_RELEASE_NOTE_ITEMS = 12;
const MAX_RELEASE_NOTE_ITEM_LENGTH = 360;
const MAX_RELEASE_NOTES_PAYLOAD_LENGTH = 24_000;

function normalizeLanguage(language = 'zh-CN') {
  return language === 'en-US' ? 'en-US' : 'zh-CN';
}

function classifyLanguageHeading(value) {
  const heading = String(value || '').trim().toLowerCase();
  if (/^(?:简体中文|中文|zh(?:-cn)?|chinese)$/.test(heading)) return 'zh-CN';
  if (/^(?:english|en(?:-us)?)$/.test(heading)) return 'en-US';
  return '';
}

function selectLocalizedMarkdownSection(value, language) {
  const source = String(value || '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const sections = new Map();
  let activeLanguage = '';
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    const headingLanguage = classifyLanguageHeading(heading?.[1]);
    if (headingLanguage) {
      activeLanguage = headingLanguage;
      if (!sections.has(activeLanguage)) sections.set(activeLanguage, []);
      continue;
    }
    if (activeLanguage) sections.get(activeLanguage).push(line);
  }
  const requested = normalizeLanguage(language);
  if (sections.has(requested)) return sections.get(requested).join('\n');
  return source;
}

function cleanMarkdownText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]+/g, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RELEASE_NOTE_ITEM_LENGTH);
}

function notesFromMarkdown(value, language) {
  const source = selectLocalizedMarkdownSection(value, language);
  const notes = [];
  let insideCodeBlock = false;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }
    if (insideCodeBlock || !line || /^#{1,6}\s/.test(line) || /^-{3,}$/.test(line) || /^!\[/.test(line)) continue;
    const note = cleanMarkdownText(line);
    if (note && !notes.includes(note)) notes.push(note);
    if (notes.length >= MAX_RELEASE_NOTE_ITEMS) break;
  }
  return notes;
}

function normalizeNoteItems(value, language) {
  const source = Array.isArray(value) ? value : [value];
  const notes = [];
  for (const item of source) {
    const candidates = typeof item === 'string' && item.includes('\n')
      ? notesFromMarkdown(item, language)
      : [cleanMarkdownText(item)];
    for (const candidate of candidates) {
      if (candidate && !notes.includes(candidate)) notes.push(candidate);
      if (notes.length >= MAX_RELEASE_NOTE_ITEMS) return notes;
    }
  }
  return notes;
}

function selectLocalizedReleaseNotes(value, language = 'zh-CN') {
  const requested = normalizeLanguage(language);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const preferredKeys = requested === 'en-US'
      ? ['en-US', 'en', 'english', 'zh-CN', 'zh', 'chinese']
      : ['zh-CN', 'zh', 'chinese', 'en-US', 'en', 'english'];
    for (const key of preferredKeys) {
      if (value[key] !== undefined) {
        const notes = normalizeNoteItems(value[key], requested);
        if (notes.length > 0) return notes;
      }
    }
    return [];
  }
  return normalizeNoteItems(value, requested);
}

function compactReleaseNotesPayload(value) {
  if (typeof value === 'string') return value.trim().slice(0, MAX_RELEASE_NOTES_PAYLOAD_LENGTH) || null;
  if (Array.isArray(value)) {
    const notes = normalizeNoteItems(value, 'zh-CN');
    return notes.length > 0 ? notes : null;
  }
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const [locale, aliases] of Object.entries({
    'zh-CN': ['zh-CN', 'zh', 'chinese'],
    'en-US': ['en-US', 'en', 'english']
  })) {
    const key = aliases.find((candidate) => value[candidate] !== undefined);
    if (!key) continue;
    const notes = normalizeNoteItems(value[key], locale);
    if (notes.length > 0) result[locale] = notes;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function formatReleaseNotes(value, language = 'zh-CN') {
  const locale = normalizeLanguage(language);
  const notes = selectLocalizedReleaseNotes(value, locale);
  const heading = locale === 'en-US' ? "What's new:" : '本次更新内容：';
  if (notes.length === 0) {
    return `${heading}\n• ${locale === 'en-US'
      ? 'This update package does not include release notes.'
      : '此更新包未附带更新说明。'}`;
  }
  return `${heading}\n${notes.map((note) => `• ${note}`).join('\n')}`;
}

module.exports = {
  MAX_RELEASE_NOTE_ITEMS,
  cleanMarkdownText,
  compactReleaseNotesPayload,
  formatReleaseNotes,
  normalizeLanguage,
  selectLocalizedReleaseNotes
};
