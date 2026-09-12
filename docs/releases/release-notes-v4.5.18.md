# Hamster Archiver 4.5.18

## 中文

4.5.18 加强归档登记失败和任务取消时的恢复处理，完善文件安全校验，并修复英文队列文案。

### 主要变化

- 仓库登记失败时，已生成的归档成品会安全保留到恢复位置，任务会报告恢复状态。
- 清理或恢复移动归档前校验文件身份，降低误删或移动同名替换文件的风险。
- 缩略图生成期间取消会正确终止任务，清理未提交的生成物并保持源文件安全。
- 源文件后处理已经完成、但仓库状态写回失败时，任务会分别准确报告这两个结果。
- 修复英文界面“待选入库方式”徽标翻译。

### 数据与安全说明

本版本不改变 SQLite 结构或用户数据位置。归档、缩略图和源文件处理仍在完成必要校验并成功登记后才执行相应后处理；提交失败时会保留可恢复状态，避免静默丢失成品。

## English

4.5.18 strengthens recovery around archive registration and cancellation, improves file-safety checks, and fixes an English queue label.

### Changes

- If warehouse registration fails after an archive has been created, the archive is safely retained in a recovery location and the task reports its recovery state.
- Archive files are identity-checked before cleanup or recovery moves, reducing the risk of deleting or moving a same-named replacement.
- Cancelling during thumbnail generation now terminates the task correctly, cleans up uncommitted generated output and keeps the source files safe.
- When source handling has completed but writing the resulting state back to the warehouse fails, the task reports those two outcomes separately and accurately.
- Fixed the English translation for the “Choose an intake method” badge.

### Data and safety

This version does not change the SQLite schema or user data location. Archive, thumbnail and source-file post-processing still requires the necessary checks and successful registration. Commit failures preserve recoverable state to avoid silently losing generated archives.
