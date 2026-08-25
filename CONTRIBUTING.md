# Contributing

感谢你愿意改进 Hamster Archiver。

## 开发流程

1. 在 Windows 上使用 Node.js 22.12+（22.x）或 24.x，配套 npm 10.x/11.x，并执行 `npm ci`；`.nvmrc` 跟随 Node.js 24.x，但不是 Git 或本地发行的精确补丁限制。不要删除或重新生成 `package-lock.json` 来绕过安装失败。
2. 从独立分支完成修改，并尽量为行为变化补充测试。
3. 提交前依次运行 `npm run verify:dependencies`、`npm run check`、`npm test` 和 `npm run publish:check`。
4. 构建发行版前运行 `npm run verify:tools`。依赖或内置工具升级必须单独修改 `dependency-lock.json`，核对固定来源、来源包及关键二进制 SHA-256，并完成真实归档及媒体抽帧测试。Dependabot 只负责每月提出 npm 与 GitHub Actions 更新 PR，不自动合并；未同步清单的更新会被 CI 拒绝。
5. Pull Request 请说明用户可见变化、验证方式和可能的数据迁移影响。

## 隐私与测试数据

不要提交 `userdata/`、真实仓库、压缩包、运行日志、密码、私人媒体或个人绝对路径。请用临时目录和虚构数据编写测试。发布安全检查通过不代表可以省略人工复核。

## 设计原则

- 本地优先、便携、可恢复。
- 源文件安全优先于自动化程度。
- 依赖和界面保持克制；新增功能应解决清晰、重复出现的问题。
- 数据格式变化必须兼容或提供明确的迁移工具。
