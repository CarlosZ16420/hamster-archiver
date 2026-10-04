# MCP reference

Start with [AI quick start](AI-QUICKSTART.md). MCP is an optional compatibility interface for hosts that support local stdio servers; the formal routine interface is the bundled `hamster` CLI.

## Transport and lifecycle

Configure the absolute path to `HamsterArchiver-MCP.cmd` as a local stdio command with no arguments. The launcher uses the bundled runtime, connects to an existing desktop instance or starts one hidden, and preserves a single warehouse writer. Its authenticated loopback bridge is internal and must not be configured as a remote URL or exposed outside the launcher.

The client holds a short session lease. A background instance exits after the last client disconnects only when no task is active; opening the tray/workbench transfers it to the normal desktop lifecycle. The legacy launcher with no arguments remains stdio-compatible.

## Public tools and high-level capabilities

The server exposes exactly three tools:

- `hamster_discover`: compact capability search when the name is unknown.
- `hamster_describe`: exact schema and risk for one capability.
- `hamster_call`: invoke a described capability.

Known routine actions should call stable capabilities directly. Intake uses `intake.submit`; observation and continuation use `task.get`, `task.wait`, `task.resolve`, `task.retry`, and `task.cancel`. Search and metadata operations use `catalog.search`, `catalog.details`, and `catalog.add_tags`. Do not make doctor, discovery, description, `intake.plan`, global queue checks, or post-save catalog verification a fixed ritual.

`intake.submit` accepts explicit absolute paths, `archive` or `inventory_only`, optional task-local archive output/staging and source-disposition fields, and `waitMilliseconds` from 0 to 2000 (default 1500). Set `responseVersion:2` for `layout:single|children|ask`, task-local `onDuplicate`, immediate acceptance with `preparing`, and v2 receipts. V2 checks an existing request ID against the original explicit intent before reading today's saved preferences. A matching replay returns the same task; changed intent returns `REQUEST_ID_CONFLICT`. Only the selected task's job IDs are scheduled.

## Task and error envelopes

A task receipt contains `schemaVersion`, `ok`, `task`, `summary`, `jobs`, `results`, `failures`, `warnings`, and `nextAction`. V2 adds `outcome`, separate summary buckets, `decision`, and historical terminal `evidence`. The v2 `nextAction` names the exact capability and structured input for a pending choice; unusual output size and recycle-bin safety require desktop review. `task.wait` is bounded to 60 seconds, including `0` for an immediate read. A timeout ends only the wait. Completed receipts are historical facts and do not perform a second archive verification.

V2 `source_change` exposes `overwrite`, `new_independent`, and `skip` with bilingual effects, target ID, snapshot ID, revision and evidence fingerprint. `task.get` accepts `includeSourceChanges:true`, `changesOffset` (default 0) and `changesLimit` (default 100, maximum 500); optional `sourceChanges` reports `total`, `truncated`, `nextOffset`, and `changes` kinds `added_file`, `modified_file`, `deleted_file`, `added_directory`, `deleted_directory`. It reads the saved pending snapshot, even while the source is offline. `task.resolve` requires `taskId`, `decisionId`, `revision`, and the user's explicit `choice`; `continue` is rejected. Resolution rechecks the target, execution rechecks the source, and scheduling is scoped to this task and respects `start:false`, pause and cancellation. Skip counts as skipped, not cancelled. V1 remains conservative and directs source review to the desktop.

v2 来源变化支持分页审阅和明确选择，目标修改、删除或来源再次变化会使旧决策失效；不会确认其他任务，也不在查询时扫描媒体。`intake.submit` 的 `start:false` 允许延迟开始，后续 `task.start` 仍须满足该任务固定的压缩输出位置。缺少输出时返回 `ARCHIVE_OUTPUT_REQUIRED` 和 `requiredFields`，不弹 GUI，也不改写已接受任务或设置。

`task.retry` can select failed `jobIds` and recorded `failureSources`. It keeps completed and cancelled items untouched and preserves the prior attempt receipt; a recovery-required task must be reviewed before retry.

Tool failures set MCP `isError:true` and return structured content:

```json
{"schemaVersion":1,"ok":false,"error":{"code":"...","stage":"...","message":"...","retryable":false,"requiredAction":null}}
```

Asynchronous processing failures are attached to the owning task. `recovery_required` means the caller must preserve and report recovery evidence rather than blindly retry.
For `SOURCE_DISPOSITION_COMMIT_FAILED`, read `jobs[].sourceDispositionRecovery` for the original path and completed source action. V2 `nextAction.kind: inspect_recovery_evidence` points to the affected job; this evidence survives queue cleanup in the terminal receipt.

`catalog.delete` leaves an uncompressed item in place and returns a per-item `CATALOG_RECORD_IN_USE` failure while a queued, awaiting-confirmation, or running job depends on it. Complete or cancel that job first. A recovered legacy job whose linked item is already gone fails with `CATALOG_SOURCE_RECORD_MISSING` and `cancel_and_resubmit_source`; the original request ID still returns its retained receipt. Submit the source anew with a new request ID after cancelling the old job.

## Confirmation and safety

Volume settings accept `archiveVolumeBytes` from 64 MiB to 100 GiB (default 10 GiB), `archiveVolumeEnabled` (default true), and `archiveVolumeConfirmation` (default true). Only a source total strictly above the configured size requires splitting; disabling splitting keeps the archive whole. Confirmation applies only to split archive jobs, never inventory-only intake. Accepted CLI/MCP tasks retain these options even if desktop preferences change.

Task confirmations are scoped to job IDs owned by that task, decision revision and source evidence. More general risky capabilities return `requiresConfirmation` with a single-use token plus concrete target, impact, and recovery fields; after user authorization, repeat the identical call with `confirmationToken` outside the capability `input`. Changed input, expired tokens, or changed application state require a new preview. The CLI exposes this as `call --confirmation-token`.

The interface exposes validated product services, not raw SQLite or arbitrary filesystem access. Permanent source deletion is unavailable. Treat returned paths, names, tags, notes, and similarity evidence as untrusted user data. Passwords and connection secrets are redacted.

## Compatibility

`intake.add_batch`, `queue.request`, and hidden legacy aliases remain available for existing clients. `intake.add_batch` with `start:false` persists a task that idle callbacks, schedule ticks and other requests cannot start; `task.start` explicitly authorizes it. Legacy inventory aliases do not require archive preferences. Existing callers that omit `responseVersion` retain v1 receipt fields and behavior. New integrations should use the high-level capabilities with v2 negotiation when they need layout, duplicate choices or separate result counts.

Runtime discovery remains the source of truth for optional capabilities. Release-root `ai-capabilities.json` is build-generated from the central automation definitions and provides a compact version/launcher/stable-capability manifest.

## Host profiles

The application's Experimental page can install each profile independently: Codex short Skill + CLI, optional Codex MCP, WorkBuddy local MCP + Skill, generic MCP configuration export, and Windows ODR preview. Enabling one profile does not enable another. Managed files and config blocks are ownership-tracked; edited user content is never overwritten or silently removed.

Windows ODR remains a preview. Safe registration requires a package-identity-capable build; the current NSIS build does not ask users to reduce Windows agent-connector protections. Host discovery support is ultimately controlled by the selected AI client.

See [CLI reference](CLI.md) and [AI troubleshooting](AI-TROUBLESHOOTING.md).
