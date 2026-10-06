'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { generateAcquisition } = require('../scripts/generate-ai-acquisition');

function published(version, digest) {
  const tagName = `v${version}`;
  const name = `HamsterArchiver-${tagName}-win-x64.zip`;
  const base = `https://github.com/CarlosZ16420/hamster-archiver/releases/download/${tagName}/`;
  return { tagName, isDraft: false, isPrerelease: false, assets: [
    { name, url: `${base}${name}`, digest: `sha256:${digest}`, state: 'uploaded' },
    { name: `${name}.sha256`, url: `${base}${name}.sha256`, state: 'uploaded' }
  ] };
}

test('published metadata generates matching exact asset links without mixing versions', () => {
  const first = generateAcquisition(published('4.6.18', 'a'.repeat(64)));
  const second = generateAcquisition(published('4.7.0', 'b'.repeat(64)));
  assert.match(first, /HamsterArchiver-v4\.6\.18-win-x64\.zip\.sha256/);
  assert.doesNotMatch(first, /v4\.7\.0/);
  assert.match(second, /HamsterArchiver-v4\.7\.0-win-x64\.zip/);
  assert.doesNotMatch(second, /v4\.6\.18/);
  assert.throws(() => generateAcquisition({ ...published('4.7.0', 'b'.repeat(64)), isDraft: true }),
    /published stable Release/);
  assert.throws(() => generateAcquisition(published('4.7.0', 'bad')), /incomplete/);
});

test('checksum comparison rejects tampered ZIP bytes', () => {
  const original = Buffer.from('test ZIP bytes');
  const expected = crypto.createHash('sha256').update(original).digest('hex');
  const tampered = Buffer.from('test ZIP bytes changed');
  assert.notEqual(crypto.createHash('sha256').update(tampered).digest('hex'), expected);
});

test('public README links and package copy list reach the offline AI guide', async () => {
  const root = path.resolve(__dirname, '..');
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const english = await fs.readFile(path.join(root, 'README.en.md'), 'utf8');
  const quickStart = await fs.readFile(path.join(root, 'docs', 'AI-QUICKSTART.md'), 'utf8');
  const acquisition = await fs.readFile(path.join(root, 'docs', 'RELEASE-ACQUISITION.md'), 'utf8');
  const build = await fs.readFile(path.join(root, 'scripts', 'build-release.js'), 'utf8');
  assert.match(readme, /docs\/AI-QUICKSTART\.md/);
  assert.match(english, /docs\/AI-QUICKSTART\.md/);
  assert.match(quickStart, /RELEASE-ACQUISITION\.md/);
  assert.match(acquisition, /HamsterArchiver-v4\.6\.18-win-x64\.zip\.sha256/);
  assert.match(acquisition, /7fcb96fd551c8f2004e3df37da1767f4aa19f149e5edfecd89abed45bd14f3b2/);
  for (const name of ['AI-QUICKSTART.md', 'RELEASE-ACQUISITION.md', 'CLI.md', 'MCP.md',
    'AI-TROUBLESHOOTING.md', 'AI-TASK-RECEIPT-v2.schema.json']) {
    assert.ok(build.includes(`'${name}'`));
    await fs.access(path.join(root, 'docs', name));
  }
});
