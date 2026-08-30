# 架构说明

## 运行边界

Electron 主进程位于 `src/main.js`，负责窗口、IPC、文件系统、队列和更新流程；预加载层只暴露受控 API；`src/renderer/` 管理界面、状态和 i18n；`src/core/` 保存可独立验证的业务与数据模块。

```text
Renderer / i18n
       ↓ IPC
Main process
       ├─ queue + archive engine ── 7-Zip / FFmpeg
       ├─ SQLite repository ─────── warehouse + thumbnails
       ├─ storage migration ─────── userdata layout
       └─ updater ───────────────── GitHub / local ZIP + notes + manifest + rollback
```

## 源码目录

- `src/core/`：归档、路径、SQLite、相似度、媒体、回收站和更新。
- `src/renderer/`：页面行为、UI 状态与本地化。
- `scripts/`：依赖恢复、检查、构建、版本维护和公开快照。
- `test/`：使用虚构数据和临时目录的自动测试。
- `tools/`：锁定工具的许可证、清单及允许提交的小型组件。
- `docs/`：产品、架构、UI、发布和历史资料。

## 数据边界

打包应用通过同目录 `user-data-location.json` 解析用户数据；没有指针时保持普通便携版的同目录 `userdata/` 行为。本项目维护机上的 `builds/current` 使用相对指针连接仓库外 `data/production`。开发模式固定使用仓库外 `data/development`，不会再读写源码根目录。

持久数据变更必须经过 `storage-paths` 与 `storage-migration`，保持旧布局可识别、迁移可回退。`warehouse-paths` 专门负责缩略图引用的相对化、旧绝对路径升级和当前仓库解析，禁止业务层直接把仓库内绝对路径写入 SQLite。任何 SQLite 结构变化都要考虑 WAL、事务和旧数据兼容。

## 构建边界

`scripts/build-release.js` 只写入仓库外 staging。`scripts/release-local.js` 从干净提交构建、检查、打包、烟雾启动，再原子提升为 current；旧 current 进入 history。源码根目录不保存 Electron 运行时副本。

每个发行包从 `docs/releases/release-summary-vX.Y.Z.json` 把中英文更新内容写入 `release-manifest.json`。在线检查读取 GitHub Release 正文，手动 ZIP 读取包内清单；两条路径在启动更新助手前把受限长度的说明写入本次 `userdata/updates/` 运行目录。新版本只接受该受信任目录且目标版本与自身一致的提示文件，在首次启动时显示后再由既有更新清理流程移除，不新增长期用户状态。

队列相似报告通过只读 IPC 按任务标识读取待确认清单；尚未生成 MD5 时只枚举当前目录，不因打开弹窗而读取大文件内容。同一路径且相对路径、大小和修改时间均未变化的已入库项目可复用原清单身份并立即完成精确重复判断，即使普通相似度清单因卡顿规避只保存了部分 MD5；不同路径的候选仍必须通过实际 MD5 严格核验。其余 MD5 由用户启动的队列阶段生成并展示进度，报告随后复用待确认清单。已完成任务复用入库清单。报告与仓库详情共同使用 `findSimilarEntryMatches` 和渲染层虚拟目录树，避免两套标记规则发生漂移。

队列的“卡顿规避”只缩减普通相似度持久保存的 MD5 数量，不缩减归档清单，也不把未抽样文件排除出名称、路径、大小等诊断：超大文件夹仍完整压缩并保存全部路径、大小与修改时间。代表文件采用稳定的“较大文件优先 + 全目录均匀覆盖”混合抽样；启用极小文件跳过时先按任务保存的 KB 阈值排除文件，再补足最多 200 个样本，默认阈值为 5 KB。自动跳过使用独立精确核验：同一未变化来源可复用稳定元数据身份，不同来源只在补齐当前与候选的完整 MD5 后判定，禁止以抽样结果冒充完整一致。
