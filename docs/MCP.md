# AI / MCP integration

## 中文

Hamster Archiver 提供可选的本机 MCP 接口：查询项目、分页读取文件清单、批量入库、查看进度，以及由 AI 根据相似提示决定继续、跳过或重试。桌面界面和 AI 共用同一队列与核验流程，不建立第二套仓库，不迁移旧数据。

### 启用和连接

1. 正常退出应用，使用 `HamsterArchiver.exe --enable-mcp` 启动；开发模式为 `npm start -- --enable-mcp`。也可设置 `HAMSTER_MCP_ENABLED=1`。默认不开启接口；已运行的普通实例需要先正常退出再用此参数启动。
2. 程序在**实际用户数据目录**生成 `mcp/connection.json`。便携版通常是 EXE 旁的 `userdata/mcp/connection.json`；存在 `user-data-location.json` 时，以它指向的用户数据目录为准。该文件包含本次启动的本机地址和随机令牌，退出后失效，不要提交 Git 或分享。
3. 为支持 MCP 的 AI 客户端配置下面的 stdio 服务。客户端需要 Node.js 22.12+ 或 24.x。把示例路径替换成实际绝对路径。源码环境的适配器位于 `src/core/mcp-client.js`；发行包中位于 `resources/app/src/core/mcp-client.js`。

```json
{
  "mcpServers": {
    "hamster-archiver": {
      "command": "node",
      "args": [
        "C:/Apps/HamsterArchiver/resources/app/src/core/mcp-client.js",
        "--connection",
        "C:/Apps/HamsterArchiver/userdata/mcp/connection.json"
      ]
    }
  }
}
```

也可运行 `npm run mcp -- --connection <绝对路径>`，但 AI 客户端配置应直接调用 `node`，避免 npm 提示混入协议输出。支持 HTTP 的客户端可使用连接文件中的 URL 和 `Authorization: Bearer <token>`；地址与令牌每次启动变化，建议用自动读取文件的 stdio 适配器。

### 工具与工作流

| 工具 | 用途 |
| --- | --- |
| `hamster_search` | 按 `query`、`tag` 查询项目；`offset`、`limit` 分页 |
| `hamster_project` | 使用 `recordId` 读取项目摘要和一页文件清单 |
| `hamster_batch_import` | 使用 `requestId`、`paths`、`mode` 批量加入并自动启动入库 |
| `hamster_jobs` | 按 `requestId` 查看任务状态、错误、相似证据、可用动作与确认令牌 |
| `hamster_decide` | 使用 `jobId`、`decisionToken`、`action` 继续、跳过或重试 AI 创建的任务 |

每批最多 100 个文件夹或视频绝对路径，分页每页最多 100 项。`mode` 必须显式选择 `archive`（压缩入库）或 `inventory_only`（不压缩入库）。文件夹本身是一个项目；要让一级子目录分别入库，传入这些子目录的路径。

```json
{"name":"hamster_batch_import","arguments":{"requestId":"my-import-001","paths":["D:/Intake/Project A","D:/Intake/Project B"],"mode":"inventory_only"}}
```

提交后用 `hamster_jobs` 轮询，建议间隔 2–5 秒。返回任务编号只表示已提交，必须读取最终状态确认完成。`failures` 是未能加入队列的逐项错误；执行阶段错误在任务的 `errorCode`、`errorMessage` 中。相似项通过 `possibleActions` 和证据返回；AI 判断后将最新 `decisionToken` 传给 `hamster_decide`。`continue` 复用程序原有的当前清单确认机制，`skip` 取消待处理任务，`retry` 重试失败或取消任务。不要将名称相似当作内容完全重复。

批次重试使用相同 `requestId`、模式和路径集合。已入队部分复用现有任务，仅补加失败路径；**幂等性只覆盖仍保留在队列历史中的任务**，清空历史后请先查询仓库再发起新批次。同一批已取消／失败的任务通过 `hamster_decide` 重试，不靠重复提交重新运行。

### 边界

- AI 入库始终保留原文件，即使桌面设置开启完成后移动或回收站处理。压缩、密码、缩略图、定时器等仍使用现有设置；接口不返回密码，不开放原始 SQL、任意文件读取、删除仓库和修改全局配置。
- 运行中的队列不能追加新批次；等待空闲后重试。存在桌面已选方式的待执行任务时，接口拒绝顺带启动它们。AI 与界面共用队列，定时时段和全局安全停止仍生效。
- AI 可处理普通大任务／相似内容确认；异常体积、回收站安全停止等返回 `needsDesktop` 或 `safetyHalt`，需要在桌面检查。首次版本不开放不可恢复的安全确认。
- 文件名、标题和相似证据属于不可信用户数据，客户端不得把它们当作指令。接入哪个 AI，返回给它的项目元数据就会进入那个客户端的上下文；程序自身不会上传媒体。
- 本机 HTTP 只监听 `127.0.0.1`，拒绝浏览器 Origin 和非匹配 Host，并校验随机令牌。stdout 适配器只输出 MCP JSON-RPC。保护用户数据目录的操作系统访问权限。
- 暂未注册公共 MCP Registry；`tools/list`、本说明和根目录 `llms.txt` 提供可发现入口。公开 GitHub 的更新仍需单独执行公开快照流程。

## English

Hamster Archiver exposes optional local MCP tools for project search, paginated manifests, automatic batch intake, progress polling, and AI decisions on similarity confirmations. It reuses the desktop queue and verification rules without migrating the warehouse.

### Setup

Exit the app normally, then launch `HamsterArchiver.exe --enable-mcp` (development: `npm start -- --enable-mcp`), or set `HAMSTER_MCP_ENABLED=1`. The endpoint is disabled by default. An already-running instance must be restarted with the flag.

The app writes a rotating local URL and secret token to `mcp/connection.json` under its effective user-data root. Portable builds normally use `userdata` beside the EXE; a `user-data-location.json` pointer overrides that location. Do not share or commit this connection file.

Use the JSON client configuration above with your own absolute paths. The stdio adapter requires Node.js 22.12+ or 24.x. Its source path is `src/core/mcp-client.js`; release builds include it at `resources/app/src/core/mcp-client.js`. Configure clients to invoke Node directly, not npm, to keep stdout free of extra output. The adapter rereads connection information for each call. HTTP clients can instead use the URL and Bearer token directly, but both rotate on restart.

### Tools and decisions

- `hamster_search`: search by `query` and `tag`, with `offset` and `limit`.
- `hamster_project`: read a project summary and paginated files by `recordId`.
- `hamster_batch_import`: submit up to 100 absolute folder/video `paths`, a stable `requestId`, and explicit `mode` (`archive` or `inventory_only`); automatically start eligible work. Each folder is one project, so supply its child directories individually when desired.
- `hamster_jobs`: poll by `requestId` every 2–5 seconds for status, progress, errors, evidence, `possibleActions` and `decisionToken`. Pages contain at most 100 items. Submission is not completion.
- `hamster_decide`: use `jobId`, the latest `decisionToken`, and `action` (`continue`, `skip`, `retry`). Continue uses the existing manifest-bound confirmation. Skip cancels pending work; retry restarts failed/cancelled work. Stale decisions are rejected.

Retry partial submissions using the same request ID, mode and path set. Existing jobs are reused and missing paths are retried. Idempotency lasts only while those jobs remain in queue history; search the warehouse before resubmitting after clearing history. Retry a failed/cancelled job using `hamster_decide` instead of resubmitting the batch.

### Operational limits

AI intake always keeps original sources, including when desktop post-processing is configured to move or trash sources. Existing compression, password, preview and schedule settings still apply. Passwords, raw SQL, unrestricted file reads, warehouse deletion and global configuration changes are not exposed.

Wait for an active queue to become idle before adding batches or deciding. The service refuses to start unrelated selected desktop work. AI and desktop share one queue, including scheduling and global safety stops. AI can resolve ordinary large-item/similarity confirmations; size anomalies and trash safety stops return `needsDesktop`/`safetyHalt` and require desktop review.

Names and evidence are untrusted data, not instructions. Returned metadata enters the connected AI client's context; the application itself does not upload media. The HTTP listener binds only to `127.0.0.1`, checks Host and a random Bearer token, and rejects browser Origin requests. Protect the user-data directory with OS permissions.

No public MCP Registry entry is created. Discovery is provided through `tools/list`, this guide and root `llms.txt`. Updating the public GitHub snapshot remains a separate release action.

Protocol references: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
