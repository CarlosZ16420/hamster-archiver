'use strict';

const boundary = require('../config/public-snapshot-boundary.json');

if (boundary.schemaVersion !== 1 || !Array.isArray(boundary.sensitiveRoots) ||
    !Array.isArray(boundary.allowedPrefixes) || !Array.isArray(boundary.allowedFiles)) {
  throw new Error('Public source boundary configuration is invalid.');
}

const sensitiveRoots = Object.freeze([...new Set(boundary.sensitiveRoots)]);
const allowedPrefixes = Object.freeze([...new Set(boundary.allowedPrefixes)]);
const allowedFiles = new Set(boundary.allowedFiles);

function normalizePublicPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function publicSourceClassification(value) {
  const name = normalizePublicPath(value);
  const sensitive = sensitiveRoots.some(prefix => name.startsWith(prefix));
  const allowedByPrefix = allowedPrefixes.some(prefix =>
    name.startsWith(prefix) || `${name}/` === prefix
  );
  const allowed = !sensitive || allowedFiles.has(name) || allowedByPrefix;
  return { name, sensitive, allowed };
}

module.exports = { normalizePublicPath, publicSourceClassification };
