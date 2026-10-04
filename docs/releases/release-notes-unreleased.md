# 未发行维护 / Unreleased maintenance

- 相似报告同时列出队列与仓库候选；队列项目注明尚未入库，并提供当前项目与候选的位置打开入口。仅队列匹配无需扫描或补算 MD5，混合匹配先显示摘要再加载仓库详细报告。
- Similarity reports list queue and catalog candidates together. Queue projects are marked as not yet added to the catalog, with location-opening actions for the current project and each candidate. Queue-only matches require no scans or MD5 calculation; mixed matches show summaries before detailed catalog comparisons.

- “MD5计算跳过极小文件”改为新配置默认关闭，默认阈值为 1 KB；初始界面同步为未勾选，已有保存设置保留。
- 重复决策提示只声明实际可选动作；内容指纹缺失时说明原因，不会仅凭同名提供复用。有可信匹配时列出已有记录的 ID、压缩状态和匹配依据。
- 明确授权复用保留已有记录的压缩状态，不虚报本次新建未压缩记录。重复决策选择跳过计入 skipped，真正取消计入 cancelled；队列项移除后仍保留持久回执和同选择重放。
- 恢复原有同源元数据快捷跳过：原始位置、完整文件路径、精确字节大小、数量和目录结构均一致时，在 MD5 计算前按设置跳过；撤回本轮新增的同源内容强制核验与复核限制。
- 成品发布完成日志补齐同盘链接、同盘复制和跨盘复制的中英文翻译。
- 异常成品或回收站安全核验待决时，取消操作明确拒绝并引导桌面处理，不再静默返回成功；待决证据与任务授权保留。
- 此项是未升版的本地维护，尚未公开发行。已有数据保持兼容，无需迁移。

- "Skip Tiny Files for MD5" is now off for new configurations, with a default threshold of 1 KB. The initial checkbox is unchecked; existing saved settings are preserved.
- Duplicate questions describe only available actions and explain missing content evidence. Names alone do not enable reuse. Trusted matches identify the existing record, its compression state, and the matching evidence.
- Explicit reuse preserves the existing record's compression state and does not claim a new uncompressed record. Duplicate skip counts as skipped; cancellation counts as cancelled. Durable receipts and decision replay survive queue removal.
- Restore the original same-source metadata shortcut: matching source location, complete file paths, exact byte sizes, counts and directory structure can skip before MD5 under existing settings. Withdraw this round's additional same-source content checks and review restrictions.
- Archive-publication logs now translate same-drive linking, same-drive copying and cross-drive copying.
- Cancellation explicitly requires desktop review for archive anomalies and trash-safety decisions. It preserves pending evidence and authorization rather than silently returning success.
- These changes are local maintenance without a version bump or public release. Existing data remains compatible and needs no migration.

## 分卷设置 / Split archive settings

- 分卷大小支持 64 MiB—100 GiB，默认 10 GiB。原始总大小未超过单卷大小时保持整包；关闭分卷后不再强制按 10 GiB 拆分。
- “扫描与队列 → 设置 → 卡顿规避”新增默认勾选的“大文件分卷压缩，需手动确认”。关闭后自动按所设大小分卷，并解除已有未启动桌面任务的分卷等待；不自动启动队列，其他风险确认保留。不压缩入库无需分卷确认。
- 已接受的 CLI/MCP 请求保留提交时设置，重启恢复保持兼容。仓库格式与用户资料不变。

- Split volumes support 64 MiB–100 GiB, defaulting to 10 GiB. Sources at or below the configured threshold remain whole; disabling splitting removes the former fixed 10 GiB override.
- Scan & Queue → Settings → Performance adds “Require Confirmation for Large Split Archives”, enabled by default. Turning it off splits automatically and releases volume-only waits for pending desktop jobs, without starting the queue or approving other risks. Inventory-only intake needs no volume confirmation.
- Accepted CLI/MCP requests retain their submitted settings, and restart recovery remains compatible. Warehouse format and user data are unchanged.
