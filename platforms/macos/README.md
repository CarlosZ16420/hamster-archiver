# Hamster Archiver for macOS

This is the macOS distribution of Hamster Archiver. The universal DMG contains both Apple Silicon and Intel code. It supports macOS 12 or later.

## Install / 安装

Open the DMG and drag **Hamster Archiver.app** to **Applications**. The app has an ad-hoc signature because this project does not have an Apple Developer ID certificate. It has **not** been notarized by Apple. macOS Gatekeeper may block the first launch. In System Settings → Privacy & Security, review the blocked app and use **Open Anyway** only if you trust this download and its published SHA-256 checksum.

打开 DMG，将 **Hamster Archiver.app** 拖入“应用程序”。本项目目前没有 Apple Developer ID 证书，因此应用仅使用临时签名，**未经 Apple 公证**。macOS 可能阻止首次启动。请先核对 GitHub 提供的 SHA-256 校验值；确认信任来源后，在“系统设置 → 隐私与安全性”中查看并选择“仍要打开”。

## Data and feature limits / 数据与功能边界

Application data is stored in the current user's `~/Library/Application Support/Hamster Archiver/` by default. Moving or replacing the app does not move that data. This Mac build bundles the official universal 7-Zip command-line tool for archiving. Video frame extraction is disabled by default because FFmpeg is not bundled. Automatic source deletion and Trash restoration are disabled on macOS because the Windows recovery mechanism cannot verify macOS Trash contents. Archive with **Keep source** or **Move source**. Updates are installed manually from the GitHub release page.

默认资料保存在当前用户的 `~/Library/Application Support/Hamster Archiver/`。移动或替换应用不会移动这些资料。Mac 版内置官方通用架构 7-Zip 命令行工具。由于未内置 FFmpeg，视频抽帧默认关闭。由于现有 Windows 恢复机制无法验证 macOS 废纸篓，Mac 版禁用自动删除源文件及废纸篓恢复；归档时请选择“保留源文件”或“移动源文件”。更新请从 GitHub 发布页手动安装。
