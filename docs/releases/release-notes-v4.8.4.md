# Hamster Archiver 4.8.4

## 中文

本次 Windows 修复版覆盖 4.8.3 → 4.8.4。

### 更新与退出

- 修复 Electron 下载更新时无法处理 GitHub 附件跳转的问题。安装版选择同版本 Setup，便携版选择完整 ZIP。
- GitHub 检查或下载发生网络/HTTP 故障时回退到配置的 CNB 镜像；保持用户确认的目标版本与 SHA-256，校验或地址信任失败不会绕过。
- 更新确认后重新检查归档是否运行；退出继续等待队列、仓库与日志落盘，托盘模式也能正常退出。
- 更新成功提示等待主窗口加载并显示；提示失败时保留记录供下次启动重试。

### 界面与说明

- 修复归档工作台超过 10 个任务时切换页面造成列表折叠的问题，返回即恢复，无需添加新项目。
- 同步中英文 README，重新整理快速开始与功能说明，并更新仓库、归档、详情和相似报告示例。

### 升级说明

- 旧版下载代码不会随服务器发布新版而改变。自动更新失败的用户请手动下载一次 4.8.4：安装版运行 Setup 升级已有安装；便携版使用完整 ZIP，保留原资料与独立备份。
- 安装版卸载默认保留资料；仓库格式兼容，无需迁移或全库重建。本次不更新独立 Mac Beta。

## English

This Windows maintenance release covers 4.8.3 → 4.8.4.

### Updates and shutdown

- Fix Electron failures when update downloads redirect from GitHub release assets. Installed apps select the matching Setup; portable apps select the complete ZIP.
- Network/HTTP failures in GitHub checks or downloads fall back to the configured CNB mirror, retaining the confirmed version and SHA-256. Checksum and URL trust failures are never bypassed.
- Recheck archive activity after confirmation. Shutdown continues to drain queue, Warehouse and log writes, including tray mode.
- Success notices wait for the main window to load and become visible. Failed display leaves the notice available for the next launch.

### Interface and documentation

- Fix Workbench lists collapsing after page switches with more than ten tasks. Returning restores the list without adding a project.
- Synchronize the Chinese and English README, clarify quick start and feature descriptions, and refresh Warehouse, archiving, details and similarity examples.

### Upgrade guidance

- Publishing a new release cannot change old clients' download code. If automatic updating fails, manually download 4.8.4 once: use Setup to upgrade an installed app, or the complete ZIP for a portable app while preserving existing data and an independent backup.
- Uninstalling an installed app preserves data by default. The Warehouse format remains compatible without migration or a full rebuild. The separate Mac Beta is unchanged.
