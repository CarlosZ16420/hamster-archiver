# Hamster Archiver 4.6.19

## 中文

### 大型任务响应

- 常见词或 MD5 匹配超过 2000 个项目时，仓库搜索仍返回完整结果；输入建议继续限制数量以保持响应速度。
- 生成缩略图时，任务列表使用轻量进度更新，减少大型仓库中的界面卡顿。
- 只修改目录检查时间、原文件后处理状态或相似关系时，仓库不再重建无关的文件、搜索和指纹索引。标题、备注、标签和清单变化仍更新对应索引。
- 扫描与清单生成共用文件 metadata 遍历底层，保留现有源文件变化判断。

### 数据安全与路径

- 人工确认大小异常成品后，如果源文件已完成移动或回收、但仓库状态保存失败，任务会明确显示实际处理结果与恢复线索，不再提示可重新入库。
- 未压缩直接入库在提交前重新核对源文件和目录；完全重复自动跳过前也核对当前源状态。压缩后的源复核、7-Zip 完整性测试及跨盘目标校验继续执行。
- 自定义暂存位置在原归档输出下保留；更改归档输出且未指定新暂存位置时，自动使用新输出旁的暂存目录。
- 阶段耗时诊断仅保留在当前进程内，不写入普通日志或仓库记录。仓库格式和用户资料位置不变，无需迁移。

## English

### Large task responsiveness

- Warehouse search returns all matches even when a common query or MD5 matches more than 2,000 items; suggestions remain limited for responsiveness.
- Thumbnail generation now updates the task list through lightweight progress messages, reducing interface stalls in large warehouses.
- Changes limited to folder check time, source disposition, or similarity relationships no longer rebuild unrelated file, search, and fingerprint indexes. Changes to titles, notes, tags, and manifests still update the affected indexes.
- Intake and manifest generation share the same file metadata walker while preserving existing source change checks.

### Data safety and paths

- After an abnormal archive is confirmed, a completed source move or recycle operation is reported accurately even if saving its final Warehouse status fails. The task retains recovery details and does not invite a duplicate retry.
- Inventory-only tasks recheck current files and directories before commit. Exact duplicate auto-skip also checks the current source. Post-compression source validation, 7-Zip integrity testing, and cross-disk destination verification remain in place.
- A custom staging directory stays in use for its archive output. Changing the output without selecting new staging derives a directory beside the new output.
- Stage timing diagnostics remain in process memory and are not written to regular logs or warehouse records. The warehouse format and user data location are unchanged; no migration is needed.
