'use strict';

(function exposeCatalogColumns(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hamsterCatalogColumns = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const columns = [
    { key: 'title', label: '名称', min: 140 },
    { key: 'type', label: '类型', min: 40 },
    { key: 'number', label: '文件', min: 32 },
    { key: 'status', label: '大小 / 状态', min: 72 },
    { key: 'tags', label: '标签', min: 60 },
    { key: 'backup', label: '备份位置', min: 80 },
    { key: 'date', label: '入库时间', min: 96 },
    { key: 'rating', label: '星级', min: 60 }
  ];
  const defaultWidths = { title: 293, type: 40, number: 37, status: 72, tags: 214, backup: 168, date: 97, rating: 64 };
  const storageKey = 'hamster-catalog-column-ratios-v2';
  const legacyKey = 'hamster-catalog-column-widths-v1';

  function normalizeRatios(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    for (const { key } of columns) {
      if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] > 0) {
        result[key] = Math.min(10000, value[key]);
      }
    }
    return result;
  }

  function visibleColumns(viewportWidth) {
    if (viewportWidth <= 680) return columns.filter(({ key }) => ['title', 'status', 'tags'].includes(key));
    if (viewportWidth <= 1080) return columns.filter(({ key }) => !['type', 'number', 'rating'].includes(key));
    return columns;
  }

  function fitWidths(visible, ratios, availableWidth) {
    const minimumTotal = visible.reduce((sum, column) => sum + column.min, 0);
    const gutter = Math.min(20, Math.max(0, (availableWidth - 48 - minimumTotal) / visible.length));
    const budget = Math.max(0, availableWidth - 48 - gutter * visible.length);
    const last = visible.at(-1);
    const editable = visible.slice(0, -1);
    const minimumOthers = minimumTotal - last.min;
    if (budget < minimumTotal) {
      const scale = budget / minimumTotal;
      return { widths: Object.fromEntries(visible.map(column => [column.key, column.min * scale])), gutter };
    }
    // The final visible track has a fixed display width and never absorbs spare space.
    const widths = { [last.key]: Math.min(defaultWidths[last.key], budget - minimumOthers) };
    let remaining = budget - widths[last.key];
    let pending = editable;
    while (pending.length > 0) {
      const weight = column => ratios[column.key] ?? defaultWidths[column.key];
      const total = pending.reduce((sum, column) => sum + weight(column), 0);
      const pinned = pending.filter(column => remaining * weight(column) / total < column.min);
      if (pinned.length === 0) {
        for (const column of pending) widths[column.key] = remaining * weight(column) / total;
        break;
      }
      for (const column of pinned) {
        widths[column.key] = column.min;
        remaining -= column.min;
      }
      pending = pending.filter(column => !pinned.includes(column));
    }
    return { widths, gutter };
  }

  function resizeWidths(visible, initial, key, delta) {
    const result = { ...initial };
    const index = visible.findIndex(column => column.key === key);
    if (index < 0 || index >= visible.length - 2) return result;
    const column = visible[index];
    const donors = visible.slice(index + 1, -1);
    const minimum = item => Math.min(item.min, initial[item.key]);
    const spare = donors.reduce((sum, item) => sum + initial[item.key] - minimum(item), 0);
    const change = Math.max(minimum(column) - initial[key], Math.min(spare, Math.round(delta)));
    result[key] += change;
    if (change <= 0) result[donors[0].key] -= change;
    else {
      let remaining = change;
      for (const donor of donors) {
        const amount = Math.min(remaining, initial[donor.key] - minimum(donor));
        result[donor.key] -= amount;
        remaining -= amount;
      }
    }
    return result;
  }

  function bind({ layout, list, translateDom, onStart }) {
    const win = list.ownerDocument.defaultView;
    let ratios = {};
    try {
      const saved = win.localStorage.getItem(storageKey);
      ratios = normalizeRatios(JSON.parse(saved === null ? win.localStorage.getItem(legacyKey) : saved));
    } catch {}
    let liveWidths = null;
    let cancel = null;

    function apply() {
      if (list.clientWidth === 0) return;
      const visible = visibleColumns(win.innerWidth);
      const fitted = fitWidths(visible, ratios, list.clientWidth);
      const widths = liveWidths ?? fitted.widths;
      layout.style.setProperty('--catalog-text-columns', visible.map(column => `${widths[column.key]}px`).join(' '));
      layout.style.setProperty('--catalog-text-gap', `${fitted.gutter}px`);
    }

    function measure() {
      return Object.fromEntries(visibleColumns(win.innerWidth).map(({ key }) => [
        key, list.querySelector(`[data-catalog-column="${key}"]`).getBoundingClientRect().width
      ]));
    }

    function refresh() {
      apply();
      const visible = visibleColumns(win.innerWidth);
      for (const cell of list.querySelectorAll('[data-catalog-column]')) {
        const handle = cell.querySelector('.catalog-column-resize');
        const index = visible.findIndex(column => column.key === cell.dataset.catalogColumn);
        const column = columns.find(item => item.key === cell.dataset.catalogColumn);
        handle.hidden = index < 0 || index === visible.length - 1;
        handle.disabled = index >= visible.length - 2;
        const width = cell.getBoundingClientRect().width;
        const spare = visible.slice(index + 1, -1).reduce((sum, item) => {
          const actual = list.querySelector(`[data-catalog-column="${item.key}"]`).getBoundingClientRect().width;
          return sum + Math.max(0, actual - item.min);
        }, 0);
        handle.setAttribute('aria-valuenow', String(Math.round(width)));
        handle.setAttribute('aria-valuemin', String(Math.round(Math.min(column.min, width))));
        handle.setAttribute('aria-valuemax', String(Math.round(width + (handle.disabled ? 0 : spare))));
      }
    }

    function save() {
      try { win.localStorage.setItem(storageKey, JSON.stringify(ratios)); } catch {}
    }

    list.addEventListener('pointerdown', event => {
      const handle = event.target.closest('.catalog-column-resize');
      if (!handle || handle.hidden || handle.disabled || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      cancel?.();
      onStart?.();
      const visible = visibleColumns(win.innerWidth);
      const key = handle.closest('[data-catalog-column]').dataset.catalogColumn;
      const initial = measure();
      const initialX = event.clientX;
      liveWidths = initial;
      refresh();
      layout.classList.add('catalog-columns-resizing');
      handle.setPointerCapture(event.pointerId);
      let changed = false;
      const move = next => {
        if (next.pointerId !== event.pointerId) return;
        next.preventDefault();
        liveWidths = resizeWidths(visible, initial, key, next.clientX - initialX);
        changed = liveWidths[key] !== initial[key];
        refresh();
      };
      const finish = commit => {
        win.removeEventListener('pointermove', move);
        win.removeEventListener('pointerup', up);
        win.removeEventListener('pointercancel', abort);
        win.removeEventListener('blur', abort);
        win.removeEventListener('keydown', escape, true);
        handle.removeEventListener('lostpointercapture', abort);
        cancel = null;
        if (commit && changed) ratios = { ...ratios, ...liveWidths };
        liveWidths = null;
        layout.classList.remove('catalog-columns-resizing');
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        refresh();
        if (commit && changed) save();
      };
      const up = next => { if (next.pointerId === event.pointerId) finish(true); };
      const abort = next => { if (next.pointerId === undefined || next.pointerId === event.pointerId) finish(false); };
      const escape = next => {
        if (next.key !== 'Escape') return;
        next.preventDefault();
        next.stopImmediatePropagation();
        finish(false);
      };
      cancel = () => finish(false);
      win.addEventListener('pointermove', move, { passive: false });
      win.addEventListener('pointerup', up);
      win.addEventListener('pointercancel', abort);
      win.addEventListener('blur', abort);
      win.addEventListener('keydown', escape, true);
      handle.addEventListener('lostpointercapture', abort);
    });

    function reset() {
      cancel?.();
      ratios = {};
      refresh();
      save();
    }
    list.addEventListener('dblclick', event => {
      const handle = event.target.closest('.catalog-column-resize');
      if (!handle || handle.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
    });
    list.addEventListener('keydown', event => {
      const handle = event.target.closest('.catalog-column-resize');
      if (!handle || handle.disabled || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') return reset();
      cancel?.();
      onStart?.();
      const key = handle.closest('[data-catalog-column]').dataset.catalogColumn;
      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 8);
      ratios = { ...ratios, ...resizeWidths(visibleColumns(win.innerWidth), measure(), key, delta) };
      refresh();
      save();
    });
    win.addEventListener('resize', () => { cancel?.(); refresh(); });
    if (win.ResizeObserver) {
      let observedWidth = list.clientWidth;
      new win.ResizeObserver(() => {
        if (observedWidth === list.clientWidth) return;
        observedWidth = list.clientWidth;
        cancel?.();
        refresh();
      }).observe(list);
    }
    apply();
    return {
      cancel: () => cancel?.(),
      refresh,
      decorate(cell, key) {
        cell.dataset.catalogColumn = key;
        const label = cell.ownerDocument.createElement('span');
        label.className = 'catalog-column-label';
        label.id = `catalog-column-label-${key}`;
        label.textContent = columns.find(column => column.key === key).label;
        cell.replaceChildren(label);
        const handle = cell.ownerDocument.createElement('button');
        handle.type = 'button';
        handle.className = 'catalog-column-resize';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', '调整列宽');
        handle.setAttribute('aria-describedby', label.id);
        handle.title = '拖动调整列宽；双击恢复默认布局；末列边界固定';
        cell.append(handle);
        translateDom?.(cell);
      }
    };
  }

  return { columns, defaultWidths, normalizeRatios, visibleColumns, fitWidths, resizeWidths, bind };
}));
