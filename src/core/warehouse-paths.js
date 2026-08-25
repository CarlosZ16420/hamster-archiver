'use strict';

const path = require('node:path');

function invalidThumbnailReference() {
  const error = new Error('缩略图引用无效或不属于当前仓库。');
  error.code = 'INVALID_THUMBNAIL_REFERENCE';
  return error;
}

function isAbsoluteOnAnyPlatform(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function thumbnailReferenceForStorage(repositoryDirectory, input) {
  const value = String(input || '').trim();
  if (!repositoryDirectory || !value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalidThumbnailReference();
  }

  let parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  if (isAbsoluteOnAnyPlatform(value)) {
    const thumbnailIndex = parts.findLastIndex((part) => part.toLocaleLowerCase('en-US') === 'thumbnails');
    if (thumbnailIndex < 0) throw invalidThumbnailReference();
    parts = parts.slice(thumbnailIndex + 1);
  } else if (parts[0]?.toLocaleLowerCase('en-US') === 'thumbnails') {
    parts = parts.slice(1);
  }

  if (parts.length === 0 || parts.some((part) =>
    !part || part === '.' || part === '..' || /^[a-z]:$/i.test(part))) {
    throw invalidThumbnailReference();
  }

  const thumbnailRoot = path.resolve(repositoryDirectory, 'thumbnails');
  const resolved = path.resolve(thumbnailRoot, ...parts);
  const relative = path.relative(thumbnailRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw invalidThumbnailReference();
  }
  return relative.split(path.sep).join('/');
}

function resolveThumbnailReference(repositoryDirectory, input) {
  const reference = thumbnailReferenceForStorage(repositoryDirectory, input);
  return path.resolve(repositoryDirectory, 'thumbnails', ...reference.split('/'));
}

function normalizeThumbnailReferences(value, repositoryDirectory, { strict = false } = {}) {
  const result = { changed: 0, invalid: 0 };
  const visit = (item) => {
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, entry] of Object.entries(item)) {
      if (key !== 'thumbnailPath') {
        visit(entry);
        continue;
      }
      if (entry === null || entry === undefined || entry === '') continue;
      try {
        const normalized = thumbnailReferenceForStorage(repositoryDirectory, entry);
        if (normalized !== entry) {
          item[key] = normalized;
          result.changed += 1;
        }
      } catch (error) {
        result.invalid += 1;
        if (strict) throw error;
      }
    }
  };
  visit(value);
  return result;
}

module.exports = {
  normalizeThumbnailReferences,
  resolveThumbnailReference,
  thumbnailReferenceForStorage
};
