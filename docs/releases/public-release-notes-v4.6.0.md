# Hamster Archiver 4.6.0

本说明汇总上一实际公开正式版本 **4.5.18** 之后至 **4.6.0** 的用户可见变化，供公开 GitHub Release 使用。

## 中文

### 浏览与 AI 接入

- 大项目详情查询会在数据库中先排除当前项目，避免重复读取、排序和解析整份项目数据；缩略图按可见区域加载并限制并发。
- 新增默认关闭的本机 MCP 接口，支持 AI 批量入库、查询项目和文件清单、轮询进度，并在相似提示后继续、跳过或重试；AI 入库保留源文件。
- 更新窗口按版本倒序展示本地版本之后的正式发行说明，并按当前语言显示中英文内容；历史说明缺失时给出明确提示。

### 队列、重复判断与入库

- 当待入库项目的同一原始位置、完整目录结构、文件名、文件数量和文件大小都与仓库记录一致时，可直接判定为完全重复并跳过 MD5；自动跳过仍受用户设置开关控制，无法确认完整快照时仍执行内容核验。
- 归档入库复用已生成的清单和目录信息，减少重复遍历、重复文件统计和整库写回；跨存储移动仍保留成品身份复核。
- 队列运行期间可以继续扫描、拖放或添加单项。新项目显示“等待下次入库”，安排到下一轮处理，避免与当前任务冲突。
- 自动跳过且保留在队列中的项目会自动取消选择，避免后续批量操作误触发。

### 界面与兼容性

- 删除自动跳过设置中重复的长说明；完成状态和“相似报告”按钮在窄窗口保持单行显示。
- 更新窗口移除标题旁装饰图标，版本序列改用绿色。
- Windows 原生窗口改用包含多种原生尺寸帧的 ICO，改善标题栏小图标清晰度。

### 数据与安全

本次升级不改变 SQLite 结构或用户数据位置。重复判断只有在同一原始位置且完整目录和文件元数据快照可确认时才跳过 MD5，并且仍受用户启用的自动跳过设置控制；无法确认时继续使用内容核验。归档成品移动仍执行身份复核，源文件后处理继续在验证和登记成功后进行。

## English

This release summarizes the user-visible changes delivered after the previous formal public release, **4.5.18**, through **4.6.0**.

### Browsing and AI integration

- Large project details now exclude the current project in the database before loading results, avoiding repeated reads, sorting and parsing of the full project record. Thumbnails load near the visible area with bounded concurrency.
- Added an opt-in local MCP interface for AI batch intake, project and manifest queries, progress polling, and continue, skip or retry actions after similarity review. AI intake keeps source files in place.
- The update window lists formal releases after the local version in descending order and shows the matching language, with an explicit message when historical notes are incomplete.

### Queue, duplicate handling and intake

- When the same original source location, complete directory shape, filenames, file count and file sizes all match a warehouse record, the project can be classified as a complete duplicate without calculating MD5. Automatic skipping still follows the user's setting, and content verification runs when the complete snapshot cannot be confirmed.
- Archive intake reuses the generated manifest and directory information, reducing repeated traversal, file statistics and full-catalog writes. Cross-storage moves still verify archive identity.
- Folders, videos and dropped paths can be added while the queue is running. New items show “Waiting for next intake run” and are scheduled for the next run to avoid conflicting with the active task.
- Items kept in the queue after an automatic duplicate skip are deselected automatically so later batch actions cannot act on them accidentally.

### Interface and compatibility

- Removed the redundant long explanation from automatic-skip settings; completed statuses and the “Similarity report” action stay on one line in narrow windows.
- Removed the decorative title icon from the update window and changed the version sequence to green.
- Windows native windows now use a multi-resolution ICO with native-size frames for sharper title-bar icons.

### Data and safety

This upgrade does not change the SQLite schema or user-data location. MD5 is skipped only when the same original source location and a complete directory and file-metadata snapshot are confirmed, and automatic skipping remains controlled by the user's setting; otherwise content verification continues. Archive moves still verify file identity, and source post-processing remains gated on successful verification and registration.
