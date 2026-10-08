# Hamster Archiver 4.8.5

## 中文

本次 Windows 正式版覆盖 4.8.4 → 4.8.5。

### 入库与启动

- 移除“不压缩入库”的额外风险弹窗；点击后按已选范围启动普通入库，重复项和来源变化仍沿用原有确认流程。
- 压缩暂存目录新增默认开启的自动选项，随压缩包位置变化；关闭后保留当前路径，并可继续手动设置，兼容已有自定义目录。
- 启动窗口首次绘制即显示进度反馈；实验性 AI 接入中的 Codex Skill 调用方式选择器与界面样式保持一致。

### Windows 下载与更新

- 新版便携发行包同时提供内容相同的 ZIP 与高压缩率 7z，各有 SHA-256 旁车；排除文档图片以减小下载体积，不影响运行所需资源。
- 便携更新优先选择有摘要的 7z；元数据没有可用 7z，或 7z/旁车返回 404 或 410 时，回退到同版本 ZIP。摘要不符、地址不可信或包内完整性失败会停止，不会切换格式绕过校验。
- 更新窗口列出公开 `main` 上已发布的 Windows 正式版本和说明，用户可选择高于当前版本的目标版本；Mac Beta 不进入 Windows 在线更新列表。
- 队列标题横向布局与普通大小文字显示得到修正。

### 升级与数据

本次仓库格式和用户资料保持兼容，无需迁移或全库重建。Mac Beta 通过独立测试发行提供，不属于 Windows 正式版安装包。

## English

This Windows stable release covers 4.8.4 → 4.8.5.

### Intake and startup

- Remove the extra caution dialog for uncompressed intake. Clicking starts ordinary intake within the selected scope; existing duplicate and source-change decisions remain in place.
- Add an enabled-by-default automatic archive-staging option that follows the archive destination. Turning it off preserves the current path and keeps manual selection available, including existing custom folders.
- The startup window shows progress on its first painted frame. The experimental Codex Skill invocation selector follows the application's visual style.

### Windows downloads and updates

- New portable releases provide matching ZIP and high-compression 7z packages, each with its own SHA-256 sidecar. Documentation images are excluded to reduce download size while required runtime resources remain included.
- Portable updates prefer a 7z with a published digest. They fall back to the same-version ZIP only when metadata has no usable 7z or the 7z/sidecar returns 404 or 410. A digest mismatch, untrusted URL, or package-integrity failure stops the update; changing formats never bypasses verification.
- The update dialog lists published Windows stable releases from public `main` with their notes and lets users select a version newer than the installed one. Mac Betas do not appear in the Windows online update list.
- Correct the queue heading's horizontal layout and restore readable styling for ordinary size text.

### Upgrade and data

The Warehouse format and user data remain compatible without migration or a full rebuild. Mac Beta is distributed separately and is not part of the Windows stable installer.
