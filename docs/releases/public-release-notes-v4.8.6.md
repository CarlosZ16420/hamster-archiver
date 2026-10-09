# Hamster Archiver 4.8.6

## 中文

本次 Windows 正式修订版覆盖上一公开正式版 4.8.5 → 4.8.6。

### 启动与更新

- 修复部分 Windows 环境中发行包因沙箱访问权限不足而无法启动的问题，保留渲染沙箱；补充运行时读取权限时保持其他账户已有权限。
- 更新下载缓存按版本、附件及摘要核对后复用；失败重试保留有效下载，启动确认后清理已退役的更新包。更新成功提示的确认状态持久保存，避免重复提醒。

### 入库、队列与自动化

- 不压缩入库和目录校对遇到无法读取的文件或目录时停止，保留原仓库记录；旧记录的清单不完整时重新读取，重试清除之前的读取错误。
- 修复暂停失败、批量取消后队列未及时唤醒，以及暂停批次最后一个任务取消后无法收尾的问题。
- CLI/MCP 明确区分未受理请求与受理状态未知，未受理请求不再给出误导性的恢复操作。准备失败且尚未开始、没有成品或恢复证据的任务可以安全取消；需要安全复核的任务仍要求桌面处理。
- 移除单卷大小的固定 100 GiB 上限，保留不小于 64 MiB 的安全整数字节限制。大型分卷仍默认需要手动确认，仅在源总大小超过设置阈值时分卷。

### 引导与显示

- 新手引导增加独立的最后一步，说明如何选择“不压缩入库”或“压缩入库”开始处理。
- 仓库缩略图在备份位置下方展示全部标签并自动换行；备份位置与标签提示保留用户原文。来源文件夹移动或改名时，校对提示指出项目并说明如何重新指定来源。
- 同步中英文 README，并补齐独立的 Mac 安装与首次启动说明。

### 升级与数据

用户资料位置及仓库格式保持兼容，无需迁移或全库重建。Windows 提供 ZIP、7z、Setup EXE 及各自 SHA-256；Mac 通过同来源的独立 Beta 提供。

## English

This Windows patch release covers the previous public stable release, 4.8.5 → 4.8.6.

### Startup and updates

- Fix packaged startup failures caused by sandbox access permissions in some Windows environments while retaining the renderer sandbox; adding runtime read access preserves other accounts' existing permissions.
- Reuse update downloads only after matching their version, asset and digest. Retries retain valid downloads, and confirmed startup retires obsolete update payloads. Persist update-notice acknowledgments to avoid repeated notifications.

### Intake, queues and automation

- Stop inventory-only intake and folder review when a source file or folder cannot be read, preserving existing Warehouse records. Re-read incomplete older manifests and clear previous read errors on retry.
- Fix scheduler wakeups after failed pauses and batch cancellation, including completing a paused batch when its last job is cancelled.
- CLI/MCP distinguish requests that were not accepted from requests with unknown acceptance. Rejected requests no longer suggest misleading recovery actions. Preparation failures can be cancelled safely when no work started and no output or recovery evidence exists; safety-review cases still require desktop review.
- Remove the fixed 100 GiB volume-size ceiling while requiring a safe integer byte value of at least 64 MiB. Large split archives still require manual confirmation by default, and splitting occurs only when the source total exceeds the configured threshold.

### Onboarding and presentation

- Add a separate final onboarding step explaining how to start with inventory-only or compressed intake.
- Show all thumbnail tags below the backup location with wrapping. Backup-location and tag tooltips preserve user text. Folder-review messages identify missing or renamed sources and explain how to select their new location.
- Synchronize the Chinese and English README and add separate Mac installation and first-launch guides.

### Upgrade and data

User-data locations and the Warehouse format remain compatible without migration or a full rebuild. Windows offers ZIP, 7z, Setup EXE and their SHA-256 sidecars; Mac is delivered as a separate Beta from the same source.
