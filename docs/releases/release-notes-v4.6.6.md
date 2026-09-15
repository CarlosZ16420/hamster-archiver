# Hamster Archiver 4.6.6

## 中文

4.6.6 是针对近期界面回归的修订版本，重点恢复归档工作台按钮布局，并明确仓库活跃度的固定显示规则。

### 工作台与仓库布局

- 归档工作台的扫描操作和入库操作分别保持在两行右对齐，不再因为窗口宽度变化而互相挤压、错位或被面板边缘截断。
- 仓库详情的“原文件位置”与“打开”按钮之间增加与压缩包“复制”按钮一致的视觉间距。

### 活跃度

- 概览固定展示截至当前周的最近 20 周，最后一列始终是包含最新日期的当前周。
- 方格尺寸和列间距保持固定；宽窗口不再拉伸列距，只有容器不足以容纳 20 周时才显示横向滚动条。
- 初次显示以及用户仍停留在最新端时，窗口缩窄后自动保持最右侧的最新日期可见；删除标题下方重复的活跃度说明。

### 引导与手动库存

- “首先进行收纳设置”引导优先显示在高亮设置区域右侧；完成全部引导后的庆祝动画增加多点烟花、彩色火花和上升粒子。
- 手动新增库存的备注改为选填，后续编辑也允许清空备注；新增弹窗顶部的说明段已删除。

### 自动化与数据

- MCP 仓库概览默认只返回紧凑汇总，仅在明确请求时提供非空活动日期，避免把大量空热力图数据写入 AI 上下文。
- 本版本不更改仓库格式、用户资料位置或现有记录，不需要迁移或重建数据。

## English

4.6.6 is a patch release for recent UI regressions. It restores the Workbench action layout and defines predictable fixed-layout behavior for warehouse activity.

### Workbench and warehouse layout

- Scan actions and intake actions remain in two separately right-aligned rows, avoiding overlap, misalignment and panel-edge clipping as the window changes size.
- The Open button after Original location now has the same visual spacing used by the Copy button on the archive row.

### Activity

- The overview shows the latest 20 weeks through the current week, with the final column always containing the newest dates.
- Cell size and column spacing remain fixed. Wide windows no longer stretch the gaps, and horizontal scrolling appears only when the container cannot fit all 20 weeks.
- The initial view, and any view already pinned to the newest end, stays scrolled to the newest dates after the window narrows. The redundant activity subtitle has been removed.

### Onboarding and manual inventory

- The “Start with storage settings” guide card prefers the right side of the highlighted settings panel. Completing the guide now plays multi-point fireworks with colored sparks and rising particles.
- Notes are optional when creating a manual inventory item and may also be cleared later. The explanatory paragraph at the top of the creation dialog has been removed.

### Automation and data

- MCP warehouse insights return a compact summary by default and provide non-empty activity dates only when explicitly requested, avoiding large empty heatmap payloads in AI context.
- This release does not change the warehouse format, user-data locations or existing records. No migration or rebuild is required.
