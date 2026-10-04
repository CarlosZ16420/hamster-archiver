'use strict';

function sameSourceMetadata(expected, actual) {
  return expected.size === actual.size && expected.modifiedAtMs === actual.modifiedAtMs;
}

function canReuseFingerprint(expected, actual) {
  return Boolean(expected) && Number(expected.size) === Number(actual.size) &&
    Number(expected.modifiedAtMs) === Number(actual.modifiedAtMs);
}

function samePublishedFileIdentity(expected, actual) {
  return expected && actual &&
    Number(expected.size) === Number(actual.size) &&
    String(expected.device) === String(actual.device) &&
    String(expected.inode) === String(actual.inode) &&
    String(expected.modifiedNs) === String(actual.modifiedNs) &&
    String(expected.createdNs) === String(actual.createdNs);
}

module.exports = { sameSourceMetadata, canReuseFingerprint, samePublishedFileIdentity };
