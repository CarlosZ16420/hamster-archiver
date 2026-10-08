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
  const titleGroup = node('div', 'update-dialog-title-group');
  const logo = node('img', 'update-dialog-logo');
  logo.src = '../../assets/app-icon.png';
  logo.alt = '';
  logo.width = 34;
  logo.height = 34;
  const title = node('h2', '', t(result.updateAvailable ? '发现新版本' : '检查更新'));
  title.id = 'update-dialog-title';
  titleGroup.append(logo, title);
  header.append(titleGroup);
  const close = button('×', 'dialog-close update-dialog-close', () => dialog.close());
  close.setAttribute('aria-label', t('关闭'));
  close.title = t('关闭');
  header.append(close);
  const content = node('div', 'update-dialog-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', t('更新内容'));
  const mac = result.distributionMode === 'mac';
  const versions = new Map((result.releases || []).map(release => [release.version, release]));
  if (result.latestVersion && !versions.has(result.latestVersion)) versions.set(result.latestVersion, {
    version: result.latestVersion, asset: result.asset, releaseUrl: result.releaseUrl,
    notes: { [locale]: { text: typeof result.releaseNotes === 'string' ? result.releaseNotes : result.releaseNotes?.[locale] || '' } }
  });
  const summary = node('div', 'update-version-summary');
  const current = node('div', '');
  if (result.currentVersion) current.append(node('span', 'update-dialog-muted', t('当前版本')), node('strong', '', `v${result.currentVersion}`));
  const target = node('label', 'update-version-picker');
  target.append(node('span', 'update-dialog-muted', t('选择版本')));
  const selector = node('select', '');
  selector.setAttribute('aria-label', t('选择版本'));
  for (const release of versions.values()) {
    const suffix = release.version === result.currentVersion ? '当前版本' : release.rollback ? '回退' : release.version === result.latestVersion ? '最新版本' : '';
    const option = node('option', '', `v${release.version}${suffix ? ` · ${t(suffix)}` : ''}`);
    option.value = release.version;
    selector.append(option);
  }
  selector.value = result.latestVersion || '';
  target.append(selector);
  if (result.currentVersion) summary.append(current);
  if (versions.size) summary.append(target);
  if (summary.childElementCount) content.append(summary);
  content.append(node('p', 'update-dialog-muted', t(result.checkFailed ? '暂时无法获取最新版本' : result.updateAvailable
    ? '下载并校验更新后再安装，用户数据会保留。'
    : result.latestVersion ? '当前已是最新版本。' : mac ? '暂无可用的 Mac 发行版。' : '暂无正式发行版。')));
  if (mac) content.append(node('p', 'update-dialog-muted', t('Mac 支持选择 Beta 更新或回退，应用和用户资料分开保存。')));
  if (result.historyIncomplete) content.append(node('p', 'update-dialog-warning', t('部分历史更新说明未能加载，请在发布页查看完整记录。')));
  const warning = node('p', 'update-dialog-warning');
  const notesContainer = node('div', 'update-notes-container');
  notesContainer.setAttribute('aria-live', 'polite');
  content.append(warning, notesContainer);
  function renderSelection() {
    const selected = versions.get(selector.value);
    const installable = Boolean(selected?.asset?.downloadUrl && selected.version !== result.currentVersion);
    installButton.hidden = !versions.size;
    installButton.disabled = busy || !installable;
    installButton.textContent = t(selected?.rollback ? '回退到所选版本' : '安装所选版本');
    warning.hidden = !selected?.rollback && (!selected || installable || selected.version === result.currentVersion);
    warning.textContent = t(selected?.rollback
      ? '旧 Beta 可能不兼容新版数据库或设置。回退前请导出仓库并备份用户数据区。'
      : '此版本没有匹配的更新包，请手动更新或打开发布页。');
    notesContainer.replaceChildren();
    const visibleReleases = mac ? [selected].filter(Boolean) : [...versions.values()].filter(release => {
      const order = [...versions.keys()];
      return order.indexOf(release.version) >= order.indexOf(selector.value);
    });
    for (const release of visibleReleases) {
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
      notesContainer.append(section);
    }
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
    dialog.querySelectorAll('button, select').forEach((element) => { element.disabled = true; });
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
      dialog.querySelectorAll('button, select').forEach((element) => { element.disabled = false; });
      renderSelection();
    }
  }
  footer.append(button('稍后', '', () => dialog.close()));
  if (result.releaseUrl) footer.append(button('打开发布页', '', () => window.archiveApp.openExternal(versions.get(selector.value)?.releaseUrl || result.releaseUrl).catch((failure) => { error.textContent = t(failure.message); })));
  footer.append(button('手动更新', '', () => perform(() => window.archiveApp.installUpdatePackage())));
  const installButton = button('安装所选版本', 'primary', () => perform(() => window.archiveApp.installCheckedUpdate(selector.value)));
  footer.append(installButton);
  selector.addEventListener('change', () => { error.textContent = ''; renderSelection(); });
  renderSelection();
  const progress = node('progress', 'update-download-progress');
  progress.max = 100;
  progress.hidden = true;
  progress.setAttribute('aria-label', t('更新进度'));
  const unsubscribe = window.archiveApp.onUpdateProgress?.((state) => {
    if (!busy || !dialog.open) return;
    progress.hidden = false;
    if (Number(state.percentage) > 0) progress.value = state.percentage;
    else progress.removeAttribute('value');
    error.textContent = t(state.stage === 'verifying' ? '正在校验更新包…' : state.stage === 'prepared' ? '更新包已准备好' : state.stage === 'copying' ? '正在复制更新包…' : state.stage === 'fallback' ? 'GitHub 连接失败，正在尝试 CNB 镜像…' : '正在下载更新…');
  });
  dialog.append(header, content, progress, error, footer);
  document.body.append(dialog);
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  const previousFocus = document.activeElement;
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => { unsubscribe?.(); dialog.remove(); previousFocus?.focus(); resolve(actionResult); }, { once: true });
    dialog.showModal();
    close.focus();
  });
};
