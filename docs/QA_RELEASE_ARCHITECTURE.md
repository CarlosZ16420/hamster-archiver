# 测试与发行架构

本文件是测试选择、构建、发布、重试和镜像的唯一规则源。`docs/RELEASE.md` 说明具体发行操作，各发行技能只做任务路由，不重复定义门槛。

## 硬约束

1. 每个提交只生成一份 QA 计划。发布目标（私有、公开、CNB）不能提高 QA 等级。
2. 源码 QA、产物构建、产物烟雾、附件上传、公开镜像和 CNB 镜像是独立阶段。
3. 同一提交和版本的成功凭据可以复用。失败只重试失败阶段；只有输入或产物发生变化时，才使受影响的后续凭据失效。
4. 私有 GitHub Release 是 Windows 二进制的构建源。公开 GitHub 和 CNB 下载、校验并镜像同一组附件，禁止重新构建。
5. 完整测试只能由显式 `full` 选择、`release_kind=major` 或明确的重大跨层变更触发。补丁、正式发布、公开发布本身都不触发完整测试。
6. 构建产物仍必须经过一次最小烟雾：隔离数据目录启动、窗口与 preload bridge 就绪、基础状态 IPC 成功、版本凭据正确、正常退出。

## QA 分级

| 等级 | 适用情形 | 默认动作 |
|---|---|---|
| `none` | 文档、注释、发行说明；或已经有同提交成功凭据 | 不安装依赖，不运行测试，不构建 |
| `targeted` | 补丁、小功能、构建或发行脚本变更 | 只检查变更 JS，并运行受影响测试组 |
| `full` | 主版本、明确重大跨层变更、用户明确要求 | 完整语法、测试、依赖、工具、布局、版本与发布安全检查一次 |

`scripts/qa-plan.js` 根据改动路径生成计划。测试组为 `release`、`mirrors`、`packaging`、`archive`、`catalog`、`data`、`desktop`、`mcp` 和 `safety`。不确定的产品源码归入最接近的业务组；不确定的仓库文件归入 `safety`。单项失败可用 `--test-file` 只重跑一个已登记测试文件，测试组失败可用 `--group` 只重跑该组。

常用入口：

```text
npm run test:changed
npm run test:group -- release
node scripts/qa-plan.js --execute --test-file test/release-local.test.js
npm run test:full
```

需要快速把便携包交给测试者时使用 `npm run release -- --channel validation --tag main`。它只生成 ZIP、摘要和清单，保留在云端一天，不创建草稿或正式 Release；稳定发行才生成安装版。

## 构建与产物

`npm run release:local` 是按需构建器，默认只刷新 `current`，默认 QA 为 `none`，且执行一次最小烟雾。调用者按实际交付目标选择：

```text
npm run release:local
npm run release:local -- --outputs zip --qa targeted
npm run release:local -- --outputs zip,installer --qa none
npm run release:local -- --outputs current,zip,installer --qa full --startup-integrity
```

- `current`：只在明确需要本机手动测试时生成；此时才要求应用退出。
- `zip`：便携测试或正式附件需要时生成，使用平衡压缩，不为追求极小体积消耗额外时间。
- `installer`：需要验证安装流程或正式发行时生成。
- `--startup-integrity`：只在启动校验、缓存或更新启动逻辑受影响时启用两次启动缓存验收。

Electron 的 npm 包可以存在而 `dist/electron.exe` 缺失，因此不能把二者视为同一状态。QA 只有 `packaging/full` 才准备 Electron；构建始终先校验运行时，优先复用校验通过的缓存，发行命令在确实缺失时允许按锁定版本下载并再次校验。普通业务测试不安装 Electron 或内置媒体工具。

## 阶段和检查点

本机检查点写入仓库外 `HamsterArchiver-Local/builds/release-runs/<version>-<commit>.json`，记录请求、每阶段状态、尝试次数、错误和产物摘要。阶段为：

```text
source → qa → dependencies → build → smoke → zip / installer / promote-current
                                              ↓
                              publish-private → publish-public → mirror-cnb
```

云端把预检、QA、构建和上传分成独立作业。构建成功后保存一天的短期 Actions 产物。上传失败时使用“重新运行失败的作业”；若必须新开运行，则传入原 `run_id` 恢复该产物。单个测试失败时用 `--retry-test test/具体文件.test.js` 只重跑该项。以上续跑都不会重新执行已成功的阶段。

重试规则：网络、超时和 5xx 最多原地重试一次；响应不明确时只回读一次远端状态；断言、配置、权限和摘要冲突立即停止；同一错误再次出现时保留检查点并退出，禁止递归调用整个发行命令。

## 分发

1. 私有 Release 从版本提交构建并上传四个附件：ZIP、安装 EXE 和两份 SHA-256。
2. 公开 Release 从私有正式 Release 下载四个附件，逐字节和旁车摘要校验后上传，零测试、零构建。
3. CNB 从公开正式 GitHub Release 下载相同四个附件和双语正文，校验后镜像，零测试、零构建。
4. 源码快照、Git 标签和 Release 附件分别记录状态。CNB 的源码标签由公开仓库同步流程补齐；它不是新的构建入口。

## 验收场景

- 文档提交：0 个业务测试，0 次构建。
- 私有 main 直接提交：不自动启动 CI；需要评审时使用拉取请求或手动 QA。
- 发行脚本修复：只运行 `release` 组，0 个业务功能组。
- 小型 UI 修复：只运行 `desktop` 组；需要公开测试包时构建一次、启动一次。
- 私有 + 公开 + CNB：一组二进制，后两个目标只镜像。
- 上传失败：重跑上传作业，0 次测试，0 次构建。
- 只改发行说明：0 次构建。
- 主版本：完整矩阵一次，后续所有目标复用该提交凭据。
