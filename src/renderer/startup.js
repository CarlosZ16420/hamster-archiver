'use strict';

const params = new URLSearchParams(location.search);
const english = params.get('language') === 'en-US';
const themeAliases = { celadon: 'forest', plum: 'twilight' };
const themeValues = ['classic', 'day', 'night', 'forest', 'twilight'];
let savedTheme = '';
try {
  const storedTheme = localStorage.getItem('hamster-theme');
  savedTheme = themeAliases[storedTheme] || storedTheme;
} catch { /* Use the safe default when storage is unavailable. */ }
const theme = themeValues.includes(savedTheme) ? savedTheme : (params.get('theme') || 'day');
const statusElement = document.querySelector('#startup-status');
const detailElement = document.querySelector('#startup-detail');
const progressElement = document.querySelector('#startup-progress');
const progressFill = progressElement.querySelector('span');
const closeButton = document.querySelector('#startup-close');

document.documentElement.lang = english ? 'en-US' : 'zh-CN';
document.body.dataset.theme = theme;
closeButton.textContent = english ? 'Close' : '关闭';
closeButton.addEventListener('click', () => window.close());

const messages = {
  'verify-cache': english ? 'Checking application files…' : '正在检查程序文件…',
  'verify-files': english ? 'Verifying application integrity…' : '正在验证程序完整性…',
  'load-data': english ? 'Loading your warehouse…' : '正在加载仓库…',
  'error': english ? 'Hamster Archiver could not start' : 'Hamster Archiver 无法启动'
};

window.setStartupStatus = (stage, detail = '', percentage = null) => {
  statusElement.textContent = messages[stage] || messages['verify-cache'];
  detailElement.textContent = detail;
  const showsProgress = stage === 'verify-files' && Number.isFinite(percentage);
  progressElement.hidden = !showsProgress;
  if (showsProgress) progressFill.style.width = `${Math.max(0, Math.min(100, percentage))}%`;
  const failed = stage === 'error';
  document.body.dataset.state = failed ? 'error' : 'working';
  closeButton.hidden = !failed;
  if (failed && !detail) {
    detailElement.textContent = english
      ? 'Reinstall or restore the application files, then try again.'
      : '请重新安装或恢复程序文件后再试。';
  }
};
