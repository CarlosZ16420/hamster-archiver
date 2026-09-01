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
  shouldShowDuplicateConfirmation(job = {}) {
    if (job.sourceCatalogRecordId || job.exactDuplicateOverrideAt) return false;
    if (job.status === 'awaiting_duplicate_confirmation') return true;
    if (job.status === 'queued' && (job.automaticDuplicateCheckPending === true ||
      (job.stageText === '等待精确重复核验' && (job.confirmationReasons || []).some((reason) =>
        ['name_match', 'similar_title', 'same_video_size'].includes(reason))))) return true;
    if (job.similarityPreflightBlocking === false || job.status !== 'awaiting_confirmation' ||
        (job.confirmationReasons || []).includes('large_task')) return false;
    return (job.confirmationReasons || []).some((reason) =>
      ['name_match', 'similar_title', 'same_video_size'].includes(reason));
  },
  summarizeScanSkips(items = []) {
    const summary = {
      total: items.length,
      smallItems: 0,
      smallItemThresholdMb: null,
      rootNonVideoFiles: 0,
      links: 0,
      unreadable: 0,
      other: 0
    };
    for (const item of items) {
      const reason = String(item?.reason || '');
      const threshold = reason.match(/^低于过滤阈值 ([\d.]+) MB$/);
      if (threshold) {
        summary.smallItems += 1;
        summary.smallItemThresholdMb ??= threshold[1];
      } else if (reason === '根级非视频文件') {
        summary.rootNonVideoFiles += 1;
      } else if (reason.includes('链接或重解析点')) {
        summary.links += 1;
      } else if (item?.code || reason.includes('无法读取') || reason.includes('读取失败')) {
        summary.unreadable += 1;
      } else {
        summary.other += 1;
      }
    }
    return summary;
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
