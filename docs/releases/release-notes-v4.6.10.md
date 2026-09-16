# Hamster Archiver 4.6.10

## 中文

4.6.10 完善 AI 接入可靠性，并集中修复 Windows 安装版、入库安全和工作台布局。

### Windows 安装版

- 新安装未改位置时继续使用默认目录；用户选择父目录后，安装器自动使用其中的 `Hamster Archiver` 子目录。
- 显式统一安装器登记的程序名与实际 `HamsterArchiver.exe`，避免快捷方式或升级入口指向错误文件。安装、卸载、控制面板条目和应用入口统一使用项目图标。
- 卸载时额外清理当前及历史名称的桌面和开始菜单快捷方式，同时继续保留用户数据。

### 入库安全与批量提示

- 批量拖放或粘贴中有多个项目低于当前入库阈值时，界面显示合并提示；运行日志按项目名称逐条记录“低于入库阈值，已跳过”。
- 已配置的压缩包存储位置被删除或不存在时，开始压缩前可选择创建原位置、重新选择或取消。归档引擎不再静默重建缺失的成品目录。

### 工作台界面

- “收纳设置”支持整体收起和展开，默认保持展开；步骤标题与主标题改为顶端对齐。
- 运行日志条目与扫描队列控件左边界统一，短内容页面的页脚贴近窗口底部。
- 顶部“仓库 / 归档工作台”在横向空间仍足够时保持同一行，只在真正窄屏时换到独立行。

### AI 接入

- MCP 后台启动增加分阶段诊断、就绪等待、实例身份校验、`doctor` 自检和软件渲染兼容参数；单实例交接与代理启动失败会返回更准确的原因。
- 新增无副作用的 `intake.plan` 预检、脱敏持久化请求记录、请求指纹幂等保护，以及 JSON 文件、标准输入和独占结果文件接口。
- 后台任务增加连接宽限期、安全退出与托盘入口；队列标记 AI 来源，发行能力清单与双语快速上手说明同步完善。

### 升级与数据

本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。请通过完整便携程序目录或安装程序升级。

## English

Version 4.6.10 improves AI integration reliability and fixes Windows installation, intake safety, and Workbench layout issues.

### Windows installer

- Fresh installs keep the default location when it is unchanged. When a parent folder is selected, the installer automatically uses a `Hamster Archiver` child folder.
- The installer now explicitly matches its registered executable name to the actual `HamsterArchiver.exe`, preventing shortcuts and upgrade entries from targeting the wrong file. Installer, uninstaller, Apps list, and application entry points consistently use the project icon.
- Uninstall removes desktop and Start Menu shortcuts under both current and historical names while continuing to preserve user data.

### Intake safety and batch feedback

- Dragging or pasting multiple items below the current intake threshold now produces one batch message, while the runtime log records each skipped project by name.
- If the configured archive folder was deleted or is missing, the app asks whether to recreate it, choose another folder, or cancel. The archive engine no longer silently recreates a missing output folder.

### Workbench interface

- Archive Setup can be collapsed as a whole and remains expanded by default. Its step label and main heading are top-aligned.
- Runtime log entries align with the queue controls, and the footer stays near the bottom on short pages.
- The Warehouse / Workbench navigation stays on one row while horizontal space is still available and moves to its own row only on genuinely narrow windows.

### AI connection

- MCP background startup gains staged diagnostics, readiness waiting, instance identity validation, `doctor` checks, and software-rendering compatibility flags. Single-instance handoff and proxy-launch failures now report more precise causes.
- Added side-effect-free `intake.plan` checks, redacted persistent request records, request-fingerprint idempotency, and JSON-file, standard-input, and exclusive result-file interfaces.
- Background tasks gain connection grace periods, safe exit behavior, and a tray entry. The queue marks AI-originated work, and release capability metadata and bilingual quick-start guidance are updated.

### Upgrade and data

This release does not change the SQLite warehouse format, user-data locations, or existing records. No migration or rebuild is required. Upgrade through the complete portable application directory or installer.
