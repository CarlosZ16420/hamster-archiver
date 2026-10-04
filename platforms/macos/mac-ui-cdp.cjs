'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const mode = process.argv[2];
const evidenceDirectory = process.argv[3];
const fixtureId = process.env.MAC_VALIDATION_FIXTURE_ID;
const fixtureTitle = 'Mac replacement validation ' + fixtureId;
const expectedProfileRoot = process.env.MAC_VALIDATION_PROFILE_DATA;
const debugBase = 'http://127.0.0.1:9222';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForPage() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(debugBase + '/json/list');
      if (!response.ok) throw new Error('CDP target list returned ' + response.status);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' &&
        target.url?.includes('index.html') && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for the local Electron CDP page: ' + (lastError?.message || 'no target'));
}

async function connectCdp(url) {
  assert(typeof WebSocket === 'function', 'This runner Node does not provide the built-in WebSocket client.');
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not open the Electron CDP WebSocket.')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callbacks.resolve(message.result);
  });
  function send(method, params = {}) {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function click(selector) {
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.scrollIntoView({block:\"center\"})');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const rectangle = await evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); if (!node) return null; const r = node.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hidden:node.hidden,disabled:Boolean(node.disabled)}; })()');
    assert(rectangle && rectangle.width > 0 && rectangle.height > 0 && !rectangle.hidden && !rectangle.disabled, 'Cannot click visible enabled ' + selector + '.');
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: rectangle.x,
        y: rectangle.y,
        button: type === 'mouseMoved' ? 'none' : 'left',
        clickCount: type === 'mousePressed' ? 1 : 0
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  async function typeText(selector, text) {
    await click(selector);
    await send('Input.insertText', { text });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { socket, evaluate, click, typeText };
}

async function main() {
  assert(['initial', 'after-replacement'].includes(mode), 'Unknown mode ' + mode);
  assert(fixtureId, 'MAC_VALIDATION_FIXTURE_ID is required.');
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const page = await waitForPage();
  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  try {
    const initial = await cdp.evaluate('(async () => { const end=Date.now()+30000; while(Date.now()<end){ const bridge=window.archiveApp; if(bridge && typeof bridge.saveConfig===\"function\"){ const state=await bridge.getState(); return {platform:bridge.platform,config:state.config,catalog:state.catalog||[],catalogCount:state.catalogCount}; } await new Promise(resolve=>setTimeout(resolve,200)); } throw new Error(\"Packaged renderer bridge did not become ready.\"); })()');
    assert(initial.platform === 'darwin', 'Renderer bridge platform was ' + initial.platform + '.');
    assert(path.resolve(initial.config.userDataDirectory) === path.resolve(expectedProfileRoot), 'The app did not use the isolated test user-data profile: ' + initial.config.userDataDirectory);
    await cdp.evaluate('(async () => { const end=Date.now()+30000; while(Date.now()<end){ const state=await window.archiveApp.getState(); if(state.catalogLoadError) throw new Error(state.catalogLoadError); if(!state.catalogLoading) return true; await new Promise(resolve=>setTimeout(resolve,250)); } throw new Error(\"Warehouse did not finish loading.\"); })()');

    if (mode === 'initial') {
      const expression = '(async () => { const bridge=window.archiveApp; const state=await bridge.getState(); const saved=await bridge.saveConfig({...state.config,suppressOnboarding:true,archiveFormat:\"zip\",recordBackupLocation:true,backupLocation:' +
        JSON.stringify('Mac replacement fixture ' + fixtureId) +
        '}); return {platform:bridge.platform,setting:saved.config}; })()';
      const result = await cdp.evaluate(expression);
      assert(result.setting?.archiveFormat === 'zip', 'The distinctive ZIP setting did not save through the real renderer bridge.');
      assert(result.setting?.backupLocation === 'Mac replacement fixture ' + fixtureId, 'The distinctive backup-location setting did not save.');

      const macBehavior = await cdp.evaluate('(async () => { const update=await window.archiveApp.checkForUpdates({silent:true}); const trash=document.querySelector(\"#auto-trash-completed\"); const paste=document.querySelector(\"#manual-image-paste\"); return {updateDistributionMode:update.distributionMode,updateInstallable:update.installable,updateAvailable:update.updateAvailable,trashHidden:trash?.closest(\"label\")?.hidden,trashDisabled:trash?.disabled,commandVPaste:paste?.textContent.includes(\"⌘V\"),archiveFormat:document.querySelector(\"#archive-format\")?.value}; })()');
      assert(macBehavior.updateDistributionMode === 'mac' && macBehavior.updateInstallable === false, 'Packaged Mac update distribution mode was not selected.');
      assert(macBehavior.trashHidden === true, 'The Windows recycle-bin control was not hidden on macOS: ' + JSON.stringify(macBehavior));
      assert(macBehavior.commandVPaste, 'The macOS paste hint did not use Command+V.');
      const onboardingSkip = await cdp.evaluate('(() => { const node=document.querySelector("#skip-onboarding"); if (!node) return null; const r=node.getBoundingClientRect(); return {visible:!node.hidden && r.width>0 && r.height>0,disabled:Boolean(node.disabled)}; })()');
      if (onboardingSkip?.visible && !onboardingSkip.disabled) await cdp.click('#skip-onboarding');
      await cdp.click('[data-page=\"workbench-page\"]');
      const workbench = await cdp.evaluate('({active:!document.querySelector(\"#workbench-page\")?.hidden,selected:document.querySelectorAll(\".nav-button\")[1]?.classList.contains(\"active\")})');
      assert(workbench.active && workbench.selected, 'A CDP mouse click did not activate the archive workbench.');
      await cdp.evaluate('(() => { const control=document.querySelector(\"#archive-format\"); control.value=\"zip\"; control.dispatchEvent(new Event(\"change\",{bubbles:true})); return true; })()');
      await new Promise((resolve) => setTimeout(resolve, 500));
      await cdp.click('#record-backup-location');
      await cdp.typeText('#backup-location', 'Mac replacement fixture ' + fixtureId);
      await cdp.click('#save-settings');
      const workbenchSettings = await cdp.evaluate('({archiveFormat:document.querySelector(\"#archive-format\")?.value,recordBackupLocation:document.querySelector(\"#record-backup-location\")?.checked,backupLocation:document.querySelector(\"#backup-location\")?.value,autoTrashHidden:document.querySelector(\"#auto-trash-completed\")?.closest(\"label\")?.hidden})');
      assert(workbenchSettings.archiveFormat === 'zip' && workbenchSettings.recordBackupLocation && workbenchSettings.backupLocation === 'Mac replacement fixture ' + fixtureId && workbenchSettings.autoTrashHidden, 'The workbench settings did not retain the Mac-specific setting state: ' + JSON.stringify(workbenchSettings));
      const persistedConfig = await cdp.evaluate('(async () => { const state=await window.archiveApp.getState(); const saved=await window.archiveApp.saveConfig({...state.config,archiveFormat:"zip",recordBackupLocation:true,backupLocation:' + JSON.stringify('Mac replacement fixture ' + fixtureId) + ',suppressOnboarding:true}); return saved.config; })()');
      assert(persistedConfig.archiveFormat === 'zip' && persistedConfig.recordBackupLocation === true && persistedConfig.backupLocation === 'Mac replacement fixture ' + fixtureId && persistedConfig.suppressOnboarding === true, 'The real renderer bridge did not persist the settings before app replacement: ' + JSON.stringify(persistedConfig));
      await new Promise((resolve) => setTimeout(resolve, 500));
      execFileSync('/usr/sbin/screencapture', ['-x', evidenceDirectory + '/workbench.png']);

      await cdp.click('[data-page=\"library-page\"]');
      await cdp.click('#add-manual-catalog');
      await cdp.typeText('#manual-catalog-name', fixtureTitle);
      await cdp.typeText('#manual-catalog-notes', 'Temporary isolated profile fixture for same-DMG replacement persistence validation ' + fixtureId + '.');
      await cdp.click('#manual-catalog-form button[type=\"submit\"]');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const record = await cdp.evaluate('(async () => { const state=await window.archiveApp.getState(); const record=state.catalog?.find(item=>item.title===' + JSON.stringify(fixtureTitle) + '); return record?{id:record.id,title:record.title}:null; })()');
      assert(record?.title === fixtureTitle, 'The manual-catalog UI did not create the fixture through its renderer bridge.');
      const warehouse = await cdp.evaluate('({active:!document.querySelector(\"#library-page\")?.hidden,selected:document.querySelectorAll(\".nav-button\")[0]?.classList.contains(\"active\"),fixtureVisible:document.querySelector(\"#library-page\")?.innerText.includes(' + JSON.stringify(fixtureTitle) + ')})');
      assert(warehouse.active && warehouse.selected && warehouse.fixtureVisible, 'A CDP mouse click did not show the new warehouse fixture.');
      await new Promise((resolve) => setTimeout(resolve, 500));
      execFileSync('/usr/sbin/screencapture', ['-x', evidenceDirectory + '/repository.png']);
      fs.writeFileSync(evidenceDirectory + '/initial-state.json', JSON.stringify({userDataDirectory:initial.config?.userDataDirectory,result:{setting:result.setting,record},persistedConfig,macBehavior,workbench,workbenchSettings,warehouse}, null, 2) + '\n');
      console.log(JSON.stringify({mode,macBehavior,workbench,workbenchSettings,warehouse,record}));
      return;
    }

    await cdp.evaluate('(async () => { const end=Date.now()+30000; while(Date.now()<end){ const state=await window.archiveApp.getState(); if(state.catalogLoadError) throw new Error(state.catalogLoadError); if(!state.catalogLoading) return true; await new Promise(resolve=>setTimeout(resolve,250)); } throw new Error(\"Warehouse did not finish loading after replacement.\"); })()');
    const expression = '(async () => { const bridge=window.archiveApp; const state=await bridge.getState(); const update=await bridge.checkForUpdates({silent:true}); return {platform:bridge.platform,userDataDirectory:state.config.userDataDirectory,archiveFormat:state.config.archiveFormat,recordBackupLocation:state.config.recordBackupLocation,backupLocation:state.config.backupLocation,suppressOnboarding:state.config.suppressOnboarding,fixture:state.catalog?.find(record=>record.title===' +
      JSON.stringify(fixtureTitle) +
      ')||null,catalogCount:state.catalogCount,updateDistributionMode:update.distributionMode,updateInstallable:update.installable}; })()';
    const persistence = await cdp.evaluate(expression);
    assert(path.resolve(persistence.userDataDirectory) === path.resolve(expectedProfileRoot), 'The replacement app did not use the isolated test profile.');
    assert(persistence.archiveFormat === 'zip' && persistence.recordBackupLocation === true && persistence.backupLocation === 'Mac replacement fixture ' + fixtureId, 'A product setting was lost after replacing the app bundle.');
    assert(persistence.suppressOnboarding === true, 'The onboarding preference did not survive replacement.');
    assert(persistence.fixture?.title === fixtureTitle, 'The warehouse record did not survive app replacement.');
    assert(persistence.updateDistributionMode === 'mac' && persistence.updateInstallable === false, 'Mac update behavior changed after replacement.');
    const initialEvidence = JSON.parse(fs.readFileSync(evidenceDirectory + '/initial-state.json', 'utf8'));
    assert(initialEvidence.userDataDirectory === persistence.userDataDirectory, 'The app changed its user data directory after bundle replacement.');
    assert(initialEvidence.result.record.id === persistence.fixture.id, 'The warehouse record identity changed after bundle replacement.');
    const settingsPath = persistence.userDataDirectory + '/config/settings.json';
    assert(fs.existsSync(settingsPath), 'The app settings file is missing at ' + settingsPath + '.');
    const settingsFile = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert(settingsFile.archiveFormat === 'zip' && settingsFile.backupLocation === 'Mac replacement fixture ' + fixtureId, 'The replacement app did not load the persisted settings.');
    await cdp.click('[data-page=\"library-page\"]');
    const warehouse = await cdp.evaluate('({active:!document.querySelector(\"#library-page\")?.hidden,fixtureVisible:document.querySelector(\"#library-page\")?.innerText.includes(' + JSON.stringify(fixtureTitle) + ')})');
    assert(warehouse.active && warehouse.fixtureVisible, 'The replacement app did not render the persisted warehouse record.');
    await new Promise((resolve) => setTimeout(resolve, 500));
    execFileSync('/usr/sbin/screencapture', ['-x', evidenceDirectory + '/after-replacement.png']);
    fs.writeFileSync(evidenceDirectory + '/replacement-state.json', JSON.stringify({persistence,warehouse,settingsPath}, null, 2) + '\n');
    console.log(JSON.stringify({mode,persistence,warehouse,settingsPath}));
  } finally {
    cdp.socket.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
