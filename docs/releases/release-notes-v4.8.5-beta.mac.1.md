# Hamster Archiver 4.8.5-beta.mac.1

## 中文

这是 Mac 公开测试版，覆盖上一公开 Mac Beta `4.8.0-beta.mac.2` 以来的共享改进；当前 Windows 正式版规范基线为 4.8.4，Mac 测试版不改变 Windows latest。

### 共享归档、队列与仓库改进

- 归档会保留源目录中的空目录，并在发布前将包内路径、大小和目录结构与完整源清单比对；最终归档位置也会验收。跨盘暂存保留到检查通过，源文件移动和恢复会复核完整路径、大小及空目录。
- 不压缩入库和完全重复自动跳过会在提交前复查当前源目录。仅当来源位置、完整路径、大小、数量和目录结构符合既有条件时，才可在计算 MD5 前跳过；其他重复判断仍按用户设置执行。新配置默认不启用“MD5 计算跳过极小文件”，默认阈值为 1 KB，已有设置保持不变。
- 队列按固定批次执行，运行中加入的项目留待下一批；支持 1—3 项并发以及逐项暂停和取消。受阻启动说明原因，目录校对区分未变化、已更新、需人工处理、失败和取消；完成任务清理保留回执与仍待处理的源状态问题。
- 分卷大小支持 64 MiB—100 GiB，默认 10 GiB；仅当原始总大小超过设置的单卷阈值时才分卷。“大文件分卷压缩，需手动确认”默认开启；关闭后只解除桌面任务的分卷等待，不会自动启动队列或确认其他风险。不压缩入库无需分卷确认。
- 仓库搜索对常见词和 MD5 返回全部匹配，不再止于 2,000 条；含 5,000 条以上记录的仓库也可检索特定项目。未压缩目录支持单项和批量校对：新增文件可按选择并入，修改、删除或证据不足时要求确认。相似报告可先显示队列摘要，再按需读取仓库文件细节。
- 导入只选择新增记录并保护已有引用图片；导出先校验同盘临时 ZIP，再替换目标，失败时保留旧备份。仓库资料位置切换通过正常退出、独立迁移和重启检查核对路径、设置、数据库与窗口，失败时保留两边资料并回退。
- 重复处理会区分跳过、取消和复用；选择与队列移除后仍可通过持久回执查询或幂等重放。新手引导说明默认 100 MB 小项目过滤；已保存的重复与 MD5 偏好不会因升级而被重置。
- 五步首次使用引导说明小项目过滤；仓库备份位置与星级筛选使用统一菜单，压缩位置选择会同步到设置。列表大小列对未压缩项目显示原始大小，对已压缩项目显示成品大小。
- 工作台在隐藏页面切换时超过十项列表折叠的问题已修复；队列标题保持横向布局，普通大小文字恢复易读显示。
- CLI/MCP v2 提供结构化任务回执、同身份恢复和分页来源变化处理；`task wait --timeout 0` 返回当前回执但不取消后台任务，非法等待值明确报错。
- Windows 专属 7z/ZIP 附件选择、安装器、CNB 回退和 README 页面维护不属于 Mac 功能；4.8.4 Windows 下载修复不改变 Mac 发布通道。

### Mac 更新与安装

- 应用可静默检查公开 Mac Beta。用户选择版本并确认重启后才安装；安装前检查下载包，先用隔离资料验证启动，再替换 `.app`。原应用及用户资料保留。
- 更新窗口展示版本说明、下载进度与回退提示。在线回退到旧 Beta 需要明确确认数据格式风险；更新程序不会自动回退数据库或设置。
- 手动更新可选择目标版本 DMG 或免安装 `.app` ZIP；选择的版本必须高于当前版本，并与同目录同名 `.sha256` 旁车中的发行版本和摘要一致，旁车文件名也须匹配。旧 Mac Beta `4.8.0-beta.mac.2` 不含应用内更新器，首次升级仍需手动安装。

### 测试范围与限制

- 请用户参与测试，先使用小型副本验证扫描、归档、更新和恢复流程，并保留原始文件、导出的仓库和独立用户资料备份。
- 本 Beta 仅临时签名、未经 Apple 公证；首次打开可能需要在系统设置中允许。请先核对下载包的 SHA-256，再按 Gatekeeper 提示操作。
- 用户资料默认位于 `~/Library/Application Support/Hamster Archiver/`，替换应用不会迁移或删除资料。ZIP 中的 `.app` 可直接运行，但资料仍位于用户目录，不随应用携带。
- Mac 不支持自动移入废纸篓及相关恢复；视频抽帧需单独配置 FFmpeg。测试反馈和实际运行结果决定是否继续完善 Mac 功能。

## English

This public Mac test release covers shared improvements since the previous public Mac Beta, `4.8.0-beta.mac.2`. The current Windows stable specification baseline is 4.8.4; this Mac Beta does not change Windows latest.

### Shared archiving, queue, and Warehouse improvements

- Archives preserve empty source folders and compare packaged paths, sizes, and structure with the complete source manifest before publication; final-location verification also runs. Cross-drive staging remains until checks pass, and source moves and restores recheck full paths, sizes, and empty folders.
- Inventory-only intake and exact-duplicate auto-skip recheck the current source before commit. MD5 may be skipped only when the source location, complete paths, sizes, counts, and folder structure meet the existing conditions; other duplicate checks continue to follow user settings. New configurations leave “Skip Tiny Files for MD5” off with a 1 KB threshold, while saved preferences remain unchanged.
- Work runs in fixed batches, with new items waiting for the next batch, one to three concurrent jobs, and per-job pause and cancellation. Blocked starts explain why; folder review distinguishes unchanged, updated, manual-action, failed, and cancelled results. Completed-task cleanup retains receipts and unresolved source-status work.
- Split volumes support 64 MiB–100 GiB and default to 10 GiB. Splitting occurs only when the original total exceeds the configured per-volume threshold. “Require Confirmation for Large Split Archives” is enabled by default; turning it off releases only split-confirmation waits for desktop jobs, without starting the queue or approving other risks. Inventory-only intake needs no split confirmation.
- Warehouse search returns every match for common terms and MD5 values instead of stopping at 2,000; catalogs with more than 5,000 records can still find a specific item. Uncompressed folders support individual and batch review: additions follow the selected action, while modifications, deletions, or incomplete evidence require review. Similarity reports can show queue summaries before loading Warehouse file details.
- Imports select only new records and protect existing referenced images. Exports validate a same-drive temporary ZIP before replacement, preserving the old backup on failure. Data-area changes use normal shutdown, a separate migration, and restart checks for paths, settings, database, and window; failures preserve both locations and roll back safely.
- Duplicate handling distinguishes skip, cancellation, and reuse; durable receipts remain available for queries or idempotent replay after queue removal. Onboarding documents the default 100 MB small-project filter; upgrades preserve saved duplicate and MD5 preferences.
- Five-step onboarding explains the small-project filter. Backup-location and rating filters share a menu, and archive-folder selection updates the setting. The list Size column shows original size for uncompressed items and archive size for compressed items.
- Fix the Workbench list collapsing after page switches when more than ten tasks are present; keep the queue heading horizontal and ordinary size text readable.
- CLI/MCP v2 provides structured task receipts, same-identity recovery, and paginated source-change handling. `task wait --timeout 0` returns the current receipt without canceling background work; invalid wait values return clear errors.
- Windows-only 7z/ZIP asset selection, installers, CNB fallback, and README-page maintenance are not Mac features. Windows update-download repairs in 4.8.4 do not change the Mac release channel.

### Mac updates and installation

- The app can silently check for public Mac Betas. Installation starts only after the user selects a version and confirms restart. The download is checked, its app is tested with an isolated profile, and only then does it replace the `.app`; the previous app and user data are retained.
- The update dialog shows release notes, download progress, and rollback guidance. Rolling back online to an older Beta requires explicit confirmation of data-format risks; the updater does not roll back databases or settings automatically.
- Manual updates accept a DMG or standalone `.app` ZIP for the target version. The selected version must be newer than the installed version and match the release version and digest in its same-directory, same-name `.sha256` sidecar; the sidecar filename must also match. The older Mac Beta `4.8.0-beta.mac.2` has no in-app updater, so its first upgrade still requires manual installation.

### Testing and limits

- Please participate in testing. Start with a small copy when checking scanning, archiving, updates, and recovery, and retain originals, an exported Warehouse, and a separate user-data backup.
- This Beta has an ad-hoc signature and is not notarized by Apple. macOS may require permission on first launch. Verify the download's SHA-256 before following Gatekeeper's prompts.
- User data defaults to `~/Library/Application Support/Hamster Archiver/`; replacing the app does not move or delete it. The ZIP contains a runnable `.app`, but data remains in the user directory and is not carried with the app.
- Mac does not support automatic moves to Trash or related restoration. Video frame extraction requires separately configured FFmpeg. Further Mac work depends on testing feedback and actual results.
