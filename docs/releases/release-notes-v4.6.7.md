# Hamster Archiver 4.6.7

## 中文

4.6.7 是一次中英文界面完善版本，补齐静态与动态界面的英文表达，并确保翻译不会改写用户自己的内容。

### 中英文界面

- 补齐队列状态、处理阶段、提示、运行反馈以及主进程原生弹窗和启动错误的中英文文案。
- 统一“仓库”“归档模式”等术语和单复数表达，清理不再使用的旧词条，并补正英文忽略词文件的说明。
- 切换英文界面时保留用户自行填写的标题、路径等内容原文，不对其中的文字递归翻译。
- 增加动态界面、用户文本保护、主进程弹窗与队列术语的回归测试。

### 数据兼容

- 本版本不更改仓库格式、用户资料位置或现有记录，不需要迁移或重建数据。

## English

Version 4.6.7 completes Chinese and English UI coverage, including dynamic interface text, while preserving content entered by users.

### Chinese and English interface

- Add bilingual copy for queue states, processing stages, notices, runtime feedback, native main-process dialogs and startup errors.
- Standardize Warehouse and archive-mode terminology and plural forms, remove obsolete strings, and correct the English ignore-word file header.
- Preserve user-entered titles, paths and similar content when the interface switches to English; do not recursively translate text within that content.
- Add regression coverage for dynamic UI translation, user-content protection, main-process dialogs and queue terminology.

### Data compatibility

- This release does not change the warehouse format, user-data locations or existing records. No migration or rebuild is required.
