---
name: hamster-archiver
description: Use only when the user explicitly names 仓鼠症大结局 or Hamster Archiver, or continues an existing Hamster task. Do not use for generic file organization, backup, compression, or source-code discussion.
---

For routine work call `intake.submit` with `responseVersion:2`, `catalog.search`,
`catalog.details`, `catalog.add_tags`, and `task.wait` directly. Preserve the requested
inventory/archive mode and use `layout:ask` only for meaningful project-boundary
ambiguity. Follow `decision` and `nextAction`; ask for a listed choice before
`task.resolve`. Report created, reused, skipped and failed counts accurately.
Discover or describe only when the capability is unknown. Do not routinely run
doctor, plan, global queue checks, or post-save catalog verification.
