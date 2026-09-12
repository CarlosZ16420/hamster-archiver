'use strict';

// Remote release content is rendered as text nodes, never HTML.
window.showUpdateDialog = function showUpdateDialog(result, { t, locale }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'update-dialog';
  dialog.dataset.i18nUserText = 'true'; // This dialog explicitly localizes its UI; remote notes retain their language.
  dialog.setAttribute('aria-labelledby', 'update-dialog-title');
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (label, className, action) => {
    const element = node('button', `button ${className}`, t(label));
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  const header = node('header', 'update-dialog-header');
  const title = node('h2', '', t(result.updateAvailable ? '发现新版本' : '检查更新'));
  title.id = 'update-dialog-title';
  header.append(title);
  const close = button('关闭', 'update-dialog-close', () => dialog.close());
  header.append(close);
  const content = node('div', 'update-dialog-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', t('更新内容'));
  if (result.latestVersion) content.append(node('strong', 'update-dialog-version', `v${result.latestVersion}`));
  if (result.currentVersion) content.append(node('p', 'update-dialog-muted', `${t('当前版本')} v${result.currentVersion}`));
  content.append(node('p', 'update-dialog-muted', t(result.checkFailed ? '暂时无法获取最新版本' : result.updateAvailable ? '下载并校验更新后再安装，用户数据会保留。' : result.latestVersion ? '当前已是最新版本。' : '暂无正式发行版。')));
  if (result.historyIncomplete) content.append(node('p', 'update-dialog-warning', t('部分历史更新说明未能加载，请在发布页查看完整记录。')));
  if (result.updateAvailable && !result.installable) content.append(node('p', 'update-dialog-warning', t('此版本没有匹配的更新包，请手动更新或打开发布页。')));
  for (const release of result.releases || []) {
    const section = node('section', 'update-release');
    const heading = node('h3', '', `v${release.version}`);
    section.append(heading);
    const date = new Date(release.publishedAt);
    if (Number.isFinite(date.getTime())) section.append(node('time', 'update-dialog-muted', date.toLocaleDateString(locale)));
    const notes = release.notes?.[locale];
    if (release.truncated) section.append(node('p', 'update-dialog-warning', t('更新说明过长，请在发布页查看全文。')));
    if (notes?.untranslated) section.append(node('p', 'update-dialog-warning', t('此版本未提供当前语言的独立说明，以下显示原文。')));
    if (!notes?.text) section.append(node('p', 'update-dialog-muted', t('此版本未附带更新说明。')));
    let list = null;
    let code = false;
    for (const raw of String(notes?.text || '').split('\n')) {
      const line = raw.trim();
      if (/^```/.test(line)) { code = !code; continue; }
      if (!line || /^[-*_]{3,}$/.test(line)) { list = null; continue; }
      const headingMatch = !code && line.match(/^#{1,6}\s+(.+)/);
      const bullet = !code && line.match(/^(?:[-*+] |\d+[.)] )(.+)/);
      const text = (headingMatch?.[1] || bullet?.[1] || line).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      const block = node(headingMatch ? 'h4' : bullet ? 'li' : 'p', '', '');
      // A small inline subset keeps emphasis without accepting remote markup or links.
      text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).forEach((part) => {
        if (part.startsWith('**') && part.endsWith('**')) block.append(node('strong', '', part.slice(2, -2)));
        else if (part.startsWith('`') && part.endsWith('`')) block.append(node('code', '', part.slice(1, -1)));
        else block.append(document.createTextNode(part));
      });
      if (bullet) {
        if (!list) { list = node('ul', ''); section.append(list); }
        list.append(block);
      } else { list = null; section.append(block); }
    }
    content.append(section);
  }
  const error = node('p', 'update-dialog-error');
  error.setAttribute('role', 'alert');
  const footer = node('footer', 'update-dialog-footer');
  let busy = false;
  let actionResult;
  async function perform(action) {
    if (busy) return;
    busy = true;
    error.dataset.busy = 'true';
    dialog.querySelectorAll('button').forEach((element) => { element.disabled = true; });
    error.textContent = t('正在准备更新…');
    try {
      actionResult = await action();
      if (actionResult?.cancelled || actionResult?.staged) { error.textContent = ''; return; }
      dialog.close();
    } catch (failure) {
      error.textContent = t(failure.message || String(failure));
    } finally {
      busy = false;
      error.dataset.busy = 'false';
      dialog.querySelectorAll('button').forEach((element) => { element.disabled = false; });
    }
  }
  footer.append(button('稍后', '', () => dialog.close()));
  if (result.releaseUrl) footer.append(button('打开发布页', '', () => window.archiveApp.openExternal(result.releaseUrl).catch((failure) => { error.textContent = t(failure.message); })));
  footer.append(button('手动更新', '', () => perform(() => window.archiveApp.installUpdatePackage())));
  if (result.updateAvailable && result.installable) footer.append(button('立即更新', 'primary', () => perform(() => window.archiveApp.installCheckedUpdate(result.latestVersion))));
  dialog.append(header, content, error, footer);
  document.body.append(dialog);
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  const previousFocus = document.activeElement;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.focus(); resolve(actionResult); }, { once: true });
    dialog.showModal();
    close.focus();
  });
};
