'use strict';

const path = require('node:path');

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const LARGE_TASK_BYTES = 10 * GIB;
const MIN_ARCHIVE_VOLUME_BYTES = 64 * MIB;
const ARCHIVE_PASSWORD = '';
const PASSWORD_SCHEME = 'configured-v1';

const VIDEO_EXTENSIONS = new Set([
  '.3gp', '.avi', '.flv', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4',
  '.mpeg', '.mpg', '.mts', '.rm', '.rmvb', '.ts', '.vob', '.webm', '.wmv'
]);

const IMAGE_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp'
]);

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const RUNNING_STATUSES = new Set([
  'inventorying', 'compressing', 'verifying', 'moving'
]);

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = {
  ARCHIVE_PASSWORD,
  GIB,
  IMAGE_EXTENSIONS,
  MIB,
  LARGE_TASK_BYTES,
  MIN_ARCHIVE_VOLUME_BYTES,
  PASSWORD_SCHEME,
  RUNNING_STATUSES,
  TERMINAL_STATUSES,
  VIDEO_EXTENSIONS,
  isImageFile,
  isVideoFile
};
