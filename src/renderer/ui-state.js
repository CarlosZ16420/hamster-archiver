'use strict';

(function exposeUiState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hamsterUiState = api;
}(typeof globalThis === 'object' ? globalThis : this, () => ({
  sourceDispositionPresentation(autoTrash, moveCompleted) {
    if (autoTrash) return { state: 'trash', label: '归档后移入回收站' };
    if (moveCompleted) return { state: 'move', label: '归档后移动原文件' };
    return { state: 'keep', label: '归档后不移动原文件' };
  },
  similarityProgressPresentation(progress = {}) {
    const total = Math.max(1, Number(progress.total) || 1);
    const completed = Math.max(0, Number(progress.completed) || 0);
    const complete = !progress.active;
    const ratio = complete ? 1 : Math.min(1, completed / total);
    const elapsedSeconds = Math.max(0, Number(progress.elapsedMs) || 0) / 1000;
    if (complete) {
      return {
        complete,
        percent: 100,
        label: `重算完成 · 用时 ${elapsedSeconds.toFixed(1)} 秒`
      };
    }
    const percent = Math.round(ratio * 100);
    if (completed >= 4) {
      const remaining = Math.max(1, Math.round((elapsedSeconds / completed) * (total - completed)));
      return {
        complete,
        percent,
        label: `正在重算 ${percent}% · 预计剩余 ${remaining} 秒`
      };
    }
    return { complete, percent, label: `正在重算 ${percent}%` };
  }
})));
