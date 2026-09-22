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
