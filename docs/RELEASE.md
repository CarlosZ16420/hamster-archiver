# 版本与发行流程

## 版本文件

每次版本推进同时核对：

- `package.json` 与 `package-lock.json`；
- README 中的版本徽章和目录示例；
- `CHANGELOG.md`；
- `docs/releases/release-notes-vX.Y.Z.md`；
- `docs/releases/release-summary-vX.Y.Z.json`，保存将写入发行包的简短中英文更新内容；
- 需要公开时再更新 `CHANGELOG.public.md`。

私人仓库的 `main` 是唯一日常开发主线。用户要求推进版本号时，版本文件、本地 `main`、私人 `origin/main`、同名 `vX.Y.Z` Git 标签和本地发行清单必须在同一次维护中一起推进并最终一致；不得只更新本地文件、侧分支或远端分支而遗漏其中任一项。GitHub Release 与公开仓库仍是独立流程，只有用户明确要求时才更新。

`npm run verify:version` 自动检查这些同步点，并要求发行摘要同时提供 `zh-CN` 与 `en-US`。补丁号用于兼容修复，次版本号用于向后兼容的新功能，主版本号用于不兼容变化。

## 本地维护版

1. 完成日常修复或优化；只有到达版本边界时才推进 SemVer 与版本文件。
2. 审查差异和仓库安全，提交到本地 `main` 并推送私人 `origin/main`，确保本地主干、远端主干一致且工作树干净。
3. 日常维护运行 `npm run release:local`；它不重复执行完整源码测试矩阵。
4. 用户明确要求测试、SemVer 主版本或被指定为重大/正式发布、上传私有 GitHub Release、或推送公开仓库时，改用 `npm run release:local -- --full-checks`。
5. 两种模式都直接使用当前受支持的本机 Node.js 22.12+（22.x）或 24.x，以及 npm 10.x/11.x；不下载第二套 Node，也不限制支持范围内的补丁版本。发行清单记录实际使用版本。随后从当前提交构建到仓库外 staging，并强制验证锁定工具、发行清单、ZIP、SHA-256 和隔离数据烟雾启动。完整模式还执行依赖、语法、单元测试、目录/版本/发布安全检查。
6. 验收成功后旧 current 进入 history，新构建提升为 `builds/current`，压缩包写入 `builds/packages`。
7. 使用 `npm run preview:current` 启动；不要在源码根目录复制或运行 EXE。

ZIP 在写入维护机专用数据指针之前生成，因此对外解压后仍保持普通便携数据行为。

## Windows 安装版与商店准备

- `npm run build:installer` 先复用已校验的 Windows x64 程序布局，再生成按用户安装的 NSIS 安装程序；产物和 SHA-256 位于仓库外 `HamsterArchiver-Local/builds/installers/`。
- 安装版与便携版是两种独立发行形态：便携版默认使用程序旁 `userdata`；安装版默认使用 Windows 用户数据目录，安装目录不保存运行数据。卸载程序默认保留用户数据。
- 安装版使用稳定的 `com.carlosz.hamsterarchiver` 应用标识和当前用户安装注册信息识别已有版本；运行更高版本安装程序时会升级已有安装，而不是并排创建第二份。安装目录始终规范为用户所选父目录下的 `Hamster Archiver` 子目录；安装选项可决定是否创建桌面快捷方式，完成页直接启动已安装 EXE，不依赖快捷方式。
- 当前 NSIS 安装程序用于普通桌面分发和安装流程验收。进入 Microsoft Store 前，优先从同一 installed 布局生成 MSIX，并在 Partner Center 预留名称、取得 Store identity 后补齐清单。MSIX 商店提交由 Microsoft 签名；在商店外分发的安装程序仍应使用可信代码签名证书。
- MSIX 安装目录是只读的，因此 installed 布局禁止依赖程序目录中的 `userdata` 或可写配置。商店包还须关闭应用内自更新，交由 Microsoft Store 更新。

## 应用内升级

打包后的 Windows x64 便携版和安装版都从顶部“检查更新”进入统一更新窗口：启动时可静默发现新版，但应用不强制更新，也不会因后台检查主动弹窗；只有用户点击“检查更新”才显示当前版本、最新版本和更新内容。便携版自动下载并校验 ZIP，手动更新打开本机发行 ZIP；安装版自动下载并校验同版本 Setup EXE，再启动安装程序升级已有安装，联网失败时仍可手动选择 Setup EXE。便携 ZIP 会检查版本、`release-manifest.json` 与关键文件完整性并使用可回滚替换；在线安装程序必须有 GitHub SHA-256，手动安装程序必须符合严格版本命名且高于当前版本。两种形态都会在更新前显示目标版本内容，并在新版本首次启动后显示一次本次变化。未来 Microsoft Store 包必须关闭应用内自更新并交由商店管理。

## 私有提交与公开发行

私有代码提交、版本标签、公开源码快照和 GitHub Release 是独立状态，必须分别确认。普通迭代应及时提交到 `main`、推送私人 `origin/main` 并刷新本地 `builds/current`，但不自动创建 GitHub Release。普通未升版提交不强制创建标签；用户明确要求推进版本号时，必须在版本提交上创建并推送对应 `vX.Y.Z` 私人标签。只有用户明确要求公开时，才读取 `docs/REPOSITORY_MAINTENANCE.md` 并执行公开快照流程；已存在 Release 时不要重复上传附件。

## 失败处理

构建或烟雾验证失败时保留 current，不提升 staging。公开快照失败时恢复公开工作树，不修改私有提交。任何失败都先记录实际提交、版本、产物路径和数据路径，再决定重试。
