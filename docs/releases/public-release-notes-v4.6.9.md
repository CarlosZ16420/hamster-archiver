# Hamster Archiver 4.6.9

## 中文

本版本汇总公开正式版 4.6.8 → 4.6.9 的变化。

### 随机漫步与新手引导

- 随机漫步按钮文案精简为“随机漫步”，并同步英文翻译。
- 新手引导第一步的语言选择标题统一为“语言/Language”。
- 完成新手引导后的烟花庆祝效果不再出现仓鼠 emoji。

### AI 接入

- 修复部分 AI 沙箱限制 Electron 子进程启动时，MCP 启动器无法可靠拉起应用的问题。Windows 发行包通过桌面 Explorer 代理启动并使用一次性请求传递后台连接意图，同时保留 Chromium 渲染沙箱；直接回退路径也会在异常退出时返回明确诊断。

### 升级与数据

本次范围为公开正式版 4.6.8 → 4.6.9。请通过完整便携程序目录或安装程序升级；本次不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

This release covers changes from public stable 4.6.8 to 4.6.9.

### Random Walk and onboarding

- Shortened the Random Walk button label and synchronized its English translation.
- Standardized the first onboarding step's language heading as `语言/Language`.
- Removed the hamster emoji from the onboarding-completion fireworks.

### AI connection

- Fixed cases where an AI sandbox's Electron child-process restrictions prevented the MCP launcher from reliably opening the app. Windows releases now delegate launch through desktop Explorer and pass background-connection intent in a one-time request while retaining the Chromium renderer sandbox. The direct fallback also returns a clear diagnostic after an abnormal exit.

### Upgrade and data

This release covers public stable 4.6.8 → 4.6.9. Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations and existing records remain unchanged; no migration or rebuild is required.
