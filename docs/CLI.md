# CLI reference / 命令参考

`hamster.cmd` ships in the Windows Release root and uses the bundled runtime. Run the launcher from its actual package; no separate Node.js installation is needed. The standalone CLI works without enabling an AI host adapter. Start with [AI quick start](AI-QUICKSTART.md) for an ordinary task.

## Commands

```text
hamster --help
hamster version --json
hamster intake <absolute-path> --inventory|--archive [options] --json
hamster search <query> --json
hamster project <record-id> --json
hamster tag <record-id> --add <tag> [--add <tag>] --json
hamster task get <task-id> [--source-changes --offset 0 --limit 100] --json
hamster task wait <task-id> [--timeout 0..60] --json
hamster task resolve <task-id> --decision <id> --revision <n> --choice <value> [--root-files exclude] --json
hamster task start <task-id> --json
hamster task pending --json
hamster task resume --request-file <path> --json
hamster capabilities [--domain <domain>] --json
hamster describe <capability> --json
hamster call <capability> --input <file-or-> [--confirmation-token <token>] --json
hamster doctor --json
hamster mcp --stdio
```

Every one-shot command accepts `--result-file <new-absolute-path>` for a structured result when stdout is unavailable. `intake --output` selects the archive destination; `--result-file` selects a JSON receipt file. The result target must not exist, and intake will reject a target inside its source. Business JSON is printed on stdout; diagnostics are printed on stderr. `hamster.cmd` without arguments prints help, while `HamsterArchiver-MCP.cmd` without arguments starts the legacy stdio adapter.

## Intake intent and frozen options

- `--inventory` catalogs without compression and always keeps originals. Contradictory move, trash, output, or staging options are rejected before startup.
- `--archive` creates and verifies an archive. Without an explicit `--source`, the new v2 CLI keeps originals even if an old desktop preference says move or trash.
- `--layout single|children|ask` chooses one project, each direct child, or a user decision. `children` asks about loose root files and does not truncate more than 100 candidates. A layout receipt lists `children.requires.choices` and `nextAction.additionalChoices`; `rootFiles: exclude` is valid only after the user explicitly agrees to leave those loose files out. / 粒度回执直接列出根文件处理选项；只有用户明确同意排除根目录散落文件时才提交 `rootFiles: exclude`。
- `--on-duplicate use_existing|ask|create_new|skip` applies to this task only. `use_existing` requires trusted exact evidence; naming and shape alone are candidates.
- `--output <absolute-directory>` and `--staging <absolute-directory>` select task-local archive paths.
- `--source keep|move|trash` selects post-verification source handling; `--move-to <absolute-directory>` is required for move.
- `--request-id <id>` is an advanced idempotency key. A normal new command receives a fresh ID. Reusing an ID with different explicit input fails with `REQUEST_ID_CONFLICT`.

`ask` uses the complete fingerprints already produced by this task. When MD5 was skipped for small files or a sampled inventory, its decision explains the missing evidence and offers only `create_new` and `skip`. `use_existing` explicitly authorizes the existing bounded supplementary verification; it can read missing hashes from eligible sources and reuses only after a trusted match is established. Neither policy trusts a name or shape match alone, and neither changes global MD5 settings. / `ask` 使用本任务已生成的完整指纹；小文件或抽样清单跳过 MD5 时，决策说明证据缺口，只提供另建和跳过。`use_existing` 明确授权现有的有界补充核验，可从符合条件的来源补算缺失指纹，只有核验可信匹配后才复用。两种策略都不会仅凭名称或形状复用，也不改变全局 MD5 设置。

Inventory-only creates an uncompressed record when a new record is requested. Explicit reuse, including choosing `use_existing` in a decision, preserves the existing record's compression state: reusing a compressed record does not create an uncompressed one. The decision lists trusted record IDs, their compression states and matching evidence in `context.trustedRecords`; terminal `existingRecords` identifies the reused record, with `created=0`, `reused=1` and no source action this run. Choosing duplicate `skip` counts as skipped; `task.cancel` remains cancellation. / 不压缩入库在新建时生成未压缩记录；明确授权复用（含决策中选择 `use_existing`）保留已有记录的压缩状态，复用压缩记录不等于新建未压缩记录。待决回执的 `context.trustedRecords` 列出可信记录 ID、压缩状态与匹配依据，终态 `existingRecords` 指明复用记录，本次 `created=0`、`reused=1`，不处置原文件。重复决策选跳过计入 skipped；`task.cancel` 仍计入 cancelled。

The accepted v2 task snapshots its effective paths, source action, duplicate policy and relevant execution settings. A later settings change does not rewrite that task. Explicit small sources are not blocked by the automatic scan size filter. Supported source types remain directories and videos.

## v2 receipt and decisions

Routine CLI intake and task commands request `schemaVersion:2`. Existing MCP callers that omit `responseVersion` receive the compatible v1 contract. The v2 receipt includes `task`, `outcome`, `effectiveOptions`, `summary`, `jobs`, `results`, `existingRecords`, `failures`, `warnings`, `decision`, `nextAction` and terminal `evidence`. The summary buckets are `created`, `updated`, `reused`, `skipped`, `failed`, `cancelled` and `pending`; `requestedProjects` is their sum or `null` while layout is undecided. Reuse and skips do not count as creation. Archive verification is `verified` only with execution evidence; historical records without it are `unknown`.

Task statuses are `accepted`, `preparing`, `queued`, `running`, `needs_input`, `needs_confirmation`, `paused`, `completed`, `completed_with_warnings`, `partial_failed`, `failed`, `cancelling`, `cancelled` and `recovery_required`. `task.terminal` reports lifecycle completion, while `outcome` and summary report the business result. `task wait --timeout` accepts whole seconds from 0 through 60; zero returns immediately, and an expired wait does not cancel the task. Invalid or out-of-range values are rejected. Use `decision.id`, `revision`, the listed choices and `nextAction.input` to resolve the exact pending question. Unusual archive-size and recycle-bin safety decisions require desktop review.

For `source_change`, read `task get <id> --source-changes --offset 0 --limit 100 --json`. The optional `sourceChanges` includes `total`, `truncated`, `nextOffset`, and entries for added/modified/deleted files and added/deleted directories. Follow `nextOffset` to read all entries; the limit is 1–500. Reads reuse the saved comparison and do not rescan media. Submit the current `decision.id` and `revision` with `--choice overwrite|new_independent|skip` only after the user chooses: update the target, create an independent project, or leave the target and source unchanged. `skip` counts as skipped; `continue` cannot authorize replacement. Target edits or source changes invalidate old evidence, and only this task is dispatched. A task accepted with `start:false` still needs `task start` after resolution. V1 continues to require desktop review.

源变化可在 CLI/MCP 中完成明确选择：先分页读完需要审阅的变化，再用当前决策 ID 和修订号提交 `overwrite`（更新原记录）、`new_independent`（保留原记录并另建）或 `skip`（保持仓库与原文件不变）。通用 `continue` 不授权覆盖；旧证据失效后重新决策。默认回执不附带完整差异，业务跳过计入 skipped，暂停、取消和延迟启动约束仍有效。

Archive execution without an output returns `ARCHIVE_OUTPUT_REQUIRED` and `requiredFields:["archiveOutputDirectory"]`, without changing settings or an accepted task's fixed options. Receiving an advanced request with `start:false` may defer this field; it must be supplied in that request before execution. / 压缩执行前必须有输出位置，错误会指出缺少的字段；不会通过改写已接受任务或全局设置来补齐。

For `SOURCE_DISPOSITION_COMMIT_FAILED`, the affected job's `sourceDispositionRecovery` records the original path and the completed move destination or recycle-bin time. A `recovery_required` v2 receipt sets `nextAction.kind` to `inspect_recovery_evidence`; inspect that evidence and the desktop log before any retry. Terminal receipts retain it after queue cleanup.

Decision receipts include `questionLocalized.en-US` and `questionLocalized.zh-CN`; `question` remains the English compatibility field. When a directory changes after a layout answer, a new decision revision is returned before child jobs are admitted. Cancelling during preparation stops further admissions, then seals the receipt after any in-flight admission has been handled.

Advanced `task.retry` accepts `jobIds` and/or `failureSources` to select recorded failed items. It never retries completed or user-cancelled jobs. Intake failures that were not selected remain in the new attempt, while the old terminal receipt remains in attempt history. A recovery-required task needs manual review before retry.

A newly recorded v2 preparation failure can be cancelled with `task.cancel` when the ledger proves that none of its projects started execution or committed a result. Cancellation retains the preparation error, clears its pending projects, and allows a new corrected request. Older recovery entries without this evidence, interrupted execution and source-disposition failures still require manual review. / 新记录的 v2 准备失败，在账本明确证明所有项目尚未执行或提交结果时，可通过 `task.cancel` 安全取消；原准备错误保留，待处理项目清空，之后可提交修正后的新请求。缺少此证据的旧恢复记录、执行中断及源文件处置失败仍需人工检查。

Terminal receipts are saved with an `asOf` time. `task get` first checks the saved receipt for the current warehouse without starting the app; it is a historical result, not a new disk verification. Missing local evidence falls through to the online lookup. Jobs removed from the visible queue retain their task receipt.

## Submission recovery

Before sending v2 intake, the CLI writes a small `requestFile` in the effective user data area. Successful output contains its path. If the response is lost, `task pending` lists outstanding request files; choose the matching file and call `task resume --request-file <path>`. Resume checks the current warehouse identity and reuses that request ID. It never chooses the latest file automatically. A new ordinary `intake` command is a new intent, even for the same source. Do not resubmit blindly when acceptance is unknown.

`task pending` checks every request file and preserves unknown, accepted and damaged entries. On a later CLI call, accepted files are reconciled against terminal receipts for the same warehouse. The CLI then retains at most 256 completed, failed or cancelled request files; the task ledger remains the authoritative history. Unknown or in-flight files are retained for explicit recovery.

An error result has `schemaVersion:2`, `ok:false`, and `error` fields including `code`, `stage`, `message`, `acceptance`, `requestId`, `taskId`, `retryClass`, `safeNextAction`, and `diagnosticRef`. `acceptance` is `not_accepted`, `accepted`, or `unknown`; a transport failure after sending normally reports `unknown` and links the request file. `call --input -` reads one UTF-8 JSON object from stdin; a file input is also a capability input object, not an outer MCP request. Raw `call` passes `--confirmation-token` outside the business input.

A validation error explicitly rejected before task registration reports `not_accepted`. Its local request is retained as failed history, is excluded from `task pending`, and points to the required correction rather than resume. Errors after registration or without a conclusive response remain conservative and require reconciliation. / 在登记任务前已明确拒绝的校验错误会返回 `not_accepted`；本地请求保留为失败历史，不列入待恢复请求，并提示修正所需字段。登记后出错或未取得明确回执时，仍保留待核对状态。

For a stale local connection, `knownCause` is taken from evidence for the same application instance. The app keeps a bounded diagnostic record in its effective user data area; missing or mismatched evidence reports `unknown`. A GPU child-process event is recorded as `gpu_process_failure` without claiming that it caused every later main-process exit.

Exit codes: `0` means a response was obtained, even if the task is unfinished; `1` is a business/client error; `2` is invalid CLI input; `3` is startup, connection or protocol failure. Use receipt fields to decide whether the work succeeded.
