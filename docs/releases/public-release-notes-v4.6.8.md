# Hamster Archiver 4.6.8

## 中文

本版本汇总公开正式版 4.6.1 → 4.6.8 的变化。

### AI 接入与自动化

- 收紧常用 MCP 操作的字段和结果边界，并采用紧凑分页与最新状态令牌保护队列操作；仓库概览默认只返回汇总，非空活动日期仅在明确请求时提供。

### 首次使用与仓库浏览

- 应用默认进入仓库，空仓库提供可跳过的六步引导；第一步可选择中文或 English。首次启动会按 Windows 界面语言选择默认值：中文 Windows 使用中文，其他界面语言使用 English；之后始终保留已保存选择。
- 仓库概览的库存数量和 GB 容量可打开历史统计，按日浏览月度记录或查看年度汇总；活跃度可悬停查看日期与数量，也能按日期精确筛选。日期格展示最近 20 周，空白和未来日期使用主题对应的中性色。
- 空仓库与没有封面的随机漫步使用主题默认背景。手动新增库存的备注改为选填，也可在后续编辑时清空。
- 归档工作台的扫描和入库操作在不同窗口宽度下保持清晰分行；低于小项目过滤阈值的单项、拖放或粘贴输入会显示一致的可读提示并定位相关设置。

### 归档、更新与数据安全

- 横屏和竖屏视频抽帧保留原始比例，不再补入黑边。压缩已有未压缩项目时，如果仓库和当前设置中的备份位置不同，会先让用户选择，并把选择固定到队列任务。
- GitHub 不可用时，应用可通过公开 latest 地址发现更新，并从公开发行附件下载；下载内容必须通过对应 SHA-256 校验。
- 已验证且未变化的打包发行版可复用完整性缓存；首次启动、升级、移动程序或关键文件变化仍会全量核验。仓库和业务操作只会在核验及初始化成功后开放，下载、更新和发行验收仍始终全量核验。
- 中英文动态界面、状态和原生弹窗文案得到补齐与统一。切换英文时，用户自行填写的标题、路径等内容保持原文。

### 升级与数据

本次范围为公开正式版 4.6.1 → 4.6.8。应用继续通过完整程序目录或安装程序升级；本次变化不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.1 to 4.6.8.

### AI connection and automation

- Tightened common MCP field and result boundaries, with compact pagination and current-state tokens protecting queue actions. Warehouse insights return a compact summary by default and include non-empty activity dates only on request.

### First run and warehouse browsing

- The app opens the Warehouse by default and provides a skippable six-step guide for an empty warehouse. The first step lets you choose Chinese or English. On first launch, Chinese Windows defaults to Chinese and other Windows interface languages to English; later launches keep the saved choice.
- Inventory and GB totals open historical statistics with daily monthly records and yearly summaries. The activity chart shows dates and counts on hover and can filter by an exact date. It displays the latest 20 weeks, with theme-neutral colors for empty and future dates.
- Empty warehouses and Random Walk items without covers use the theme's default background. Notes for manually created inventory items are optional and can be cleared later.
- Workbench scan and intake actions stay in separate, clearly aligned rows at different window widths. Items below the small-item threshold show a consistent readable message whether added through the picker, drag and drop or paste, and the app points to the relevant setting.

### Archiving, updates and data safety

- Landscape and portrait video frames retain their original aspect ratio without black padding. When compressing an existing uncompressed item with a different saved and configured backup location, the app asks which location to use and stores the choice with the queued task.
- If GitHub is unavailable, the app can discover updates through the public latest endpoint and download public release assets. Downloads must pass the matching SHA-256 check.
- An unchanged packaged distribution that was already verified can reuse its integrity cache. First launch, upgrades, moving the app or changing a critical file still trigger full verification. The Warehouse and business operations remain closed until verification and initialization succeed; downloads, updates and release acceptance always perform full checks.
- Chinese and English dynamic interface, status and native-dialog copy is more complete and consistent. User-entered titles, paths and similar content remain unchanged when switching to English.

### Upgrade and data

This release covers public stable 4.6.1 → 4.6.8. Upgrade through the complete application directory or installer. The warehouse format, user-data locations and existing records remain unchanged; no migration or rebuild is required.
