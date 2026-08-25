# 版本与发行流程

## 版本文件

每次版本推进同时核对：

- `package.json` 与 `package-lock.json`；
- README 中的版本徽章和目录示例；
- `CHANGELOG.md`；
- `docs/releases/release-notes-vX.Y.Z.md`；
- 需要公开时再更新 `CHANGELOG.public.md`。

私人仓库的 `main` 是唯一日常开发主线。用户要求推进版本号时，版本文件、本地 `main`、私人 `origin/main`、同名 `vX.Y.Z` Git 标签和本地发行清单必须在同一次维护中一起推进并最终一致；不得只更新本地文件、侧分支或远端分支而遗漏其中任一项。GitHub Release 与公开仓库仍是独立流程，只有用户明确要求时才更新。

`npm run verify:version` 自动检查这些同步点。补丁号用于兼容修复，次版本号用于向后兼容的新功能，主版本号用于不兼容变化。

## 本地维护版

1. 完成日常修复或优化；只有到达版本边界时才推进 SemVer 与版本文件。
2. 审查差异和仓库安全，提交到本地 `main` 并推送私人 `origin/main`，确保本地主干、远端主干一致且工作树干净。
3. 日常维护运行 `npm run release:local`；它不重复执行完整源码测试矩阵。
4. 用户明确要求测试、SemVer 主版本或被指定为重大/正式发布、上传私有 GitHub Release、或推送公开仓库时，改用 `npm run release:local -- --full-checks`。
5. 两种模式都直接使用当前受支持的本机 Node.js 22.12+（22.x）或 24.x，以及 npm 10.x/11.x；不下载第二套 Node，也不限制支持范围内的补丁版本。发行清单记录实际使用版本。随后从当前提交构建到仓库外 staging，并强制验证锁定工具、发行清单、ZIP、SHA-256 和隔离数据烟雾启动。完整模式还执行依赖、语法、单元测试、目录/版本/发布安全检查。
6. 验收成功后旧 current 进入 history，新构建提升为 `builds/current`，压缩包写入 `builds/packages`。
7. 使用 `npm run preview:current` 启动；不要在源码根目录复制或运行 EXE。

ZIP 在写入维护机专用数据指针之前生成，因此对外解压后仍保持普通便携数据行为。

## 应用内升级

打包后的 Windows x64 便携版从顶部“检查更新”进入统一更新窗口：窗口始终显示当前版本和最新版本；检测到新版时提供自动更新；无论是否有新版或联网是否成功，都可选择“手动更新”并打开本机发行 ZIP。两条更新路径都会检查版本、`release-manifest.json` 与关键文件完整性，拒绝同版、旧版、平台不符或被破坏的包；替换时使用同一套回滚与启动验证流程，并始终排除 `userdata`。

## 私有提交与公开发行

私有代码提交、版本标签、公开源码快照和 GitHub Release 是独立状态，必须分别确认。普通迭代应及时提交到 `main`、推送私人 `origin/main` 并刷新本地 `builds/current`，但不自动创建 GitHub Release。普通未升版提交不强制创建标签；用户明确要求推进版本号时，必须在版本提交上创建并推送对应 `vX.Y.Z` 私人标签。只有用户明确要求公开时，才读取 `docs/REPOSITORY_MAINTENANCE.md` 并执行公开快照流程；已存在 Release 时不要重复上传附件。

## 失败处理

构建或烟雾验证失败时保留 current，不提升 staging。公开快照失败时恢复公开工作树，不修改私有提交。任何失败都先记录实际提交、版本、产物路径和数据路径，再决定重试。
