# Hamster Archiver 4.8.6-beta.mac.1

## 中文

本 Mac 公开测试版覆盖上一公开 Mac Beta 4.8.5-beta.mac.1 → 4.8.6-beta.mac.1，与 Windows 4.8.6 使用同一来源；不改变 Windows latest。

- 更新缓存核对版本、附件和摘要后复用，重试保留有效下载；验证新应用启动后确认更新，待主窗口就绪再清理恢复文件与已退役更新包。更新提示确认状态持久保存。
- 来源读取失败时停止不压缩入库或目录校对，保留原仓库记录；旧清单不完整时重新读取，重试清除旧读取错误。
- 修复暂停失败和批量取消后的队列唤醒、暂停批次最后一个任务取消后的收尾。CLI/MCP 区分未受理与状态未知；尚未开始且没有成品或恢复证据的准备失败任务可安全取消。
- 移除分卷大小的固定 100 GiB 上限，仍要求不小于 64 MiB 的安全整数字节数；大型分卷默认手动确认。
- 新手引导增加选择入库方式的最后一步，缩略图展示全部标签并换行，提示保留用户原文；来源移动或改名时提供明确指引。提供独立中英文安装与首次启动指南。

提供 DMG、免安装 .app ZIP 及各自 SHA-256。用户资料仍位于 ~/Library/Application Support/Hamster Archiver/，格式兼容，无需迁移。应用仅临时签名、未经 Apple 公证；请先核对摘要，并按安装指南处理 Gatekeeper 首开提示。ZIP 的资料不随应用携带。Mac 不支持自动移入废纸篓及相关恢复；视频抽帧需自行配置 FFmpeg。请先使用小型副本测试并保留独立备份。

## English

This public Mac Beta covers 4.8.5-beta.mac.1 → 4.8.6-beta.mac.1 and uses the same source as Windows 4.8.6. It does not change Windows latest.

- Reuse update caches only after matching their version, asset and digest, retaining valid downloads on retry. Confirm updates after validating the new app's startup, then wait for main-window readiness before cleaning recovery files and obsolete payloads. Persist update-notice acknowledgments.
- Stop inventory-only intake and folder review after source-read failures, preserving existing Warehouse records. Re-read incomplete older manifests and clear previous read errors on retry.
- Fix queue wakeups after failed pauses and batch cancellation, and finish paused batches after their final job is cancelled. CLI/MCP distinguish rejected requests from unknown acceptance; preparation failures can be cancelled safely when no work started and no output or recovery evidence exists.
- Remove the fixed 100 GiB volume ceiling while requiring a safe integer byte value of at least 64 MiB. Large split archives still require manual confirmation by default.
- Add a final onboarding step for selecting the intake mode, show all thumbnail tags with wrapping, and preserve user text in tooltips. Explain how to recover moved or renamed sources and provide separate Chinese and English installation and first-launch guides.

DMG, standalone .app ZIP and their SHA-256 sidecars are provided. User data remains in ~/Library/Application Support/Hamster Archiver/ and stays compatible without migration. The app is ad-hoc signed and is not notarized by Apple; verify the digest and follow the installation guide for Gatekeeper first-launch prompts. ZIP data does not travel with the app. Mac does not support automatic moves to Trash or related restoration; video frame extraction requires separately configured FFmpeg. Test with a small copy first and retain independent backups.
