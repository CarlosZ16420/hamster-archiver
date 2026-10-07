# Hamster Archiver 4.8.5

## 中文

本次公开 Windows 正式版累积覆盖 4.8.4 → 4.8.5，纳入该范围内已合入的产品维护与更新。

### 入库与启动

- 移除“不压缩入库”的额外风险弹窗；点击后按已选范围启动普通入库，重复项和来源变化仍沿用原有确认流程。
- 压缩暂存目录新增默认开启的自动选项，随压缩包位置变化；关闭后保留当前路径，并可继续手动设置，兼容已有自定义目录。
- 启动窗口首次绘制即显示进度反馈；实验性 AI 接入中的 Codex Skill 调用方式选择器与界面样式保持一致。

### Windows 下载与更新

- 新版 Windows 便携发行包提供内容相同的 ZIP 与高压缩率 7z，各自附 SHA-256；排除随包文档图片以减小下载体积，程序运行资源保持完整。
- 便携版更新优先下载并校验有摘要的 7z；元数据没有 7z，或 7z/旁车返回 404 或 410 时，才回退同版本 ZIP。摘要错误、地址不可信或包内完整性失败会停止更新，不会换格式绕过校验。
- 更新窗口可查看公开 `main` 上已发布的 Windows 正式版本及说明，并选择高于当前版本的目标版本。Mac Beta 不出现在 Windows 在线更新列表。
- 队列标题与横向布局得到修正；普通大小文字恢复易读显示。

### 升级与数据

升级范围为 4.8.4 → 4.8.5。Windows 使用完整便携 ZIP 或 Setup 安装程序升级。仓库格式和用户资料保持兼容，无需迁移或全库重建。Mac Beta 通过独立测试发行提供，不属于 Windows 正式版安装包。

## English

This public Windows stable release covers 4.8.4 → 4.8.5 and includes merged product maintenance and updates from that range.

### Intake and startup

- Remove the extra caution dialog for uncompressed intake. Clicking starts ordinary intake within the selected scope; existing duplicate and source-change decisions remain in place.
- Add an enabled-by-default automatic archive-staging option that follows the archive destination. Turning it off preserves the current path and keeps manual selection available, including existing custom folders.
- The startup window shows progress on its first painted frame. The experimental Codex Skill invocation selector follows the application's visual style.

### Windows downloads and updates

- New Windows portable releases provide matching ZIP and high-compression 7z packages, each with its own SHA-256 file. Documentation images are excluded to reduce download size while required runtime resources remain included.
- Portable updates prefer a 7z with a published digest. They fall back to the same-version ZIP only when metadata has no usable 7z or the 7z/sidecar returns 404 or 410. A digest mismatch, untrusted URL, or package-integrity failure stops the update; changing formats never bypasses verification.
- The update dialog lists published Windows stable releases from public `main` with their notes and lets users select a version newer than the installed one. Mac Betas do not appear in the Windows online update list.
- Correct the queue heading's horizontal layout and restore readable styling for ordinary size text.

### Upgrade and data

The upgrade range is 4.8.4 → 4.8.5. Upgrade Windows through the complete portable ZIP or Setup installer. The Warehouse format and user data remain compatible without migration or a full rebuild. Mac Beta is distributed separately and is not part of the Windows stable installer.
