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

### 本地后续维护：仓库整理（未升版）

- 列表与缩略图共用多选规则：普通框选替换、Ctrl 框选反选、Shift 框选追加；Ctrl 点击切换单项，Shift 点击选择当前页连续范围，Ctrl+Shift 点击追加范围。输入框和弹窗不会接管这些仓库快捷操作。
- 选择当前页的复选框显示空框、半选横杠或全选对勾；半选点击补齐当前页，全选点击清空所有页选择。Esc 提供直接取消入口，已选计数显示跨页项目数量；移除重复的独立清空按钮。
- 仓库工具增加小/中/大缩略图尺寸并记住偏好，不改变分页数量或重生成图片。向下浏览后可一键返回搜索筛选与批量操作栏，避开顶部导航，不跳回仓库概览。

### 本地后续维护：运行时（未升版）

- Electron 从 43.4.0 更新到 43.7.1 稳定版，保留 43 系列接口兼容性，并同步依赖与运行时完整性锁定。其他依赖和应用版本号不变，无需迁移用户资料。

### 本地后续维护：仓库显示与撤回（未升版）

- 缩略图大小调整移到仓库工具底部，移除辅助说明，标签与选择框对齐；分页可手动输入页号并通过 Enter 跳转。
- 修复小、中、大缩略图封面顶部空白；列表表头与数据共用列宽和间距，窄窗口同步隐藏字段。
- Windows 回收站批量查询统一 UTF-8 路径输出，并分批查询全部路径，修复中文路径及超过 100 个路径时对仍存在文件的错误判定。撤回继续保护原位置已有文件。

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

### Subsequent local maintenance: Warehouse organization (same version)

- Both views share selection rules: a plain marquee replaces selection, Ctrl marquee toggles hit items, and Shift marquee adds items. Ctrl clicks toggle one item; Shift clicks select a range on the current page, and Ctrl+Shift adds that range. Inputs and dialogs retain their own keyboard behavior.
- The page checkbox shows empty, mixed or checked states. Clicking a mixed state completes the current page; clicking a checked state clears selection across all pages. Escape provides direct cancellation, and the count identifies items on other pages; the redundant separate clear button is removed.
- Warehouse tools offer remembered small, medium and large thumbnail sizes without changing page sizes or regenerating images. After scrolling down, a floating button returns to search, filters and bulk actions below the navigation bar rather than to the overview.

### Subsequent local maintenance: runtime (same version)

- Electron moves from 43.4.0 to the stable 43.7.1 release, retaining the 43-series API compatibility and synchronizing dependency and runtime integrity locks. Other dependencies and the application version stay unchanged; user data requires no migration.

### Subsequent local maintenance: Warehouse display and undo (same version)

- Thumbnail size moves to the bottom of Warehouse tools with aligned controls and no helper text. Page numbers can be typed and confirmed with Enter.
- Fixes blank space above small, medium and large covers. List headers and data share column widths and spacing, hiding matching fields in narrow windows.
- Recycle Bin batch queries output UTF-8 paths and process every path in batches, fixing false missing-file reports for Chinese paths and queries exceeding 100 paths. Undo still protects existing destination files.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records are unchanged; no migration or rebuild is required. Undo history lasts only for the current run, while Windows continues to manage deleted files in the Recycle Bin after exit.
