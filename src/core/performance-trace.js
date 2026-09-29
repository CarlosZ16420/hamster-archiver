'use strict';

const ALLOWED_FIELDS = new Set([
  'jobId', 'stage', 'elapsedMs', 'fileCount', 'bytes', 'hashedBytes', 'mode', 'candidateCount'
]);

function createPerformanceTrace({ enabled = true, maxEntries = 500, sink = null } = {}) {
  const entries = [];
  const capacity = Math.max(1, Math.min(500, Math.floor(Number(maxEntries) || 500)));
  return {
    record(value) {
      if (!enabled || !value || typeof value.stage !== 'string') return;
      const entry = {};
      for (const key of ALLOWED_FIELDS) {
        if (!Object.hasOwn(value, key)) continue;
        const field = value[key];
        if (key === 'jobId' || key === 'stage' || key === 'mode') {
          if (typeof field === 'string') entry[key] = field.slice(0, 100);
        } else if (Number.isFinite(field) && field >= 0) entry[key] = field;
      }
      if (!entry.stage || !Number.isFinite(entry.elapsedMs)) return;
      entries.push(Object.freeze(entry));
      if (entries.length > capacity) entries.shift();
      sink?.(entry);
    },
    snapshot() { return entries.map((entry) => ({ ...entry })); },
    clear() { entries.length = 0; }
  };
}

const performanceTrace = createPerformanceTrace({
  sink: process.env.HAMSTER_PERF_TRACE === '1'
    ? (entry) => process.stderr.write(`[hamster-perf] ${JSON.stringify(entry)}\n`)
    : null
});

module.exports = { createPerformanceTrace, performanceTrace };
