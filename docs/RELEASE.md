# 版本与发行流程

## 云端优先、本地 Current 与本地回退

Review、正式 QA、按需产物、检查点和失败续跑统一遵循 `docs/QA_RELEASE_ARCHITECTURE.md`。正式发行默认 `npm run release`，也可在云端确实不可用时明确选择 `npm run release -- --mode local`。标签必须指向当前已提交版本，禁止移动历史标签。

- 默认命令同时启动两条路径：本机从源码生成 Current，云端生成正式 Release。Current 始终本地构建，不下载云端附件，不执行源码 QA 或烟雾测试；两条路径可并行，失败状态分别报告。
- 本地启动器在派发前读取 Release 状态以保证幂等；云端 `package.yml` 只保留 QA、构建和发布三个作业。补丁/次版本执行一次受影响 QA，主版本执行一次完整 QA。稳定发行不允许跳过 QA，也不查询日常 CI 后再决定是否测试。
- 构建只生成一次 ZIP、安装 EXE 和两份 SHA-256，并做一次最小隔离启动。验证后的文件以短期 Actions 产物保存一天，供发布失败后的作业级续跑。
- 上传失败时优先在 Actions 里“重新运行失败的作业”。必须新开运行时使用 `npm run release -- --resume-run RUN_ID` 复用原产物；不得重跑 QA 或构建。完整草稿直接发布，部分草稿只续传缺失附件，完整正式 Release 是幂等成功。
- 启动器用一次 `gh run watch` 等待，不进行高频 AI 轮询。等待超时时远端任务继续运行，不自动取消、不另起任务。
- 本地回退先复用同提交产物和 QA 凭据。传入失败云端运行的 `--resume-run RUN_ID` 时，只确认该运行已有成功 QA；没有可复用凭据时才在打包前执行一次正式 QA。`release:local` 本身永远不运行 QA。
- Electron 只在打包或相关 QA 中准备。发行入口验证 `electron.exe`，优先使用校验缓存；确实缺失时按锁定版本下载并复验。普通业务测试不准备 Electron。
- 本机 Git 写操作和所有 GitHub CLI 远端调用从首次执行就使用正常 Windows 宿主凭据上下文，Agent 直接申请宿主权限，不先到受限账户探测或寻找其他令牌。发布入口只调用一次目标仓库 API，并区分网络/TLS、凭据与仓库权限故障；不自动登录、修改 ACL 或绕过被拒绝的宿主授权。通过后出现的 404/422 按远端状态或工作流配置修复。
- 本机默认直连 GitHub，不自动设置 Git/GitHub CLI 代理或关闭证书校验。CNB 发布通过公开仓库的 GitHub Actions 镜像四附件与正文，不依赖本机代理、CNB Token 或重复上传；只有明确调试 CNB 写入时才使用下文的本机调试入口。
- 私有 Release 是二进制权威源。公开发布执行 `release-publish.js mirror`，直接下载、校验并上传私有四附件；CNB 再从公开 GitHub Release 镜像。两个目标均为零测试、零构建。

## CNB 发行镜像

GitHub Release 是唯一权威发行源。CNB 只镜像同一正式版本的公开源码标签、原始双语正文、便携 ZIP、安装 EXE 和对应两份 SHA-256，不在 CNB 重建产物，也不向 CNB 推送私有源码。已发布的 4.6.0 客户端没有 CNB 检查或下载回退能力；该能力只能由后续包含本实现的版本提供。

应用始终先请求 GitHub；GitHub 成功（包括已经是最新版）时不请求 CNB。只有 GitHub 超时、连接失败、HTTP 错误（包括 404）或响应解析失败时才尝试 CNB，两边都失败才向用户报错。版本化只读配置 `src/config/update-providers.json` 随应用打包，内置目标是公开仓库 `carlosz16420/hamster-archive`：通过匿名可访问的 `/releases/latest` 跳转取得正式版本标签，再使用 `/releases/latest/download/<文件名>` 下载便携 ZIP、安装 EXE 和对应 SHA-256；客户端不携带 CNB Token。CNB OpenAPI Release 元数据需要鉴权，因此不作为公开客户端的默认入口；该后备只提供 latest，历史列表标为不完整并链接公开发布页。运行环境仍可用 `HAMSTER_CNB_DISCOVERY_MODE`、`HAMSTER_CNB_LATEST_RELEASE_API`、`HAMSTER_CNB_RELEASES_API`、`HAMSTER_CNB_RELEASES_URL` 和 `HAMSTER_CNB_DOWNLOAD_HOSTS` 显式覆盖。下载和每一跳重定向继续受 CNB 主机白名单约束，实际文件必须通过 SHA-256 旁车校验。

正式 GitHub Release 发布后，独立的 `sync-cnb-release.yml` 才具备镜像入口。CNB 写入由公开仓库变量 `CNB_SYNC_ENABLED=true` 显式启用；未启用时 workflow 安全跳过并说明原因。启用前仍必须独立核实真实目标、当前官方 API 契约、上传主机和 Token 实际权限。workflow 的同步 job 和写入 step 同时限制为 `CarlosZ16420/hamster-archiver`，执行代码固定检出本次 workflow 的 `github.sha`。同步先核对本地公开标签与 GitHub 公开标签的提交；CNB 缺少该标签时只推送这一条公开标签，已有同名标签不一致时拒绝覆盖，然后才进入 Release 镜像。CNB Token 只注入标签与附件同步步骤，失败不改变 GitHub 发布结果。脚本不把环境声明当成权限证明。

手动重试同一标签时优先从公开仓库 Actions 运行 `Sync published release to CNB`；它会先补齐缺失的公开源码标签，再执行附件镜像。单独调试附件同步时，在环境中显式设置 `CNB_SYNC_ENABLED=true`、`CNB_REPO_SLUG`、`CNB_TOKEN` 和精确的 `CNB_UPLOAD_HOSTS`，再运行 `npm run release:sync:cnb -- --tag vX.Y.Z --github-repo CarlosZ16420/hamster-archiver --cnb-repo GROUP/REPO --make-latest false`；此命令仍要求 CNB 已有同名标签。`CNB_API_BASE`、`CNB_WEB_BASE` 可覆盖经核实的 SaaS 基址。历史版本手动补同步默认 `makeLatest=false`，不会改变 CNB latest；只有确认目标就是当前最新正式版本时才显式传 `--make-latest true`，发布事件 workflow 会明确传入该值。脚本先创建或接续隐藏草稿，创建阶段始终保持 `make_latest=false`，只读取已发布 GitHub 正文和四附件并逐项校验名称、大小和 SHA-256；完整回读通过后才按显式 latest 选择发布 CNB Release。同名同摘要附件会跳过，正文、标题、大小或摘要冲突会停止且不覆盖。网络、上传或确认响应不明时先回读远端状态，再决定是否重试，不重新构建或盲目补传。公开客户端的匿名下载回退与同步 workflow 的写权限彼此独立：前者不使用 Token，后者的 Token 仍不得进入源码或发行包。

Actions 页面也可手动运行：`tag` 填现有标签。`publish=false` 是云端打包验证通道，只生成便携 ZIP、摘要和清单并保留一天；`publish=true` 才生成安装版并发布。稳定发布的 `qa_level` 不能为 `none`。上传阶段失败可重新运行失败作业；新运行填写原 `resume_run_id`，复用保留一天的验证产物。

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

1. 完成修改后由人工或 Agent Review 实际差异、边界和安全；默认不运行测试。Reviewer 只有发现具体风险时才点名一项检查。
2. 修正 Review 问题后提交私有 `main`。需要马上人工体验时运行 `npm run release:local`；它本地刷新 Current，零自动测试、零烟雾、零云端下载。
3. `release:local` 用 `--outputs zip`、`--outputs installer` 或组合值生成其他产物，但仍不运行源码 QA。只有云端正式构建显式传入 `--smoke`；启动完整性行为由正式 QA 覆盖，不在本地构建阶段重复启动。
4. 各阶段写入仓库外 `builds/release-runs`。重跑同一命令会校验并复用成功阶段，只重试失败处。
5. 使用 `npm run preview:current` 启动；不要在源码根目录复制或运行 EXE。

ZIP、Current 与安装版只在选中时报告；未请求的产物不构成失败。

## Windows 安装版与商店准备

- 安装版仅在 `--outputs` 包含 `installer` 时构建。需要单独重建时也可使用 `npm run build:installer`；产物和 SHA-256 位于仓库外 `HamsterArchiver-Local/builds/installers/`。
- 安装版与便携版是两种独立发行形态：便携版默认使用程序旁 `userdata`；安装版默认使用 Windows 用户数据目录，安装目录不保存运行数据。卸载程序默认保留用户数据。
- 安装版使用稳定的 `com.carlosz.hamsterarchiver` 应用标识和当前用户安装注册信息识别已有版本；运行更高版本安装程序时会升级已有安装，而不是并排创建第二份。安装目录始终规范为用户所选父目录下的 `Hamster Archiver` 子目录；安装选项可决定是否创建桌面快捷方式，完成页直接启动已安装 EXE，不依赖快捷方式。
- 当前 NSIS 安装程序用于普通桌面分发和安装流程验收。进入 Microsoft Store 前，优先从同一 installed 布局生成 MSIX，并在 Partner Center 预留名称、取得 Store identity 后补齐清单。MSIX 商店提交由 Microsoft 签名；在商店外分发的安装程序仍应使用可信代码签名证书。
- MSIX 安装目录是只读的，因此 installed 布局禁止依赖程序目录中的 `userdata` 或可写配置。商店包还须关闭应用内自更新，交由 Microsoft Store 更新。

## 应用内升级

单版本说明 `docs/releases/release-notes-vX.Y.Z.md` 必须提供完整双语内容：一级产品标题下依次提供 `## 中文`、`## English`，各语言内使用三级标题与条目。公开 GitHub Release 必须使用下文规定的累积双语完成稿 `public-release-notes-vX.Y.Z.md` 全文，不能只提供最新小版本说明。`verify:version` 检查当前单版本文件的两个非空语言分区。包内 `release-summary` 继续提供安装确认所需的简短双语摘要。

手动检查会按本次成功的发行来源列出本地版本之后、最新正式版本以内的已发布 Release；未建立 Release 的 Git 标签不在历史中。历史记录缺少译文时需维护者在权威 GitHub Release 修正双语正文并重新核对镜像，应用不会自动翻译。历史请求失败、达到分页上限或单篇超过 128,000 字符时保留 latest、明确提示并提供对应来源发布页入口。修正本地说明文件不会自动更改已发布内容；远端正文修改需单独明确授权。

打包后的 Windows x64 便携版和安装版都从顶部“检查更新”进入统一更新窗口：启动时可静默发现新版，但应用不强制更新，也不会因后台检查主动弹窗；只有用户点击“检查更新”才显示当前版本、最新版本和更新内容。便携版自动下载并校验 ZIP，手动更新打开本机发行 ZIP；安装版自动下载并校验同版本 Setup EXE，再启动安装程序升级已有安装，联网失败时仍可手动选择 Setup EXE。在线下载和摘要严格绑定检查结果的 `provider`：GitHub 只接受 GitHub 及其既有 CDN，CNB 只接受本机明确配置的 CNB/对象存储主机及同白名单重定向，不接受任意 HTTPS。便携 ZIP 继续检查版本、`release-manifest.json` 与关键文件完整性并使用可回滚替换；两来源在线安装程序都必须有匹配 SHA-256，手动安装程序必须符合严格版本命名且高于当前版本。两种形态都会在更新前显示目标版本内容，并在新版本首次启动后显示一次本次变化。未来 Microsoft Store 包必须关闭应用内自更新并交由商店管理。

## 私有提交与公开发行

私有代码提交、版本标签、Current、公开源码快照和 Release 是独立状态，必须分别确认。每次代码维护及时提交到 `main`、推送私人 `origin/main`；只有明确要求才刷新 Current。普通未升版提交不强制创建标签；用户明确要求推进版本号时，在版本提交上创建并推送对应私人标签，再显式选择发布方式。只有用户明确要求公开时才执行公开快照或 Release；已存在正式附件时直接复用。

## 失败处理

构建或显式烟雾验证失败时保留 current，不提升 staging。每个阶段把提交、版本、尝试次数、错误和产物写入外部检查点；修复后只重跑失败阶段。配置、权限或摘要错误先修根因；网络/5xx 最多重试一次。同一根因第二次仍失败就停止并报告，禁止第三次派发、重新登录、重新构建或重新上传。公开快照失败时恢复公开工作树，不修改私有提交。

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
