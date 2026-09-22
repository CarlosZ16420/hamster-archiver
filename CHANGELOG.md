# Changelog

## 4.6.18

# Hamster Archiver 4.6.18

## 中文

本次覆盖公开正式版 4.6.17 → 4.6.18，包含这一范围内已经合入的产品更新。

### 校对更新与详情

- 未压缩目录的单项与批量入口统一为“校对更新”。详情页的“校对更新”和“压缩入库”紧跟项目名显示，使用与“打开”“修改”一致的紧凑按钮样式。
- “入库日期”统一为“入库时间”。详情页不再分别显示“目录更新于”和“上次检查于”，只在入库时间下一行显示一项“上次校对时间”。
- 重复或相似任务的确认按钮统一为“继续入库”；队列进度移除冗长的名称候选片段，保留有用的相似候选数量。

### 仓库整理与撤回

- “仓库工具”下拉菜单新增“不展示‘未压缩’标签”选项，保存本机偏好并同时作用于列表与缩略图视图。
- 批量撤回执行期间，右下角会显示不与返回按钮和 Toast 重叠的旋转等待图标，撤回按钮同时禁用，避免重复提交。
- 删除仓库项目后再撤回时，会从恢复后的完整仓库快照重建双向相似关系，避免关系丢失。

### 重复项清理

- “清除可能重复项”改为“清除疑似重复项”。该操作只清理非精确的名称或标题疑似项；带有文件内容一致或项目完全重复证据的任务继续由独立的完全重复入口处理。

### 升级与数据

升级范围为 4.6.17 → 4.6.18。请使用完整便携程序目录或安装程序升级。SQLite 仓库格式、用户资料位置和现有记录保持兼容，无需迁移或全库重建。

## English

This release covers public stable 4.6.17 → 4.6.18 and includes the product changes merged in that range.

### Update review and item details

- Single-item and batch actions for uncompressed folders are now consistently named Review Updates. In item details, Review Updates and Compress & Archive sit directly beside the item name and use the same compact button style as Open and Edit.
- Inventory Date is now Inventory Time. The separate Folder Updated and Last Checked rows are replaced by one Last Reviewed row immediately below it.
- Duplicate and similarity confirmations consistently use Continue Intake. The long same-name candidate fragment is removed from queue progress while useful similar-candidate counts remain.

### Warehouse organization and undo

- Warehouse Tools gains a Hide the “Uncompressed” tag option. The saved local preference applies to both list and thumbnail views.
- A non-overlapping spinner appears at the lower right during bulk undo, and the undo button is disabled until the operation finishes to prevent repeated submissions.
- Undoing deleted Warehouse items rebuilds reciprocal similarity relationships from the restored complete Warehouse snapshot, preventing relationship loss.

### Duplicate cleanup

- Remove Possible Duplicates becomes Remove Suspected Duplicates. It removes only non-exact name or title candidates; tasks with identical-content or complete-project evidence remain for the separate exact-duplicate action.

### Upgrade and data

The upgrade range is 4.6.17 → 4.6.18. Upgrade through the complete portable directory or installer. The SQLite Warehouse format, user-data locations, and existing records remain compatible; no migration or full rebuild is required.

## 4.6.17

# Hamster Archiver 4.6.17

## 中文

本次覆盖公开正式版 4.6.11 → 4.6.17，包括 4.6.11 发布后的维护，以及 4.6.12–4.6.17 已合入的更新。以下按最终行为合并，包含未单独公开发行的版本。

### 未压缩目录与二次压缩

- 未压缩目录可单项或批量更新，同路径再次添加继续最近成功写入的原记录；选择不压缩即更新，选择压缩即升级原记录。
- 文件与空目录共用一次属性快照。新增自动更新；修改、删除、旧信息不足以及压缩前的目录变化必须先确认，可覆盖原项目、新建独立项目或跳过。报告读取已有对比结果，不再扫描；未变化指纹与有效预览复用，失败或取消不改仓库与原文件。
- 更新批次立即检查并限定本批范围，不带动无关任务；手动暂停仅在下一次定时开始时自动继续。关闭使用说明不会关闭删改确认。
- 原文件位置“打开”旁增加“修改”，只更新记录指向，下次更新或压缩再检查。压缩包状态简化为“未压缩”；目录检查无变化时显示项目名（超过 15 个字符省略），日志保留完整名称；已排队项目明确提示先完成或取消任务。
- 二次压缩的单项确认直接列出原备份位置与当前设置。批量可保留原位置、逐项确认或更新并继续；只有冲突项等待逐项确认，其余照常执行。备份位置在排队时冻结，大任务仍独立确认风险；二次压缩沿用原文件后处理设置。

### 仓库浏览与整理

- 两种视图共用多选：Ctrl 单项切换、Shift 连续范围、Ctrl+Shift 追加范围；普通框选替换、Ctrl 框选反选、Shift 框选追加。全选框支持空、半选、全选状态，跨页选择有明确计数，Esc 可取消。
- 缩略图视图按钮使用大中小三态 SVG，默认中档，再次点击按大→中→小循环并保存偏好；悬停缓慢呼吸，减少动态效果时关闭动画。卡片封面贴顶且保留完整画面，切换不重生成图片、不改变页码和选择。
- 列表提供独立名称复制按钮；表头与正文共用列宽、间距和窄窗口隐藏规则。列分界线可拖动、键盘调整或恢复默认，按比例保存，总宽与末列位置保持稳定。
- 列表不重复未压缩标签，渲染全部标签并在列边界裁切，不遮挡备份位置。标签筛选优先显示可能重复与未压缩，超过 20 行内部滚动；概览标签指标可查看全部标签及数量并直接筛选。
- 列表与缩略图点击条目定位到详情，复制与选择保持独立。当前页号可直接编辑或从候选页码选择，支持 Enter、失焦提交与无效输入恢复；键盘左右翻页保留滚动位置。
- 批量计数与操作按钮保持同一行，追加标签与修改备份位置归入批量菜单。搜索随窗口收缩、聚焦原位展开；窄窗口概览紧凑并列，随机漫步卡片缩短，队列统计保持一行。搜索与概览指标使用中性反馈，详情备份位置去除多余空隙，入口统一为“导入仓库”。
- 向下浏览可一键返回仓库工具栏；Toast 位于该按钮上方，自动跳过选项与分割线保持间距，工作台标题与概览卡片对齐。

### 删除、启动与性能

- 删除后可在本次运行最近十次撤回历史中恢复完整记录、压缩包与缩略图；文件由 Windows 回收站管理，不新增长期副本。撤回检查缺失内容与同名路径，不覆盖用户文件；中文路径与超过 100 项的回收站查询已修复。
- 删除与撤回顺序执行，正常退出等待收尾。已跳过、取消、失败或完成的历史队列不再阻塞新任务；删除失效仓库候选后释放对应确认。
- 桌面窗口可先显示，仓库后台分批加载并明确显示进度，加载完成前限制依赖完整仓库的操作；启动缓存及后台清理减少重复工作。Electron 更新至 43.7.1。
- 图片预览最多两个并发，视频顺序抽帧并保留部分成功结果；队列显示媒体数量、帧进度，预算耗尽有明确警告。入库只保存新记录及受影响相似关系，保留未变化文件、搜索和指纹索引，日志区分各阶段耗时。
- 运行日志跨重启恢复最近 300 条有效记录，正常退出等待写入；补记启动退出、设置字段、数据区切换、更新、排除词与关键错误，密码值不写日志，普通浏览不写日志。
- Windows 安装程序提供中英文选择，内置与自定义页面跟随语言；修复实时进度状态胶囊样式。

### AI 与命令行接入

- 修复部分多显示适配器环境的 AI 启动，恢复 Electron 默认图形选择，保留单实例、诊断与渲染沙箱。
- CLI、MCP 与 UI 共用任务服务和结构化回执，提供 `hamster` 高层命令、`intake.submit` 与 `task.*`；固定任务参数、requestId 幂等、显式路径过滤与任务范围，避免确认或恢复启动无关任务。
- AI 接入移至默认关闭的实验功能，可独立管理 Codex Skill、Codex MCP、WorkBuddy、通用 MCP 和 Windows ODR 安全预览。接入按所有权摘要保护，不覆盖用户修改；ODR 限制不要求降低系统保护。
- README、AI 指引、CLI 参考与能力清单重整为精简入口，能力按需发现，故障说明与待确认回执同步更新。

### 升级与数据

升级范围为 4.6.11 → 4.6.17。请使用完整便携程序目录或安装程序升级。SQLite 仓库格式与用户资料位置保持兼容，无需迁移或全库重建。目录更新不改原文件；撤回仅在本次运行有效，退出后由 Windows 回收站管理已删除文件。

## English

This release covers public stable 4.6.11 → 4.6.17, including maintenance after the 4.6.11 publication and merged updates in 4.6.12–4.6.17. Changes are grouped by their final behavior, including versions without a separate public release.

### Uncompressed folders and later compression

- Refresh one uncompressed folder or a batch. Adding the same source again continues its most recently committed record: uncompressed intake refreshes it, while compression upgrades it.
- Files and empty folders share one property snapshot. Additions update automatically; modifications, deletions, incomplete history, and changes before compression require review with replace, independent item, or skip choices. Reports reuse saved comparisons without scanning again. Unchanged fingerprints and valid previews are reused; failures and cancellation preserve the Warehouse and originals.
- Refresh batches check immediately within their own scope, without starting unrelated work. A manual pause resumes automatically only at the next scheduled start. Dismissing usage guidance never suppresses change review.
- Edit now sits beside Open at the original location. Relocation changes only the record’s pointer, checked again on refresh or compression. Archive status is simply Uncompressed. Unchanged checks identify the item, shortening names beyond 15 characters while logging the full name; already-queued items explain that their task must finish or be canceled first.
- Single-item later compression lists the original and current backup locations. Batches can keep locations, review each item, or update and continue. Only conflicting items wait for individual review; others proceed. Queued backup settings are frozen, large-task risks still need separate confirmation, and later compression retains source-handling settings.

### Warehouse browsing and organization

- Both views share selection rules: Ctrl toggles one item, Shift selects a range, and Ctrl+Shift adds a range. A plain marquee replaces selection, Ctrl marquee toggles, and Shift marquee adds. Select-all supports empty, mixed, and checked states, counts identify cross-page selections, and Escape clears selection.
- The thumbnail button uses large, medium, and small SVG states, defaults to medium, and cycles large → medium → small when clicked again, saving preferences. Hover breathes slowly unless reduced motion is enabled. Covers stay at the top and retain the complete image; resizing does not regenerate images or change pages and selection.
- List rows provide an independent name-copy button. Headers and rows share widths, spacing, and narrow-window visibility. Column dividers support dragging, keyboard adjustment, and resetting, saving proportions while keeping the total width and final column stable.
- List rows omit the duplicate Uncompressed tag and render all tags, clipping within their column to protect backup locations. Tag filters prioritize Possible duplicate and Uncompressed, scroll internally beyond 20 rows, and the overview Tags metric opens all tags and counts for direct filtering.
- Item clicks in either view scroll to details, independently of copying and selection. Edit the current page directly or choose a candidate, with Enter/blur submission and invalid-input recovery; arrow-key pagination preserves scrolling.
- Bulk counts and buttons stay together; tag and backup edits move into the bulk menu. Search shrinks with the window and expands in place on focus. Narrow overviews use compact parallel sections, Random Walk is shorter, and queue statistics stay in one row. Search and metrics use neutral feedback, backup detail pills lose extra spacing, and the entry consistently reads Import Warehouse.
- A floating button returns to Warehouse tools after scrolling. Toasts appear above it, Auto-skip keeps divider spacing, and Workbench headings and overview cards align.

### Deletion, startup, and performance

- The current run’s ten-entry undo history restores complete records, archives, and thumbnails. Windows Recycle Bin manages files without long-term app copies. Undo checks missing content and same-name paths without overwriting user files; Chinese paths and queries exceeding 100 items are fixed.
- Delete and undo run in order and normal exit waits for cleanup. Skipped, canceled, failed, and completed queue history no longer blocks new work; deleting stale Warehouse candidates releases their confirmations.
- The desktop window can appear before bounded background Warehouse loading completes, with visible progress and restrictions on operations requiring the full Warehouse. Startup caching and background cleanup reduce repeated work. Electron moves to 43.7.1.
- Image previews use at most two concurrent tasks. Videos extract frames sequentially and retain partial successes, with media counts, frame progress, and explicit budget warnings. Intake saves only new records and affected similarity relationships, retaining unchanged file, search, and fingerprint indexes; logs separate stage timing.
- Runtime logs restore the latest 300 valid entries across restarts and flush on normal exit. They cover startup/exit, changed setting fields, data-area switches, updates, ignore terms, and critical errors without password values or routine browsing logs.
- The Windows installer offers English and Chinese with built-in and custom pages following the chosen language. Live progress status-pill styling is repaired.

### AI and command-line integration

- AI startup on affected multi-display-adapter systems restores Electron’s default graphics selection while retaining single-instance behavior, diagnostics, and the renderer sandbox.
- CLI, MCP, and UI share a task service and structured receipts, with high-level `hamster` commands, `intake.submit`, and `task.*`. Frozen task settings, requestId idempotency, explicit-path filtering, and scoped confirmation/recovery prevent unrelated work from starting.
- AI integration moves into experimental features, off by default, with independent Codex Skill, Codex MCP, WorkBuddy, generic MCP, and Windows ODR safety-preview controls. Ownership digests protect user edits; ODR restrictions never require weakening system protection.
- README, AI guidance, CLI references, and capability metadata use concise entry points and on-demand discovery, with updated troubleshooting and confirmation receipts.

### Upgrade and data

The upgrade range is 4.6.11 → 4.6.17. Upgrade through the complete portable directory or installer. The SQLite Warehouse format and user-data locations remain compatible; no migration or full rebuild is needed. Folder refresh preserves originals. Undo lasts only for the current run; Windows Recycle Bin manages deleted files after exit.

## 4.6.16

# Hamster Archiver 4.6.16

## 中文

本次覆盖公开正式版 4.6.11 → 4.6.16，包括 4.6.11 发布后的维护，以及 4.6.12–4.6.16 已合入的更新。以下按最终行为合并，包含未单独公开发行的版本。

### 未压缩目录与二次压缩

- 未压缩目录可单项或批量更新，同路径再次添加继续最近成功写入的原记录；选择不压缩即更新，选择压缩即升级原记录。
- 文件与空目录共用一次属性快照。新增自动更新；修改、删除、旧信息不足以及压缩前的目录变化必须先确认，可覆盖原项目、新建独立项目或跳过。报告读取已有对比结果，不再扫描；未变化指纹与有效预览复用，失败或取消不改仓库与原文件。
- 更新批次立即检查并限定本批范围，不带动无关任务；手动暂停仅在下一次定时开始时自动继续。关闭使用说明不会关闭删改确认。
- 原文件位置“打开”旁增加“修改”，只更新记录指向，下次更新或压缩再检查。压缩包状态简化为“未压缩”；目录检查无变化时显示项目名（超过 15 个字符省略），日志保留完整名称；已排队项目明确提示先完成或取消任务。
- 二次压缩的单项确认直接列出原备份位置与当前设置。批量可保留原位置、逐项确认或更新并继续；只有冲突项等待逐项确认，其余照常执行。备份位置在排队时冻结，大任务仍独立确认风险；二次压缩沿用原文件后处理设置。

### 仓库浏览与整理

- 两种视图共用多选：Ctrl 单项切换、Shift 连续范围、Ctrl+Shift 追加范围；普通框选替换、Ctrl 框选反选、Shift 框选追加。全选框支持空、半选、全选状态，跨页选择有明确计数，Esc 可取消。
- 缩略图视图按钮使用大中小三态 SVG，默认中档，再次点击按大→中→小循环并保存偏好；悬停缓慢呼吸，减少动态效果时关闭动画。卡片封面贴顶且保留完整画面，切换不重生成图片、不改变页码和选择。
- 列表提供独立名称复制按钮；表头与正文共用列宽、间距和窄窗口隐藏规则。列分界线可拖动、键盘调整或恢复默认，按比例保存，总宽与末列位置保持稳定。
- 列表不重复未压缩标签，渲染全部标签并在列边界裁切，不遮挡备份位置。标签筛选优先显示可能重复与未压缩，超过 20 行内部滚动；概览标签指标可查看全部标签及数量并直接筛选。
- 列表与缩略图点击条目定位到详情，复制与选择保持独立。当前页号可直接编辑或从候选页码选择，支持 Enter、失焦提交与无效输入恢复；键盘左右翻页保留滚动位置。
- 批量计数与操作按钮保持同一行，追加标签与修改备份位置归入批量菜单。搜索随窗口收缩、聚焦原位展开；窄窗口概览紧凑并列，随机漫步卡片缩短，队列统计保持一行。搜索与概览指标使用中性反馈，详情备份位置去除多余空隙，入口统一为“导入仓库”。
- 向下浏览可一键返回仓库工具栏；Toast 位于该按钮上方，自动跳过选项与分割线保持间距，工作台标题与概览卡片对齐。

### 删除、启动与性能

- 删除后可在本次运行最近十次撤回历史中恢复完整记录、压缩包与缩略图；文件由 Windows 回收站管理，不新增长期副本。撤回检查缺失内容与同名路径，不覆盖用户文件；中文路径与超过 100 项的回收站查询已修复。
- 删除与撤回顺序执行，正常退出等待收尾。已跳过、取消、失败或完成的历史队列不再阻塞新任务；删除失效仓库候选后释放对应确认。
- 桌面窗口可先显示，仓库后台分批加载并明确显示进度，加载完成前限制依赖完整仓库的操作；启动缓存及后台清理减少重复工作。Electron 更新至 43.7.1。
- 图片预览最多两个并发，视频顺序抽帧并保留部分成功结果；队列显示媒体数量、帧进度，预算耗尽有明确警告。入库只保存新记录及受影响相似关系，保留未变化文件、搜索和指纹索引，日志区分各阶段耗时。
- 运行日志跨重启恢复最近 300 条有效记录，正常退出等待写入；补记启动退出、设置字段、数据区切换、更新、排除词与关键错误，密码值不写日志，普通浏览不写日志。
- Windows 安装程序提供中英文选择，内置与自定义页面跟随语言；修复实时进度状态胶囊样式。

### AI 与命令行接入

- 修复部分多显示适配器环境的 AI 启动，恢复 Electron 默认图形选择，保留单实例、诊断与渲染沙箱。
- CLI、MCP 与 UI 共用任务服务和结构化回执，提供 `hamster` 高层命令、`intake.submit` 与 `task.*`；固定任务参数、requestId 幂等、显式路径过滤与任务范围，避免确认或恢复启动无关任务。
- AI 接入移至默认关闭的实验功能，可独立管理 Codex Skill、Codex MCP、WorkBuddy、通用 MCP 和 Windows ODR 安全预览。接入按所有权摘要保护，不覆盖用户修改；ODR 限制不要求降低系统保护。
- README、AI 指引、CLI 参考与能力清单重整为精简入口，能力按需发现，故障说明与待确认回执同步更新。

### 升级与数据

升级范围为 4.6.11 → 4.6.16。请使用完整便携程序目录或安装程序升级。SQLite 仓库格式与用户资料位置保持兼容，无需迁移或全库重建。目录更新不改原文件；撤回仅在本次运行有效，退出后由 Windows 回收站管理已删除文件。

## English

This release covers public stable 4.6.11 → 4.6.16, including maintenance after the 4.6.11 publication and merged updates in 4.6.12–4.6.16. Changes are grouped by their final behavior, including versions without a separate public release.

### Uncompressed folders and later compression

- Refresh one uncompressed folder or a batch. Adding the same source again continues its most recently committed record: uncompressed intake refreshes it, while compression upgrades it.
- Files and empty folders share one property snapshot. Additions update automatically; modifications, deletions, incomplete history, and changes before compression require review with replace, independent item, or skip choices. Reports reuse saved comparisons without scanning again. Unchanged fingerprints and valid previews are reused; failures and cancellation preserve the Warehouse and originals.
- Refresh batches check immediately within their own scope, without starting unrelated work. A manual pause resumes automatically only at the next scheduled start. Dismissing usage guidance never suppresses change review.
- Edit now sits beside Open at the original location. Relocation changes only the record’s pointer, checked again on refresh or compression. Archive status is simply Uncompressed. Unchanged checks identify the item, shortening names beyond 15 characters while logging the full name; already-queued items explain that their task must finish or be canceled first.
- Single-item later compression lists the original and current backup locations. Batches can keep locations, review each item, or update and continue. Only conflicting items wait for individual review; others proceed. Queued backup settings are frozen, large-task risks still need separate confirmation, and later compression retains source-handling settings.

### Warehouse browsing and organization

- Both views share selection rules: Ctrl toggles one item, Shift selects a range, and Ctrl+Shift adds a range. A plain marquee replaces selection, Ctrl marquee toggles, and Shift marquee adds. Select-all supports empty, mixed, and checked states, counts identify cross-page selections, and Escape clears selection.
- The thumbnail button uses large, medium, and small SVG states, defaults to medium, and cycles large → medium → small when clicked again, saving preferences. Hover breathes slowly unless reduced motion is enabled. Covers stay at the top and retain the complete image; resizing does not regenerate images or change pages and selection.
- List rows provide an independent name-copy button. Headers and rows share widths, spacing, and narrow-window visibility. Column dividers support dragging, keyboard adjustment, and resetting, saving proportions while keeping the total width and final column stable.
- List rows omit the duplicate Uncompressed tag and render all tags, clipping within their column to protect backup locations. Tag filters prioritize Possible duplicate and Uncompressed, scroll internally beyond 20 rows, and the overview Tags metric opens all tags and counts for direct filtering.
- Item clicks in either view scroll to details, independently of copying and selection. Edit the current page directly or choose a candidate, with Enter/blur submission and invalid-input recovery; arrow-key pagination preserves scrolling.
- Bulk counts and buttons stay together; tag and backup edits move into the bulk menu. Search shrinks with the window and expands in place on focus. Narrow overviews use compact parallel sections, Random Walk is shorter, and queue statistics stay in one row. Search and metrics use neutral feedback, backup detail pills lose extra spacing, and the entry consistently reads Import Warehouse.
- A floating button returns to Warehouse tools after scrolling. Toasts appear above it, Auto-skip keeps divider spacing, and Workbench headings and overview cards align.

### Deletion, startup, and performance

- The current run’s ten-entry undo history restores complete records, archives, and thumbnails. Windows Recycle Bin manages files without long-term app copies. Undo checks missing content and same-name paths without overwriting user files; Chinese paths and queries exceeding 100 items are fixed.
- Delete and undo run in order and normal exit waits for cleanup. Skipped, canceled, failed, and completed queue history no longer blocks new work; deleting stale Warehouse candidates releases their confirmations.
- The desktop window can appear before bounded background Warehouse loading completes, with visible progress and restrictions on operations requiring the full Warehouse. Startup caching and background cleanup reduce repeated work. Electron moves to 43.7.1.
- Image previews use at most two concurrent tasks. Videos extract frames sequentially and retain partial successes, with media counts, frame progress, and explicit budget warnings. Intake saves only new records and affected similarity relationships, retaining unchanged file, search, and fingerprint indexes; logs separate stage timing.
- Runtime logs restore the latest 300 valid entries across restarts and flush on normal exit. They cover startup/exit, changed setting fields, data-area switches, updates, ignore terms, and critical errors without password values or routine browsing logs.
- The Windows installer offers English and Chinese with built-in and custom pages following the chosen language. Live progress status-pill styling is repaired.

### AI and command-line integration

- AI startup on affected multi-display-adapter systems restores Electron’s default graphics selection while retaining single-instance behavior, diagnostics, and the renderer sandbox.
- CLI, MCP, and UI share a task service and structured receipts, with high-level `hamster` commands, `intake.submit`, and `task.*`. Frozen task settings, requestId idempotency, explicit-path filtering, and scoped confirmation/recovery prevent unrelated work from starting.
- AI integration moves into experimental features, off by default, with independent Codex Skill, Codex MCP, WorkBuddy, generic MCP, and Windows ODR safety-preview controls. Ownership digests protect user edits; ODR restrictions never require weakening system protection.
- README, AI guidance, CLI references, and capability metadata use concise entry points and on-demand discovery, with updated troubleshooting and confirmation receipts.

### Upgrade and data

The upgrade range is 4.6.11 → 4.6.16. Upgrade through the complete portable directory or installer. The SQLite Warehouse format and user-data locations remain compatible; no migration or full rebuild is needed. Folder refresh preserves originals. Undo lasts only for the current run; Windows Recycle Bin manages deleted files after exit.

## 4.6.13

# Hamster Archiver 4.6.13

## 中文

本版本汇总公开正式版 4.6.11 → 4.6.13 的变化，包含 4.6.12 的 AI 启动与性能维护，以及 4.6.13 的删除撤回和重复候选修复。

### 仓库删除与退出安全

- 删除仓库条目后，可在本次运行的最近十次撤回历史中恢复完整记录；本应用管理的压缩包和缩略图从 Windows 回收站恢复，不新增应用内回收站或长期暂存副本。
- 删除和撤回按顺序执行。关闭窗口或退出撞上在途操作时，窗口先隐藏，进程完成当前短操作后再结束。
- 撤回前检查回收站内容和目标路径；内容缺失或出现同名目标时停止恢复，不覆盖现有文件，也不消耗撤回记录。

### 队列、预览与入库性能

- 已自动跳过、已取消、失败和已完成的历史队列项不再让新任务进入重复确认；删除失效仓库候选后，相关任务会恢复正常排队。
- 图片预览最多两个并发任务，视频逐个抽帧并保留部分成功结果；队列显示媒体处理数量与视频帧进度，达到预算时给出明确警告。
- 入库只保存新记录与相似关系受影响的旧记录，避免复制历史完整清单或重建未变化的文件、搜索和指纹索引。

### AI 接入与工作台

- MCP 启动器恢复 Electron 的系统默认图形选择，修复部分多显示适配器 Windows 环境中的纯 AI 启动失败，同时保留单实例、诊断、自检与渲染沙箱。
- AI 快速上手、MCP 说明和能力清单改为精简入口，具体能力在连接后按需发现。
- “01 · 收纳设置”与“02 · 扫描与队列”视觉上基本对齐，并保持左侧略高数个像素。

### 升级与数据

本次范围为公开正式版 4.6.11 → 4.6.13。请通过完整便携程序目录或安装程序升级；SQLite 仓库格式、用户资料位置和现有记录保持不变，无需迁移或重建。撤回历史只在当前运行中有效，退出后由 Windows 回收站继续管理已删除文件。

## English

This release covers public stable 4.6.11 → 4.6.13, including the 4.6.12 AI-startup and performance maintenance plus the 4.6.13 deletion-undo and duplicate-candidate fixes.

### Warehouse deletion and exit safety

- Deleted Warehouse items can be restored from the ten-entry undo history during the current run. App-managed archives and thumbnails return from the Windows Recycle Bin, without an in-app recycle bin or long-term staging copy.
- Delete and undo operations run in order. If the window closes or the app exits during one of these short operations, the window hides first and the process exits after cleanup finishes.
- Undo checks Recycle Bin content and destination paths before restoring. Missing content or a same-name destination stops restoration without overwriting files or consuming the undo entry.

### Queue, preview, and intake performance

- Automatically skipped, canceled, failed, and completed queue history no longer sends new work into duplicate review. Tasks return to their normal queue state when their stale Warehouse candidate is deleted.
- Image previews use at most two concurrent tasks. Videos run sequentially and retain partial successful output; the queue shows media counts and frame progress, with explicit warnings when budgets are exhausted.
- Intake saves only new records and old records affected by reciprocal similarity changes, avoiding copies of complete historical manifests and rebuilds of unchanged file, search, and fingerprint indexes.

### AI connection and Workbench

- The MCP launcher restores Electron's system-default graphics selection, fixing pure-AI startup on affected multi-display-adapter Windows systems while retaining single-instance startup, diagnostics, self-checks, and the renderer sandbox.
- AI quick-start guidance, the MCP reference, and capability metadata now provide concise entry points, with detailed capabilities discovered on demand after connection.
- “01 · Archive Setup” is visually aligned with “02 · Scan & Queue” while remaining a few pixels higher.

### Upgrade and data

This release covers public stable 4.6.11 → 4.6.13. Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required. Undo history lasts only for the current run, while Windows continues to manage deleted files in the Recycle Bin after exit.

## 4.6.11

# Hamster Archiver 4.6.11

## 中文

本版本汇总公开正式版 4.6.9 → 4.6.11 的变化，包含未单独正式公开发行的 4.6.10 改进。

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

本次范围为公开正式版 4.6.9 → 4.6.11。请通过完整便携程序目录或安装程序升级；本次不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.9 to 4.6.11, including the 4.6.10 improvements that were not published as a separate public stable release.

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

This release covers public stable 4.6.9 → 4.6.11. Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required.

## 4.6.9

# Hamster Archiver 4.6.9

## 中文

本版本汇总公开正式版 4.6.8 → 4.6.9 的变化。

### 随机漫步与新手引导

- 随机漫步按钮文案精简为“随机漫步”，并同步英文翻译。
- 新手引导第一步的语言选择标题统一为“语言/Language”。
- 完成新手引导后的烟花庆祝效果不再出现仓鼠 emoji。

### AI 接入

- 修复部分 AI 沙箱限制 Electron 子进程启动时，MCP 启动器无法可靠拉起应用的问题。Windows 发行包通过桌面 Explorer 代理启动并使用一次性请求传递后台连接意图，同时保留 Chromium 渲染沙箱；直接回退路径也会在异常退出时返回明确诊断。

### 升级与数据

本次范围为公开正式版 4.6.8 → 4.6.9。应用继续通过完整程序目录或安装程序升级；本次变化不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.8 to 4.6.9.

### Random Walk and onboarding

- Shortened the Random Walk button label and synchronized its English translation.
- Standardized the first onboarding step's language heading as `语言/Language`.
- Removed the hamster emoji from the onboarding-completion fireworks.

### AI connection

- Fixed cases where an AI sandbox's Electron child-process restrictions prevented the MCP launcher from reliably opening the app. Windows releases now delegate launch through desktop Explorer and pass background-connection intent in a one-time request while retaining the Chromium renderer sandbox. The direct fallback also returns a clear diagnostic after an abnormal exit.

### Upgrade and data

This release covers public stable 4.6.8 → 4.6.9. Upgrade through the complete application directory or installer. The SQLite warehouse format, user-data locations and existing records remain unchanged; no migration or rebuild is required.

## 4.6.8

# Hamster Archiver 4.6.8

## 中文

本版本汇总公开正式版 4.6.1 → 4.6.8 的变化。

### AI 接入与自动化

- 收紧常用 MCP 操作的字段与结果边界，并采用紧凑分页和最新状态令牌保护队列操作；仓库概览默认只返回汇总，非空活动日期仅在明确请求时提供。

### 首次使用与仓库浏览

- 应用默认进入仓库，空仓库提供可跳过的六步引导；第一步可选择中文或 English。首次启动会按 Windows 界面语言选择默认值：中文 Windows 使用中文，其他界面语言使用 English；之后始终保留已保存选择。
- 仓库概览的库存数量和 GB 容量可打开历史统计，按日浏览月度记录或查看年度汇总；活跃度可悬停查看日期与数量，也能按日期精确筛选。日期格展示最近 20 周，空白和未来日期使用主题对应的中性色。
- 空仓库与没有封面的随机漫步使用主题默认背景。手动新增库存的备注改为选填，也可在后续编辑时清空。
- 归档工作台的扫描和入库操作在不同窗口宽度下保持清晰分行；低于小项目过滤阈值的单项、拖放或粘贴输入会显示一致的可读提示并定位相关设置。

### 归档、更新与数据安全

- 横屏和竖屏视频抽帧保留原始比例，不再补入黑边。压缩已有未压缩项目时，如果仓库和当前设置中的备份位置不同，会先让用户选择，并把选择固定到队列任务。
- GitHub 不可用时，应用可通过公开 latest 地址发现更新，并从公开发行附件下载；下载内容必须通过对应 SHA-256 校验。
- 已验证且未变化的打包发行版可复用完整性缓存；首次启动、升级、移动程序或关键文件变化仍会全量核验。仓库和业务操作只会在核验及初始化成功后开放，下载、更新和发行验收仍始终全量核验。
- 中英文动态界面、状态和原生弹窗文案得到补齐与统一。切换英文时，用户自行填写的标题、路径等内容保持原文。

### 升级与数据

本次范围为公开正式版 4.6.1 → 4.6.8。应用继续通过完整程序目录或安装程序升级；本次变化不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.1 to 4.6.8.

### AI connection and automation

- Tightened common MCP field and result boundaries, with compact pagination and current-state tokens protecting queue actions. Warehouse insights return a compact summary by default and include non-empty activity dates only on request.

### First run and warehouse browsing

- The app opens the Warehouse by default and provides a skippable six-step guide for an empty warehouse. The first step lets you choose Chinese or English. On first launch, Chinese Windows defaults to Chinese and other Windows interface languages to English; later launches keep the saved choice.
- Inventory and GB totals open historical statistics with daily monthly records and yearly summaries. The activity chart shows dates and counts on hover and can filter by an exact date. It displays the latest 20 weeks, with theme-neutral colors for empty and future dates.
- Empty warehouses and Random Walk items without covers use the theme's default background. Notes for manually created inventory items are optional and can be cleared later.
- Workbench scan and intake actions stay in separate, clearly aligned rows at different window widths. Items below the small-item threshold show a consistent readable message whether added through the picker, drag and drop or paste, and the app points to the relevant setting.

### Archiving, updates and data safety

- Landscape and portrait video frames retain their original aspect ratio without black padding. When compressing an existing uncompressed item with a different saved and configured backup location, the app asks which location to use and stores the choice with the queued task.
- If GitHub is unavailable, the app can discover updates through the public latest endpoint and download public release assets. Downloads must pass the matching SHA-256 check.
- An unchanged packaged distribution that was already verified can reuse its integrity cache. First launch, upgrades, moving the app or changing a critical file still trigger full verification. The Warehouse and business operations remain closed until verification and initialization succeed; downloads, updates and release acceptance always perform full checks.
- Chinese and English dynamic interface, status and native-dialog copy is more complete and consistent. User-entered titles, paths and similar content remain unchanged when switching to English.

### Upgrade and data

This release covers public stable 4.6.1 → 4.6.8. Upgrade through the complete application directory or installer. The warehouse format, user-data locations and existing records remain unchanged; no migration or rebuild is required.


本文件是公开快照仓库使用的版本记录，只保留面向用户的正式发行节点。开发过程中的内部补丁与提交记录不进入公开仓库。

## 4.6.0

本版本汇总自 4.5.18 之后至 4.6.0 的公开变化。

- 大项目详情查询改为在数据库中先排除自身，避免重复读取和解析整份项目数据；缩略图按可见区域加载并限制并发。
- 新增默认关闭的本机 MCP 接口，可由 AI 批量入库、查询项目和清单、查看进度，并在相似提示后继续、跳过或重试；AI 入库保留源文件。
- 更新窗口会按版本倒序展示本地版本之后的正式发行说明，并按当前语言显示中英文内容；历史说明缺失时给出明确提示。
- 当同一原始位置、完整目录结构、文件名、文件数量和文件大小都与仓库记录一致时，可直接判定为完全重复并跳过 MD5；自动跳过仍受用户设置开关控制，无法确认完整快照时仍执行内容核验。
- 归档入库复用已生成的清单和目录信息，减少重复遍历、文件统计和整库写回；跨存储移动仍保留成品身份复核。
- 队列运行期间可继续扫描、拖放或添加单项，新项目显示“等待下次入库”并安排到下一轮处理；自动跳过且保留的项目会自动取消选择。
- 队列完成状态和“相似报告”按钮在窄窗口保持单行显示；更新窗口移除装饰图标并将版本序列改为绿色。
- Windows 原生窗口使用多分辨率 ICO，改善标题栏小图标清晰度。

## 4.5.18

- 仓库提交失败时会安全保留已生成的归档成品到恢复位置，并准确显示恢复状态，避免用户误以为成品已经消失。
- 清理或恢复归档成品前会核对文件身份，降低同名文件被误删或误移动的风险。
- 缩略图处理阶段取消会正确终止任务并清理未提交成品，源文件保持安全。
- 源文件已完成移动但仓库状态写回失败时，任务会分别说明两件事，便于后续修复仓库状态。
- 修复英文界面“待选入库方式”徽标翻译。

## 4.5.17

- 修复自动跳过或重复待确认状态被延迟进度覆盖的问题，点击队列不再让状态退回“生成清单与 MD5”或让确认请求消失。
- 统一“内容完全一致 / 项目完全重复”表达；相似报告和完整目录结构会同时用金色标出一致文件的文件名与 MD5，并补齐中英文界面。
- 三项队列安全设置默认开启，极小文件阈值保持 5 KB；完成后移动默认关闭，卡顿规避与完整重复核验继续彼此独立。
- 安装版支持 GitHub 自动更新、离线手动更新和更新内容展示；安装器规范目标子目录、提供桌面快捷方式选项、修复完成页启动，并复用稳定应用标识升级已有安装。

## 4.5.16

- 重整自动跳过交互：扫描时的名称相似只做非阻塞提示；开始处理并完成内容核验后，精确重复可直接按设置跳过，真正的相似项目只需要一次确认。
- 新增项目形状与内容指纹索引，旧仓库自动补齐；跨目录精确核验会在候选排除后提前停止，相似报告改用批量索引查询，降低大型仓库和超大目录的重复检查开销。
- 人工确认绑定本次完整清单并在继续时复用，避免源文件变化或重复生成清单造成错误结论和无谓等待。
- 暂停当前任务时可从队列工具栏直接取消；超大文件夹的代表文件数量可自行设置，默认 200。

## 4.5.14

- 修复深色主题下主题选择菜单出现白底浅色文字、选项难以辨认的问题；下拉选项现在跟随当前主题的字段背景和正文色。

## 4.5.13

- 更新前后均可查看本次发行内容，在线更新和手动发行 ZIP 共用完整性校验、回滚与更新后提示。
- 完善“卡顿规避”默认值与安全边界，使抽样和极小文件设置不影响完整归档、精确重复判断或自动跳过。
- 重做队列相似报告和自动跳过证据链，明确区分名称相似与内容精确重复，并修复库内项目压缩、自身比较和重复确认流程。
- 仓库标签支持逗号分段自动补全；列表、目录和精确重复提示统一采用绿色、中性、红色和金色的明确语义。
- 新增“森林”和“暮光”主题，统一五套主题的文字、焦点和状态提示色。
- 修复仓库搜索清空后结果不恢复，以及选择列表项或卡片时重复渲染造成的闪烁。
- 修正高级压缩设置的分隔线、勾选框对齐、项目详情标题背景和顶部 Logo 清晰度。

## 4.5.9

- 完成中英文项目主页同步重构，并加入显眼的语言切换入口。
- 新增真实中英文界面视觉，展示归档工作台、大缩略图仓库、仓库概览以及项目媒体与完整目录详情。

## 4.5.6

- 仓库标签筛选新增“可能重复”选项，可直接查看当前仍有有效相似关系的项目。
- 修复标准相似度把单个共享词、短标题和常见发布格式词当作充分证据的问题；相似算法升级后会在后台重建旧关系、清理误报标签，并保留手动排除结果。
- 重新设计项目主页，新增项目原生主视觉和本地验证流程图，整理双语功能说明、真实界面、便携数据边界、更新和开发指引。

## 4.5.2

- 以 4.5.0 完整界面为基础合并中英文界面完善和新版相似度算法，修复此前版本线维护错误。
- 相似度设置区移除重复边框和标题；切换强度不再自动重算已有关系，可按需手动执行全局重算。
- 便携版更新会同步完整运行组件并保留现有用户数据，避免新 EXE 继续加载旧版应用代码。

## 4.5.0

- 手动更新指引改为通过“导出仓库 / 并入外部仓库”迁移，不再建议直接移动用户数据目录。
- 用户数据区和压缩暂存目录均可选择并保存；切换数据区保留原目录，不自动合并两个已有仓库。
- 修复未压缩项目压缩升级时误判自身重复，以及已删除项目的任务历史干扰新项目重复判断的问题。
- 调整使用说明入口与运行记录布局，具体日志只在日志列表中显示。

## 4.4.9

- 队列标题区的“添加单个文件夹”“添加单个视频”“扫描主目录”三个扫描入口统一右对齐，并保持原有按钮顺序和功能。

## 4.4.8

- 修复自动更新替换程序目录时可能形成同名嵌套目录、导致新 EXE 继续加载旧版应用代码并回滚的问题。
- 更新器现在先备份并移除对应旧程序项，再精确写入新版；`userdata` 始终排除在替换范围之外。
- 4.2.0 内置旧更新脚本，需按失败弹窗中的步骤手动升级一次；后续版本使用修复后的更新器。

## 4.4.6

- 汇总界面细节修正：默认展开归档后处理、固定撤回按钮宽度、统一无相似项目底色，并修正运行记录间距。

## 4.4.3

- 队列按钮按原型重新排布，暂停移到工具栏右侧；清理队列新增“清空已取消队列”。
- 确认 4.2.0 客户端可以识别带 `v` 前缀的后续版本标签。

## 4.4.2

- 收紧归档后处理卡片间距，并让仓库大缩略图与上方工具栏边缘对齐。

## 4.4.1

- 进一步按 NEWUI 原型统一字体、间距、设置栏宽度和卡片尺寸，收存位置及其他设置区改为更紧凑协调的布局。
- 归档后处理重新排列并将地址输入框放入对应卡片；顶部状态明确显示是否移动原文件或移入回收站，既有校验与安全熔断保持不变。
- 仓库筛选、视图和工具按键改为紧凑工具栏，缩略图卡片尺寸更贴近原型；批量操作持续可见但只有勾选项目后才能执行，项目详情继续显示在页面底部。

## 4.4.0

- 重构归档工作台与仓库界面：设置折叠分组提供实时摘要，宽屏双栏更便于同时查看设置和任务，危险操作不再与常用按钮平铺。
- 仓库大缩略图自适应填满可用宽度，并提供无图片纯文本列表；项目详情仍固定显示在页面下方，既有整理与安全功能完整保留。
- 新增 64 MiB—10 GiB 可配置分卷，默认 10 GiB；关闭主动分卷也不能绕过超过 10 GiB 的确认与安全分卷，全部分卷继续作为一个整体校验、发布、删除和回滚。

## 4.2.0

- Windows 便携版入口统一为 `HamsterArchiver.exe`。从旧版升级时，请完整解压到新目录并复制旧版 `userdata`，不要只覆盖 EXE。
- 语言切换改为“⇄ EN / ⇄ 中文”按钮，补齐动态任务、仓库卡片、提示、确认框和任务阶段的英文翻译。
- 修复更新助手启动失败、更新失败记录可能被重复提示，以及更新包可执行文件校验不严格的问题。

## 4.1.1

- 产品品牌统一为 Hamster Archiver；新版发布包保留 `HamsterArchive.exe` 物理入口名，确保旧版更新助手可以无感升级。
- 新增简体中文 / English 界面语言选项，并提供英文版 README。
- 回收站安全熔断现在只复核当前刚处理的任务，不再抽查历史项目，避免用户主动清理造成误报。

## 4.1.0

- 检查更新现在可以自动下载、校验并暂存 Windows 便携包；重启后由独立更新助手替换程序文件，启动失败时尝试恢复旧版本，`userdata` 不会被覆盖。
- 仓库新增白昼与黑夜主题；活跃度改为按每日入库项目数分级，达到 100 项/天才显示最深颜色。
- 仓库详情可以打开原文件当前位置；回收站中的项目可确认复原到原位置，成功后自动在文件浏览器中定位并更新状态。
- 队列任务可直接打开来源位置；重复待确认任务可跳转到仓库中的相似项目。
- 更新应用与 README 品牌图标；公开仓库更名为 `hamster-archiver`，并完善双语简介、CI 状态与项目标签。

## 4.0.0

- 原文件位置状态在项目详情页中可见；来源失效时统一显示“未发现原文件”，并保留安全的固定原始路径记录逻辑。
- 7-Zip 改为随软件携带且不再允许用户修改路径；高级设置新增 7z/ZIP 格式与 0—9 压缩等级，默认使用 7z 快速压缩。
- 视频帧备份默认 3 帧，单项目缩略图上限默认 30 张。
- 外部仓库导入仅接受 ZIP 压缩包。
- 更新 README 的界面说明与项目详情展示。

## 3.5.0

- 仓库封面、项目媒体预览和随机漫步统一完整显示图片，竖图不再被裁掉；留白区域使用同图模糊铺底。
- 修复关闭“小项目过滤”后仍无法加入极小文件夹的问题，扫描与单项添加不再被尚未填写的成品目录提前阻断。
- 加固 FC2 等编号型标题的相似判断，排除词清理后只剩数字编号时不再建立无意义的相似关系。
- 接入统一的仓鼠文件夹应用图标，并重新整理 README 的真实项目界面总览。
- 统一归档位置两列控件的宽度、高度、间距与文字基线，改善设置页对齐。

## 3.0.0

- 归档高级设置重新分组，视频帧备份与小项目过滤移入高级区，并补充项目页 GitHub 与反馈入口。
- 每个仓库项目拥有独立的原文件位置状态；应用核验已移动或已回收的来源，位置失效时标记为“未发现原文件”。
- 删除仓库记录时可尝试把已移动或已回收的原文件恢复到原始位置；恢复失败会保留仓库记录和成品。
- 相似项目支持单项重新计算和双向解除关系，手动解除结果会持久保存。
- 清理解压密码的重复展示，保留默认遮盖、主动显示和复制能力。
- README 使用虚构数据和公开授权素材重做，补充真实界面、数据边界及便携布局说明。

## 2.0.0

- 便携版 7-Zip 与 FFmpeg 使用相对路径；整体移动软件目录后仍可自动定位，`userdata` 内部路径也会随软件重定位。
- 压缩暂存区自动放在成品目录旁，减少跨磁盘发布压缩包的时间与失败风险。
- 增加 GitHub 手动检查更新，并对连接超时给出明确提示。
- 压缩队列根据最近 30 次任务的实际速度显示剩余任务数和预计等待时间。
- 调整仓库导入、导出、随机漫步和图片预览操作布局，重做使用说明界面。
- 删除每日回顾入口，收敛仓库概览功能。

## 1.1.0

- 队列按钮、使用说明和密码编辑逻辑优化。
- 多卷压缩包改为隔离暂存后整体删除，失败自动回滚。
- 随机漫步洗牌算法，一轮内不重复推荐同一项目。
- 高频进度事件只发送任务 ID、阶段和百分比。
- 仓库列表分页、详情目录虚拟渲染。
- SQLite 中文分词候选索引、相似候选索引、文件指纹索引。
- FFmpeg 探测解析测试及成功/降级日志。
- 坏文件跳过并记录日志；存在跳过项时强制保留源项目。

## 1.0.0

- 首个公开版本：提供按一级文件夹或视频独立压缩、10 GiB 分卷、加密和完整性校验。
- 大任务、疑似重复与体积异常采用人工确认流程；异常成品可安全删除而不移动源文件。
- 使用 SQLite 建立本地仓库，支持缩略图、视频均匀截帧、模糊搜索、标签、星级、备注和相似项目。
- 支持暂停、完成当前项后暂停、定时运行、拖放导入、批量整理与可恢复的源文件后处理。
- 采用便携式 `userdata` 布局；设置、密码记录、仓库、日志和暂存区留在软件目录中。
- 发布包随附便携版 7-Zip，并以单个 FFmpeg 程序完成视频信息读取与缩略图抽帧。
