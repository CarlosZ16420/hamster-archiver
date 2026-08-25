# 开发指南

## 环境

使用 Windows，以及 Node.js 22.12+（22.x）或 Node.js 24.x，配套 npm 10.x/11.x。`.nvmrc` 与 CI 跟随 Node.js 24.x 作为开发建议；开发和本地发行只校验兼容范围，不限定补丁版本。项目通过 `.npmrc` 使用官方 npm 仓库，首次安装运行 `npm ci`；缺少锁定工具时运行 `npm run tools:prepare`。

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

需要改位置时设置 `HAMSTER_LOCAL_ROOT`。开发数据可单独用 `HAMSTER_DEV_USER_DATA_DIR` 覆盖；公开仓库可用 `PUBLIC_SNAPSHOT_DIR` 覆盖。

## 常用命令

```powershell
npm start                  # 开发模式，使用仓库外 development 数据
npm run check              # 自动发现并检查所有已跟踪 JS
npm test
npm run publish:check      # 依赖、目录、版本和发布安全检查
npm run preview:current    # 启动仓库外 current，而不是根目录 EXE
```

`npm run check:layout` 会拒绝根目录中的用户数据、发行版、运行时副本和未登记目录。测试必须使用系统临时目录或 `development/`，不要在根目录创建固定名称的试验目录。

开发和 `npm run release:local` 都直接使用当前本机受支持的 Node.js/npm。项目不会额外下载 Node.js，也不会因为支持范围内的补丁版本不同而阻止 Git 操作或本地发行；发行清单记录实际使用版本。

## 提交要求

提交前检查差异和未跟踪文件；不要提交数据库、日志、归档、真实媒体、密码或个人绝对路径。结构或工作流变化同步更新本目录文档和对应项目技能。
