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
       └─ updater ───────────────── GitHub / local ZIP + manifest + rollback
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
