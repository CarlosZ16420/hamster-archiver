# 版本与发行流程

## 云端优先与本地回退

正式发行选择一次构建方式：默认 `npm run release`，或 `npm run release -- --mode local`。在需要发布的仓库工作树中执行；默认从该仓库的 origin 识别目标，也可明确指定 `--repo CarlosZ16420/hamster-archive` 或 `--repo CarlosZ16420/hamster-archiver`。目标远端标签必须与当前已提交 HEAD 完全一致，版本必须匹配 package.json；禁止移动历史标签。

- 云端：显式触发 `package.yml`，执行完整检查、便携 ZIP/隔离启动验收、安装 EXE 构建以及两份 SHA-256 校验，然后直接上传四个文件到同仓库 Release 草稿。不会先下载到本机，也不依赖 Actions artifact 存储。
- 本地：`npm run release -- --mode local` 执行相同完整构建和校验，直接从本机上传 Release 草稿，不触发云端打包。执行前准备依赖、Electron 运行时和锁定工具，见开发文档。
- 云端任务最长运行 25 分钟；启动器连同排队默认最多等 30 分钟，超时请求取消并退出，提供明确的本地命令。不会无限查找运行、自动重复提交或暗中启动本地构建。切换前必须确认同版本云端任务已结束；本地入口会拒绝与活动云端任务同时发行。
- Actions 分钟数/执行额度不足时，可直接选本地模式；仅 artifact 存储不足不妨碍直接上传 Release。GitHub 本身或登录不可用时，上传仍会失败，此时先保留本地产物并修复连接。
- 任务成功必须具备 EXE、ZIP 及对应的两份校验文件。任何上传中断都只留下草稿，不把缺文件的版本公开。已发布 Release 一律拒绝覆盖；草稿已有同名同摘要文件则跳过，冲突则停止并提示检查，绝不覆盖不明文件。
- 上传中断后可保留现有构建，执行 `node scripts/release-publish.js upload --repo OWNER/REPO --tag vX.Y.Z` 继续上传，不必重新打包。若从云端部分草稿切换到本地新构建，应先检查并删除该未发布草稿中冲突的附件，再重试上传；不得删除历史正式 Release。
- 成功后检查草稿页面并发布；应用的自动更新只读取正式 Release。安装版和便携版历史附件不受 Actions 清理影响。

Git 标签推送不再触发打包；两个仓库不会因同步同一版本而自动各打一次。普通 CI 仍自动运行。公开仓库仍只接受私有源码的受控快照，只有需要向公开用户发行时才选择公开仓库构建；不要同时对两个仓库启动同版本发布。

Actions 页面也可手动运行：`tag` 填现有版本标签，`publish=true` 创建草稿。`publish=false` 只构建验证，允许 `tag=main`，不创建 Release。`retain_artifact` 默认关闭，确有临时下载需要才开启，保留 3 天；其上传失败不阻断已完成的 Release 草稿。不要用验证模式绕过正式发布的标签核验。

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
3. 只有需要本地试用时才运行 `npm run release:local`；它不重复执行完整源码测试矩阵。云端发行时不额外运行本地打包。
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

GitHub Release 正文必须使用 `docs/releases/release-notes-vX.Y.Z.md` 的完整双语内容：一级产品标题下依次提供 `## 中文`、`## English`，各语言内使用三级标题与条目；不能只上传英文正文或用“主要变化”代替语言分区。`verify:version` 检查当前版本的两个非空语言分区。包内 `release-summary` 继续提供安装确认所需的简短双语摘要。

手动检查会列出本地版本之后、最新正式版本以内的已发布 Release；未建立 Release 的 Git 标签不在历史中。历史记录缺少译文时需维护者为对应 GitHub Release 补齐双语正文，应用不会自动翻译。历史请求失败、达到分页上限或单篇超过 128,000 字符时明确提示并提供发布页入口。修正本地说明文件不会自动更改 GitHub 上已发布的内容；远端正文修改需单独明确授权。

打包后的 Windows x64 便携版和安装版都从顶部“检查更新”进入统一更新窗口：启动时可静默发现新版，但应用不强制更新，也不会因后台检查主动弹窗；只有用户点击“检查更新”才显示当前版本、最新版本和更新内容。便携版自动下载并校验 ZIP，手动更新打开本机发行 ZIP；安装版自动下载并校验同版本 Setup EXE，再启动安装程序升级已有安装，联网失败时仍可手动选择 Setup EXE。便携 ZIP 会检查版本、`release-manifest.json` 与关键文件完整性并使用可回滚替换；在线安装程序必须有 GitHub SHA-256，手动安装程序必须符合严格版本命名且高于当前版本。两种形态都会在更新前显示目标版本内容，并在新版本首次启动后显示一次本次变化。未来 Microsoft Store 包必须关闭应用内自更新并交由商店管理。

## 私有提交与公开发行

私有代码提交、版本标签、公开源码快照和 GitHub Release 是独立状态，必须分别确认。普通迭代及时提交到 `main` 并推送私人 `origin/main`；本地 `builds/current` 仅在需要试用时刷新，不自动创建 GitHub Release。普通未升版提交不强制创建标签；用户明确要求推进版本号时，在版本提交上创建并推送对应 `vX.Y.Z` 私人标签，再显式选择发布方式。只有用户明确要求公开时，才读取 `docs/REPOSITORY_MAINTENANCE.md` 并执行公开快照流程；已存在正式 Release 时不要重复上传附件。

## 失败处理

构建或烟雾验证失败时保留 current，不提升 staging。公开快照失败时恢复公开工作树，不修改私有提交。任何失败都先记录实际提交、版本、产物路径和数据路径，再决定重试。
