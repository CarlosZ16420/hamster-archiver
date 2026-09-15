# Hamster Archiver 4.6.2

## 中文

本版本汇总 4.6.1 → 4.6.2 的界面、首次使用、媒体预览和发行维护改进。

### 首次使用与仓库界面

- 应用现在默认打开仓库，并把“仓库”放在导航首位。空仓库会显示三步新手引导，依次指向归档工作台、收存位置和队列操作；引导可随时跳过，也可选择以后不再提示。
- 仓库详情按钮由“保存整理信息”精简为“保存”，字号与“添加图片”一致；随机漫步卡片移除“随机一项库存”的重复说明。
- 黑夜、暮光等暗色主题中的仓库活跃度空白方格改用对应主题颜色，不再显示突兀白块。

### 入库与媒体预览

- 未压缩项目再次压缩入库时，如果仓库记录和当前设置都包含不同的备份位置，应用会询问是更新为本次设置还是保留原位置。选择会随队列任务保存，避免运行期间设置变化造成错写。
- 自动移入回收站的启用说明由“才会把”改为“就会把”，中英文提示同步调整，明确成功后的处理结果。
- 视频抽帧不再在图片文件中补黑边。横屏和竖屏画面均保留原始比例，由仓库卡片使用完整前景和现有模糊背景适配固定展示区域；不会额外引入透明通道或放大图片体积。

### 更新与发行

- 正式 Release 改为云端优先：完整草稿可直接发布，已经完整发布的版本会幂等结束；只有云端任务停止且失败时才使用明确的本地后备构建。
- 启用无需令牌的 CNB 公共更新后备。GitHub 不可用时，应用可通过公开 latest 跳转发现版本，并校验公开附件及 SHA-256 旁车后下载。

### 升级与数据

仓库格式、用户资料位置和现有记录保持兼容。新手引导关闭状态写入现有设置；库内项目压缩只更新用户明确选择的备份位置，不迁移或重建仓库数据。

## English

This release covers interface, first-use, media-preview and release-maintenance changes from 4.6.1 to 4.6.2.

### First use and warehouse interface

- The app now opens the Warehouse by default and places it first in navigation. An empty warehouse offers a three-step guide pointing to the Workbench, location setup and queue actions. The guide can be skipped at any time or permanently disabled.
- The warehouse detail action is shortened from “Save organization details” to “Save” and now matches the Add images button size. Random Walk no longer repeats the “random inventory item” subtitle.
- Empty cells in the warehouse activity chart now use theme-specific colors in Night, Twilight and other dark themes instead of appearing as bright white blocks.

### Intake and media previews

- When compressing an existing uncompressed item, the app asks whether to replace or preserve its backup location if the warehouse record and current setting contain different values. The decision is snapshotted with the queued task so later setting changes cannot alter it.
- The Recycle Bin confirmation wording now states the successful post-intake result directly, with synchronized Chinese and English text.
- Extracted video frames no longer contain baked-in black padding. Landscape and portrait frames retain their original aspect ratio while the warehouse card uses the full foreground and existing blurred backdrop to fit its fixed area, without adding an alpha channel or inflating image dimensions.

### Updates and releases

- Stable releases now use a cloud-first flow: complete drafts can be published directly and complete published releases finish idempotently. An explicit local fallback is used only after a stopped cloud failure.
- Enabled the token-free public CNB update fallback. If GitHub is unavailable, the app can discover the release through the public latest redirect and download only after validating public assets and their SHA-256 sidecar.

### Upgrade and data

Warehouse format, user-data locations and existing records remain compatible. The onboarding preference uses existing settings, and warehouse compression changes a backup location only after the user makes an explicit choice; no data migration or warehouse rebuild is required.
