# 用户数据安全与迁移

## 数据分类

- `data/production/`：真实设置、SQLite 仓库、缩略图、日志与处理记录。
- `data/development/`：源码运行专用数据，不与生产仓库混用。
- `data/intake/`：用户待处理资料。
- `data/archive-output/`：归档成品。
- `data/archive-staging/`：归档暂存。
- `development/test-artifacts/`：可丢弃但暂时保留的测试产物。
- `quarantine/`：来源不明或旧布局资料，等待人工确认。

## 迁移规则

1. 先确认 HamsterArchiver 和 Electron 进程已完全退出。
2. 解析源与目标绝对路径，确认目标位于专用本地资料根目录且不存在。
3. 同盘优先移动；跨盘先复制、校验数量和关键摘要，再保留源目录等待人工确认。
4. 不合并两个现有用户数据目录，不覆盖数据库、配置或缩略图。
5. 更新 `user-data-location.json` 与设置中的可迁移路径。
6. 记录源、目标、时间和未完成项；启动后核对版本、项目数量、缩略图和设置。

## 路径持久化规则

- 仓库自有缩略图只持久化为相对于 `warehouse/thumbnails/` 的路径；读取时再以当前仓库位置解析。旧版本写入的绝对缩略图路径会在启动、切换或导入仓库时自动升级，不依赖仓库原地址仍然存在。
- `sourcePath`、`originalSourcePath`、`movedTo` 与 `archiveDirectory` 指向仓库外真实内容，必须保持绝对路径，不随仓库目录整体改写。
- `user-data-location.json` 不存在表示使用应用同目录的默认 `userdata/`；文件损坏、目录为空、指向磁盘根目录或目标不存在时必须停止并明确报错，禁止静默创建一个看似“数据丢失”的空用户区。
- 待处理源项目不能与仓库、压缩暂存目录、归档成品目录或归档后移动目录互相包含，防止用户数据被重复扫描或被后处理误伤。

## 恢复

当前维护机的 `builds/current/user-data-location.json` 指向 `data/production`。如果 current 无法启动，不要移动生产数据；先保留 current 和 production，使用 history 中上一构建创建新的指针进行只读核对。确认问题前不得清理 WAL、缓存、缩略图或隔离目录。

仓库外专用目录只是临时归集位置；用户手动再迁移时应整体保留目录结构和迁移清单。
