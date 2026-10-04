# Development guide

Hamster Archiver targets Windows. Use Node.js 22.12+ (22.x) or 24.x with npm 10.x/11.x; `.nvmrc` tracks Node.js 24.x.

## Setup

Install the locked dependencies with `npm ci`. Electron is not downloaded during dependency installation. Before launching the desktop application, run `npm run electron:prepare`; add `-- --allow-download` only when network access is intentional. If bundled tools are missing, run `npm run tools:prepare`.

Runtime data, databases, logs, generated archives, and built applications do not belong in the source tree. See [Data safety](DATA_SAFETY.md) for the user-data boundaries.

## Common commands

```powershell
npm start
npm run check
npm test
npm run verify:dependencies
npm run publish:check
```

`npm start` uses isolated development data. The checks above validate the source tree but do not authorize access to real user data or release publication.

## Contributing

Create your own branch, keep changes focused, add tests for behavior changes, and describe user-visible effects and data-migration risks in the pull request. Contributors may use their own editor, agent, review, and Git workflow; no maintainer-specific automation is required by this public source snapshot.

See [Contributing](../CONTRIBUTING.md) for the repository's general contribution and privacy rules.

## Long-running collaboration

These practices keep long tasks understandable without prescribing a particular agent or editor:

- Keep one short current-state summary: exact source, authorized scope, completed checks and artifacts, active process or run IDs, next action, blocker, and evidence locations. Replace the summary when state changes; keep history separately and read it only to resolve a specific question.
- Give a delegated worker its role, scope, current summary, and next stage instead of the full conversation. If the primary maintainer owns repairs, the worker reports problems and handles only the reviewed submission or distribution steps. A reviewer reads the changed files and necessary direct callers.
- Report completion, failure, a required repair, or a new authorization need. Routine progress belongs in the current summary. Prefer event-driven waiting; after ten minutes without a meaningful report, make one targeted status check. Continue the same watcher or process and consume incremental output instead of starting duplicate work or rereading full logs.
- Reuse checks only while their source inputs and environment remain valid. A repair invalidates affected checks; a commit, PR, upload retry, or status read does not by itself require repeating tests or builds. Prepare version metadata in the candidate before verification, and create an immutable release tag only after the exact source and build artifacts pass acceptance.
- Validate the candidate's public projection against the trusted target rules before formal QA and packaging. After a transfer failure, check existing state and use a small diagnostic request before choosing a resumable transfer. Preserve verified fragments, verify the final full file and checksum, and resume only the failed stage. Do not publish credentials, raw private logs, or personal paths in progress reports.

### 中文

- 保留一个简短的当前状态摘要，记录精确来源、授权范围、已完成检查和产物、运行中的进程或运行 ID、下一动作、阻塞原因与证据位置。状态变化时替换摘要，历史另存，只为具体问题读取。
- 委派时提供职责、范围、当前摘要和下一阶段，不复制整段对话。主维护者负责修复时，执行者只回报问题并处理已审查的提交或分发步骤；审查只读取本次改动及必要的直接调用处。
- 在完成、失败、需要修复或新增授权时回报，例行进度写入当前摘要。优先等待事件；超过十分钟无有效回报再定向核对一次状态。沿用同一 watcher 或进程，读取增量输出，不重复启动任务或拉取完整日志。
- 检查仅在输入与环境仍有效时复用；修复只使受影响检查失效。提交、PR、上传重试或状态回读本身不要求重测、重建。先在候选中准备版本元数据，精确源码与产物验收通过后才创建不可变标签。
- 正式 QA 和打包前，按目标可信规则检查候选公开投影。传输失败先核对已有状态并进行小范围诊断，再选择可恢复的传输；保留已验证片段，最终仍校验完整文件与摘要，只续跑失败阶段。进度报告不公开凭据、私有原始日志或个人路径。
