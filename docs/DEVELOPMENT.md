# 开发指南

## 环境

使用 Windows，以及 Node.js 22.12+（22.x）或 Node.js 24.x，配套 npm 10.x/11.x。`.nvmrc` 与 CI 跟随 Node.js 24.x 作为开发建议；开发和本地发行只校验兼容范围，不限定补丁版本。项目通过 `.npmrc` 使用官方 npm 仓库，首次安装运行 `npm ci`；随后运行 `npm run electron:prepare` 准备 Electron 运行时。`electron.exe` 位于被 Git 忽略的 `node_modules/electron/dist/`，不是源码文件；全新检出或公开快照重建后需要重新准备。该命令默认只使用本机校验通过的缓存，缓存不存在时会停止且不会下载；人工确认允许下载后才运行 `npm run electron:prepare -- --allow-download`。缺少锁定工具时运行 `npm run tools:prepare`。正式本地发行入口会自动补齐缺失的锁定 npm 依赖和工具。

## 两层目录

```text
project/                    # 只保存源码和可复现开发资源
HamsterArchiver-Local/      # 默认位于 project 同级，不进入 Git
├─ builds/
│  ├─ current/
│  ├─ staging/
│  ├─ packages/
│  └─ history/
├─ data/
│  ├─ production/
│  ├─ development/
│  ├─ intake/
│  ├─ archive-output/
│  └─ archive-staging/
├─ development/
├─ public-snapshot/
└─ quarantine/
```

默认使用源码仓库同级的 `HamsterArchiver-Local/` 作为本机资料根；需要固定到其他位置时设置 `HAMSTER_LOCAL_ROOT`。开发数据可单独用 `HAMSTER_DEV_USER_DATA_DIR` 覆盖；公开仓库可用 `PUBLIC_SNAPSHOT_DIR` 覆盖。不得在源码仓库同级新增或继续使用额外的 `Hamster*` 副本。

## 常用命令

```powershell
npm start                  # 开发模式，使用仓库外 development 数据
npm run check              # 自动发现并检查所有已跟踪 JS
npm test
npm run publish:check      # 依赖、目录、版本和发布安全检查
npm run electron:prepare   # 仅从校验通过的本机缓存准备 Electron 运行时
npm run preview:current    # 启动仓库外 current，而不是根目录 EXE
```

需要人工绕过启动缓存并重新执行完整发行包校验时，可用 `HamsterArchiver.exe --verify-integrity` 启动；成功后会刷新当前用户数据区的缓存。

`npm run check:layout` 会拒绝根目录中的用户数据、发行版、运行时副本和未登记目录。临时源码、测试和发行隔离目录必须使用系统 temp 或 `HamsterArchiver-Local/development/`，不要在根目录创建固定名称的试验目录，也不要创建同级 `Hamster*` 副本。

开发和 `npm run release:local` 都直接使用当前本机受支持的 Node.js/npm。项目不会额外下载 Node.js，也不会因为支持范围内的补丁版本不同而阻止 Git 操作或本地发行；发行清单记录实际使用版本。

## 提交与本地 Current

每次代码维护完成后，必须在干净的已提交 `main` 上推送私有 `origin/main`，再运行 `npm run release:local` 刷新 `HamsterArchiver-Local/builds/current`，并同步生成便携 ZIP、安装 EXE 和两份 SHA-256。使用 `npm run preview:current` 检查便携版，并直接运行 `builds/installers/` 中对应版本的 Setup EXE 检查安装版。该入口会先校验 Electron 运行时，缺失时仅尝试从已验证的本机缓存恢复，不会暗中下载。云端正式发行仍优先在 GitHub runner 构建并直接上传，不复用或上传本机产物；但不能因此默默省略本轮明确要求的 Current。本地测试发行与正式 Release 必须分别报告。

## 提交要求

提交前检查差异和未跟踪文件；不要提交数据库、日志、归档、真实媒体、密码或个人绝对路径。结构或工作流变化同步更新本目录文档和对应项目技能。
