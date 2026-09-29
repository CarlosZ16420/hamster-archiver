# Hamster Archiver 4.7.2

## 中文

### 任务等待边界

- `task wait --timeout 0` 立即返回当前回执，后台任务继续运行。
- CLI/MCP 等待时间仅接受 0 至 60 秒的整数；任务服务接口接受 0 至 60000 毫秒的整数。非法或越界值会明确报错，不会被改为默认值或截断到边界。

4.7.1 的空目录保留与归档源结构校验继续生效。仓库格式和用户资料位置不变，无需迁移。

## English

### Task wait limits

- `task wait --timeout 0` returns the current receipt immediately while background work continues.
- CLI/MCP wait times accept whole seconds from 0 through 60; the task service accepts whole milliseconds from 0 through 60000. Invalid or out-of-range values return an error instead of being replaced or clamped.

The empty-folder and archive structure checks from 4.7.1 remain in effect. The warehouse format and user data location are unchanged; no migration is needed.
