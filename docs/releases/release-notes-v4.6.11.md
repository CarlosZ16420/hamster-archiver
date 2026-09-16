# Hamster Archiver 4.6.11

## 中文

4.6.11 修复正式发行的测试准备条件和本机发布流程，保留 4.6.10 的 Windows 安装版、入库安全、工作台与 AI 接入改进。

### 发行可靠性

- 归档集成测试显式创建已确认的输出目录，与应用“不静默重建缺失目录”的安全行为保持一致；加密校验和数据库拒绝提交后的成品恢复检查仍保留。
- 本机 Git/GitHub 维护从首次操作起使用正常 Windows 凭据上下文，默认直连，不自动搜索令牌或设置代理；网络、凭据和仓库权限错误分别报告。
- 私有正式发行完成后，公开 GitHub 和 CNB 镜像相同附件；公开更新说明覆盖上一公开正式版 4.6.9 → 4.6.11。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

Version 4.6.11 repairs formal-release test setup and the local publishing workflow while retaining the Windows installer, intake safety, Workbench, and AI integration improvements from 4.6.10.

### Release reliability

- Archive integration tests explicitly create the confirmed output folder, matching the application's safety rule against silently recreating missing directories. Encryption verification and recovery checks after a rejected database commit remain in place.
- Local Git/GitHub maintenance starts in the normal Windows credential context and uses direct connectivity by default, without automatic token searches or proxy configuration. Network, credential, and repository-permission failures are reported separately.
- After the private stable release completes, public GitHub and CNB mirror the same attachments. Public release notes cover public stable 4.6.9 → 4.6.11.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required.
