# 版本与发行流程

## 云端优先与本地回退

正式发行选择一次构建方式：默认 `npm run release`，或 `npm run release -- --mode local`。在需要发布的仓库工作树中执行；默认从该仓库的 origin 识别目标，也可明确指定 `--repo CarlosZ16420/hamster-archive` 或 `--repo CarlosZ16420/hamster-archiver`。目标远端标签必须与当前已提交 HEAD 完全一致，版本必须匹配 package.json；禁止移动历史标签。

- 云端：显式触发 `package.yml`，在 GitHub runner 上执行完整检查、便携 ZIP/隔离启动验收、安装 EXE 构建以及两份 SHA-256 校验。目标版本尚无 Release 时，一次调用 GitHub CLI 并同时传入四个附件；GitHub CLI 按其官方流程在内部创建临时草稿、上传全部附件并发布，项目脚本不再手工创建草稿后立即反查。产物不会先下载到本机，也不依赖 Actions artifact 存储；正式云端 Release 不上传本机刚生成的 Current 产物，避免占用维护机上行流量。
- 本地：只在云端任务已经停止且确实失败，或用户明确选择本地方式时，运行 `npm run release -- --mode local`。入口先校验当前提交是否已有完整的本地发行清单、ZIP、安装 EXE 和两份 SHA-256；完全一致时直接复用并上传，不重复执行测试或构建。只有产物缺失或提交不一致时才执行一次完整构建和校验。缺少 npm 依赖时按锁文件安装；缺少发行工具时从固定来源恢复并校验；Electron 运行时仍只从校验通过的本机缓存恢复，不会隐式下载。该命令用于正式发行；日常维护后的手动测试 Current 使用 `npm run release:local`。
- 云端任务最长运行 25 分钟；启动器连同排队默认最多等 30 分钟。启动后只用 15、30、60 秒三个有界等待窗口定位本次唯一请求，随后交给一次 `gh run watch` 阻塞等待，不再每 10 秒自行查询；超时请求取消并退出，提供明确的本地命令。不会无限查找运行、自动重复提交或暗中启动本地构建。切换前必须确认同版本云端任务已结束；本地入口会拒绝与活动云端任务同时发行。
- Actions 分钟数/执行额度不足时，可直接选本地模式；仅 artifact 存储不足不妨碍直接上传 Release。GitHub 本身或登录不可用时，上传仍会失败，此时先保留本地产物并修复连接。
- 任务成功必须具备 EXE、ZIP 及对应的两份校验文件。GitHub CLI 在首次发布中负责保证附件上传完成后才公开；任何上传中断最多留下内部草稿，不把缺文件的版本公开。已发布且完整的 Release 视为幂等成功，一律不重建或覆盖；已发布但不完整或为预发行时安全停止。草稿已有同名同摘要文件则跳过，冲突则停止并提示检查，绝不覆盖不明文件。
- 上传中断后可保留现有构建，执行 `node scripts/release-publish.js release --repo OWNER/REPO --tag vX.Y.Z` 继续上传并在完整核验后发布，不必重新打包。对 EOF、连接重置、超时及可重试的 GitHub 服务错误，每个附件最多等待 30 秒回读一次并重试一次；若失败响应前远端其实已收到同名同大小同摘要附件，则视为成功而不重复上传。若从云端部分草稿切换到本地新构建，应先检查并删除该未发布草稿中冲突的附件，再重试上传；不得删除历史正式 Release。
- 若发布入口发现完整草稿，先确认标签/提交、双语正文以及远端恰好四个非空且带 GitHub SHA-256 摘要的预期附件，然后直接发布，不重新构建、不读取本地产物、不重复上传；发布后的立即回读未达到预期时只固定等待 30 秒再回读一次，不进行高频轮询。部分草稿才进入构建、续传和冲突核验。云端任务成功后，本地启动器接受“完整正式 Release”为成功状态。应用的自动更新只读取正式 Release，安装版和便携版历史附件不受 Actions 清理影响。

Git 标签推送不再触发打包；两个仓库不会因同步同一版本而自动各打一次。普通 CI 仍自动运行。私有与公开 GitHub Release 的 Windows 附件来自同一私有版本时，使用 `node scripts/release-publish.js mirror --from-repo CarlosZ16420/hamster-archive --repo CarlosZ16420/hamster-archiver --tag vX.Y.Z`：它核对公开标签的快照提交映射、私有正式 Release、四个本地文件及远端大小/SHA-256，再以公开累积双语正文发布相同附件。公开仓库无需再为同一版本重复构建。

## CNB 发行镜像

GitHub Release 是唯一权威发行源。CNB 只镜像同一正式版本的公开源码标签、原始双语正文、便携 ZIP、安装 EXE 和对应两份 SHA-256，不在 CNB 重建产物，也不向 CNB 推送私有源码。已发布的 4.6.0 客户端没有 CNB 检查或下载回退能力；该能力只能由后续包含本实现的版本提供。

应用始终先请求 GitHub；GitHub 成功（包括已经是最新版）时不请求 CNB。只有 GitHub 超时、连接失败、HTTP 错误（包括 404）或响应解析失败时才尝试 CNB，两边都失败才向用户报错。版本化只读配置 `src/config/update-providers.json` 随应用打包，内置目标是公开仓库 `carlosz16420/hamster-archive`：通过匿名可访问的 `/releases/latest` 跳转取得正式版本标签，再使用 `/releases/latest/download/<文件名>` 下载便携 ZIP、安装 EXE 和对应 SHA-256；客户端不携带 CNB Token。CNB OpenAPI Release 元数据需要鉴权，因此不作为公开客户端的默认入口；该后备只提供 latest，历史列表标为不完整并链接公开发布页。运行环境仍可用 `HAMSTER_CNB_DISCOVERY_MODE`、`HAMSTER_CNB_LATEST_RELEASE_API`、`HAMSTER_CNB_RELEASES_API`、`HAMSTER_CNB_RELEASES_URL` 和 `HAMSTER_CNB_DOWNLOAD_HOSTS` 显式覆盖。下载和每一跳重定向继续受 CNB 主机白名单约束，实际文件必须通过 SHA-256 旁车校验。

正式 GitHub Release 发布后，独立的 `sync-cnb-release.yml` 才具备镜像入口。CNB 写入由公开仓库变量 `CNB_SYNC_ENABLED=true` 显式启用；未启用时 workflow 安全跳过并说明原因。启用前仍必须独立核实真实目标、当前官方 API 契约、上传主机和 Token 实际权限。workflow 的同步 job 和写入 step 同时限制为 `CarlosZ16420/hamster-archiver`，执行代码固定检出本次 workflow 的 `github.sha`。同步先核对本地公开标签与 GitHub 公开标签的提交；CNB 缺少该标签时只推送这一条公开标签，已有同名标签不一致时拒绝覆盖，然后才进入 Release 镜像。CNB Token 只注入标签与附件同步步骤，失败不改变 GitHub 发布结果。脚本不把环境声明当成权限证明。

手动重试同一标签时优先从公开仓库 Actions 运行 `Sync published release to CNB`；它会先补齐缺失的公开源码标签，再执行附件镜像。单独调试附件同步时，在环境中显式设置 `CNB_SYNC_ENABLED=true`、`CNB_REPO_SLUG`、`CNB_TOKEN` 和精确的 `CNB_UPLOAD_HOSTS`，再运行 `npm run release:sync:cnb -- --tag vX.Y.Z --github-repo CarlosZ16420/hamster-archiver --cnb-repo GROUP/REPO --make-latest false`；此命令仍要求 CNB 已有同名标签。`CNB_API_BASE`、`CNB_WEB_BASE` 可覆盖经核实的 SaaS 基址。历史版本手动补同步默认 `makeLatest=false`，不会改变 CNB latest；只有确认目标就是当前最新正式版本时才显式传 `--make-latest true`，发布事件 workflow 会明确传入该值。脚本先创建或接续隐藏草稿，创建阶段始终保持 `make_latest=false`，只读取已发布 GitHub 正文和四附件并逐项校验名称、大小和 SHA-256；完整回读通过后才按显式 latest 选择发布 CNB Release。同名同摘要附件会跳过，正文、标题、大小或摘要冲突会停止且不覆盖。网络、上传或确认响应不明时先回读远端状态，再决定是否重试，不重新构建或盲目补传。公开客户端的匿名下载回退与同步 workflow 的写权限彼此独立：前者不使用 Token，后者的 Token 仍不得进入源码或发行包。

Actions 页面也可手动运行：`tag` 填现有版本标签，`publish=true` 构建并通过 GitHub CLI 原生事务上传、发布；若目标已有完整草稿则直接发布，若已有完整正式 Release 则幂等成功，两种情况都跳过构建。`publish=false` 只构建验证，允许 `tag=main`，不创建 Release。`retain_artifact` 默认关闭，确有临时下载需要才开启，保留 3 天；其上传失败不阻断已完成的正式 Release。不要用验证模式绕过正式发布的标签核验。

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
3. 每次代码维护完成都运行 `npm run release:local`，将当前已提交且已推送的 `main` 刷新到外部 `HamsterArchiver-Local/builds/current`，并在同一次本地测试发行中生成便携 ZIP、安装 EXE 与各自 SHA-256。手动测试至少覆盖 `builds/current/HamsterArchiver.exe` 和 `builds/installers/HamsterArchiver-Setup-vX.Y.Z-win-x64.exe`；该入口默认不重复执行完整源码测试矩阵。云端正式发行避免无条件重复本地打包或上传本地产物，但不得以云端成功为由默默遗漏本轮明确要求的 Current。
4. 用户明确要求测试、SemVer 主版本或被指定为重大/正式发布、上传私有 GitHub Release、或推送公开仓库时，改用 `npm run release:local -- --full-checks`。
5. 两种模式都直接使用当前受支持的本机 Node.js 22.12+（22.x）或 24.x，以及 npm 10.x/11.x；不下载第二套 Node，也不限制支持范围内的补丁版本。`electron.exe` 是锁定 npm 依赖生成的运行时文件，不进入 Git；公开快照重建或全新检出后由发行入口按锁文件恢复 npm 包，再从 SHA-256 校验通过的本机缓存恢复 Electron 运行时。没有可用缓存时停止并明确说明未下载，只有人工确认后显式运行 `npm run electron:prepare -- --allow-download` 才允许联网。发行清单记录实际使用版本。随后从当前提交构建到仓库外 staging，并强制验证锁定工具、发行清单、ZIP、SHA-256、隔离数据烟雾启动，以及打包应用首次全量校验和第二次缓存命中。烟雾验收使用隔离目录中的结果文件，不依赖 Windows GUI 进程在 runner 上不稳定的标准输出。完整模式还执行依赖、语法、单元测试、目录/版本/发布安全检查。
6. 验收成功后旧 current 进入 history，新构建提升为 `builds/current`，便携压缩包写入 `builds/packages`，安装 EXE 写入 `builds/installers`。`release:local` 成功必须同时报告 Current 中的便携 EXE、便携 ZIP、安装 EXE 和两份 SHA-256；缺少任一发行形态时不得宣称本地测试发行完成。
7. 使用 `npm run preview:current` 启动；不要在源码根目录复制或运行 EXE。

ZIP 在写入维护机专用数据指针之前生成，因此对外解压后仍保持普通便携数据行为。

## Windows 安装版与商店准备

- `npm run release:local` 会在提升 Current 前调用安装版构建，确保每次 Current 更新都同步得到可测试的 NSIS 安装程序。需要单独重建安装版时仍可使用 `npm run build:installer`；产物和 SHA-256 位于仓库外 `HamsterArchiver-Local/builds/installers/`。
- 安装版与便携版是两种独立发行形态：便携版默认使用程序旁 `userdata`；安装版默认使用 Windows 用户数据目录，安装目录不保存运行数据。卸载程序默认保留用户数据。
- 安装版使用稳定的 `com.carlosz.hamsterarchiver` 应用标识和当前用户安装注册信息识别已有版本；运行更高版本安装程序时会升级已有安装，而不是并排创建第二份。安装目录始终规范为用户所选父目录下的 `Hamster Archiver` 子目录；安装选项可决定是否创建桌面快捷方式，完成页直接启动已安装 EXE，不依赖快捷方式。
- 当前 NSIS 安装程序用于普通桌面分发和安装流程验收。进入 Microsoft Store 前，优先从同一 installed 布局生成 MSIX，并在 Partner Center 预留名称、取得 Store identity 后补齐清单。MSIX 商店提交由 Microsoft 签名；在商店外分发的安装程序仍应使用可信代码签名证书。
- MSIX 安装目录是只读的，因此 installed 布局禁止依赖程序目录中的 `userdata` 或可写配置。商店包还须关闭应用内自更新，交由 Microsoft Store 更新。

## 应用内升级

单版本说明 `docs/releases/release-notes-vX.Y.Z.md` 必须提供完整双语内容：一级产品标题下依次提供 `## 中文`、`## English`，各语言内使用三级标题与条目。公开 GitHub Release 必须使用下文规定的累积双语完成稿 `public-release-notes-vX.Y.Z.md` 全文，不能只提供最新小版本说明。`verify:version` 检查当前单版本文件的两个非空语言分区。包内 `release-summary` 继续提供安装确认所需的简短双语摘要。

手动检查会按本次成功的发行来源列出本地版本之后、最新正式版本以内的已发布 Release；未建立 Release 的 Git 标签不在历史中。历史记录缺少译文时需维护者在权威 GitHub Release 修正双语正文并重新核对镜像，应用不会自动翻译。历史请求失败、达到分页上限或单篇超过 128,000 字符时保留 latest、明确提示并提供对应来源发布页入口。修正本地说明文件不会自动更改已发布内容；远端正文修改需单独明确授权。

打包后的 Windows x64 便携版和安装版都从顶部“检查更新”进入统一更新窗口：启动时可静默发现新版，但应用不强制更新，也不会因后台检查主动弹窗；只有用户点击“检查更新”才显示当前版本、最新版本和更新内容。便携版自动下载并校验 ZIP，手动更新打开本机发行 ZIP；安装版自动下载并校验同版本 Setup EXE，再启动安装程序升级已有安装，联网失败时仍可手动选择 Setup EXE。在线下载和摘要严格绑定检查结果的 `provider`：GitHub 只接受 GitHub 及其既有 CDN，CNB 只接受本机明确配置的 CNB/对象存储主机及同白名单重定向，不接受任意 HTTPS。便携 ZIP 继续检查版本、`release-manifest.json` 与关键文件完整性并使用可回滚替换；两来源在线安装程序都必须有匹配 SHA-256，手动安装程序必须符合严格版本命名且高于当前版本。两种形态都会在更新前显示目标版本内容，并在新版本首次启动后显示一次本次变化。未来 Microsoft Store 包必须关闭应用内自更新并交由商店管理。

## 私有提交与公开发行

私有代码提交、版本标签、公开源码快照和 GitHub Release 是独立状态，必须分别确认。每次代码维护及时提交到 `main`、推送私人 `origin/main`，并刷新外部 `HamsterArchiver-Local/builds/current` 供手动测试；云端正式发行避免重复构建，但若本轮明确要求 Current，必须完成对应刷新并单独报告，不能静默跳过。普通未升版提交不强制创建标签；用户明确要求推进版本号时，在版本提交上创建并推送对应 `vX.Y.Z` 私人标签，再显式选择发布方式。只有用户明确要求公开时，才读取 `docs/REPOSITORY_MAINTENANCE.md` 并执行公开快照流程；已存在正式 Release 时不要重复上传附件。

## 失败处理

构建或烟雾验证失败时保留 current，不提升 staging。公开快照失败时恢复公开工作树，不修改私有提交。任何失败都先记录实际提交、版本、产物路径和数据路径，再决定重试。

## 公开发行必做：累积双语更新说明

每次公开发行必须完成本节任务，不能只发布最新一个私有小版本的说明。私有仓库可以频繁更新，公开仓库仍可跨多个版本发行；说明必须覆盖用户从上次公开版本升级到本次版本时实际获得的变化。

1. **确定范围。** 从目标公开频道实际已发布的正式 Release 中确认低于目标版本 B 的上一正式版本 A，记录 `A → B`。不得用上次私有提交、最近私有标签或公开源码推送时间代替 A。草稿、预发行和正在编辑的 B 不作为基线；首次公开发行明确标注基线。无法确认 A 时先准备本地草稿，不把不确定范围当作完整说明发布。
2. **收集来源。** 汇总私有 `CHANGELOG.md`、`docs/releases/` 和已有本地说明中 `(A, B]` 的记录，并核对目标发行提交及必要的 Git 历史。纳入同一版本号下已经合入 B 的后续维护；不得只比较版本标题，也不得把 B 之后的未发布改动或未合入目标的分支写成已交付功能。
3. **逐项覆盖。** 把功能、修复、交互、兼容性、数据迁移及升级提醒整理为用户可读内容。合并重复条目，同一功能多次调整时说明 B 的最终行为；保留历史分组时明确后续调整。内部构建、测试或开发过程记录可排除，但须有理由。不得直接公开私有日志、真实数据、本机路径或秘密。
4. **保存完成稿与覆盖记录。** 公开正文保存为 `docs/releases/public-release-notes-vB.md`，作为该次公开发行的唯一正文来源；保留单个私有版本的 `release-notes-vB.md`，不要混淆两种范围。另在私有维护文档区保存 `docs/public-release-coverage-vB.md`，记录频道、A/B、目标提交、来源版本/维护记录，以及每项对应正文位置或排除理由。覆盖记录不进入公开快照。没有实际存在的版本号不要求补造记录。
5. **统一双语与公开日志。** 完成稿使用 `## 中文`、`## English`，两区均说明升级范围，覆盖相同变化与安全提醒。按功能合并或用三级/四级标题按版本分组均可。`CHANGELOG.public.md` 的 B 章节从这份完成稿整理，保持相同覆盖范围；GitHub Release 使用完成稿全文，不用包内简短摘要替代。说明累积不要求为每个私有版本创建公开 Release，也不要求拆分中英文安装包。
6. **发布前门槛。** 对照覆盖记录逐项确认无遗漏、无未合入内容，中英文含义一致，升级范围与实际频道一致，并完成脱敏审查。存在未解释缺口、缺少译文或目标归属不明时，公开发行尚未完成，不发布不完整正文。云端和本地共用的 `release-publish.js` 对公开频道只读取累积完成稿，缺文件或语言分区为空即停止；已有草稿正文与完成稿不一致时拒绝继续上传附件，上传后再次回读核对。它和 `verify:version` 都不能判断跨版本语义覆盖是否完整；该项仍由发行执行者显式核对并报告。
7. **发布后回读。** 在已有公开发行授权范围内上传完成稿，随后读取线上正文，核对两种语言、范围及条目与本地完成稿一致。仅补改历史文字时先备份原正文和附件元数据，验证标签、安装包、ZIP 与 SHA 附件未改变；无需重建或重复上传附件。源码快照成功或附件上传成功都不能替代正文回读。

交付时必须单独报告“累积更新说明”：上一公开版本、目标版本、纳入范围、排除理由、完成稿与覆盖记录位置、双语核对和线上回读结果。仅准备或同步源码、未获授权发布 Release 时，保留完成稿并明确正文尚未发布；本规范不自动授权公开推送或创建 Release。

例如上次公开版为 4.5.6、本次为 4.5.9，必须汇总 4.5.7、4.5.8、4.5.9 中实际合入的变化，不能只放 4.5.9 的主页更新说明。
