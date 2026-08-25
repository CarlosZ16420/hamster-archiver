'use strict';

const path = require('node:path');
const { resolveLocalRoot } = require('./local-paths');

function resolveDevelopmentUserDataRoot(projectRoot, env = process.env) {
  const configured = String(env.HAMSTER_DEV_USER_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveLocalRoot(projectRoot, env), 'data', 'development');
}

module.exports = { resolveDevelopmentUserDataRoot };
