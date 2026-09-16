# Hamster Archiver 4.6.10

## 中文

本版本汇总公开正式版 4.6.9 → 4.6.10 的变化。

### Windows 安装版

- 新安装未改位置时继续使用默认目录；选择父目录后自动使用其中的 `Hamster Archiver` 子目录。
- 统一安装器登记的程序名与实际 `HamsterArchiver.exe`，修复快捷方式和升级入口可能指向错误文件的问题。安装、卸载、系统应用列表和程序入口统一使用项目图标。
- 卸载时清理当前及历史名称的桌面和开始菜单快捷方式，同时继续保留用户数据。

### 入库安全与工作台

- 批量拖放或粘贴中有多个项目低于当前入库阈值时显示合并提示，运行日志仍按项目名称逐条记录跳过原因。
- 压缩包存储位置不存在时，开始压缩前可创建原位置、重新选择或取消；归档引擎不再静默重建缺失目录。
- “收纳设置”默认展开且可整体折叠；标题、日志边界、短页面页脚及顶部主导航的对齐和响应式换行得到优化。

### AI 接入

- MCP 后台启动增加分阶段诊断、就绪等待、实例身份校验、`doctor` 自检和软件渲染兼容参数；单实例交接与代理启动失败会返回更准确的原因。
- 新增无副作用的 `intake.plan` 预检、脱敏持久化请求记录、请求指纹幂等保护，以及 JSON 文件、标准输入和独占结果文件接口。
- 后台任务增加连接宽限期、安全退出与托盘入口；队列标记 AI 来源，发行能力清单与双语快速上手说明同步完善。

### 升级与数据

本次范围为公开正式版 4.6.9 → 4.6.10。请通过完整便携程序目录或安装程序升级；本次不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.9 to 4.6.10.

### Windows installer

- Fresh installs keep the default location when unchanged. Selecting a parent folder automatically uses a `Hamster Archiver` child folder.
- The registered executable name now matches the actual `HamsterArchiver.exe`, fixing shortcuts and upgrade entries that could target the wrong file. Installer, uninstaller, Apps list, and application entry points consistently use the project icon.
- Uninstall removes desktop and Start Menu shortcuts under current and historical names while continuing to preserve user data.

### Intake safety and Workbench

- Multiple dragged or pasted items below the intake threshold now produce one batch message, while the runtime log records every skipped project by name.
- When the archive folder is missing, the app asks whether to recreate it, choose another folder, or cancel. The archive engine no longer silently recreates the directory.
- Archive Setup remains expanded by default and can be collapsed as a whole. Heading alignment, log boundaries, short-page footer placement, and responsive top-navigation wrapping are improved.

### AI connection

- MCP background startup gains staged diagnostics, readiness waiting, instance identity validation, `doctor` checks, and software-rendering compatibility flags. Single-instance handoff and proxy-launch failures now report more precise causes.
- Added side-effect-free `intake.plan` checks, redacted persistent request records, request-fingerprint idempotency, and JSON-file, standard-input, and exclusive result-file interfaces.
- Background tasks gain connection grace periods, safe exit behavior, and a tray entry. The queue marks AI-originated work, and release capability metadata and bilingual quick-start guidance are updated.

### Upgrade and data

This release covers public stable 4.6.9 → 4.6.10. Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required.
