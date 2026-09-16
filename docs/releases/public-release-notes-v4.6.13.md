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
