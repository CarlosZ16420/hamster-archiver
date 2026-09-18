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
