'use strict';

(function exposeUiState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hamsterUiState = api;
}(typeof globalThis === 'object' ? globalThis : this, () => ({
  formatCatalogDate(value, locale = 'zh-CN') {
    const selectedLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
    const dateOnly = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return new Intl.DateTimeFormat(selectedLocale, {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
      }).format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12)));
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat(selectedLocale, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  },
  formatItemCount(count, locale = 'zh-CN') {
    const value = Number(count) || 0;
    if (locale !== 'en-US') return `${value} 项`;
    return `${value} ${value === 1 ? 'item' : 'items'}`;
  },
  ratingButtonLabel(rating, locale = 'zh-CN') {
    const value = Number(rating) || 0;
    if (locale !== 'en-US') return `${value} 星`;
    return `${value} ${value === 1 ? 'star' : 'stars'}`;
  },
  sourceDispositionPresentation(autoTrash, moveCompleted) {
    if (autoTrash) return { state: 'trash', label: '归档后移入回收站' };
    if (moveCompleted) return { state: 'move', label: '归档后移动原文件' };
    return { state: 'keep', label: '归档后不移动原文件' };
  },
  shouldShowDuplicateConfirmation(job = {}) {
    if (job.sourceCatalogRecordId || job.exactDuplicateOverrideAt) return false;
    if (job.status === 'awaiting_duplicate_confirmation') return true;
    if (job.status === 'queued' && (job.automaticDuplicateCheckPending === true ||
      (job.stageText === '等待内容完全一致核验' && (job.confirmationReasons || []).some((reason) =>
        ['name_match', 'similar_title', 'same_video_size'].includes(reason))))) return true;
    if (job.similarityPreflightBlocking === false || job.status !== 'awaiting_confirmation' ||
        (job.confirmationReasons || []).includes('large_task')) return false;
    return (job.confirmationReasons || []).some((reason) =>
      ['name_match', 'similar_title', 'same_video_size'].includes(reason));
  },
  shouldApplyTaskProgress(job = {}, progress = {}) {
    const runningStages = new Set(['inventorying', 'compressing', 'verifying', 'moving']);
    return runningStages.has(job.status) && job.status === progress.stage;
  },
  queueSimilarityEvidenceText(project = {}) {
    if ((project.reasons || []).includes('项目完全重复')) return '项目完全重复';
    const details = [];
    if (project.exactFileCount > 0) details.push(`${project.exactFileCount} 个文件内容完全一致`);
    if (project.exactDirectoryCount > 0) details.push(`${project.exactDirectoryCount} 个目录名称完全一致`);
    if (project.similarFileCount > 0) details.push(`${project.similarFileCount} 个文件名称相似`);
    if (project.similarDirectoryCount > 0) details.push(`${project.similarDirectoryCount} 个目录名称相似`);
    for (const reason of project.reasons || []) {
      if (!['项目完全重复', '文件内容完全一致', '文件名相似', '目录名相似', '目录名完全一致'].includes(reason)) {
        details.push(reason);
      }
    }
    return [...new Set(details)].join(' · ') || '项目存在相似证据';
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
