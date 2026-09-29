# Hamster Archiver 4.7.1

## 中文

### 归档完整性

- 压缩归档现在保留源目录中的空目录，包括嵌套空目录和与文件并存的空目录。
- 除 7-Zip 自身的完整性测试外，发布前还会将包内文件路径、大小及目录结构与源清单比对。源扫描不完整或包内内容不一致时，停止发布和源文件后处理，保留原件以便重新扫描或检查。

仓库格式和用户资料位置不变，无需迁移。

## English

### Archive integrity

- Compressed archives now retain empty source folders, including nested empty folders and empty folders alongside files.
- Before publication, the app compares archived file paths, sizes, and folder structure with the source manifest in addition to running 7-Zip's integrity test. An incomplete source scan or a mismatch stops publication and source handling, leaving originals available for a new scan or inspection.

The warehouse format and user data location are unchanged; no migration is needed.
