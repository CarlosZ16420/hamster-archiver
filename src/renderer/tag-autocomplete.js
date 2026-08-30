'use strict';

function normalizeTag(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function splitActiveTag(value) {
  const source = String(value || '');
  const separatorIndex = Math.max(source.lastIndexOf(','), source.lastIndexOf('，'));
  const prefix = separatorIndex >= 0 ? source.slice(0, separatorIndex + 1) : '';
  const raw = source.slice(separatorIndex + 1);
  return {
    prefix,
    leadingWhitespace: raw.match(/^\s*/)?.[0] || '',
    query: raw.trim(),
    completedTags: prefix.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean)
  };
}

function findTagSuggestions(value, availableTags, limit = 8) {
  const active = splitActiveTag(value);
  const query = normalizeTag(active.query);
  if (!query) return [];
  const completed = new Set(active.completedTags.map(normalizeTag));
  const unique = new Map();
  for (const rawTag of availableTags || []) {
    const tag = String(rawTag || '').trim();
    const normalized = normalizeTag(tag);
    if (!normalized || completed.has(normalized) || normalized === query || unique.has(normalized)) continue;
    if (!normalized.includes(query)) continue;
    unique.set(normalized, tag);
  }
  return [...unique.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftStarts = leftKey.startsWith(query) ? 0 : 1;
      const rightStarts = rightKey.startsWith(query) ? 0 : 1;
      return leftStarts - rightStarts || left.localeCompare(right, 'zh-CN');
    })
    .slice(0, limit)
    .map(([, tag]) => tag);
}

function completeTagValue(value, suggestion) {
  const active = splitActiveTag(value);
  return `${active.prefix}${active.leadingWhitespace}${String(suggestion || '').trim()}`;
}

function bindTagAutocomplete(input, options = {}) {
  if (!input || input.dataset.tagAutocompleteBound === 'true') return null;
  input.dataset.tagAutocompleteBound = 'true';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const field = input.closest('.editor-field') || input.parentElement;
  field?.classList.add('tag-autocomplete-field');
  const menu = document.createElement('div');
  menu.className = 'tag-autocomplete-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', options.label || '标签自动补全');
  menu.hidden = true;
  field?.append(menu);
  let suggestions = [];
  let activeIndex = 0;
  let blurTimer = null;

  const close = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    suggestions = [];
    activeIndex = 0;
    menu.hidden = true;
    menu.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const accept = (index = activeIndex) => {
    const suggestion = suggestions[index];
    if (!suggestion) return false;
    input.value = completeTagValue(input.value, suggestion);
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    return true;
  };
  const render = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (input.selectionStart !== input.value.length || input.selectionEnd !== input.value.length) {
      close();
      return;
    }
    suggestions = findTagSuggestions(input.value, options.getTags?.() || []);
    if (suggestions.length === 0) {
      close();
      return;
    }
    activeIndex = Math.min(activeIndex, suggestions.length - 1);
    menu.replaceChildren();
    suggestions.forEach((tag, index) => {
      const button = document.createElement('div');
      button.id = `${input.id || 'tag-input'}-suggestion-${index}`;
      button.className = `tag-autocomplete-option${index === activeIndex ? ' active' : ''}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
      button.title = options.acceptHint || '按 Tab 补全';
      const label = document.createElement('span');
      label.dataset.i18nUserText = 'true';
      label.textContent = tag;
      button.append(label);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        accept(index);
      });
      menu.append(button);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', menu.children[activeIndex].id);
  };

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('compositionend', render);
  input.addEventListener('blur', () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(close, 120);
  });
  input.addEventListener('keydown', (event) => {
    if (menu.hidden || suggestions.length === 0) return;
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      accept();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      render();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  return { close, render };
}

const api = { bindTagAutocomplete, completeTagValue, findTagSuggestions, normalizeTag, splitActiveTag };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.hamsterTagAutocomplete = api;
