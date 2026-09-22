'use strict';

function expectedReleaseAssetNames(tag) {
  const names = [`HamsterArchiver-${tag}-win-x64.zip`, `HamsterArchiver-Setup-${tag}-win-x64.exe`];
  return names.flatMap(name => [name, `${name}.sha256`]);
}

module.exports = { expectedReleaseAssetNames };
