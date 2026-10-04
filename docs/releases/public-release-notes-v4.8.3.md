# Hamster Archiver 4.8.3

## 中文

本次 Windows 正式版覆盖上一公开 Windows 正式版 4.6.18 → 4.8.3，汇总该范围内已合入的维护与功能更新。4.8.0 与 4.8.1 Windows 正式候选未完成发行；4.8.2 已在私有仓库发行，但尚未公开，本次使用新的不可变版本纳入后续功能。Mac 仍提供独立的 4.8.0-beta.mac.2 测试版 DMG，不属于本次 Windows 正式安装包。

### 归档完整性与源文件安全

- 归档保留源目录中的空目录，并在发布前将包内路径、大小及目录结构与完整源清单比对。扫描不完整或内容不符时停止发布和源文件后处理，保留原件。
- 成品在最终归档位置完成验收；跨盘传输在测试和清单核对通过前保留暂存副本。源移动核对完整路径、大小和空目录，恢复时依据当前内容校对并保留移后副本。
- 未压缩入库和完全重复自动跳过在提交前复核当前源目录。相同来源、路径、大小、数量和目录结构满足既有条件时可在计算 MD5 前跳过；正常重复保护仍按用户设置工作。
- 新配置默认不启用“MD5 计算跳过极小文件”，阈值为 1 KB；已保存的个人设置不会被改写。异常成品或回收站安全审查尚未完成时，取消操作会交由桌面处理并保留待决信息。
- 发布完成日志覆盖同盘链接、同盘复制和跨盘复制，明确区分源文件操作失败与操作完成后状态保存失败。
- 分卷大小支持 64 MiB—100 GiB，默认 10 GiB。只有原始总大小超过所设单卷大小才分卷，关闭分卷后保持整包，不再强制按 10 GiB 拆分。
- “扫描与队列 → 设置 → 卡顿规避”新增默认开启的“大文件分卷压缩，需手动确认”。关闭后解除未启动桌面任务的分卷等待，不自动启动队列，也不放行其他风险；不压缩入库无需分卷确认。

### 队列、校对与仓库

- 队列按固定批次执行；运行中新增的项目留待下一批。可设置 1–3 项并发，并单独暂停或取消任务；资源冲突会按项目边界处理。
- 无法启动时说明当前批次正在运行或哪些项目待人工处理，并突出显示相关队列项，提示确认、继续或取消。
- 批次结束后可分别清理已完成或已取消任务；已完成任务包含重复跳过。只移除队列项，保留仓库记录、压缩包、源文件和持久回执，仍需处理的源文件状态保存失败项继续保留。
- 仓库常见词和 MD5 搜索返回全部匹配项，不再截断于 2000 条。缩略图进度使用轻量更新，减少大型仓库中的界面卡顿。备份位置与星级筛选采用统一菜单。
- 列表“大小”列显示未压缩项目的原始大小，压缩项目继续显示归档成品大小。
- 未压缩目录支持单项或批量校对。新增文件可按选择并入；修改、删除或证据不足时先让用户确认。导入只选择新增记录并保护已有引用图片；导出先验证目标同盘临时 ZIP，再替换目标，失败时保留旧备份。
- 目录校对提交后提示到归档工作台查看；完成时区分未变化与仓库已更新，人工处理、失败和取消也有对应反馈。
- 相似报告同时呈现尚未入库的队列候选和仓库候选，按来源分区并提供双方位置入口。仅有队列匹配时复用已有摘要，不扫描目录或补算 MD5；混合结果先显示摘要，再加载仓库文件级报告。仅改变检查时间、源文件处理状态或相似关系时，不重建无关索引。

### CLI、MCP 与任务恢复

- Windows 发行包可直接使用 v2 `hamster` CLI 与 MCP 任务接口。请求回执说明项目范围、重复处理、结果及下一步；执行设置在受理时固定，包括分卷确认设置，终态结果可在队列清理后按仓库身份查询。
- 请求发送前保存恢复身份；连接结果不确定时可查询或继续原任务，避免重复提交。`task wait --timeout 0` 立即返回当前回执但不取消后台任务；非法等待值会明确报错。
- 相似报告和重复决定准确区分跳过、取消与复用，并保留持久回执。重复项选择可在队列移除后幂等重放；取消遇到源处置或回收站安全待决时会安全交由桌面处理。
- 压缩位置可在执行时选择，并同步到设置；CLI/MCP 缺少必要位置时返回结构化提示。v2 来源变化支持分页差异、覆盖、另建或业务跳过，并使过期证据失效。

### 启动、设置与数据

- 启动窗口在归档运行模块加载前显示，提前提供反馈，再继续载入资料和主窗口。
- 新手引导简化为五步，提供语言选择，统一焦点、Esc、跳过和快捷键行为，并说明默认 100 MB 小项目过滤。仓库启动时后台分批加载并显示进度，完整就绪后才开放相关操作。
- 用户数据位置切换在应用正常退出后执行迁移，并通过独立重启验收核对身份、实际路径、设置、数据库与窗口；失败时保留两边资料并安全回退。
- 仓库格式和现有用户资料保持兼容，无需迁移或全库重建。请使用完整便携程序目录或 Windows 安装程序升级，并继续保留独立备份。

## English

This Windows stable release covers public Windows stable 4.6.18 → 4.8.3 and consolidates merged maintenance and product changes in that range. The 4.8.0 and 4.8.1 Windows stable candidates were not completed as releases. Version 4.8.2 was released privately but not publicly; this new immutable version includes the subsequent features. Mac remains on the separate 4.8.0-beta.mac.2 test DMG, outside this Windows package.

### Archive integrity and source safety

- Archives preserve empty source folders and compare packaged paths, sizes, and directory structure with the complete source manifest before publication. An incomplete scan or mismatch stops publication and source handling, leaving originals available.
- Final archive verification runs at the destination. Cross-drive staging remains available until tests and manifest checks pass. Source moves check full paths, sizes, and empty folders; restoration checks current contents and preserves the moved copy.
- Inventory-only intake and exact-duplicate auto-skip recheck the current source before commit. Existing conditions for the same source, paths, sizes, counts, and folder structure can skip MD5 calculation; duplicate safeguards continue to follow user settings.
- “Skip Tiny Files for MD5” is off for new configurations, with a 1 KB threshold. Saved preferences remain unchanged. If an archive anomaly or Recycle Bin safety review is pending, cancellation is handed to the desktop with pending evidence retained.
- Completion logs cover same-drive linking, same-drive copying and cross-drive copying, and distinguish failed source handling from a completed operation whose status could not be saved.
- Split volumes support 64 MiB–100 GiB, defaulting to 10 GiB. Splitting applies only when source bytes exceed the configured volume size; disabling splitting keeps archives whole and removes the fixed 10 GiB override.
- Scan & Queue → Settings → Performance adds “Require Confirmation for Large Split Archives”, enabled by default. Turning it off releases volume-only waits for pending desktop jobs without starting the queue or approving other risks. Inventory-only intake needs no volume confirmation.

### Queue, review, and Warehouse

- Work runs in fixed batches; projects added during a run wait for the next batch. Choose concurrency from one to three jobs and pause or cancel each task independently. Resource conflicts are handled within project boundaries.
- Blocked starts explain active processing or pending manual action, highlight relevant queue items, and guide users to confirm, continue or cancel.
- After the batch ends, clear completed or cancelled tasks separately; completed tasks include duplicate skips. This removes queue entries while preserving Warehouse records, archives, originals and durable receipts. Items with unresolved source-status save failures remain available for handling.
- Warehouse search returns every match for common terms and MD5 values instead of stopping at 2,000. Thumbnail progress uses lightweight updates to reduce interface stalls in large Warehouses. Backup-location and rating filters use a consistent menu.
- The list Size column shows original size for uncompressed items and archive size for compressed items.
- Uncompressed folders support individual and batch review. New files can be merged according to the selected action; modifications, deletions, or incomplete evidence require review. Imports select only new records and protect existing referenced images. Exports validate a same-drive temporary ZIP before replacement, preserving the previous backup on failure.
- Submitted folder reviews point users to the Archive Workbench. Completion notices distinguish unchanged folders from updated Warehouse records; manual action, failure and cancellation also receive specific feedback.
- Similarity reports show pending queue candidates and Warehouse candidates in separate sections and provide location-opening actions for both sides. Queue-only matches reuse existing summaries without scanning or calculating MD5; mixed results show summaries before detailed catalog comparisons. Changes limited to review time, source disposition, or similarity relationships no longer rebuild unrelated indexes.

### CLI, MCP, and task recovery

- The Windows package supports the v2 `hamster` CLI and MCP task interface. Receipts describe project scope, duplicate handling, results, and next steps; execution settings, including split-archive confirmation, are frozen on acceptance, and terminal results remain queryable by Warehouse identity after queue cleanup.
- Recovery identity is saved before sending a request. An uncertain connection can be resolved against the original task to avoid duplicate submission. `task wait --timeout 0` returns the current receipt immediately without canceling background work; invalid wait values return clear errors.
- Similarity reports and duplicate decisions distinguish skip, cancellation, and reuse while retaining durable receipts. Duplicate choices can be replayed idempotently after queue removal. Cancellation with pending source-handling or Recycle Bin safety decisions is handed to the desktop safely.
- Archive locations can be selected at execution and update the settings field; CLI/MCP return structured guidance when a required location is missing. V2 source changes support paginated differences, overwrite, independent creation or business skip, and invalidate stale evidence.

### Startup, settings, and data

- The startup window appears before archive runtime modules load, providing earlier feedback before data and the main window finish loading.
- Onboarding now uses five steps with a language choice, aligns focus, Escape, skipping and keyboard shortcuts, and documents the default 100 MB small-project filter. The Warehouse loads in background batches with progress and enables related operations after data is ready.
- User-data location changes run after normal application exit and are checked through a separate restart. The check verifies migration identity, actual paths, settings, database and window; failure preserves both locations and rolls back safely.
- The Warehouse format and existing user data remain compatible; no migration or full rebuild is needed. Upgrade using the complete portable application directory or the Windows installer, and keep an independent backup.
