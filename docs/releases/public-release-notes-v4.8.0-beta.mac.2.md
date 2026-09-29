# Hamster Archiver 4.8.0-beta.mac.2 · macOS Beta

## 中文

本预发行版首次提供 Mac 下载，功能来源覆盖上一公开正式版 4.6.18 至本次 4.8.0-beta.mac.2 的已合入改动。Windows 最新正式版仍为 4.6.18；本页只提供 Mac DMG。

### 首个 Mac 版

- 提供 macOS 12 及以上的 Apple Silicon、Intel 通用架构 DMG。桌面仓库、目录与视频入库、7z/ZIP 压缩及归档内容校验复用现有业务流程；Mac 构建独立收纳在 `platforms/macos/`。
- 随包内置经过 SHA-256 校验的官方 Mac 版 7-Zip。资料默认放在 `~/Library/Application Support/Hamster Archiver/`，应用替换不会删除仓库；不改变 SQLite 仓库格式。
- macOS 扫描跳过符号链接，路径与卷判断考虑 Mac 常见的大小写及 Unicode 路径差异，归档前继续检查可用空间。同卷发布保留原子替换，跨卷操作继续复核复制结果。
- Mac 版提供系统应用菜单和可选的本机 CLI/MCP。视频抽帧默认关闭；需要此功能时须自行配置可用的 FFmpeg。
- 现有 Windows 回收站复原机制不适用于 macOS，因此 Mac Beta 禁用归档后自动移入废纸篓及本机压缩包的仓库删除。归档后仍可保留源文件或移动到指定目录。Mac 更新需从 GitHub 手动下载新版 DMG。

### 自 4.6.18 起的共同改进

- 归档现在保留来源中的空目录，并在成品发布前将文件路径、大小、目录结构与完整源清单比对；清单不完整或内容不符时停止发布和源文件后处理。
- CLI/MCP 增加直接使用的 v2 任务合同：入库方式、项目粒度、重复策略、持久回执与丢失响应后的同身份恢复更明确。任务先记录请求身份再准备，已完成结果可离线查询；后台连接与退出诊断增加边界保护。
- 仓库搜索不再把常见词或 MD5 结果截断在前 2000 条。任务执行采用固定批次，运行中新增的任务归入下一批；增加 1–3 项并发、逐任务暂停取消和冲突准入。
- 未压缩入库与目录校对减少重复扫描和写入；仅新增文件自动并入，修改或删除仍需人工确认。用户资料与仓库格式保持兼容，不要求迁移或全库重建。
- `task wait --timeout 0` 立即返回但保持后台任务运行；等待时长只接受规定范围内的整数，非法参数直接报错。

### 安装与验证

下载 `HamsterArchiver-v4.8.0-beta.mac.2-mac-universal.dmg` 和同名 `.sha256`，核对 SHA-256 后将应用拖入“应用程序”。本项目暂无 Apple Developer ID 证书，应用仅临时签名、未经 Apple 公证，macOS 可能阻止首次打开。请确认信任来源后，按“系统设置 → 隐私与安全性”中的提示决定是否“仍要打开”。先用小目录试用，并保留原文件及独立备份。

## English

This prerelease introduces the first Mac download. It includes changes merged since the last public stable release, 4.6.18, through 4.8.0-beta.mac.2. Windows stable remains at 4.6.18; this page provides a Mac DMG only.

### First Mac build

- A universal DMG supports Apple Silicon and Intel Macs running macOS 12 or later. The desktop library, folder and video intake, 7z/ZIP compression, and archive verification reuse the existing application flow. Mac build code lives under `platforms/macos/`.
- The app includes an official Mac 7-Zip binary verified by SHA-256. User data defaults to `~/Library/Application Support/Hamster Archiver/` and remains when the app is replaced. The SQLite catalog format is unchanged.
- Mac scanning skips symbolic links. Path and volume checks account for common case and Unicode differences, and archiving still checks available space. Same-volume publication remains atomic; cross-volume copies are verified.
- The Mac build offers a native application menu and optional local CLI/MCP. Video frame extraction is off by default and requires a separately configured FFmpeg.
- The Windows Recycle Bin recovery mechanism does not apply to macOS. The Mac beta disables automatic moving to Trash and deletion of local archived packages through the library. You can keep originals or move them to a selected folder after archiving. Download a new DMG from GitHub for updates.

### Shared improvements since 4.6.18

- Archives preserve empty source folders. Before publication, file paths, sizes, and folder structure are checked against the complete source manifest. Incomplete scans or mismatches stop publication and source handling.
- The CLI/MCP gains a direct-use v2 task contract with clearer intake mode, project boundaries, duplicate policy, durable receipts, and same-identity recovery after a lost response. Requests are recorded before preparation, terminal results remain available offline, and background connection and exit diagnostics have bounded behavior.
- Warehouse search no longer truncates common-term or MD5 results after 2,000 items. Runs use fixed batches; work added during a run waits for the next batch. Concurrency of 1–3 jobs, per-job pause and cancellation, and conflict admission are available.
- Uncompressed intake and folder review reduce repeated scans and writes. Additions can merge automatically; modifications and deletions still require review. User data and the catalog format remain compatible without migration or a full rebuild.
- `task wait --timeout 0` returns immediately while background work continues. Wait times accept only whole numbers within their documented range; invalid values return an error.

### Install and verify

Download `HamsterArchiver-v4.8.0-beta.mac.2-mac-universal.dmg` and its `.sha256` file. Verify the SHA-256, open the DMG, and drag the app to Applications. The project has no Apple Developer ID certificate, so the app has an ad-hoc signature and is not notarized by Apple. macOS may block the first launch. If you trust the download, review the macOS prompt in System Settings → Privacy & Security before choosing Open Anyway. Start with a small folder, and keep originals and an independent backup.
