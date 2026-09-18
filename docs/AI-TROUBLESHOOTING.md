# AI integration troubleshooting

Read this page only after a real error. Preserve the structured error code and stage; do not replace product operations with direct database or filesystem edits.

## `STARTUP_TIMEOUT`

Cause: application integrity verification or warehouse startup did not become ready within the client window. No intake was accepted. Safe action: run `hamster doctor --json` once and inspect its stage; wait for an already-visible startup window if present. User involvement is needed if integrity verification reports damaged application files.

## `CONNECTION_STALE` / `CONNECTION_FAILED`

Cause: the recorded local instance exited, or the authenticated loopback endpoint cannot be reached. The task may still exist if submission had already been accepted. Safe action: reconnect through the bundled launcher, then use the known task ID. Do not select another warehouse or resubmit with changed input. User involvement is needed only when Windows blocks application launch.

## `REQUEST_ID_CONFLICT`

Cause: the request ID already belongs to different effective paths or task-local options. The existing request was not changed. Safe action: use `task get` for the original task; use a new request ID only for a genuinely different request. User input is required if it is unclear which request was intended.

## `OUTPUT_NOT_WRITABLE` / `INVALID_PATH`

Cause: an output, staging, source, or move destination is missing, not absolute, unavailable, or cannot be written. No unsafe fallback is chosen. Safe action: correct the path or ask the user to choose another location. Never silently create a different destination or change saved preferences.

## `RECOVERY_REQUIRED`

Cause: a processing or persistence boundary could not be reconciled automatically. Archive outputs or source-disposition evidence may need manual review. Safe action: stop automated retries, preserve the full receipt and recovery locations, and open the application workbench. User involvement is required.

## `INTEGRATION_USER_MODIFIED` / `INTEGRATION_CONFIG_CONFLICT`

Cause: a managed Skill, connector, or config block was edited, or its ownership markers are incomplete. No user content is overwritten or removed. Safe action: review and reconcile that host config, then use Repair. User involvement is required.

## `ODR_UNAVAILABLE` / `ODR_PACKAGE_IDENTITY_REQUIRED`

Cause: Windows ODR is absent, or this build lacks the package identity needed for safe registration. Other integrations are unaffected. Safe action: leave ODR disabled and use CLI or local MCP. Do not enable reduced agent-connector protections.

## `GRAPHICS_INITIALIZATION_FAILED`

Cause: Electron could not initialize the active Windows graphics environment. No business request was accepted. Safe action: preserve diagnostics and use the desktop-supported graphics profile; do not add `--no-sandbox` or disable Windows protections. User involvement may be needed for display-driver remediation.
