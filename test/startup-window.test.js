'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererRoot = path.join(__dirname, '..', 'src', 'renderer');
const startupScript = fs.readFileSync(path.join(rendererRoot, 'startup.js'), 'utf8');

function startupPage(language) {
  const elements = Object.fromEntries(['status', 'detail', 'progress', 'close'].map((id) => [id, {
    textContent: '', hidden: id === 'close', dataset: {}, style: {}, attributes: {},
    addEventListener() {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  }]));
  elements.progress.fill = { style: {} };
  elements.progress.querySelector = () => elements.progress.fill;
  const document = {
    documentElement: {}, body: { dataset: {} },
    querySelector: (selector) => elements[selector.slice('#startup-'.length)]
  };
  const window = {};
  vm.runInNewContext(startupScript, {
    window, document, URLSearchParams, location: { search: `?language=${language}` },
    localStorage: { getItem: () => null }
  });
  return { window, document, elements };
}

test('startup shows progress immediately in both languages, including cache-hit and data-loading stages', () => {
  const html = fs.readFileSync(path.join(rendererRoot, 'startup.html'), 'utf8');
  const initialProgress = html.match(/<div\b[^>]*id="startup-progress"[^>]*>/)[0];
  assert.doesNotMatch(initialProgress, /\bhidden\b/);
  assert.match(initialProgress, /data-mode="indeterminate"/);
  for (const [language, initialText] of [['zh-CN', '正在启动…'], ['en-US', 'Starting…']]) {
    const { window, elements } = startupPage(language);
    assert.equal(elements.status.textContent, initialText);
    for (const stage of ['starting', 'verify-cache', 'load-data']) {
      window.setStartupStatus(stage);
      assert.equal(elements.progress.hidden, false, stage);
      assert.equal(elements.progress.dataset.mode, 'indeterminate', stage);
      assert.equal(elements.progress.attributes['aria-valuenow'], undefined);
    }
  }
});

test('file progress switches to actual percentages, then loading and error clear the percentage', () => {
  const { window, document, elements } = startupPage('en-US');
  for (const [input, expected] of [[0, 0], [42, 42], [105, 100], [-5, 0]]) {
    window.setStartupStatus('verify-files', '', input);
    assert.equal(elements.progress.hidden, false);
    assert.equal(elements.progress.dataset.mode, 'determinate');
    assert.equal(elements.progress.fill.style.width, `${expected}%`);
    assert.equal(elements.progress.attributes['aria-valuenow'], String(expected));
  }
  for (const [stage, percentage] of [['load-data', null], ['verify-files', NaN]]) {
    window.setStartupStatus(stage, '', percentage);
    assert.equal(elements.progress.dataset.mode, 'indeterminate');
    assert.equal(elements.progress.fill.style.width, '');
    assert.equal(elements.progress.attributes['aria-valuenow'], undefined);
  }
  window.setStartupStatus('error', 'Repair needed');
  assert.equal(elements.progress.hidden, true);
  assert.equal(elements.close.hidden, false);
  assert.equal(document.body.dataset.state, 'error');
  assert.equal(elements.detail.textContent, 'Repair needed');
});

test('startup window and second-instance requests wait for the painted frame; integrity tests stay hidden', async () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const create = main.slice(main.indexOf('async function createStartupWindow('), main.indexOf('function updateStartupWindow('));
  const show = main.slice(main.indexOf('function showMainWindow('), main.indexOf('async function readStartupPreferences('));
  for (const integrityTest of [false, true]) {
    let options;
    let shown = 0;
    let painted;
    const context = vm.createContext({
      startupWindowReady: false, isStartupIntegrityTest: integrityTest,
      startupUsesEnglish: false, applicationReady: false,
      path, __dirname: path.join(__dirname, '..', 'src'), appIconPath: 'fixture.ico',
      readStartupPreferences: async () => ({ language: 'en-US', theme: 'day' }),
      defaultInterfaceLanguage: () => 'en-US',
      logStartupTiming() {}, clearMcpIdleTimer() {},
      BrowserWindow: class {
        constructor(value) { options = value; }
        removeMenu() {}
        once(name, callback) { assert.equal(name, 'ready-to-show'); painted = callback; }
        async loadFile() {}
        setTitle() {}
        show() { shown++; }
        focus() {}
        isDestroyed() { return false; }
      },
      process: { platform: 'win32' }
    });
    vm.runInContext(`${create}\n${show}`, context);
    await context.createStartupWindow();
    assert.equal(options.show, false, 'the native window must not precede its contents');
    context.showMainWindow();
    assert.equal(shown, 0, 'a second instance must not reveal an unpainted window');
    painted();
    assert.equal(shown, integrityTest ? 0 : 1);
  }
});
