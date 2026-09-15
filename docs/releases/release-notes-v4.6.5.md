# Hamster Archiver 4.6.5

## 中文

4.6.5 是面向仓库历史浏览、概览布局和自动化接口稳定性的维护版本。

### 仓库统计与活跃度

- 点击仓库概览中的库存数量或 GB 容量，会打开记录统计弹窗。月视图按日显示入库数量与容量，并可纵向翻阅到最早入库年份；年视图提供逐年和逐月汇总。
- 活跃度展示截至当前周的最近 16 周，默认直接显示最新日期。日期格保持固定比例并在正常宽度下均匀占满区域，只有容器确实放不下时才显示可拖动横向滚动条。
- 活跃度悬浮提示、键盘操作和按日期筛选保持不变；本周尚未到达的日期继续使用中性灰底。

### 随机漫步与窗口布局

- 白昼主题下，没有项目封面的随机漫步改用森林主题的绿金渐变。
- 新建空仓库会立即显示同一默认背景，但不显示“暂无封面”占位文字，不再停留在加载空白。
- 顶部“仓库 / 归档工作台”导航使用对称布局保持居中；窗口不足以容纳左右控件时单独换行，避免与状态、主题和语言按钮重叠。

### 自动化与发行可靠性

- MCP 常用操作增加明确字段白名单、分页与最新状态令牌保护，并收紧队列批次、仓库导入导出和位置切换的确认与结果边界。
- GitHub Release 首次发布和中断续传流程得到收紧，降低重复查询、草稿状态竞争与可恢复上传失败造成的误判。

### 升级与数据

本版本不更改仓库格式、用户资料位置或现有记录，不需要迁移或重建数据。历史统计只读取已有记录，不会隐式触发全库重算。

## English

4.6.5 is a maintenance release focused on warehouse history, overview layout and automation reliability.

### Warehouse statistics and activity

- Clicking the Inventory or GB total in the warehouse overview opens record statistics. The monthly view shows daily item and storage totals and scrolls back to the earliest inventory year; the yearly view provides annual and monthly summaries.
- Activity shows the latest 16 weeks through the current week, so the newest dates are visible immediately. Cells keep fixed proportions and spread across the available normal-width area; a draggable horizontal scrollbar appears only when the container is genuinely too narrow.
- Existing tooltips, keyboard actions and exact-date filtering remain available. Upcoming dates in the current week retain the neutral empty-cell color.

### Random Walk and window layout

- In the Daylight theme, Random Walk cards without a project cover now use the Forest theme's green-and-gold gradient.
- A new empty warehouse immediately displays the same default background without a “No cover” placeholder instead of remaining on an empty loading state.
- The Warehouse / Workbench navigation remains centered in a symmetric layout and moves to its own centered row before it can overlap status, theme or language controls.

### Automation and release reliability

- Common MCP operations now use explicit setting allowlists, compact pagination and current-state tokens, with tighter queue-batch, warehouse import/export and location-switch confirmation boundaries.
- Initial GitHub Release publishing and interrupted-upload recovery are more robust against duplicate queries, draft-state races and recoverable upload failures.

### Upgrade and data

This release does not change the warehouse format, user-data locations or existing records. No migration or rebuild is required, and history statistics only read existing records without triggering a full-library recalculation.
