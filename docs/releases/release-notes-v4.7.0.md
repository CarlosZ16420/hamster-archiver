# Hamster Archiver 4.7.0

## 中文

### AI 与命令行任务

- 可以直接从完整 Windows 发行包运行 `hamster.cmd`，提交不压缩入库或压缩归档。新任务回执明确项目粒度、重复处理、结果数量和下一步选择；临时使用无需先登记 AI 宿主。
- `--layout ask` 在项目边界不明确时保留同一任务并请求选择；`--on-duplicate` 在本次任务内处理经过核验的重复项，不修改全局去重设置。不压缩入库始终保留原件，新版压缩任务未授权处置时也默认保留原件。
- `--result-file` 可在终端输出不可见时保存结构化结果。请求发送前记录恢复身份；收到不确定的受理错误时可用 `task resume --request-file` 查询原任务。

### 回执与可靠性

- 执行设置在受理时固定；终态项目事实和整批回执按仓库身份保存，队列清理后仍可查询。离线终态查询不需要启动图形应用；历史回执表示完成时的事实，不代表当前磁盘复查。
- `start:false` 的任务在明确启动前不会被空闲或定时调度误执行。重复确认、大任务、源变化和回收站安全审查保留原有安全边界；不确定的源处置不会自动重试。
- CLI/MCP 请求使用总时限并以短时清理释放会话。就绪后退出会返回诊断引用和已知或未知的原因，未知原因不会被猜成 GPU 故障。
- 常见词或 MD5 的仓库搜索返回超过 2000 条的完整匹配结果。异常归档确认后若源文件已移动或回收、最终状态却保存失败，任务回执保留原位置和实际处理线索，清空队列后仍可离线查看，并提示先核对恢复证据。

### 使用与兼容

- README、离线快速开始、CLI 说明和短 Skill 指向同一直接入口；发行包附带 v2 回执 schema 与准确的获取说明。原有桌面入口、v1 工具调用和用户资料位置保持兼容，不需要搬迁仓库。
- 真实 AI 宿主表现、特殊 Windows 命令行字符、驱动故障和严格系统写入隔离仍需在对应环境单独验证；工程单测不能代替使用验收。

## English

### AI and command line tasks

- The complete Windows release can run `hamster.cmd` directly for inventory-only intake or compressed archiving. New task receipts state project layout, duplicate handling, result counts, and the next decision. Temporary CLI use does not require host registration.
- `--layout ask` retains the same task while asking about an ambiguous project boundary. `--on-duplicate` handles verified matches within that task without changing the global duplicate setting. Inventory-only intake keeps originals, and new archive requests also keep them unless source handling is authorized.
- `--result-file` saves a structured result when terminal output is unavailable. A request identity is saved before sending; `task resume --request-file` looks up the original task after an uncertain response.

### Receipts and reliability

- Execution settings are frozen at admission. Terminal facts for each project and the whole task are stored within the warehouse identity and remain available after queue cleanup. Offline terminal lookup does not start the desktop app. A historical receipt describes the operation at completion, not a fresh disk check.
- Tasks submitted with `start:false` remain idle until explicitly started. Duplicate confirmation, large tasks, source changes, and recycle-bin safety review retain their existing safeguards; uncertain source handling is not retried automatically.
- CLI/MCP requests share one total deadline with short best-effort session release. Exits after ready include a diagnostic reference and an evidenced or unknown cause; an unknown cause is not labelled as a GPU failure.
- Warehouse search returns all matches beyond 2,000 items for common terms or MD5 values. If source handling completed after abnormal archive confirmation but the final status save fails, the task receipt retains the original location and completed action after queue cleanup for offline recovery review.

### Use and compatibility

- The README, offline quick start, CLI reference, and short Skills lead to the same direct entry. The package includes the v2 receipt schema and a precise acquisition guide. Existing desktop flows, v1 tool calls, and user data locations remain compatible without a warehouse migration.
- Real AI hosts, unusual Windows command line characters, driver faults, and strict system-write isolation require separate environment-specific checks. Engineering tests do not replace user acceptance.
