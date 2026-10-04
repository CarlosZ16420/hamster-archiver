# Hamster Archiver 4.8.1

## 中文

本次 Windows 正式版覆盖上一公开 Windows 正式版 4.6.18 → 4.8.1，汇总该范围内已合入的维护与功能更新。4.8.0 Windows 正式候选未完成发行，没有正式附件或公开 Release；这些累积改进由本次 4.8.1 交付。Mac 仍提供独立的 4.8.0-beta.mac.2 测试版 DMG，不属于本次 Windows 正式安装包。

### 归档完整性与源文件安全

- 归档保留源目录中的空目录，并在发布前将包内路径、大小及目录结构与完整源清单比对。扫描不完整或内容不符时停止发布和源文件后处理，保留原件。
- 成品在最终归档位置完成验收；跨盘传输在测试和清单核对通过前保留暂存副本。源移动核对完整路径、大小和空目录，恢复时依据当前内容校对并保留移后副本。
- 未压缩入库和完全重复自动跳过在提交前复核当前源目录。相同来源、路径、大小、数量和目录结构满足既有条件时可在计算 MD5 前跳过；正常重复保护仍按用户设置工作。
- 新配置默认不启用“MD5 计算跳过极小文件”，阈值为 1 KB；已保存的个人设置不会被改写。异常成品或回收站安全审查尚未完成时，取消操作会交由桌面处理并保留待决信息。
- 发布完成日志覆盖同盘链接、同盘复制和跨盘复制，明确区分源文件操作失败与操作完成后状态保存失败。

### 队列、校对与仓库

- 队列按固定批次执行；运行中新增的项目留待下一批。可设置 1–3 项并发，并单独暂停或取消任务；资源冲突会按项目边界处理。
- 仓库常见词和 MD5 搜索返回全部匹配项，不再截断于 2000 条。缩略图进度使用轻量更新，减少大型仓库中的界面卡顿。
- 未压缩目录支持单项或批量校对。新增文件可按选择并入；修改、删除或证据不足时先让用户确认。导入只选择新增记录并保护已有引用图片；导出先验证目标同盘临时 ZIP，再替换目标，失败时保留旧备份。
- 相似报告同时呈现尚未入库的队列候选和仓库候选，并注明队列项目状态、提供双方位置入口。仅有队列匹配时复用已有摘要，不扫描目录或补算 MD5；混合结果先显示摘要，再加载仓库文件级报告。仅改变检查时间、源文件处理状态或相似关系时，不重建无关索引。

### CLI、MCP 与任务恢复

- Windows 发行包可直接使用 v2 `hamster` CLI 与 MCP 任务接口。请求回执说明项目范围、重复处理、结果及下一步；执行设置在受理时固定，终态结果可在队列清理后按仓库身份查询。
- 请求发送前保存恢复身份；连接结果不确定时可查询或继续原任务，避免重复提交。`task wait --timeout 0` 立即返回当前回执但不取消后台任务；非法等待值会明确报错。
- 相似报告和重复决定准确区分跳过、取消与复用，并保留持久回执。重复项选择可在队列移除后幂等重放；取消遇到源处置或回收站安全待决时会安全交由桌面处理。
- 压缩位置可在执行时选择；CLI/MCP 缺少必要位置时返回结构化提示。v2 来源变化支持分页差异、覆盖、另建或业务跳过，并使过期证据失效。

### 启动、设置与数据

- 新手引导统一焦点、Esc、跳过和快捷键行为，并说明默认 100 MB 小项目过滤。仓库启动时后台分批加载并显示进度，完整就绪后才开放相关操作。
- 用户数据位置切换在应用正常退出后执行迁移，并通过独立重启验收核对身份、实际路径、设置、数据库与窗口；失败时保留两边资料并安全回退。
- 仓库格式和现有用户资料保持兼容，无需迁移或全库重建。请使用完整便携程序目录或 Windows 安装程序升级，并继续保留独立备份。

## English

This Windows stable release covers public Windows stable 4.6.18 → 4.8.1 and consolidates merged maintenance and product changes in that range. The 4.8.0 Windows stable candidate was not completed as a release and has no formal assets or public Release; 4.8.1 delivers these accumulated changes. Mac remains on the separate 4.8.0-beta.mac.2 test DMG, outside this Windows package.

### Archive integrity and source safety

- Archives preserve empty source folders and compare packaged paths, sizes, and directory structure with the complete source manifest before publication. An incomplete scan or mismatch stops publication and source handling, leaving originals available.
- Final archive verification runs at the destination. Cross-drive staging remains available until tests and manifest checks pass. Source moves check full paths, sizes, and empty folders; restoration checks current contents and preserves the moved copy.
- Inventory-only intake and exact-duplicate auto-skip recheck the current source before commit. Existing conditions for the same source, paths, sizes, counts, and folder structure can skip MD5 calculation; duplicate safeguards continue to follow user settings.
- “Skip Tiny Files for MD5” is off for new configurations, with a 1 KB threshold. Saved preferences remain unchanged. If an archive anomaly or Recycle Bin safety review is pending, cancellation is handed to the desktop with pending evidence retained.
- Completion logs cover same-drive linking, same-drive copying and cross-drive copying, and distinguish failed source handling from a completed operation whose status could not be saved.

### Queue, review, and Warehouse

- Work runs in fixed batches; projects added during a run wait for the next batch. Choose concurrency from one to three jobs and pause or cancel each task independently. Resource conflicts are handled within project boundaries.
- Warehouse search returns every match for common terms and MD5 values instead of stopping at 2,000. Thumbnail progress uses lightweight updates to reduce interface stalls in large Warehouses.
- Uncompressed folders support individual and batch review. New files can be merged according to the selected action; modifications, deletions, or incomplete evidence require review. Imports select only new records and protect existing referenced images. Exports validate a same-drive temporary ZIP before replacement, preserving the previous backup on failure.
- Similarity reports show pending queue candidates and Warehouse candidates, identify pending-catalog status, and provide location-opening actions for both sides. Queue-only matches reuse existing summaries without scanning or calculating MD5; mixed results show summaries before detailed catalog comparisons. Changes limited to review time, source disposition, or similarity relationships no longer rebuild unrelated indexes.

### CLI, MCP, and task recovery

- The Windows package supports the v2 `hamster` CLI and MCP task interface. Receipts describe project scope, duplicate handling, results, and next steps; execution settings are frozen on acceptance, and terminal results remain queryable by Warehouse identity after queue cleanup.
- Recovery identity is saved before sending a request. An uncertain connection can be resolved against the original task to avoid duplicate submission. `task wait --timeout 0` returns the current receipt immediately without canceling background work; invalid wait values return clear errors.
- Similarity reports and duplicate decisions distinguish skip, cancellation, and reuse while retaining durable receipts. Duplicate choices can be replayed idempotently after queue removal. Cancellation with pending source-handling or Recycle Bin safety decisions is handed to the desktop safely.
- Archive locations can be selected at execution; CLI/MCP return structured guidance when a required location is missing. V2 source changes support paginated differences, overwrite, independent creation or business skip, and invalidate stale evidence.

### Startup, settings, and data

- Onboarding aligns focus, Escape, skipping and keyboard shortcuts, and documents the default 100 MB small-project filter. The Warehouse loads in background batches with progress and enables related operations after data is ready.
- User-data location changes run after normal application exit and are checked through a separate restart. The check verifies migration identity, actual paths, settings, database and window; failure preserves both locations and rolls back safely.
- The Warehouse format and existing user data remain compatible; no migration or full rebuild is needed. Upgrade using the complete portable application directory or the Windows installer, and keep an independent backup.
