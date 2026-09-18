# CLI reference

`hamster.cmd` is the formal local automation entry point included in Windows release packages. It uses the bundled runtime; do not install Node.js. Paths and arguments are passed as individual Windows command arguments, so Unicode and spaces are supported without JSON shell escaping.

## Command tree

```text
hamster --help
hamster version --json
hamster intake <path> --inventory|--archive [options] --json
hamster search <query> --json
hamster project <record-id> --json
hamster tag <record-id> --add <tag> [--add <tag>] --json
hamster task get <task-id> --json
hamster task wait <task-id> [--timeout 0..60] --json
hamster capabilities [--domain <domain>] --json
hamster describe <capability> --json
hamster call <capability> --input <file-or-> --json
hamster doctor --json
hamster mcp --stdio
```

Routine callers should use `intake`, `search`, `project`, `tag`, and `task wait`. Discovery, description, raw calls, doctor, and MCP mode are advanced or compatibility interfaces.

## Intake

Options for archive intake:

- `--output <absolute-directory>`: archive publication directory.
- `--staging <absolute-directory>`: optional temporary archive directory.
- `--source keep|move|trash`: action after archive verification and catalog commit.
- `--move-to <absolute-directory>`: required with `--source move`.
- `--request-id <id>`: advanced idempotency key; ordinary callers should let the CLI create it.

Effective options are frozen per task and never saved as future defaults. Reusing a request ID with identical effective input returns the original task; changed input returns `REQUEST_ID_CONFLICT`. Intake waits about 1–2 seconds, then returns its current receipt. Continue with `task get` or bounded `task wait`; a timeout does not cancel work.

## JSON contracts

Successful intake and task commands return a schema-versioned receipt containing `ok`, `task`, `summary`, `jobs`, `results`, `failures`, `warnings`, and `nextAction`. Business completion is determined by `task.status` and `task.terminal`. Archive results include publication location and verification state; inventory-only results say that archive verification is not applicable.

Failures written to stderr use:

```json
{"schemaVersion":1,"ok":false,"error":{"code":"...","stage":"...","message":"...","retryable":false,"requiredAction":null}}
```

`call --input -` reads exactly one UTF-8 JSON object from stdin. With a file path, the file must contain the capability input object—not an outer MCP request. stdout is business JSON only; diagnostics go to stderr.

Task states are `accepted`, `preparing`, `queued`, `running`, `needs_input`, `needs_confirmation`, `paused`, `completed`, `completed_with_warnings`, `partial_failed`, `failed`, `cancelling`, `cancelled`, and `recovery_required`.

## Exit codes and resume

- `0`: a valid response was obtained; the task may still be running.
- `1`: business failure before acceptance or a capability error.
- `2`: invalid CLI input.
- `3`: application startup, connection, or protocol failure.

Persist the returned task ID in the caller's own state. `task get` and `task wait` resume observation after a disconnect without resubmitting the source. If submission outcome was uncertain and an explicit request ID was used, retry only the identical request.

`HamsterArchiver-MCP.cmd` with no arguments remains the legacy stdio MCP launcher. `hamster.cmd` with no arguments displays CLI help; the two launchers are intentionally separate.
