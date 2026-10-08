# Hamster Archiver for macOS

This is the macOS distribution of Hamster Archiver. The universal DMG contains both Apple Silicon and Intel code. It supports macOS 12 or later.

## Install / 安装

Open the DMG and drag **Hamster Archiver.app** to **Applications**. The app has an ad-hoc signature because this project does not have an Apple Developer ID certificate. It has **not** been notarized by Apple. macOS Gatekeeper may block the first launch. In System Settings → Privacy & Security, review the blocked app and use **Open Anyway** only if you trust this download and its published SHA-256 checksum.

打开 DMG，将 **Hamster Archiver.app** 拖入“应用程序”。本项目目前没有 Apple Developer ID 证书，因此应用仅使用临时签名，**未经 Apple 公证**。macOS 可能阻止首次启动。请先核对 GitHub 提供的 SHA-256 校验值；确认信任来源后，在“系统设置 → 隐私与安全性”中查看并选择“仍要打开”。

## Data and feature limits / 数据与功能边界

Application data is stored in the current user's `~/Library/Application Support/Hamster Archiver/` by default. Moving or replacing the app does not move that data. This Mac build bundles the official universal 7-Zip command-line tool for archiving. Video frame extraction is disabled by default because FFmpeg is not bundled. Automatic source deletion and Trash restoration are disabled on macOS because the Windows recovery mechanism cannot verify macOS Trash contents. Archive with **Keep source** or **Move source**.

默认资料保存在当前用户的 `~/Library/Application Support/Hamster Archiver/`。移动或替换应用不会移动这些资料。Mac 版内置官方通用架构 7-Zip 命令行工具。由于未内置 FFmpeg，视频抽帧默认关闭。由于现有 Windows 恢复机制无法验证 macOS 废纸篓，Mac 版禁用自动删除源文件及废纸篓恢复；归档时请选择“保留源文件”或“移动源文件”。

Source folders, archive destinations, staging folders and moved-source destinations remain configurable on Mac. Paths such as `/Users/name/Documents/Archives` or `/Volumes/External/Archives` can be selected with the native folder picker. Archives stay at your chosen destination; the Warehouse index, previews and settings are separate user data. External disks must be mounted and writable. The ZIP distribution contains a runnable `.app` with no installer; its data still lives in Application Support, so moving the app does not carry the Warehouse to another Mac.

Mac 仍可选择源目录、归档成品位置、暂存位置与源文件移动位置，例如 `/Users/用户名/Documents/Archives` 或 `/Volumes/外置盘/Archives`。原生目录选择器可直接选这些路径。成品保存到所选位置，仓库索引、缩略图与设置属于独立用户资料。外置盘必须已挂载且可写。ZIP 发行包中的 `.app` 无需安装即可运行，但资料仍在 Application Support，移动应用不会把仓库一起带到另一台 Mac。

## Updates and Beta rollback / 更新与 Beta 回退

Use **Check for updates** to choose a published Mac Beta, inspect its notes and download a verified DMG. Confirm the restart to replace only the `.app`; an isolated startup check runs before replacement, and the previous app is retained for recovery. Launch from Applications or another writable folder; an app running inside a mounted DMG cannot update itself. Older Betas may not understand newer databases or settings: export your Warehouse and keep a separate user-data backup before confirming a rollback. Replacing the app does not restore old data formats. The published `4.8.0-beta.mac.2` predates this updater and needs a manual first upgrade.

通过“检查更新”选择已发布的 Mac Beta、查看说明并下载通过校验的 DMG。确认重启后只替换 `.app`，替换前以隔离资料目录验证启动，旧应用保留以便恢复。请从“应用程序”或其他可写目录启动；直接在已挂载 DMG 中运行的应用无法自动更新。旧 Beta 可能无法读取新版数据库或设置，请先导出仓库并单独备份用户资料，再确认回退。替换应用不会恢复旧数据格式。已发布的 `4.8.0-beta.mac.2` 早于本更新功能，首次升级需手动安装。
