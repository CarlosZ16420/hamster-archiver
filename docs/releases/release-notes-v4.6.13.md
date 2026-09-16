# Hamster Archiver 4.6.13

## 中文

4.6.13 为仓库删除补齐当前运行期间的撤回能力，修复历史队列造成的重复提示，并微调归档工作台标题对齐。

### 删除与撤回

- 删除仓库条目后，可在本次运行的最近十次撤回历史中恢复完整记录；本应用管理的压缩包和缩略图从 Windows 回收站恢复，不新增应用内回收站或长期暂存副本。
- 删除和撤回按顺序执行。关闭窗口或退出撞上在途操作时，窗口先隐藏，进程完成当前短操作后再结束，避免正常关闭截断数据库与文件收尾。
- 撤回前检查所需回收站内容和目标路径；内容已被清空或原位置出现同名文件时停止恢复，不覆盖现有文件，也不消耗该次撤回记录。

### 重复候选与界面

- 已自动跳过、已取消、失败和已完成的历史队列项不再作为新任务的重复候选；扫描可以重新加入已经结束的历史来源。
- 删除仓库候选时同步移除队列中的失效引用；只因该候选等待确认的任务恢复为正常排队。
- “01 · 收纳设置”轻微下移，与“02 · 扫描与队列”视觉上基本对齐，同时仍保持略高数个像素。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。撤回历史只在当前运行中有效；退出后由 Windows 回收站继续管理已删除文件。

## English

Version 4.6.13 adds same-session undo for Warehouse deletion, fixes duplicate prompts caused by finished queue history, and refines Workbench heading alignment.

### Deletion and undo

- Deleted Warehouse items can be restored from the ten-entry undo history during the current run. App-managed archives and thumbnails return from the Windows Recycle Bin; no in-app recycle bin or long-term staging copy is introduced.
- Delete and undo operations run in order. If the window closes or the app exits during one of these short operations, the window hides first and the process exits after file and database cleanup finishes.
- Undo checks required Recycle Bin content and destination paths first. Missing content or a same-name destination stops restoration without overwriting files or consuming the undo entry.

### Duplicate candidates and interface

- Automatically skipped, canceled, failed, and completed queue history no longer acts as a duplicate candidate for new tasks. Scanning can add a source again after its earlier queue work has ended.
- Deleting a Warehouse candidate removes stale queue references and returns tasks blocked only by that candidate to their normal queued state.
- “01 · Archive Setup” moves slightly lower for visual alignment with “02 · Scan & Queue” while remaining a few pixels higher.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records are unchanged; no migration or rebuild is required. Undo history lasts only for the current run, while Windows continues to manage deleted files in the Recycle Bin after exit.
