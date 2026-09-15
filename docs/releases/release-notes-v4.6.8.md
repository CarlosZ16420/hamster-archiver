# Hamster Archiver 4.6.8

## 中文

本次私有发行汇总正式版 4.6.5 → 4.6.8 的用户可见变化，包含源码版本 4.6.6 和 4.6.7 的维护内容。

### 工作台与仓库

- 归档工作台的扫描和入库操作分别保持在两行右对齐；仓库活跃度固定显示最近 20 周，窗口变窄且视图停留在最新端时仍保持最新日期可见。
- 手动新增库存的备注改为选填，之后也可清空；MCP 仓库概览默认只返回紧凑汇总，活动日期仅在明确请求时提供。

### 中英文界面与首次使用

- 补齐队列状态、处理阶段、提示、运行反馈、主进程原生弹窗和启动错误的中英文文案，并统一术语；精简英文表达，同时保留用户自行填写的标题、路径等原文。
- 首次启动且尚未保存语言时，中文 Windows 默认使用中文，其他 Windows 界面语言默认使用 English；之后沿用已保存的语言选择。
- 空仓库引导第一步新增固定双语的 `Language / 语言`、`中文`、`English` 选择器。切换后界面立即更新并保存设置，不增加引导步骤。

### 打包启动与数据

- 未变化且已验证的发行包可复用完整性校验缓存；首次启动、升级、移动程序或关键文件变化时仍执行全量校验。
- 校验完成前不开放仓库与业务操作；下载、更新和发行验收继续执行完整校验，缓存不可用时安全回退。
- 本次范围不更改仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This private release summarizes user-facing changes from stable 4.6.5 to 4.6.8, including maintenance delivered in source versions 4.6.6 and 4.6.7.

### Workbench and warehouse

- Workbench scan and intake actions stay in two separately right-aligned rows. The activity chart keeps a fixed layout for the latest 20 weeks and preserves the newest dates when a view at the latest end is narrowed.
- Notes for manually created inventory items are optional and can be cleared later. MCP warehouse insights return a compact summary by default and include activity dates only on request.

### Chinese and English interface and first run

- Completed bilingual copy for queue states, processing stages, notices, runtime feedback, native main-process dialogs and startup errors, with consistent terminology. English copy is shorter while user-entered titles and paths remain unchanged.
- On first launch without a saved language, Chinese Windows uses Chinese by default and other Windows interface languages use English. The saved choice is used on later launches.
- The first empty-warehouse guide step now includes a fixed bilingual `Language / 语言`, `中文` and `English` selector. A change applies immediately and is saved without adding another guide step.

### Packaged startup and data

- An unchanged, previously verified distribution can reuse its integrity cache. First launch, upgrade, moving the app or changing a critical file still triggers full verification.
- The warehouse and business operations remain unavailable until verification completes. Downloads, updates and release acceptance still perform full checks, with a safe fallback when the cache is unavailable.
- These changes do not alter the warehouse format, user-data locations or existing records. No migration or rebuild is required.
