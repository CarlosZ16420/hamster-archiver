'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { CancelledError } = require('./archive-engine-errors');

function portableRelativePath(value) { return value.split(path.sep).join('/'); }

async function* walkSourceMetadata(sourcePath, sourceType, options = {}) {
  const { signal, pauseController, onSkipped = () => {} } = options;
  if (sourceType === 'video') {
    const stats = await fs.stat(sourcePath);
    yield { type: 'file', absolutePath: sourcePath, relativePath: path.basename(sourcePath),
      name: path.basename(sourcePath), stats };
    return;
  }
  const pending = [sourcePath];
  while (pending.length > 0) {
    await pauseController?.waitIfPaused(signal);
    if (signal?.aborted) throw new CancelledError();
    const current = pending.pop();
    let directory;
    try { directory = await fs.opendir(current); } catch (error) {
      onSkipped({ absolutePath: current, relativePath: portableRelativePath(path.relative(sourcePath, current)) || '.',
        type: 'directory', error });
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current, entry.name);
      const relativePath = portableRelativePath(path.relative(sourcePath, absolutePath));
      if (entry.isDirectory()) {
        yield { type: 'directory', absolutePath, relativePath, name: entry.name };
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        let stats;
        try { stats = await fs.stat(absolutePath); } catch (error) {
          onSkipped({ absolutePath, relativePath, type: 'file', error });
          continue;
        }
        yield { type: 'file', absolutePath, relativePath, name: entry.name, stats };
      }
    }
  }
}

module.exports = { walkSourceMetadata };
