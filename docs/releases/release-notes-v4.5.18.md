# Hamster Archiver 4.5.18

4.5.18 strengthens recovery around archive registration and cancellation, improves file-safety checks, and fixes an English queue label.

## 主要变化

- If warehouse registration fails after an archive has been created, the archive is safely retained in a recovery location and the task reports its recovery state.
- Archive files are identity-checked before cleanup or recovery moves, reducing the risk of deleting or moving a same-named replacement.
- Cancelling during thumbnail generation now terminates the task correctly, cleans up uncommitted generated output and keeps the source files safe.
- When source handling has completed but writing the resulting state back to the warehouse fails, the task reports those two outcomes separately and accurately.
- Fixed the English translation for the “Choose an intake method” badge.

## 数据与安全说明

本版本不改变 SQLite 结构或用户数据位置。归档、缩略图和源文件处理仍在完成必要校验并成功登记后才执行相应后处理；提交失败时会保留可恢复状态，避免静默丢失成品。
