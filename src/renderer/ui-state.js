'use strict';

(function exposeUiState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.hamsterUiState = api;
}(typeof globalThis === 'object' ? globalThis : this, () => ({
  isCompletedQueueJob(job = {}) {
    return String(job.status || '').startsWith('completed') || job.status === 'skipped_duplicate';
  },
  canClearCompletedQueueJob(job = {}) {
    return (String(job.status || '').startsWith('completed') || job.status === 'skipped_duplicate') &&
      job.errorCode !== 'SOURCE_DISPOSITION_COMMIT_FAILED';
  },
  directoryRefreshNotices(previousJobs, jobs) {
    const previousById = new Map(previousJobs.map((job) => [job.id, job]));
    return jobs.flatMap((job) => {
      if (job.taskKind !== 'catalog_refresh' || previousById.get(job.id)?.status === job.status) return [];
      const title = String(job.unchangedDirectoryTitle || job.displayName || '');
      const name = Array.from(title).slice(0, 30).join('') + (Array.from(title).length > 30 ? '…' : '');
      if (job.status === 'completed') return [{ message: job.unchangedDirectoryTitle
        ? `“${name}”校对完成：目录未发现变化。`
        : `“${name}”校对完成：仓库已更新。`, isError: false }];
      if (job.status.startsWith('awaiting_')) return [{
        message: `“${name}”校对需要手动处理；请到归档工作台查看并确认。`, isError: true
      }];
      if (job.status === 'failed' || job.status === 'completed_cleanup_failed') return [{
        message: `“${name}”校对未能正常完成；请到归档工作台查看原因并处理。`, isError: true
      }];
      if (job.status === 'cancelled') return [{ message: `“${name}”校对已取消。`, isError: false }];
      return [];
    });
  },
  sourceLocationUrl(value, allowBareHost = false) {
    const location = String(value || '').trim();
    try {
      const url = new URL(location);
      if (['http:', 'https:'].includes(url.protocol) && url.hostname) return url.href;
    } catch {}
    if (!allowBareHost || !location || /[\s\\]/u.test(location) || location.startsWith('/')) return '';
    try {
      const url = new URL(`https://${location}`);
      const labels = url.hostname.split('.');
      if (url.username || url.password || labels.length < 2 ||
          !labels.every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)) ||
          !/^(?:[a-z]{2,}|xn--[a-z\d-]+)$/i.test(labels.at(-1))) return '';
      return url.href;
    } catch {
      return '';
    }
  },
  catalogRangeSelection(pageIds, anchorId, targetId, selection, additive = false) {
    const result = new Set(additive ? selection : []);
    const targetIndex = pageIds.indexOf(targetId);
    if (targetIndex < 0) return new Set(selection);
    const anchorIndex = pageIds.indexOf(anchorId);
    const start = anchorIndex < 0 ? targetIndex : anchorIndex;
    for (const id of pageIds.slice(Math.min(start, targetIndex), Math.max(start, targetIndex) + 1)) result.add(id);
    return result;
  },
  catalogMarqueeSelection(initialSelection, hitIds, mode) {
    const result = new Set(mode === 'replace' ? [] : initialSelection);
    for (const id of hitIds) {
      if (mode === 'toggle' && result.has(id)) result.delete(id);
      else result.add(id);
    }
    return result;
  },
  catalogGridRowsForSize(size) {
    return 3;
  },
  catalogPageSizeForColumns(columns, rows = 4) {
    const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
    const safeRows = Math.max(1, Math.floor(Number(rows) || 1));
    return safeColumns * safeRows;
  },
  catalogPageForAnchor(anchorIndex, pageSize) {
    const safeIndex = Math.max(0, Math.floor(Number(anchorIndex) || 0));
    const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 1));
    return Math.floor(safeIndex / safePageSize) + 1;
  },
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
  shouldShowQueueSimilarityReport(job = {}, config = {}) {
    if (job.sourceCatalogRecordId || config.similarityReportEnabled === false) return false;
    return (job.nameDuplicateMatches || []).some((match) => match.archiveId || match.jobId) ||
      (job.similarMatches || []).some((match) => match.id) ||
      (job.exactProjectMatches || []).some((match) => match.id) ||
      (job.exactDuplicateMatches || []).some((match) => (match.previous || []).some((previous) => previous.archiveId));
  },
  shouldApplyTaskProgress(job = {}, progress = {}) {
    const runningStages = new Set(['inventorying', 'compressing', 'verifying', 'moving']);
    return runningStages.has(job.status) && job.status === progress.stage;
  },
  newlyAutoSkippedJobIds(previousJobs = [], nextJobs = []) {
    const previousStatuses = new Map(previousJobs.map((job) => [job.id, job.status]));
    return nextJobs
      .filter((job) => job.status === 'skipped_duplicate' && previousStatuses.get(job.id) !== 'skipped_duplicate')
      .map((job) => job.id);
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
