# Hamster Archiver 4.6.4

## 中文

4.6.4 是面向仓库浏览、新手引导和入库错误反馈的维护版本。

### 仓库活跃度

- 尚未到达的日期现在和无活动日期一样保留主题对应的中性灰底，不再显示成透明空洞。
- 鼠标悬浮或键盘聚焦色块时，会显示完整日期与当天仓储内容数量。
- 点击色块或按 Enter/Space，会按该入库日期精确筛选仓库；工具栏会显示当前日期条件，并可一键清除。

### 新手引导与文案

- 空仓库引导扩展为六步，依次聚焦归档工作台入口、整块收纳设置、唯一必填的压缩包存放位置、原文件后处理与顶部状态、队列操作和拖放区。
- 原文件后处理步骤同时框选工作台设置与顶部状态，不把中间无关区域并入高亮；完成引导后播放一次轻量 emoji 庆祝效果，跳过或关闭时不播放。
- “收存位置”改为“收纳设置”，“压缩后保存在”改为“压缩包保存在”；使用说明首项改为“把资源添加到仓库”，并精简说明。
- 回收站自动处理确认文案改为“只要验证并入库成功”，消除条件表达歧义。

### 小项目过滤

- 通过“添加单个视频”、拖放或粘贴加入的项目若低于当前阈值，都会显示去除底层调用包装后的同一条可读错误。
- 报错后自动展开“入库与预览”，滚动到“小项目过滤”并短暂闪烁对应卡片，直接提示用户应调整的位置。

### 升级与数据

本版本不更改仓库格式、用户资料位置或现有记录，不需要迁移或重建数据。

## English

4.6.4 is a maintenance release focused on warehouse browsing, onboarding and intake-error feedback.

### Warehouse activity

- Future dates now keep the theme's neutral empty-cell background instead of appearing as transparent holes.
- Hovering a cell or focusing it with the keyboard shows the full date and the number of warehouse items added that day.
- Clicking a cell, or pressing Enter/Space, filters the warehouse to that exact inventory date. A visible toolbar chip shows and clears the date filter.

### Onboarding and copy

- Empty-warehouse onboarding now has six steps covering the Workbench entry, the full intake setup, the only required archive location, source-file post-processing and its header status, queue actions, and the drop zone.
- The post-processing step highlights both relevant areas without including the unrelated middle of the interface. Completing the guide plays one lightweight emoji celebration; skipping or closing it does not.
- “Locations” is now labeled “Intake setup”, archive-output copy is clearer, and the first quick-start item now explains how to add resources to the warehouse.
- The Recycle Bin confirmation now states that source handling occurs as soon as verification and cataloging succeed.

### Small-item filtering

- Items below the current threshold now show the same readable error whether added through the single-video picker, drag and drop, or paste, without exposing the underlying IPC wrapper.
- The error automatically expands “Intake & previews”, scrolls to “Small-item filtering”, and briefly highlights the relevant card.

### Upgrade and data

This release does not change the warehouse format, user-data locations or existing records. No migration or rebuild is required.
