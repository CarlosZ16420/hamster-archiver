# Hamster Archiver 4.6.14

## 中文

4.6.14 改进仓库标签浏览、筛选与键盘翻页，让常用入口更稳定、紧凑。

### 标签浏览与筛选

- 标签筛选始终按“全部标签、可能重复、未压缩、用户标签”排列；超过 20 行的内容在下拉面板内滚动，不再无限拉长工具栏菜单。
- “未压缩”作为应用提供的状态标签，中文界面显示“未压缩”，英文界面显示“Uncompressed”；用户自行填写的标签仍保持原文。
- 仓库概览中的“标签”指标现在可点击，打开与记录统计一致的全部标签视图。视图展示特殊标签、全部用户标签及各自项目数，选择标签后直接返回仓库并应用筛选。

### 浏览工具

- 使用键盘左右方向键翻页时只切换仓库内容，不再把页面强制滚动到结果区顶部；鼠标分页和手动输入页码继续保留原有定位行为。
- 排序选择精简为“入库 ↓ / 入库 ↑ / 名称 A–Z / 名称 Z–A”，减少工具栏占用空间。
- 列表名称列提供一键复制按钮，复制完整项目名称且不打开详情或改变选择；收紧类型、文件数量和大小/状态列距。
- 全选框不再显示旁边的重复说明，保留中英文悬停提示和可访问名称。搜索框随窗口收缩、聚焦后原位展开，避免挤走仓库工具；队列的五项状态统计在窄窗口下保持一行。

### 运行日志

- 关闭应用后运行日志仍保存在当前用户数据区的 `logs/app.log`；下次启动会恢复最近 300 条有效记录，正常退出前会等待日志写入完成。
- 日志现在补记启动与退出、设置字段变化、用户数据区切换、更新操作、相似度排除词维护、仓库删除失败和关键后台错误。设置记录只包含变化字段，不保存密码内容；普通搜索、浏览、复制和打开位置不会记入日志。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

Version 4.6.14 improves Warehouse tag browsing, filtering, and keyboard pagination with steadier, more compact controls.

### Tag browsing and filtering

- The tag filter always lists All tags, Possible duplicate, and Uncompressed before user tags. Menus longer than 20 rows scroll internally instead of growing without limit.
- Uncompressed is an app-provided status tag and follows the interface language. User-created tags remain exactly as entered.
- The Tags metric in the Warehouse overview now opens an all-tags view styled like item statistics. It shows special tags, every user tag, and item counts; choosing one returns to the Warehouse and applies that filter.

### Browsing tools

- Left and right arrow pagination now changes only the Warehouse page and preserves the current window scroll position. Mouse pagination and typed page numbers keep their existing positioning behavior.
- Sort choices are shortened to Added ↓ / Added ↑ / Name A–Z / Name Z–A to use less toolbar space.
- Each list row has a button to copy its complete item name without opening details or changing the selection. Type, file count, and size/status columns use tighter spacing.
- The select-all checkbox no longer repeats its explanation beside it; bilingual tooltips and accessible labels remain. Search shrinks with the window and expands in place on focus to leave room for Warehouse tools. All five queue statistics stay in one row at narrow widths.

### Runtime log

- Runtime logs remain in `logs/app.log` inside the active user-data area after the app closes. The next launch restores the latest 300 valid entries, and a normal exit waits for pending log writes.
- Logs now cover startup and exit, changed setting fields, user-data-area switches, update actions, similarity ignore-list maintenance, Warehouse deletion failures, and critical background errors. Setting records never include password values; routine searching, browsing, copying, and opening locations are not logged.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records are unchanged; no migration or rebuild is required.
