# Hamster Archiver 4.6.3

## 中文

4.6.3 是面向界面一致性、活跃度配色和本地测试发行流程的维护版本。

### 弹窗与活跃度

- 应用内弹窗统一采用更接近 Windows 窗口的小圆角，右上角关闭控件统一为“×”，不再显示文字式“关闭”按钮。
- 检查更新弹窗在标题左侧显示项目 Logo，底部操作区加深层次，并统一按钮边框、阴影和主操作样式。
- 仓库活跃度图采用 GitHub 式语义：无活动格在浅色主题中使用中性浅灰，在暗色主题中使用克制的低亮度深色；只有存在入库活动的一至四级方格显示绿色，避免空白区域泛绿或刺眼。

### 本地测试与正式发行

- 每次更新本地 Current 都会在同一次流程中生成完整便携目录、便携 ZIP、安装 EXE 和两份 SHA-256，便于同时检查便携版与安装版。
- 正式 GitHub Release 仍优先在 GitHub Actions 云端构建并直接上传附件，不上传本机测试产物，从而减少维护机上行流量。

### 升级与数据

本版本不更改仓库格式、用户资料位置或现有记录，不需要迁移或重建数据。

## English

4.6.3 is a maintenance release focused on dialog consistency, activity-chart colors and the local test-release workflow.

### Dialogs and activity chart

- In-app dialogs now use compact Windows-like corners and a consistent upper-right “×” control instead of text-based Close buttons.
- The update dialog shows the project logo beside its title, uses a more distinct footer surface, and aligns button borders, shadows and primary-action styling.
- The warehouse activity chart now follows GitHub-like semantics: empty cells use neutral light gray in light themes and restrained low-luminance tones in dark themes. Only cells with recorded activity use the four green levels, avoiding green-tinted or glaring empty areas.

### Local testing and formal releases

- Every local Current refresh now produces the complete portable directory, portable ZIP, installer EXE and both SHA-256 files in one flow, so both distributions can be tested together.
- Formal GitHub Releases remain cloud-first: GitHub Actions builds and uploads the assets directly instead of uploading local test artifacts, reducing upstream traffic from the maintenance machine.

### Upgrade and data

This release does not change the warehouse format, user-data locations or existing records. No migration or rebuild is required.
