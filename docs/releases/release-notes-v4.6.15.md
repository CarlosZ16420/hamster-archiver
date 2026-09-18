# Hamster Archiver 4.6.15

## 中文

4.6.15 优化仓库工具布局与浏览交互。

### 本地后续维护：不压缩入库

- 未压缩目录支持单项与批量更新，同路径二次拖入绑定最近一次成功写入内容的记录。仅新增直接并入原记录；删改、旧信息不足及转压缩前变化先展示报告，可覆盖、新建独立项目或跳过。
- 文件与空目录共用一次属性快照，保存后不丢目录和读取错误。未变化指纹与有效预览复用，不为刷新补算历史 MD5；独立项目不复制原文件或旧项目人工信息。
- 更新批次立即开始、范围固定，报告确认与恢复不带动无关任务；手动暂停仅在下一次定时开始时自动继续。更新说明可关闭，但删改确认不会被关闭。
- 支持手动重设原文件位置，位置变更不会立即扫描。目录更新不改动原文件；二次压缩仍沿用已有后处理设置。加强源集合变化检测和已提交任务恢复，中英文界面及 AI／CLI 待确认回执同步更新。
- 本次保持 4.6.15，不代表已更新公开 Release。

### 仓库布局与提示

- 批量操作栏固定选择计数与按钮的层次，撤回和手动新增保持紧凑对齐，避免调整窗口宽度时随意换行、拉伸。空间确实不足时，批量按钮组可横向滚动；极窄窗口下右侧操作整体进入下一行。
- 搜索框选中后不再显示红色外圈；库存、标签和 GB 指标的悬浮与键盘聚焦改为中性反馈。
- 修复详情统计胶囊内部重复内边距造成的空隙，让“备份位置：”与具体内容自然衔接。
- “并入外部仓库”入口和确认标题统一改为“导入仓库”，导入范围与同 ID 跳过规则保持不变。

### 浏览与分页

- 列表模式和缩略图模式点击条目都会定位到项目详情。复选框、名称复制、Ctrl/Shift 选择和框选继续使用各自的独立行为。
- 页码框移除上下微调按钮，点击或聚焦即显示可滚动的页码候选；可用鼠标或上下方向键与 Enter 选择，Esc 关闭并恢复当前页。
- 保留手动输入页码、Enter 或失焦提交；越界整数收敛到有效页，空值和非整数恢复当前页。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

Version 4.6.15 improves Warehouse tool layout and browsing interactions.

### Subsequent local maintenance: uncompressed intake

- Refresh one uncompressed folder or a selected batch. Dropping its original location again binds the most recently committed content record. Additions merge directly; modifications, deletions, incomplete history, and changes before compression require a report with replace, independent item, or skip choices.
- Files and empty directories share one property snapshot that preserves directory and error metadata. Reuse unchanged fingerprints and valid previews without filling historical MD5 gaps. Independent items copy neither originals nor the old item’s organization details.
- Refresh batches start immediately and keep their scope through review and recovery, without starting unrelated tasks. A manual pause resumes automatically only at the next scheduled start. Dismissible usage notices never suppress change review.
- Manually relocate originals without scanning immediately. Refresh never alters originals; later compression retains existing source-handling settings. Strengthen source-set validation and committed-task recovery, with bilingual UI and explicit AI/CLI confirmation receipts.
- This maintenance keeps version 4.6.15 and does not update the public Release.

### Warehouse layout and feedback

- Bulk selection counts and buttons keep a stable hierarchy. Undo and manual intake stay compact and aligned as the window changes width. When space is insufficient, bulk buttons scroll horizontally; at very narrow widths, the right action group moves together to the next row.
- Focused search no longer displays a red outer ring. Inventory, Tags, and GB metrics use neutral hover and keyboard focus feedback.
- Remove repeated padding inside detail statistic pills so the Backup location label flows naturally into its value.
- Rename the external Warehouse import entry and confirmation title to Import Warehouse. The import scope and existing-ID skip rules remain unchanged.

### Browsing and pagination

- Clicking an item in either list or thumbnail view scrolls to its details. Checkboxes, name copying, Ctrl/Shift selection, and marquee selection retain their independent behavior.
- Remove numeric spinner buttons from the page field. Clicking or focusing it opens a scrollable page list, with mouse selection or arrow keys and Enter. Escape closes the list and restores the current page.
- Keep direct page editing and submission with Enter or on blur. Out-of-range integers clamp to valid pages; empty or noninteger input restores the current page.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite Warehouse format, user-data locations, and existing records are unchanged; no migration or rebuild is required.
