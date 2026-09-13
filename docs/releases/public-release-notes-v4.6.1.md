# Hamster Archiver 4.6.1

## 中文

本版本汇总公开正式版 4.6.0 → 4.6.1 的变化。

### AI 接入与资源整理

- 新增使用内置运行时的 HamsterArchiver-MCP.cmd 启动器，无需单独安装 Node.js；可连接已有实例或后台启动，并支持单次命令调用。
- MCP 提供能力发现、参数查询和统一调用入口，扩展设置、仓库整理、队列控制和用户数据迁移等应用操作。旧客户端应按新版接入文档更新配置和工具调用。
- AI 入库会先读取已保存的备份偏好；缺少必要偏好时先提示。移动或回收源文件等高风险操作需要与具体操作绑定的一次性确认。
- 用户数据迁移增加独立执行与启动确认，迁移失败保留原资料；迁移时排除临时 MCP 连接凭据。
- 补充双语 AI 快速上手、能力发现和连接验收说明，简化项目主页。

### 更新与发行

- 加入可配置的 CNB 更新来源回退和发行镜像基础设施。GitHub 查询成功时不请求 CNB；本版内置 CNB 端点仍为空，尚不能直接使用 CNB 下载回退。
- 修复发行草稿分页查找，完善 Electron 本地缓存校验恢复、打包启动器验收和公开导出安全检查。

### 升级与数据

保留完整程序目录并通过应用更新或安装程序升级。仓库格式和用户数据位置保持兼容；AI 整理和源文件后处理仍遵守应用确认与校验流程。MCP 工具入口已调整，请依据本版文档重新发现能力。

## English

This release covers changes from public stable 4.6.0 to 4.6.1.

### AI connection and resource organization

- Added HamsterArchiver-MCP.cmd using the bundled runtime, without a separate Node.js installation. It connects to an existing instance or starts in the background and supports one-shot calls.
- MCP now provides capability discovery, schema lookup and a unified call entry point, with expanded settings, catalog editing, queue control and user-data migration operations. Existing clients should update configuration and tool calls using the new connection guide.
- AI intake reads saved backup preferences first and requests missing required choices. Higher-risk operations such as moving or recycling sources require a one-time confirmation bound to the specific operation.
- User-data migration uses a separate worker and startup acknowledgement, retains original data on failure and excludes temporary MCP connection credentials.
- Added bilingual AI onboarding, capability discovery and connection verification guidance, and simplified the project pages.

### Updates and releases

- Added infrastructure for configurable CNB update fallback and release mirroring. Successful GitHub checks do not contact CNB. Bundled CNB endpoints remain empty, so CNB download fallback is not active out of the box.
- Fixed paginated draft-release lookup and improved verified Electron cache recovery, packaged-launcher acceptance and public-export safety checks.

### Upgrade and data

Keep the complete application directory and upgrade through the application or installer. Warehouse format and user-data location remain compatible; AI editing and source post-processing retain application confirmation and verification gates. MCP tool entry points have changed; rediscover capabilities using this version's guide.
