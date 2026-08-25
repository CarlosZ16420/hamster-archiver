'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { resolveDevelopmentUserDataRoot } = require('../src/core/development-paths');
const {
  assertPathInsideLocalRoot,
  makeLocalLayout
} = require('../src/core/local-paths');

test('development data defaults outside the source repository', () => {
  const projectRoot = path.resolve('C:\\projects\\hamster-archiver');
  const resolved = resolveDevelopmentUserDataRoot(projectRoot, {});
  assert.equal(
    resolved,
    path.join(path.dirname(projectRoot), 'HamsterArchiver-Local', 'data', 'development')
  );
  assert.equal(resolved.startsWith(projectRoot + path.sep), false);
});

test('local root override controls the complete external layout', () => {
  const env = { HAMSTER_LOCAL_ROOT: 'D:\\HamsterLocal' };
  const layout = makeLocalLayout('C:\\project', env);
  assert.equal(layout.root, path.resolve(env.HAMSTER_LOCAL_ROOT));
  assert.equal(
    resolveDevelopmentUserDataRoot('C:\\project', env),
    path.join(layout.root, 'data', 'development')
  );
});

test('development data can be explicitly redirected', () => {
  assert.equal(
    resolveDevelopmentUserDataRoot('C:\\project', { HAMSTER_DEV_USER_DATA_DIR: 'D:\\HamsterDev' }),
    path.resolve('D:\\HamsterDev')
  );
});

test('local release targets must stay below the external root', () => {
  const root = path.resolve('D:\\HamsterLocal');
  assert.doesNotThrow(() => assertPathInsideLocalRoot(path.join(root, 'builds', 'current'), root));
  assert.throws(() => assertPathInsideLocalRoot(root, root), /不能直接使用/);
  assert.throws(() => assertPathInsideLocalRoot('D:\\outside', root), /必须位于/);
});
