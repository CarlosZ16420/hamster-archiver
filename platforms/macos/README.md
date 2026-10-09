# Hamster Archiver Mac 版使用指南

[English](README.en.md)

当前 macOS 发行版为 **4.8.5-beta.mac.1 测试版**，Universal DMG 和 ZIP 均支持 macOS 12 及以上的 Apple Silicon 与 Intel Mac。请从 [Mac Beta 发布页](https://github.com/CarlosZ16420/hamster-archiver/releases/tag/v4.8.5-beta.mac.1) 下载。

## 安装：下载、复制、启动

1. 从 [Hamster Archiver 官方发行页](https://github.com/CarlosZ16420/hamster-archiver/releases) 选择 Mac Beta，下载名称以 `-mac-universal.dmg` 结尾的文件。Universal 同时支持 Apple Silicon 和 Intel；`Source code` 是源码，不是可直接运行的应用。
2. 双击 DMG，将 **Hamster Archiver.app** 拖入“应用程序”，等待复制完成。
3. 打开访达的“应用程序”，双击 **Hamster Archiver**。应用正常打开后，可以推出安装磁盘，并删除下载的 DMG。

也可下载以 `-mac-universal.zip` 结尾的 ZIP，双击解压后将 **Hamster Archiver.app** 放到“应用程序”或其他可写目录再运行。不要下载 Windows ZIP。两种格式都提供同名 `.sha256` 校验文件。请启动所选目录中的副本；直接从已挂载的 DMG 运行时，应用内更新器无法替换应用。

应用能正常启动时，直接开始使用；只有遇到首次启动拦截时，才需要下面的确认步骤。无需安装 Node.js，也无需注册 Apple 开发者账户。

<a id="first-launch"></a>

## 首次启动被拦截

**当前 Beta 仅有临时签名，尚无 Apple Developer ID 签名，未经 Apple 公证。** 下面的操作是由电脑使用者确认打开这个应用，不是向 Apple 申请开发者授权。请先确认文件来自上面的官方发行页；需要核验下载文件时，将其 SHA-256 与该发行随附的 `.sha256` 文件比较。

当提示为“无法验证开发者”或“Apple 无法检查是否包含恶意软件”，并且你已确认来源可信、文件未被篡改时：

1. 先从“应用程序”尝试打开 **Hamster Archiver**，让系统显示该应用的提示。
2. 打开苹果菜单 → **系统设置 → 隐私与安全性**，向下找到“安全性”中与 **Hamster Archiver** 对应的拦截记录。
3. 点击该应用的 **仍要打开**，按系统提示再次确认；系统可能要求输入这台 Mac 的登录密码或使用 Touch ID。密码只输入 macOS 的系统窗口，不用发送给开发者。
4. 应用打开后即可使用；系统会记住这次例外，不需要每次重复设置。

**带截图的官方帮助：** [Apple：在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)。macOS 12 的入口是苹果菜单 → **系统偏好设置 → 安全性与隐私 → 通用**。系统版本不同，按钮名称和位置可能略有差异；可在 [Apple 使用手册](https://support.apple.com/zh-cn/guide/mac-help/mh40616/mac) 顶部选择对应系统版本。

## 其他提示

| 看到的情况 | 如何处理 |
|---|---|
| 找不到“仍要打开” | 再从“应用程序”尝试启动，核对当前拦截是否属于 Hamster Archiver。公司或学校管理的 Mac 可能禁止此操作，需要联系这台电脑的管理员。 |
| 提示应用“已损坏”或“将损坏你的电脑” | 不适用上面的放行步骤。停止打开，重新从官方发行页下载并核验摘要；若仍出现提示，将 macOS 版本和原始错误截图反馈给项目。 |
| 访问所选目录时提示权限不足 | 这是文件夹权限，与首次启动确认不同。按系统弹窗授权所需目录，或改选当前用户可写的位置；外置盘需要已挂载且可写。 |

此流程只针对本应用的系统确认，不需要关闭整机安全检查。录制教程或反馈截图时，请遮住个人路径、账户与通知，不录入密码。

## 数据与功能边界

默认资料保存在当前用户的 `~/Library/Application Support/Hamster Archiver/`。移动或替换应用不会移动这些资料。Mac 版内置官方通用架构 7-Zip 命令行工具。由于未内置 FFmpeg，视频抽帧默认关闭。由于现有 Windows 恢复机制无法验证 macOS 废纸篓，Mac 版禁用自动删除源文件及废纸篓恢复；归档时请选择“保留源文件”或“移动源文件”。

Mac 仍可选择源目录、归档成品位置、暂存位置与源文件移动位置，例如 `/Users/用户名/Documents/Archives` 或 `/Volumes/外置盘/Archives`。原生目录选择器可直接选这些路径。成品保存到所选位置，仓库索引、缩略图与设置属于独立用户资料。外置盘必须已挂载且可写。ZIP 发行包中的 `.app` 无需安装即可运行，但资料仍在 Application Support，移动应用不会把仓库一起带到另一台 Mac。

## 更新与 Beta 回退

后台检查只发现新的 Mac Beta，不会自动安装。通过 **“检查更新”** 选择版本、阅读说明并下载通过校验的 DMG。**确认重启后**，更新器才替换 `.app`；替换前以隔离资料验证启动，并保留旧应用以便恢复。用户资料保持原位。

使用 **“手动更新”** 时，选择高于当前版本的 DMG 或 ZIP，并把同名 `.sha256` 校验文件放在同一目录。请保留两个文件的原始发行名称；校验文件内的包名和 SHA-256 也必须匹配。例如：

```text
HamsterArchiver-v4.8.5-beta.mac.1-mac-universal.dmg
HamsterArchiver-v4.8.5-beta.mac.1-mac-universal.dmg.sha256
```

ZIP 对应使用 `.zip` 和 `.zip.sha256`。本地更新只接受更高版本；回退通过在线版本选择单独确认。回退前请导出仓库并独立备份用户资料：旧 Beta 可能无法读取新版数据库或设置，替换应用不会恢复旧数据格式。旧 `4.8.0-beta.mac.2` 不含应用内更新器，首次升级需手动安装新版应用。

## 协助测试

欢迎协助测试本 Beta。请先用小型副本验证扫描、压缩与不压缩入库、在线及手动更新，以及平台支持的恢复操作；保留原文件、导出的仓库和独立用户资料备份。[反馈问题](https://github.com/CarlosZ16420/hamster-archiver/issues)时请附 macOS 版本、Mac 芯片类型、应用版本、操作步骤和错误信息，隐去私人路径及密码。
