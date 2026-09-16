# Hamster Archiver 4.6.11

## 中文

4.6.11 修复正式发行的测试准备条件和本机发布流程，并继续完善 Windows 安装版与界面细节，保留 4.6.10 的入库安全、工作台与 AI 接入改进。

### 界面与安装程序

- 微调“收纳设置”步骤标题的垂直位置，并让仓库概览中的活跃度卡片与随机漫步卡片下边缘对齐。
- 修复实时进度更新期间“生成清单与 MD5”等状态胶囊外框消失的问题；“移入库目录”继续用于已验证成品实际发布到仓库的阶段。
- Windows 安装程序第一步可选择 English 或简体中文，内置页面和自定义选项全程跟随所选语言。

### 发行可靠性

- 发布前直接核对 ZIP 内的版本及提交，防止同版本重新构建时误复用旧压缩包。
- 修复安装器目录页回调过早访问更新检测插件，以及重复清理回调定义导致的编译失败；保留严格编译检查，安装器构建显式关闭隐式发布。
- 归档集成测试显式创建已确认的输出目录，与应用“不静默重建缺失目录”的安全行为保持一致；加密校验和数据库拒绝提交后的成品恢复检查仍保留。
- 本机 Git/GitHub 维护从首次操作起使用正常 Windows 凭据上下文，默认直连，不自动搜索令牌或设置代理；网络、凭据和仓库权限错误分别报告。
- 私有正式发行完成后，公开 GitHub 和 CNB 镜像相同附件；公开更新说明覆盖上一公开正式版 4.6.9 → 4.6.11。

### 升级与数据

请通过完整便携程序目录或安装程序升级。本版本不更改 SQLite 仓库格式、用户资料位置或现有记录，无需迁移或重建数据。

## English

Version 4.6.11 repairs formal-release test setup and the local publishing workflow, further refines the Windows installer and interface details, and retains the intake safety, Workbench, and AI integration improvements from 4.6.10.

### Interface and installer

- Fine-tuned the Archive Setup step label and aligned the lower edges of the activity and Random Walk cards in Warehouse Overview.
- Fixed live progress updates dropping the status-pill styling from stages such as Building Manifest. “Saving to Warehouse” remains the stage for publishing verified output into the Warehouse.
- The Windows installer now begins with an English / Simplified Chinese choice, and both built-in and custom pages follow the selected language.

### Release reliability

- Publication verifies the version and commit inside the ZIP itself, preventing reuse of an older archive when rebuilding the same version.
- Fixed installer compilation failures caused by directory-page callbacks accessing the update-detection plugin too early and clearing callback definitions twice. Strict compiler checks remain enabled, and installer builds explicitly disable implicit publishing.
- Archive integration tests explicitly create the confirmed output folder, matching the application's safety rule against silently recreating missing directories. Encryption verification and recovery checks after a rejected database commit remain in place.
- Local Git/GitHub maintenance starts in the normal Windows credential context and uses direct connectivity by default, without automatic token searches or proxy configuration. Network, credential, and repository-permission failures are reported separately.
- After the private stable release completes, public GitHub and CNB mirror the same attachments. Public release notes cover public stable 4.6.9 → 4.6.11.

### Upgrade and data

Upgrade through the complete portable application directory or installer. The SQLite warehouse format, user-data locations, and existing records remain unchanged; no migration or rebuild is required.
