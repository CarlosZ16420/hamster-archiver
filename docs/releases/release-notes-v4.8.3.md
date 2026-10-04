# Hamster Archiver 4.8.3

## 中文

本修订版纳入私有主线已合入的队列、界面和分卷设置更新。4.8.2 私有发行和历史标签保持不变；公开 Windows 正式版使用 4.8.3，完整升级说明累积覆盖 4.6.18 → 4.8.3。

### 队列与使用体验

- 启动受阻时说明正在运行或待人工处理的原因，并突出显示相关队列项。目录校对反馈区分未变化、已更新、人工处理、失败和取消。
- 已完成任务清理包含重复跳过，并保留持久回执、仓库记录、压缩包和源文件；源文件状态保存失败且仍需处理的项目继续保留。
- 首次使用引导简化为五步；仓库备份位置与星级筛选采用统一菜单，压缩位置选择后同步到设置。
- 列表“大小”列显示未压缩项目的原始大小，压缩项目继续显示成品大小。
- 启动窗口在归档运行模块加载前显示，提前提供启动反馈。

### 分卷设置

- 分卷大小支持 64 MiB—100 GiB，默认 10 GiB；只有原始总大小超过所设单卷大小才分卷，关闭分卷后保持整包。
- “大文件分卷压缩，需手动确认”默认开启；关闭后解除未启动桌面任务的分卷等待，不自动启动队列，不放行其他风险。不压缩入库无需分卷确认。
- 已受理的 CLI/MCP 请求保留提交时设置。仓库格式和用户资料保持兼容，无需迁移；Mac Beta 本次不更新。

## English

This revision includes queue, interface and split-archive updates already merged into private main. The private 4.8.2 release and historical tags remain unchanged. Public Windows stable uses 4.8.3, with cumulative upgrade notes covering 4.6.18 → 4.8.3.

### Queue and usability

- Blocked starts explain active processing or pending manual action and highlight relevant queue items. Folder review distinguishes unchanged, updated, manual-action, failed and cancelled results.
- Completed-task cleanup includes duplicate skips while preserving durable receipts, Warehouse records, archives and originals. Items with unresolved source-status save failures remain available for handling.
- Onboarding now uses five steps. Backup-location and rating filters share a consistent menu, and archive-folder selection updates the settings field.
- The list Size column shows original size for uncompressed items and archive size for compressed items.
- The startup window appears before archive runtime modules load, providing earlier startup feedback.

### Split archives

- Volume sizes support 64 MiB–100 GiB, defaulting to 10 GiB. Splitting applies only when source bytes exceed the configured volume size; disabling splitting keeps archives whole.
- “Require Confirmation for Large Split Archives” is enabled by default. Turning it off releases volume-only waits for pending desktop jobs without starting the queue or approving other risks. Inventory-only intake needs no volume confirmation.
- Accepted CLI/MCP requests retain their submitted settings. The Warehouse format and user data remain compatible without migration. Mac Beta is unchanged in this release.
