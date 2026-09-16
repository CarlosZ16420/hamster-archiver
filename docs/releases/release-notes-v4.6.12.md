# Hamster Archiver 4.6.12

## 中文

4.6.12 修复纯 AI 接入在部分 Windows 图形环境中无法启动的问题，并显著减少 AI 首次接入需要读取的重复内容。

### AI 启动可靠性

- MCP 启动器不再强制添加 `--disable-gpu` 和 `--disable-gpu-compositing`。Electron 使用系统默认图形选择，避免这些开关在带多个实体或虚拟显示适配器的机器上反向触发 GPU 进程崩溃。
- 桌面代理与直接回退继续清除应用进程的 Node 模式环境、保留 Chromium 渲染沙箱，并继续提供单实例、结构化诊断和 `doctor` 自检。
- 增加启动器参数回归，并以真实发行包验证 `doctor`、能力发现、只读计划、实际小样本不压缩入库和仓库回读。

### AI 内容精简

- AI 快速上手、MCP 接口说明和 `llms.txt` 改为单一英文，合并重复约束并保留安装、连接、入库、确认和故障处理的必要流程。
- `ai-capabilities.json` 只保留版本门控、CLI 命令、三个 MCP 工具和运行时发现入口，不再重复嵌入完整能力目录；AI 在连接后按任务发现和描述所需能力。

### 本地后续维护（未升版）

- 图片预览最多两个并发任务，视频逐个抽帧并保留失败前后的成功帧。新增尝试预算与视频处理时限，达到预算时明确警告；完整清单与归档验证不变。
- 队列显示处理数量与当前视频帧，日志记录预览、相似关系和仓库保存耗时。
- 入库不再深拷贝历史文件清单，只保存新记录与相似关系受影响的旧记录。仅关系变化时保留既有文件、搜索与指纹索引，提交失败仍恢复原有关系并保护源文件。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

Version 4.6.12 fixes AI startup on affected Windows graphics environments and substantially reduces duplicated content that an assistant must read during first-time setup.

### AI startup reliability

- The MCP launcher no longer forces `--disable-gpu` and `--disable-gpu-compositing`. Electron uses the system default graphics selection, avoiding GPU-process crashes caused by those switches on systems with multiple physical or virtual display adapters.
- Desktop-broker and direct-fallback launches still remove Node mode from the application process, retain Chromium's renderer sandbox, and preserve single-instance startup, structured diagnostics, and `doctor` verification.
- Launcher-argument regression coverage is joined by real packaged-app verification of `doctor`, capability discovery, read-only planning, a small inventory-only intake, and catalog readback.

### Concise AI guidance

- The AI quick start, MCP reference, and `llms.txt` now use English only, merge repeated constraints, and retain the required installation, connection, intake, confirmation, and troubleshooting workflow.
- `ai-capabilities.json` now contains only the version gate, CLI commands, three MCP tools, and runtime discovery entry instead of duplicating the complete capability catalog. Assistants discover and describe only the capabilities needed for the task.

### Local follow-up maintenance (same version)

- Image previews use at most two concurrent tasks. Videos are processed sequentially and retain successful frames when other frames fail. Explicit attempt and video processing budgets warn on exhaustion; complete manifests and archive verification remain intact.
- Queue stages show media counts and the current video frame. Logs separate preview, similarity and database timing.
- Intake no longer deep-clones historical file manifests. It saves only new records and old records affected by reciprocal similarity changes, retaining file, search and fingerprint indexes for relationship-only updates. Failed commits still restore previous relationships and protect source files.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required.
