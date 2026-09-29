# Hamster Archiver 4.8.0-beta.mac.2

## 中文

### 首个 Mac 测试版

- 提供 macOS 12 及以上的 Apple Silicon 与 Intel 通用架构 DMG。桌面整理、可校验的 7z/ZIP 归档，以及可选的本机 CLI/MCP 接入可供试用。
- 压缩工具使用已校验的官方 Mac 版 7-Zip。视频抽帧仍需自行配置 FFmpeg；没有 FFmpeg 时默认关闭视频抽帧。
- 默认用户资料位于 `~/Library/Application Support/Hamster Archiver/`。不改变仓库数据格式；请保留原始文件和独立备份，先用小目录试用。
- Mac 版关闭自动移入废纸篓、相关复原流程及应用内安装更新。更新请从 GitHub 下载新版 DMG。
- 本项目暂无 Apple Developer ID 证书，因此该版本仅临时签名，未经 Apple 公证。请核对发行页的 SHA-256 后再按系统提示决定是否打开。

Windows 公开正式版仍为 4.6.18；本 Beta 只提供 Mac DMG，不包含 Windows 安装包。

## English

### First Mac beta

- A universal DMG supports Apple Silicon and Intel Macs running macOS 12 or later. Try desktop organization, verified 7z/ZIP archiving, and optional local CLI/MCP integration.
- The build includes a verified official Mac 7-Zip binary. Video frame extraction needs a separately configured FFmpeg and is off by default without it.
- User data defaults to `~/Library/Application Support/Hamster Archiver/`. The catalog format is unchanged. Keep originals and an independent backup, and start with a small folder.
- Automatic moving to Trash, related restoration, and in-app update installation are disabled on Mac. Install updates using a new DMG from GitHub.
- The project has no Apple Developer ID certificate. This build has an ad-hoc signature and is not notarized by Apple. Verify the published SHA-256 before deciding whether to open it through macOS security settings.

The public Windows stable release remains 4.6.18. This beta provides a Mac DMG only, without a Windows installer.
