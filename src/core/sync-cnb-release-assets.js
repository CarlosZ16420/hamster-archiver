'use strict';

// Releases through 4.8.4 are immutable four-asset bundles. New Windows
// releases retain ZIP for existing clients and add 7z with its own checksum.
function supportsSevenZipRelease(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(String(tag));
  if (!match) return false;
  const version = match.slice(1).map(Number);
  return version[0] > 4 || (version[0] === 4 &&
    (version[1] > 8 || (version[1] === 8 && version[2] > 4)));
}

function expectedReleaseAssetNames(tag) {
  const names = [`HamsterArchiver-${tag}-win-x64.zip`, `HamsterArchiver-Setup-${tag}-win-x64.exe`];
  if (supportsSevenZipRelease(tag)) names.push(`HamsterArchiver-${tag}-win-x64.7z`);
  return names.flatMap(name => [name, `${name}.sha256`]);
}

module.exports = { expectedReleaseAssetNames, supportsSevenZipRelease };
