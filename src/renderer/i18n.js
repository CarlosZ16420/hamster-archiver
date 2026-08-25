'use strict';

// Post-hoc translation layer: the renderer keeps Chinese as the source language
// and swaps known interface phrases to English at runtime. User data (titles,
// tags, paths and notes) is never translated.
//
// Dictionary entries use [Chinese, English] pairs so that duplicate keys fail
// loudly at load time instead of being silently collapsed by an object literal.
// Captured groups in patterns ($1, $2, …) are translated recursively, which
// lets composed sentences such as “无法打开仓库：…” translate their inner labels.

const exactSections = [
  ['全局与品牌', [
    ['仓鼠症大结局', 'Hamster Archiver'],
    ['Hamster Archive', 'Hamster Archiver'],
    ['把混乱的文件，变成可视化仓库和规整压缩包，再交给云盘。', 'Turn messy files into a searchable vault and tidy archives, then hand them to your cloud drive.'],
    ['Hamster Archive · 本地优先的归档工具', 'Hamster Archiver · a local-first archiving tool'],
    ['Hamster Archiver · 本地优先的归档工具', 'Hamster Archiver · a local-first archiving tool'],
    ['本地优先的归档工具', 'A local-first archiving tool'],
    ['请从桌面程序启动', 'Launch from the desktop app'],
    ['这个页面需要本地文件与 7-Zip 权限，不能作为普通网页单独打开。', 'This page needs local file and 7-Zip access and cannot be opened as a regular web page.'],
    ['请关闭当前页面，然后运行项目根目录中的 HamsterArchiver.exe。', 'Close this page, then run HamsterArchiver.exe from the application folder.'],
    ['桌面桥接未加载：请运行 HamsterArchiver.exe，不要直接打开网页文件。', 'Desktop bridge not loaded: run HamsterArchiver.exe instead of opening the page directly.'],
    ['页面导航', 'Page navigation'],
    ['归档工作台', 'Workbench'],
    ['GitHub 仓库', 'GitHub repository'],
    ['欢迎反馈', 'Feedback welcome']
  ]],
  ['主题与语言', [
    ['主题', 'Theme'],
    ['语言', 'Language'],
    ['检查更新', 'Check for updates'],
    ['手动更新', 'Manual update'],
    ['暂时无法获取最新版本', 'The latest version is currently unavailable'],
    ['选择官方发行压缩包并更新', 'Select an official release ZIP to update'],
    ['切换到 English', 'Switch to English'],
    ['切换到中文', 'Switch to Chinese'],
    ['简体中文', 'Simplified Chinese'],
    ['选择界面语言', 'Choose interface language'],
    ['经典', 'Classic'],
    ['白昼', 'Daylight'],
    ['黑夜', 'Night'],
    ['青瓷', 'Celadon'],
    ['暮紫', 'Twilight Plum'],
    ['选择界面主题', 'Choose interface theme']
  ]],
  ['通用按钮与短词', [
    ['关闭', 'Close'],
    ['取消', 'Cancel'],
    ['确认', 'Confirm'],
    ['确认删除', 'Confirm deletion'],
    ['修改', 'Edit'],
    ['复制', 'Copy'],
    ['打开', 'Open'],
    ['选择', 'Choose'],
    ['显示', 'Show'],
    ['隐藏', 'Hide'],
    ['清除', 'Clear'],
    ['重试', 'Retry'],
    ['撤回', 'Undo'],
    ['知道了', 'Got it'],
    ['追加', 'Add'],
    ['开始', 'Start'],
    ['结束', 'End'],
    ['跳到', 'Jump to'],
    ['页', 'page'],
    ['至', 'to'],
    ['拖放', 'Drop'],
    ['粘贴', 'Paste'],
    ['无', 'None'],
    ['未记录', 'Not recorded'],
    ['；', '; '],
    ['。', '.']
  ]],
  ['工作台·收存位置', [
    ['01 · 收存位置', '01 · LOCATIONS'],
    ['这次从哪里收，存到哪里', 'Choose what to collect and where to store it'],
    ['01 / 归档位置', '01 / LOCATIONS'],
    ['先确认这次从哪里收、存到哪里', 'Choose what to collect and where to store it'],
    ['需要备份的文件主目录', 'Source directory to back up'],
    ['最终压缩包存放点', 'Archive output directory'],
    ['批量备份文件时，为主目录下的每一个文件夹或视频，单独压缩进行备份，跳过其他文件', 'When backing up in bulk, each folder or video directly under the source directory is archived separately; other files are skipped'],
    ['推荐勾选，便于识别哪些文件被备份了', 'Recommended so backed-up sources are easy to identify']
  ]],
  ['工作台·归档后处理', [
    ['归档后处理', 'After archiving'],
    ['保留原文件 · 不记录备份位置', 'Keep source files · no backup location recorded'],
    ['保留原文件', 'Keep source files'],
    ['完成后保留原文件', 'Keep source files after completion'],
    ['归档完成后移入回收站', 'Move source to the Recycle Bin after archiving'],
    ['归档后保留原文件', 'Keep original files after archiving'],
    ['归档后不移动原文件', 'Do not move original files after archiving'],
    ['归档后移动原文件', 'Move original files after archiving'],
    ['归档后将原文件移至回收站', 'Move original files to the Recycle Bin after archiving'],
    ['归档后移入回收站', 'Move to the Recycle Bin after archiving'],
    ['归档完成后移到指定位置', 'Move source to the selected location after archiving'],
    ['完成后移动原文件', 'Move source after completion'],
    ['完成后移入回收站', 'Move source to the Recycle Bin after completion'],
    ['完成后移动到指定位置', 'Move to the selected location after completion'],
    ['仅在压缩、验证、入库全部成功后移动；失败时保留源文件', 'Move only after compression, verification and cataloging succeed; failures keep the source'],
    ['归档后移动位置', 'Move-after-archiving location'],
    ['完成后移入 Windows 回收站', 'Move to the Windows Recycle Bin after completion'],
    ['可从回收站恢复；仅在压缩、验证、入库和缩略图全部成功后执行，异常时安全停止', 'Recoverable from the Recycle Bin; runs only after compression, verification, cataloging and thumbnails all succeed, with a safety stop on anomalies'],
    ['记录备份位置', 'Record backup location'],
    ['把云盘、移动硬盘或其他备份去向写入仓库词条', 'Write the cloud drive, removable disk or other backup destination into a warehouse entry'],
    ['填写云盘、移动硬盘或其他备份去向', 'Enter a cloud drive, removable disk or other backup destination'],
    ['不记录备份位置', 'Do not record backup location'],
    ['归档完成后，把对应文件夹或视频移入指定位置', 'Move each archived folder or video to the selected location'],
    ['只在压缩、完整性验证与入库全部成功后移动；目标重名或移动校验失败时会保留源文件', 'Move only after compression, verification and cataloging succeed; collisions or failed checks keep the source.'],
    ['归档完成后，把对应原文件夹或视频移入 Windows 回收站', 'Move each archived source folder or video to the Windows Recycle Bin'],
    ['仅在压缩、完整性验证、入库记录和缩略图全部完成后执行；可从回收站恢复', 'Only after compression, verification, cataloging and thumbnails finish; recoverable from the Recycle Bin.'],
    ['仅在压缩、完整性验证、入库记录和缩略图全部完成后执行；可从回收站恢复，异常时会安全停止', 'Only after compression, verification, cataloging and thumbnails finish; recoverable from the Recycle Bin, with a safety stop on anomalies.'],
    ['启用后，每个任务只有在验证并入库成功后，才会把对应源文件夹或视频移入 Windows 回收站。是否启用？', 'When enabled, each source folder or video is moved to the Windows Recycle Bin only after verification and cataloging succeed. Enable it?']
  ]],
  ['工作台·高级压缩设置', [
    ['高级压缩设置', 'Advanced compression'],
    ['7z · 等级 1 · 时间戳命名 · 分卷 10 GB · 无密码', '7z · level 1 · timestamp naming · 10 GB volumes · no password'],
    ['压缩格式', 'Archive format'],
    ['7z（默认）', '7z (default)'],
    ['ZIP', 'ZIP'],
    ['格式', 'format'],
    ['压缩率', 'Compression level'],
    ['0 · 不压缩', '0 · Store only'],
    ['1 · 快速（默认）', '1 · Fast (default)'],
    ['3 · 标准', '3 · Standard'],
    ['5 · 较高', '5 · Higher'],
    ['7 · 高', '7 · High'],
    ['9 · 极限', '9 · Maximum'],
    ['等级', 'level'],
    ['压缩包命名方式', 'Archive naming'],
    ['时间戳 + 随机数（默认）', 'Timestamp + random suffix (default)'],
    ['原文件名 + 8 位随机数（过长时截断）', 'Original name + 8-digit random suffix (truncate if needed)'],
    ['自定义名 + 8 位随机数', 'Custom name + 8-digit random suffix'],
    ['时间戳命名', 'Timestamp naming'],
    ['原文件名命名', 'Original-name naming'],
    ['自定义命名', 'Custom naming'],
    ['自定义名称', 'Custom name'],
    ['原文件名', 'Original file name'],
    ['填写符合 Windows 文件命名规范的自定义名', 'Enter a Windows-compatible custom name'],
    ['分卷压缩', 'Split into volumes'],
    ['超过单卷上限时自动拆分；默认 10 GiB，与旧版行为一致。', 'Split automatically above the per-volume limit; the 10 GiB default matches previous behavior.'],
    ['单卷大小', 'Volume size'],
    ['分卷大小单位', 'Volume size unit'],
    ['不主动分卷', 'No optional splitting'],
    ['已关闭主动分卷；超过 10 GiB 时仍执行安全分卷。', 'Optional splitting is off; tasks over 10 GiB still use safety volumes.'],
    ['安全上限保持为 10 GiB：即使关闭主动分卷，超过 10 GiB 的任务仍须确认并按 10 GiB 分卷。分卷发布、校验、删除与回滚始终按整组处理。', 'The 10 GiB safety limit remains: even with optional splitting off, larger tasks require confirmation and 10 GiB volumes. Publishing, verification, deletion and rollback always handle the complete volume set.'],
    ['解压密码', 'Archive password'],
    ['留空则不设置密码', 'Leave empty for no password'],
    ['留空表示无密码', 'Leave empty for no password'],
    ['记录解压密码', 'Record archive password'],
    ['把任务实际使用的密码作为专属词条写入仓库；不勾选时只记录“已加密”。', 'Store the password used by each task as a private warehouse entry; otherwise only record “encrypted”.'],
    ['已设置密码', 'Password set'],
    ['无密码', 'No password'],
    ['已加密', 'Encrypted'],
    ['未加密', 'Not encrypted']
  ]],
  ['工作台·入库与预览', [
    ['入库与预览', 'Catalog & previews'],
    ['视频抽帧 3 帧/视频 · 缩略图上限 30 张 · 过滤 <100 MB', '3 video frames/video · thumbnail limit 30 · filter <100 MB'],
    ['视频帧备份', 'Video frame backup'],
    ['按总时长平均抽取画面，并在仓库中按视频成组显示', 'Extract evenly spaced frames and group them by video in the warehouse'],
    ['帧/视频', 'frames/video'],
    ['每个视频保存的帧数', 'Frames saved per video'],
    ['小项目过滤', 'Small-item filter'],
    ['扫描和拖入时跳过低于阈值的视频或文件夹', 'Skip videos and folders below the threshold while scanning or dropping'],
    ['最小项目大小', 'Minimum item size'],
    ['不抽取视频帧', 'Do not extract video frames'],
    ['不过滤小项目', 'Do not filter small items'],
    ['单个项目缩略图上限', 'Per-project thumbnail limit'],
    ['包括图片缩略图与视频抽帧，避免超大项目生成过多预览。', 'Includes image thumbnails and video frames to prevent excessive previews.'],
    ['张', 'images']
  ]],
  ['工作台·更多设置', [
    ['更多设置', 'More settings'],
    ['定时运行关闭 · 数据与维护工具', 'Scheduled run off · data & maintenance tools'],
    ['定时运行关闭', 'Scheduled run off'],
    ['定时运行', 'Scheduled run'],
    ['时间不足时不再启动下一项；到结束时间会安全暂停', 'No new task starts when time is short; the queue pauses safely at the end time'],
    ['定时开始时间', 'Scheduled start time'],
    ['定时结束时间', 'Scheduled end time'],
    ['相似度排除词表', 'Similarity ignore list'],
    ['相似判断的“白名单”。每行一个词；不影响仓库搜索、MD5 或文件大小重复检查。', 'A whitelist for similarity checks. One term per line; it does not affect search, MD5 or size checks.'],
    ['打开词表', 'Open list'],
    ['重新载入', 'Reload'],
    ['用户数据区', 'User data area'],
    ['集中保存设置、仓库数据库、缩略图、暂存文件和当前用户的一份运行日志', 'Stores settings, the warehouse database, thumbnails, staging files and the current user log'],
    ['切换时保留旧目录', 'The old directory is retained when switching'],
    ['压缩暂存目录', 'Archive staging directory'],
    ['默认在打包存放点同目录下新建一个 staging 文件夹，目录不存在时自动创建', 'A staging folder is created beside the output directory when needed'],
    ['默认在打包存放点同目录下新建 staging 文件夹，也可选择其他安全位置', 'Creates a staging folder beside the output directory by default; another safe location can be selected'],
    ['数据与维护工具', 'Data & maintenance tools'],
    ['高级设置', 'Advanced settings'],
    ['保存设置', 'Save settings']
  ]],
  ['队列·工具栏与汇总', [
    ['02 · 扫描与队列', '02 · SCAN & QUEUE'],
    ['02 / 扫描与队列', '02 / SCAN & QUEUE'],
    ['先预览，再开始归档', 'Preview first, then archive'],
    ['添加单个文件夹', 'Add folder'],
    ['添加单个视频', 'Add video'],
    ['扫描主目录', 'Scan source directory'],
    ['开始压缩入库', 'Start archiving'],
    ['不压缩直接入库', 'Add without compression'],
    ['拖拽或粘贴文件夹、视频，快速加入队列', 'Drop or paste a folder or video to add it to the queue'],
    ['任务', 'Tasks'],
    ['等待确认', 'Awaiting confirmation'],
    ['等待压缩', 'Queued'],
    ['已完成', 'Completed'],
    ['原始总量', 'Original size'],
    ['查看相似项目', 'View similar projects'],
    ['确认并按 10G 分卷', 'Confirm and split at 10 GiB'],
    ['确认重复风险', 'Confirm duplicate risk'],
    ['确认重复并继续', 'Confirm duplicate and continue'],
    ['核验后确认入库', 'Verify and add to warehouse'],
    ['删除异常成品', 'Delete abnormal output'],
    ['确认安全警告', 'Acknowledge safety warning'],
    ['未选择任务（按住 Ctrl 可多选）', 'No tasks selected (hold Ctrl to multi-select)'],
    ['多选可进行批量操作', 'Select multiple items for batch actions'],
    ['选中内容后出现批量操作', 'Batch actions appear after selecting items'],
    ['未选择任务', 'No tasks selected'],
    ['移除所选', 'Remove selected'],
    ['重复项处理', 'Duplicate handling'],
    ['清除可能重复', 'Clear possible duplicates'],
    ['清除精确重复', 'Clear exact duplicates'],
    ['同意全部重复', 'Confirm all duplicates'],
    ['清理队列', 'Clean queue'],
    ['清空已完成队列', 'Clear completed tasks'],
    ['清空已取消队列', 'Clear cancelled tasks'],
    ['一键清空队列', 'Clear queue'],
    ['一键清空队列…', 'Clear queue…'],
    ['选择全部任务', 'Select all tasks'],
    ['完成这一项暂停', 'Finish this item, then pause'],
    ['完成本项后暂停', 'Finish this item, then pause'],
    ['暂停', 'Pause'],
    ['暂停当前任务', 'Pause current task'],
    ['继续当前任务', 'Resume current task'],
    ['还没有任务。选择一个实际主目录后开始扫描。', 'No tasks yet. Choose a real source directory and scan it.'],
    ['折叠任务列表', 'Collapse task list'],
    ['展开任务列表', 'Expand task list'],
    ['大小', 'Size'],
    ['状态', 'Status'],
    ['进度', 'Progress'],
    ['操作', 'Actions'],
    ['文件', 'Files'],
    ['名称', 'Name'],
    ['类型', 'Type'],
    ['手动', 'Manual'],
    ['视频', 'Video'],
    ['文件夹', 'Folder'],
    ['大小 / 状态', 'Size / status']
  ]],
  ['队列·状态标签', [
    ['生成清单与 MD5', 'Building manifest and MD5'],
    ['压缩中', 'Compressing'],
    ['完整性验证', 'Integrity verification'],
    ['移入库目录', 'Moving to warehouse'],
    ['归档完成/源文件处理失败', 'Archived / source handling failed'],
    ['失败', 'Failed'],
    ['已取消', 'Cancelled'],
    ['重复待确认', 'Duplicate awaiting confirmation'],
    ['大小异常待核验', 'Abnormal size awaiting review'],
    ['回收站安全警告', 'Recycle Bin safety warning']
  ]],
  ['运行记录', [
    ['03 · 运行记录', '03 · ACTIVITY LOG'],
    ['03 / 运行记录', '03 / ACTIVITY LOG'],
    ['发生了什么', 'What happened'],
    ['空闲', 'Idle'],
    ['暂无日志', 'No logs yet'],
    ['当前任务已暂停', 'Current task paused'],
    ['队列运行中', 'Queue running'],
    ['等待定时时段', 'Waiting for scheduled time'],
    ['安全停止：等待确认', 'Safety stop: awaiting confirmation'],
    ['不到 1 分钟', 'Less than 1 minute'],
    ['开始调用 7-Zip；密码参数已隐藏。', 'Starting 7-Zip; the password argument is hidden.'],
    ['开始调用 7-Zip；本任务未设置密码。', 'Starting 7-Zip; this task has no password.'],
    ['开始全局重算仓库相似关系…', 'Starting a full rebuild of warehouse similarity relations…'],
    ['已按当前设置完成全局重算。', 'The full similarity rebuild finished with the current settings.'],
    ['用户已核对压缩体积异常，并确认入库。', 'The abnormal archive size was reviewed and approved for cataloging.'],
    ['用户删除了大小异常成品；源项目未移动、未删除。', 'The abnormal output was deleted; the source item was not moved or deleted.'],
    ['用户已确认回收站安全警告；队列仍保持停止，后续任务需手动重新开始。', 'The Recycle Bin safety warning was acknowledged. The queue remains stopped and must be restarted manually.'],
    ['运行中的任务已安全取消。', 'The running task was cancelled safely.']
  ]],
  ['仓库·概览', [
    ['仓库活跃度 / ACTIVITY', 'WAREHOUSE ACTIVITY'],
    ['仓库概览', 'Warehouse overview'],
    ['本周入库', 'Added this week'],
    ['导出仓库', 'Export warehouse'],
    ['并入外部仓库', 'Import external warehouse'],
    ['随机漫步 · 换一个', 'Random walk · Another'],
    ['随机漫步', 'Random walk'],
    ['随机漫步 · 随机一项库存', 'Random walk · a random inventory item'],
    ['库存', 'Inventory'],
    ['标签', 'Tags'],
    ['最近 16 周', 'Last 16 weeks'],
    ['按入库日期与容量显示活跃度', 'Activity by inventory date and size'],
    ['最近十六周入库活跃度', 'Inventory activity over the last sixteen weeks'],
    ['少', 'Less'],
    ['多', 'More'],
    ['正在从仓库中挑选一项随机内容…', 'Choosing a random warehouse item…'],
    ['仓库还是空的，添加库存后这里会自动出现推荐。', 'The warehouse is empty. Add inventory to see recommendations here.'],
    ['仓库中暂时没有可以推荐的内容。', 'There is no warehouse item to recommend yet.'],
    ['没有找到符合这次回顾条件的库存。', 'No inventory matched this review.'],
    ['从全部库存中为你随机抽取了一项。', 'A random item was selected from the entire inventory.']
  ]],
  ['仓库·工具栏与批量操作', [
    ['浏览、分类并整理已入库内容', 'Browse, classify and organize archived content'],
    ['模糊搜索标题、标签、备份位置、路径…', 'Fuzzy-search titles, tags, backup locations and paths…'],
    ['仓库筛选与视图工具', 'Warehouse filter and view tools'],
    ['按标签筛选', 'Filter by tag'],
    ['全部标签', 'All tags'],
    ['按备份位置筛选', 'Filter by backup location'],
    ['全部备份位置', 'All backup locations'],
    ['按星级筛选', 'Filter by rating'],
    ['全部星级', 'All ratings'],
    ['未评分', 'Unrated'],
    ['仓库排序', 'Warehouse sort'],
    ['入库时间：新到旧', 'Inventory date: newest first'],
    ['入库时间：旧到新', 'Inventory date: oldest first'],
    ['文件名：正序', 'File name: A–Z'],
    ['文件名：倒序', 'File name: Z–A'],
    ['仓库视图', 'Warehouse view'],
    ['文本列表', 'Text list'],
    ['大缩略图', 'Large thumbnails'],
    ['列表', 'List'],
    ['仓库工具', 'Warehouse tools'],
    ['刷新仓库', 'Refresh warehouse'],
    ['设置仓库位置', 'Set warehouse location'],
    ['在文件浏览器中查看仓库', 'Open warehouse in File Explorer'],
    ['当前仓库位置', 'Current warehouse location'],
    ['仓库内容', 'Warehouse content'],
    ['选择当前页', 'Select current page'],
    ['选择当前结果', 'Select current results'],
    ['未选择仓库内容', 'No warehouse items selected'],
    ['批量追加标签', 'Add tags in bulk'],
    ['批量修改备份位置', 'Change backup location in bulk'],
    ['删除所选', 'Delete selected'],
    ['手动新增库存', 'Add inventory manually'],
    ['上一页', 'Previous'],
    ['下一页', 'Next'],
    ['仓库分页', 'Warehouse pagination'],
    ['选择仓库页码', 'Choose warehouse page'],
    ['放大的仓库缩略图', 'Enlarged warehouse thumbnail'],
    ['仓库中暂无归档记录', 'No archive records in the warehouse'],
    ['没有符合当前条件的仓库内容', 'No warehouse content matches the current filters'],
    ['仓库', 'Warehouse']
  ]],
  ['仓库·列表与卡片', [
    ['入库时间', 'Inventory date'],
    ['星级', 'Rating'],
    ['未命名归档', 'Untitled archive'],
    ['未命名文件', 'Untitled file'],
    ['无预览', 'No preview'],
    ['暂无标签', 'No tags'],
    ['暂无封面', 'No cover'],
    ['手动库存', 'Manual inventory'],
    ['仅记录', 'Record only'],
    ['未压缩', 'Uncompressed'],
    ['未压缩入库', 'Uncompressed intake'],
    ['可能重复', 'Possible duplicate'],
    ['高度匹配', 'High match'],
    ['相似标题', 'Similar title'],
    ['手动库存条目', 'Manual inventory item']
  ]],
  ['仓库·详情与整理信息', [
    ['选择一条仓库记录', 'Select a warehouse record'],
    ['这里会显示整理信息、完整目录、文件名、MD5、分卷信息和可用缩略图。', 'Organization details, the full tree, file names, MD5 values, volumes and thumbnails appear here.'],
    ['整理信息', 'Organization details'],
    ['标题', 'Title'],
    ['例如：摄影，旅行，待整理（用逗号分隔）', 'e.g. photography, travel, to review (comma-separated)'],
    ['例如：百度网盘 / 家庭备份盘 A', 'e.g. Baidu Drive / Home backup disk A'],
    ['例如：百度网盘 / 移动硬盘 A', 'e.g. Baidu Drive / Removable disk A'],
    ['例如：旅行, 摄影', 'e.g. travel, photography'],
    ['例如：旅行, 摄影, 待复查', 'e.g. travel, photography, to review'],
    ['备份位置', 'Backup location'],
    ['备注', 'Notes'],
    ['记录来源、内容特点、后续处理计划等，支持直接粘贴图片', 'Record the source, content and next steps; images can be pasted directly'],
    ['说明这项库存是什么、在哪里，或之后准备如何处理…', 'Describe what this inventory item is, where it lives, or how you plan to process it…'],
    ['保存整理信息', 'Save organization details'],
    ['完成管理', 'Done managing'],
    ['管理', 'Manage'],
    ['相似项目', 'Similar projects'],
    ['可能重复 · 相似项目', 'Possible duplicates · similar projects'],
    ['定位相似文件', 'Locate similar files'],
    ['重新计算', 'Recalculate'],
    ['当前没有已关联的相似项目。', 'No similar projects are linked.'],
    ['压缩包名称已复制', 'Archive name copied'],
    ['解压密码已复制', 'Archive password copied'],
    ['压缩包：未生成（未压缩）', 'Archive: not created (uncompressed)'],
    ['压缩包已加密，但密码未记录', 'Archive is encrypted, but its password was not recorded'],
    ['压缩后 未压缩', 'After compression: uncompressed'],
    ['未发现原文件', 'Original file not found'],
    ['已执行移入回收站，但回收站中未找到该文件——回收站可能已满，文件或已被永久删除', 'The item was sent to the Recycle Bin, but could not be found there; it may be full and the item may have been permanently deleted'],
    ['源文件已进入回收站', 'Source file moved to the Recycle Bin'],
    ['源文件已移动', 'Source file moved'],
    ['原文件位置：', 'Original location: '],
    ['原文件位置', 'Original file location'],
    ['文件位置', 'File location'],
    ['任务位置', 'Task location'],
    ['复原后的原文件位置', 'Restored original file location'],
    ['打开原文件当前位置', 'Open original file location'],
    ['从回收站复原到原位置', 'Restore from Recycle Bin to original location'],
    ['原文件在 Windows 回收站中。要将文件从回收站移出到原位置吗？', 'The original file is in the Windows Recycle Bin. Move it back to its original location?'],
    ['该原文件在 Windows 回收站中。要将文件从回收站移出到原位置吗？', 'The original file is in the Windows Recycle Bin. Move it back to its original location?'],
    ['原文件已复原，并已打开原位置', 'Original file restored and original location opened'],
    ['已打开原文件当前位置', 'Original file location opened'],
    ['删除图片', 'Delete image'],
    ['设为项目封面', 'Set as project cover'],
    ['当前项目封面', 'Current project cover'],
    ['媒体预览', 'Media preview'],
    ['日期未知', 'Date unknown'],
    ['完整目录结构', 'Complete directory tree'],
    ['这个归档中没有文件。', 'This archive contains no files.'],
    ['无 MD5', 'No MD5'],
    ['手动库存记录 · 未关联压缩包或文件清单', 'Manual inventory · no archive or manifest attached'],
    ['这是手动库存记录', 'This is a manual inventory record'],
    ['它只保存名称、备注及整理信息，不代表程序已经生成或验证过压缩包。', 'It stores only the name, notes and organization details; it does not mean that an archive was generated or verified.'],
    ['删除这张图片？', 'Delete this image?']
  ]],
  ['手动库存与批量整理对话框', [
    ['手动添加图片', 'Add images manually'],
    ['添加图片', 'Add images'],
    ['选择项目图片', 'Choose project images'],
    ['＋ 选择项目图片', '＋ Choose project images'],
    ['也可以在这里按 Ctrl+V 粘贴图片', 'You can also press Ctrl+V here to paste images'],
    ['移除这张图片', 'Remove this image'],
    ['手动库存 / MANUAL', 'MANUAL INVENTORY'],
    ['新增一条库存内容', 'Add an inventory item'],
    ['适合记录暂时没有压缩包或文件清单的内容。只有名称和备注必填，也可以直接补充位置、标签与图片。', 'For content without an archive or manifest yet. Only the name and notes are required; locations, tags and images are optional.'],
    ['名称（必填）', 'Name (required)'],
    ['备注（必填）', 'Notes (required)'],
    ['标签（选填，逗号分隔）', 'Tags (optional, comma-separated)'],
    ['原始位置（选填，可填写网址）', 'Original location (optional, URL allowed)'],
    ['备份位置（选填）', 'Backup location (optional)'],
    ['图片（选填，可多选）', 'Images (optional, multiple allowed)'],
    ['文件路径或 https://…', 'File path or https://…'],
    ['添加到仓库', 'Add to warehouse'],
    ['批量整理', 'Bulk organization'],
    ['追加标签', 'Add tags'],
    ['修改备份位置', 'Change backup location'],
    ['用逗号分隔。标签须以文字或数字开头，可使用文字、数字、空格、短横线、下划线和间隔号；单个最多 30 字。', 'Separate tags with commas. Tags must start with a letter or number and may contain letters, numbers, spaces, hyphens, underscores and middle dots; each tag may contain up to 30 characters.']
  ]],
  ['风险确认与删除对话框', [
    ['未压缩入库 / CAUTION', 'UNCOMPRESSED INTAKE / CAUTION'],
    ['确认不压缩直接入库', 'Confirm uncompressed intake'],
    ['本次入库将不会执行压缩，可能导致用户备份时出现遗漏，请确认风险。', 'This intake will not create an archive and may be missed during backup. Please acknowledge the risk.'],
    ['不再提示', 'Do not show again'],
    ['确认并直接入库', 'Confirm and add'],
    ['把未压缩项目送入队列', 'Queue uncompressed items'],
    ['库内项目压缩 / CAUTION', 'WAREHOUSE ITEM COMPRESSION / CAUTION'],
    ['本功能仅用于给库内“未压缩项目”压缩备份使用。', 'This feature is only for compressing warehouse items marked as uncompressed.'],
    ['确认并送入队列', 'Confirm and queue'],
    ['压缩入库', 'Compress and archive'],
    ['删除仓库项目', 'Delete warehouse items'],
    ['确认删除所选内容', 'Confirm deletion of selected items'],
    ['只有必要操作全部成功后，对应仓库记录才会删除。', 'Warehouse records are removed only after every required step succeeds.'],
    ['尝试将原文件位置复原', 'Try to restore original locations'],
    ['仅处理仍在回收站或归档后移动位置中的原文件；复原失败时会保留对应仓库记录和压缩包。', 'Only sources still in the Recycle Bin or post-archive location are handled; failed restoration keeps the warehouse record and archives.'],
    ['所选项目没有可以尝试复原的原文件记录。', 'The selected items have no original locations that can be restored.']
  ]],
  ['使用说明对话框', [
    ['使用说明', 'Instructions'],
    ['使用说明 / QUICK START', 'QUICK START'],
    ['把资源变成可检索的安全归档', 'Turn resources into safe, searchable archives'],
    ['选择资源主目录', 'Choose a source directory'],
    ['应用会把其中每个大文件夹与视频分别压缩，生成规整的压缩包，并把内容记录到仓库。', 'Each large folder and video is archived separately and recorded in the warehouse.'],
    ['手动云备份压缩包', 'Back up archives to your cloud drive'],
    ['本工具只负责本地记录，您可以将压缩包存放点设置为云盘自动同步的目录，或自行上传压缩包。', 'This tool keeps local records. Set the output directory to a cloud-synced folder or upload the archives yourself.'],
    ['按需处理单个资源', 'Process one resource when needed'],
    ['也可以把单个文件夹或视频直接拖入应用，单独加入任务列表。', 'Drop a single folder or video into the app to add it as an individual task.'],
    ['本应用会跳过主目录中的零散图片和其他文件。如需处理，请先把它们收纳到文件夹中。', 'Loose images and other files directly under the source directory are skipped. Put them in a folder if they need processing.']
  ]],
  ['安全熔断对话框', [
    ['安全熔断 / SAFETY HALT', 'SAFETY HALT'],
    ['队列已立即停止', 'Queue stopped immediately'],
    ['自动移入回收站已经关闭', 'Automatic Recycle Bin moves are disabled'],
    ['后续任务尚未启动。请先检查 Windows 回收站和原文件位置，再决定是否重新开始队列。', 'Later tasks have not started. Check the Windows Recycle Bin and source location before restarting the queue.'],
    ['我已了解，保持队列停止', 'I understand; keep the queue stopped'],
    ['安全警告已确认；队列保持停止，自动移入回收站已关闭', 'Safety warning acknowledged; queue remains stopped and automatic Recycle Bin moves are disabled']
  ]],
  ['渲染层·提示与确认', [
    ['设置已保存', 'Settings saved'],
    ['正在扫描下一级目录，请稍候…', 'Scanning the next directory level, please wait…'],
    ['正在读取完整目录和缩略图…', 'Reading the complete directory and thumbnails…'],
    ['仓库整理信息已保存', 'Warehouse details saved'],
    ['仓库已刷新', 'Warehouse refreshed'],
    ['仓库已复制并切换；原位置仍保留', 'Warehouse copied and switched; the original remains'],
    ['任务名称已复制', 'Task name copied'],
    ['已打开任务所在位置', 'Task location opened'],
    ['已打开用户数据区', 'User data area opened'],
    ['相似关系已重新计算', 'Similarity recalculated'],
    ['已双向移除相似关系', 'Similarity removed in both directions'],
    ['项目封面已更新', 'Project cover updated'],
    ['图片已删除，可在“撤回”中恢复', 'Image deleted; undo to restore it'],
    ['确定删除这张图片？删除后可以通过仓库顶部的“撤回”恢复。', 'Delete this image? You can restore it with Undo at the top of the warehouse.'],
    ['已撤回最近一次仓库操作', 'The most recent warehouse action was undone'],
    ['缩略图读取失败', 'Could not read thumbnail'],
    ['手动库存已添加', 'Manual inventory added'],
    ['单个项目最多添加 100 张图片。', 'A project can contain at most 100 images.'],
    ['没有等待确认的重复任务', 'No duplicate tasks are awaiting confirmation'],
    ['没有发现可清除的重复任务', 'No duplicate tasks to clear'],
    ['没有发现可清除的精确重复任务', 'No exact duplicate tasks to clear'],
    ['目录结构中没有可定位的相似文件或文件夹', 'No similar files or folders to locate in the directory tree'],
    ['所选仓库内容已删除。', 'The selected warehouse content was deleted.'],
    ['当前已是最新版本', 'You are using the latest version'],
    ['正在检查…', 'Checking…'],
    ['正在读取更新包…', 'Reading update package…'],
    ['更新包已校验', 'Update package verified'],
    ['更新包已校验，等待重新启动', 'Update package verified; restart is pending'],
    ['正在校验更新…', 'Verifying update…'],
    ['正在下载更新…', 'Downloading update…'],
    ['自动更新未能启动，程序仍停留在当前版本', 'Automatic update could not start. The current version is still running.'],
    ['完整性测试已经通过，但压缩前后体积比例超出安全阈值。请先人工核对日志和源项目；确认仍要入库吗？', 'Integrity testing passed, but the archive size ratio is outside the safety threshold. Check the log and source first; add it to the warehouse anyway?'],
    ['删除这次异常任务生成的压缩文件和缩略图？源文件会完整保留在原位置，且不会加入仓库。', 'Delete the archives and thumbnails created by this abnormal task? The source will remain intact and will not be added to the warehouse.'],
    ['从任务列表清除所有“名称可能重复”或“内容精确重复”的项目？已入库档案和源文件不会删除。', 'Clear all tasks marked as name- or content-duplicates? Archived files and source files will not be deleted.'],
    ['从任务列表清除所有名称或标题可能重复的项目？已入库档案和源文件不会删除。', 'Clear all tasks whose names or titles may be duplicated? Archived files and source files will not be deleted.'],
    ['从任务列表清除所有已确认存在内容完全相同文件的项目？已入库档案和源文件不会删除。', 'Clear all tasks confirmed to contain identical files? Archived files and source files will not be deleted.'],
    ['清空整个任务列表？如果当前正在运行，会停止当前任务并阻止后续任务启动。已入库档案和源文件不会删除。', 'Clear the entire task list? A running task is stopped and later tasks are prevented from starting. Archived files and source files will not be deleted.'],
    ['同意任务列表中全部名称重复、标题相似或视频大小相同的风险，并让它们进入等待压缩状态？', 'Accept all name-duplicate, title-similar or same-size video risks and move them to the compression queue?'],
    ['选择外部仓库压缩包（.zip）后，会把其中的仓库记录、缩略图和解压密码记录一并并入当前仓库。相同 ID 的记录会跳过；外部压缩包实体不会被移动或删除。是否继续？', 'After choosing an external warehouse ZIP, its records, thumbnails and archive passwords will be merged into this warehouse. Duplicate IDs are skipped; the external archive is not moved or deleted. Continue?']
  ]],
  ['主进程·IPC 与文件对话框错误', [
    ['已拒绝非本地界面的请求。', 'Request from a non-local page was rejected.'],
    ['仓库记录标识无效。', 'Invalid warehouse record id.'],
    ['请选择 PNG、JPEG、WebP 或 GIF 图片。', 'Choose a PNG, JPEG, WebP or GIF image.'],
    ['单张图片不能超过约 25 MB。', 'A single image cannot exceed about 25 MB.'],
    ['图片内容无效或无法读取。', 'The image content is invalid or unreadable.'],
    ['归档任务运行期间不能更新，请先暂停或完成当前任务。', 'Cannot update while archiving tasks are running. Pause or finish the current tasks first.'],
    ['队列运行期间不能修改用户数据区。', 'Cannot change the user data area while the queue is running.'],
    ['只允许打开 HTTP 或 HTTPS 链接。', 'Only HTTP or HTTPS links can be opened.'],
    ['复制内容过长。', 'The content to copy is too long.'],
    ['这个任务没有可打开的原文件位置。', 'This task has no original file location to open.'],
    ['没有找到指定仓库记录。', 'The specified warehouse record was not found.'],
    ['没有记录原文件位置，无法从回收站复原。', 'No original location was recorded, so it cannot be restored from the Recycle Bin.'],
    ['没有记录可打开的原文件当前位置。', 'No current original file location to open was recorded.']
  ]],
  ['主进程·队列与核心模块（校验与错误）', [
    ['每条归档最多设置 30 个标签。', 'Each archive can have at most 30 tags.'],
    ['单个标签不能超过 30 个字符。', 'A single tag cannot exceed 30 characters.'],
    ['标签只能使用文字、数字、空格、短横线、下划线或间隔号，并且必须以文字或数字开头。', 'Tags may only contain letters, numbers, spaces, hyphens, underscores or middle dots, and must start with a letter or number.'],
    ['标题不能为空。', 'The title cannot be empty.'],
    ['标题不能超过 200 个字符。', 'The title cannot exceed 200 characters.'],
    ['星级必须是 0 到 5 的整数。', 'The rating must be an integer from 0 to 5.'],
    ['备注不能超过 5000 个字符。', 'Notes cannot exceed 5000 characters.'],
    ['手动库存的备注不能为空。', 'Manual inventory notes cannot be empty.'],
    ['备份位置不能超过 200 个字符。', 'The backup location cannot exceed 200 characters.'],
    ['解压密码最多 128 个字符，且不能包含换行或控制字符。', 'The archive password is limited to 128 characters and cannot contain line breaks or control characters.'],
    ['名称不能为空。', 'The name cannot be empty.'],
    ['备注不能为空。', 'Notes cannot be empty.'],
    ['名称不能超过 200 个字符。', 'The name cannot exceed 200 characters.'],
    ['原始位置不能超过 2000 个字符，也不能包含换行或控制字符。', 'The original location cannot exceed 2000 characters and cannot contain line breaks or control characters.'],
    ['备份位置不能超过 200 个字符，也不能包含换行或控制字符。', 'The backup location cannot exceed 200 characters and cannot contain line breaks or control characters.'],
    ['删除目标不在允许的仓库子目录内。', 'The deletion target is outside the allowed warehouse subdirectories.'],
    ['缩略图引用无效或不属于当前仓库。', 'The thumbnail reference is invalid or does not belong to the current warehouse.'],
    ['Windows 回收站服务不可用。', 'The Windows Recycle Bin service is unavailable.'],
    ['系统回收站服务不可用。', 'The system Recycle Bin service is unavailable.'],
    ['归档记录缺少压缩包目录，已拒绝删除。', 'The archive record has no archive directory; deletion was refused.'],
    ['归档文件', 'Archive files'],
    ['缩略图目录', 'Thumbnails directory'],
    ['暂存磁盘', 'Staging disk'],
    ['成品磁盘', 'Output disk'],
    ['压缩暂存目录未配置，无法安全删除多卷压缩包。', 'The staging directory is not configured, so multi-volume archives cannot be deleted safely.'],
    ['压缩暂存目录与成品不在同一磁盘，无法保证多卷压缩包原子删除。', 'The staging directory is on a different disk from the output, so multi-volume archives cannot be deleted atomically.'],
    ['相似度排除词表位置未配置。', 'The similarity ignore list location is not configured.'],
    ['仓库撤销记录已达到上限 10 条；最早的一条记录已被移出。', 'Warehouse undo history reached its limit of 10; the oldest entry was removed.'],
    ['没有可以撤回的仓库操作。', 'There is no warehouse action to undo.'],
    ['原始仓库记录不存在，无法撤回。', 'The original warehouse record no longer exists, so it cannot be undone.'],
    ['不能移除项目与自身的关系。', 'A project cannot be linked to itself.'],
    ['相似项目不存在，请刷新后重试。', 'The similar project no longer exists; refresh and try again.'],
    ['没有找到指定归档记录。', 'The specified archive record was not found.'],
    ['这张缩略图不存在，不能设为封面。', 'This thumbnail does not exist and cannot be set as the cover.'],
    ['这张图片不存在或已被删除。', 'This image does not exist or was already deleted.'],
    ['当前程序无法保存所选图片。', 'This program cannot save the selected image.'],
    ['单个项目最多手动添加 100 张图片。', 'A project can hold at most 100 manually added images.'],
    ['请先选择仓库内容。', 'Select warehouse content first.'],
    ['请输入要追加的标签。', 'Enter the tags to add.'],
    ['请先选择要删除的仓库内容。', 'Select the warehouse content to delete first.'],
    ['部分仓库记录不存在，请刷新后重试。', 'Some warehouse records no longer exist; refresh and try again.'],
    ['备份位置不能为空。', 'The backup location cannot be empty.'],
    ['当前系统不支持自动从回收站复原。', 'This system does not support automatic restoration from the Recycle Bin.'],
    ['没有在 Windows 回收站中找到对应原文件，或系统未能完成复原。', 'The original file was not found in the Windows Recycle Bin, or the system could not finish restoring it.'],
    ['记录的移动目标中已找不到原文件。', 'The original file is no longer in the recorded move destination.'],
    ['跨磁盘复原校验失败，文件数量或大小不一致。', 'Cross-disk restoration check failed: file count or size mismatch.'],
    ['跨磁盘复原校验失败，文件大小不一致。', 'Cross-disk restoration check failed: file size mismatch.'],
    ['当前原文件不在可复原状态。', 'The original file is not in a restorable state.'],
    ['未知条目', 'Unknown entry'],
    ['仓库记录不存在。', 'The warehouse record does not exist.'],
    ['队列运行期间不能修改路径。', 'Paths cannot be changed while the queue is running.'],
    ['勾选“记录备份位置”后，请填写备份位置。', 'Fill in the backup location after enabling “Record backup location”.'],
    ['解压密码最多 128 个字符，且不能包含换行或控制字符。留空表示不设置密码。', 'The archive password is limited to 128 characters without line breaks or control characters. Leave it empty for no password.'],
    ['每个视频的缩略帧数必须是 1—20 的整数。', 'Frames per video must be an integer between 1 and 20.'],
    ['单个项目的缩略图上限必须是 1—500 的整数。', 'The per-project thumbnail limit must be an integer between 1 and 500.'],
    ['压缩格式只能选择 7z 或 ZIP。', 'The archive format must be 7z or ZIP.'],
    ['压缩率等级必须是 0—9 的整数。', 'The compression level must be an integer between 0 and 9.'],
    ['单卷大小必须是 64 MiB—10 GiB 之间的整数。', 'The volume size must be between 64 MiB and 10 GiB.'],
    ['小文件过滤阈值必须在 1 MB—100 GB 之间。', 'The small-file filter threshold must be between 1 MB and 100 GB.'],
    ['定时运行需要填写不同的开始和结束时间。', 'Scheduled run needs different start and end times.'],
    ['请选择有效的压缩包命名方式。', 'Choose a valid archive naming mode.'],
    ['归档后移动与移入回收站不能同时启用。', 'Move-after-archiving and Recycle Bin cannot both be enabled.'],
    ['请先确认回收站安全警告，再决定是否重新启用自动移入回收站。', 'Acknowledge the Recycle Bin safety warning before re-enabling automatic Recycle Bin moves.'],
    ['请填写归档后移动位置。', 'Fill in the move-after-archiving location.'],
    ['队列运行期间不能修改仓库位置。', 'The warehouse location cannot be changed while the queue is running.'],
    ['仓库位置不能为空。', 'The warehouse location cannot be empty.'],
    ['新仓库与当前仓库不能互相包含。', 'The new warehouse and the current warehouse cannot contain each other.'],
    ['所选仓库位置不是空目录，也不包含 warehouse.sqlite。请选择空目录或已有仓库。', 'The chosen warehouse location is neither empty nor contains warehouse.sqlite. Choose an empty directory or an existing warehouse.'],
    ['请选择导出文件位置。', 'Choose where to export the file.'],
    ['导出仓库必须保存为 .zip 压缩包。', 'The warehouse export must be saved as a .zip archive.'],
    ['导出压缩包生成失败，文件为空。', 'Export failed: the generated archive is empty.'],
    ['外来仓库文件必须是 .zip 压缩包。', 'The external warehouse file must be a .zip archive.'],
    ['压缩包内没有找到 warehouse.sqlite。', 'warehouse.sqlite was not found inside the archive.'],
    ['请选择仓库目录或 .zip 压缩包。', 'Choose a warehouse directory or a .zip archive.'],
    ['所选目录不是有效的仓库目录：缺少 warehouse.sqlite。', 'The chosen directory is not a valid warehouse: warehouse.sqlite is missing.'],
    ['移动位置已经存在同名项目', 'An item with the same name already exists at the move destination'],
    ['已备份原文件存放磁盘空间不足；源项目仍保留在原位置。', 'Not enough space on the destination disk; the source stays in place.'],
    ['跨磁盘移动复核失败，复制后的文件数量或大小不一致。', 'Cross-disk move check failed: copied file count or size mismatch.'],
    ['跨磁盘移动复核失败，视频大小不一致。', 'Cross-disk move check failed: video size mismatch.'],
    ['已验证入库，源项目已移到完成位置', 'Verified and cataloged; the source was moved to the completion location'],
    ['已验证入库，源项目已移入回收站', 'Verified and cataloged; the source was moved to the Recycle Bin'],
    ['已验证并入库', 'Verified and cataloged'],
    ['大小异常已人工确认并入库', 'Size anomaly confirmed manually and cataloged'],
    ['归档成功，但移动源项目失败，原位置已保留', 'Archived successfully, but moving the source failed; it stays in place'],
    ['归档成功，但移入回收站失败', 'Archived successfully, but the move to the Recycle Bin failed'],
    ['没有找到指定任务。', 'The specified task was not found.'],
    ['当前任务不处于等待确认状态。', 'The current task is not awaiting confirmation.'],
    ['当前任务没有等待确认的大小异常。', 'The current task has no size anomaly awaiting confirmation.'],
    ['当前任务没有可删除的异常成品。', 'The current task has no abnormal output to delete.'],
    ['当前没有与该项目对应的回收站安全警告。', 'There is no Recycle Bin safety warning for this task.'],
    ['当前没有可暂停的任务。', 'There is no task to pause.'],
    ['当前阶段不能暂停，请等待文件移动完成。', 'This stage cannot be paused; wait for the file move to finish.'],
    ['当前任务不能重试。', 'The current task cannot be retried.'],
    ['请在当前队列结束后重试。', 'Retry after the current queue finishes.'],
    ['任务已取消。', 'The task was cancelled.'],
    ['任务已重新加入队列。', 'The task was queued again.'],
    ['队列已经在运行。', 'The queue is already running.'],
    ['任务列表中没有可以直接入库的项目。', 'There are no tasks that can be cataloged directly.'],
    ['请等待当前队列停止后再添加库内项目。', 'Wait for the current queue to stop before adding warehouse items.'],
    ['已经在任务列表中', 'Already in the task list'],
    ['没有可复用的原文件位置或清单', 'No reusable original location or manifest'],
    ['原文件类型已经变化', 'The original file type has changed'],
    ['对应的未压缩仓库项目已经不存在。', 'The corresponding uncompressed warehouse item no longer exists.'],
    ['队列运行期间不能重新扫描。', 'Cannot rescan while the queue is running.'],
    ['所选主目录不是文件夹。', 'The chosen source directory is not a folder.'],
    ['单项归档当前只支持文件夹或视频文件。', 'Single-item archiving currently supports folders or video files only.'],
    ['运行中的任务不能直接移除，请先取消它。', 'A running task cannot be removed directly; cancel it first.'],
    ['大小异常的成品已经生成，请先确认入库，不能直接从任务列表移除。', 'Abnormal output was already created; confirm or discard it before removing the task.'],
    ['回收站安全警告尚未确认，不能直接移除对应任务。', 'The Recycle Bin safety warning is unacknowledged; the task cannot be removed directly.'],
    ['回收站安全警告尚未确认，队列保持停止。', 'The Recycle Bin safety warning is unacknowledged; the queue stays stopped.'],
    ['回收站没有保留原文件，队列已停止。', 'The Recycle Bin did not keep the original file; the queue was stopped.'],
    ['源项目没有进入回收站，仍保留在原位置。为避免后续项目发生永久删除，队列已安全停止。', 'The source did not enter the Recycle Bin and stays in place. To avoid permanent deletion of later items, the queue was halted.'],
    ['无法确认源项目是否保留在回收站，且原位置已经不存在。队列已安全停止，请立即检查回收站。', 'It could not be confirmed that the source is in the Recycle Bin, and it is gone from its original location. The queue was halted; check the Recycle Bin immediately.'],
    ['源项目在原位置和回收站中都未找到。回收站可能已满或超出配额，文件可能已被永久删除；队列已安全停止。', 'The source was found neither in place nor in the Recycle Bin. The Recycle Bin may be full or over quota and the file may be permanently deleted; the queue was halted.'],
    ['归档已入库；原文件仍在原位置，自动移入回收站已关闭', 'Archived and cataloged; the original stays in place and automatic Recycle Bin moves are disabled'],
    ['归档已入库；未能在回收站或原位置找到源文件，自动移入回收站已关闭', 'Archived and cataloged; the source was found neither in the Recycle Bin nor in place, and automatic Recycle Bin moves are disabled'],
    ['队列状态异常，已安全停止', 'Queue state error; the queue was stopped safely'],
    ['任务执行结束后仍处于等待状态，为防止重复运行已停止队列。', 'The task was still awaiting after finishing; the queue was stopped to prevent a duplicate run.'],
    ['检测到任务状态没有推进，已停止队列以避免重复执行。', 'Task state did not advance; the queue was stopped to avoid a duplicate run.'],
    ['磁盘空间安全停止，等待用户处理', 'Halted for disk space; awaiting user action'],
    ['当前任务已暂停；程序保持打开即可稍后继续。', 'The current task is paused. Keep the app open to resume later.'],
    ['当前任务已继续运行。', 'The current task resumed.'],
    ['已按要求完成一项，队列现已暂停。', 'One item finished as requested; the queue is now paused.'],
    ['当前可执行任务已经处理完毕。', 'All runnable tasks have been processed.'],
    ['当前任务完成后将暂停队列。', 'The queue will pause after the current task.'],
    ['下一项任务完成后将暂停队列。', 'The queue will pause after the next task.'],
    ['已到定时结束时间，当前任务已安全暂停。', 'The scheduled end time was reached; the current task paused safely.'],
    ['归档队列已启动。', 'The archive queue started.'],
    ['标题相似', 'Similar title'],
    ['标题一致', 'Identical title'],
    ['包含标题相似的视频', 'Contains videos with similar titles'],
    ['视频大小完全一致', 'Identical video size'],
    ['目录名相似', 'Similar folder name'],
    ['文件内容完全一致', 'Identical file content'],
    ['文件名相似', 'Similar file name'],
    ['名称重复', 'Duplicate name'],
    ['名称可能重复', 'Name may be duplicated'],
    ['存在精确重复文件', 'Exact duplicate files exist'],
    ['直接入库', 'intake without compression'],
    ['压缩', 'compression'],
    ['已跳过链接或重解析点', 'Skipped links or reparse points'],
    ['根级非视频文件', 'Root-level non-video file']
  ]],
  ['主进程·队列与核心模块（完成与状态提示）', [
    ['已验证入库；因回收站安全熔断，源项目保留在原位置', 'Verified and cataloged; source kept in place because of the Recycle Bin safety halt'],
    ['已验证入库；因队列正在停止，源项目已保留', 'Verified and cataloged; source kept because the queue is stopping'],
    ['已取消，源文件未修改', 'Cancelled; source was not changed'],
    ['处理失败，可重试', 'Processing failed; retry is available'],
    ['异常成品已移入回收站，源项目保持原位', 'Abnormal archive moved to the Recycle Bin; source kept in place'],
    ['任务已生成清单和缩略图并直接入库；未生成压缩包，原文件保持原位。', 'The task built its manifest and thumbnails and was cataloged directly; no archive was created and the source stays in place.'],
    ['库内未压缩项目已完成压缩，原仓库记录已升级。', 'The uncompressed warehouse item was compressed; its warehouse record was upgraded.'],
    ['任务已完成完整性测试并成功入库。', 'The task passed the integrity test and was cataloged.'],
    ['已生成完整清单并直接入库（未压缩）', 'Manifest completed and added without compression'],
    ['库内项目压缩', 'Warehouse item compression'],
    ['回收站复核暂时不可用', 'Recycle Bin recheck unavailable'],
    ['回收站安全熔断期间未执行源文件后处理。', 'Source post-processing was skipped during the Recycle Bin safety halt.']
  ]],
  ['主进程·更新与媒体', [
    ['GitHub 返回了无法识别的版本号。', 'GitHub returned an unrecognized version number.'],
    ['当前运行环境不支持联网检查更新。', 'This environment cannot check for updates online.'],
    ['无法连接 GitHub', 'Could not connect to GitHub'],
    ['等待主程序退出', 'Waiting for the main program to exit'],
    ['主程序在 90 秒内没有退出。', 'The main program did not exit within 90 seconds.'],
    ['已创建程序文件回滚副本。', 'A rollback copy of the program files was created.'],
    ['更新包中缺少 HamsterArchiver.exe。', 'HamsterArchiver.exe is missing from the update package.'],
    ['新版本未在 45 秒内完成启动验证。', 'The new version did not finish startup validation within 45 seconds.'],
    ['更新验证成功。', 'The update was validated successfully.'],
    ['已恢复旧版本程序文件。', 'The previous program files were restored.'],
    ['SHA256 摘要地址不是受信任的 GitHub HTTPS 地址。', 'The SHA256 digest URL is not a trusted GitHub HTTPS address.'],
    ['更新包地址不是受信任的 GitHub HTTPS 地址。', 'The update package URL is not a trusted GitHub HTTPS address.'],
    ['当前运行环境不支持流式下载更新包。', 'This environment cannot stream the update package.'],
    ['更新包目录结构无效，找不到程序文件。', 'The update package layout is invalid; program files were not found.'],
    ['自动更新目前仅支持 Windows 便携版。', 'Automatic updates currently support the Windows portable edition only.'],
    ['从压缩包更新目前仅支持 Windows 便携版。', 'Updating from a ZIP currently supports the Windows portable edition only.'],
    ['只有打包后的 Windows 便携版可以从压缩包更新。', 'Only the packaged Windows portable edition can update from a ZIP.'],
    ['请选择 .zip 格式的新版本压缩包。', 'Choose a new-version package in .zip format.'],
    ['所选更新包已经不存在。', 'The selected update package no longer exists.'],
    ['所选更新包不是文件。', 'The selected update package is not a file.'],
    ['更新包发行清单版本不受支持。', 'The update package manifest version is not supported.'],
    ['所选更新包不是 Windows x64 便携版。', 'The selected package is not the Windows x64 portable edition.'],
    ['更新包发行清单中的版本号无效。', 'The version in the update package manifest is invalid.'],
    ['这个 Release 没有可用的 Windows 更新包。', 'This release has no usable Windows update package.'],
    ['Release 缺少 SHA256 摘要，已停止更新。', 'The release is missing its SHA256 digest; the update was stopped.'],
    ['更新包 SHA256 校验失败，文件可能已损坏。', 'The update package failed its SHA256 check; it may be corrupted.'],
    ['更新包版本与 Release 标签不一致。', 'The update package version does not match the release tag.'],
    ['FFmpeg 无法读取有效的视频时长或画面尺寸。', 'FFmpeg could not read a valid video duration or frame size.']
  ]],
  ['主进程·存储与路径', [
    ['不能把磁盘根目录设为用户数据区。', 'A disk root cannot be used as the user data area.'],
    ['新旧用户数据区不能互相包含。', 'The new and old user data areas cannot contain each other.'],
    ['所选目录不是空目录，也没有找到可识别的 Hamster Archiver 用户数据。', 'The chosen directory is neither empty nor recognizable Hamster Archiver user data.'],
    ['用户数据布局无效。', 'The user data layout is invalid.'],
    ['请选择需要备份的文件主目录、文件夹或视频。', 'Choose a source directory, folder or video to back up.'],
    ['暂存目录不能与所选源项目互相包含。', 'The staging directory and selected source cannot contain one another.'],
    ['打包后文件存放点不能与所选源项目互相包含。', 'The output directory and selected source cannot contain one another.'],
    ['仓库位置不能与所选源项目互相包含。', 'The warehouse location and selected source cannot contain one another.'],
    ['归档后移动位置不能与源项目互相包含。', 'The move-after-archiving location cannot contain, or be inside, the source item.'],
    ['主目录、暂存目录、打包后文件存放点和仓库位置不能为空。', 'The source directory, staging directory, output directory and warehouse location cannot be empty.'],
    ['暂存目录与库目录不能互相包含。', 'The staging directory and the library directory cannot contain each other.'],
    ['仓库位置不能与暂存目录或打包后文件存放点互相包含。', 'The warehouse location cannot overlap the staging or output directory.'],
    ['启用归档后移动时，必须填写移动位置。', 'A move destination is required when move-after-archiving is enabled.'],
    ['归档后移动位置不能与源项目、暂存目录、成品目录或仓库位置互相包含。', 'The move-after-archiving location cannot overlap the source, staging, output or warehouse directories.'],
    ['7-Zip 路径不是文件。', 'The 7-Zip path is not a file.'],
    ['源文件在扫描后发生变化，请重新扫描后再归档。', 'The source changed after scanning; scan again before archiving.'],
    ['没有可安全读取并归档的文件。', 'No files could be safely read and archived.'],
    ['没有可安全读取并入库的文件。', 'No files could be safely read and cataloged.'],
    ['7-Zip 成功退出，但没有找到输出压缩包。', '7-Zip exited successfully, but no output archive was found.'],
    ['压缩包或原始文件大小无效', 'Archive or original size is invalid'],
    ['压缩包比原始内容大超过 5%', 'The archive is more than 5% larger than the original'],
    ['压缩后体积不足原始内容的 1%', 'The archive is smaller than 1% of the original'],
    ['自动复原回收站内容仅支持 Windows。', 'Automatic Recycle Bin restoration is Windows-only.'],
    ['原文件位置已经存在同名内容，无法从回收站复原。', 'Something with the same name already exists at the original location; it cannot be restored from the Recycle Bin.'],
    ['无效的进程编号。', 'Invalid process id.']
  ]],
  ['设置·相似度计算', [
    ['相似度计算', 'Similarity detection'],
    ['默认开启 · 标准', 'Enabled by default · Standard'],
    ['入库时自动与仓库内项目对比标题、视频名与大小，提示可能重复。', 'Automatically compares titles, video names and sizes against warehouse records on intake to flag possible duplicates.'],
    ['启用相似度计算', 'Enable similarity detection'],
    ['关闭相似度计算，不会清空旧有相似度关系，新入库项目不再计算相似度。', 'Turning off similarity detection keeps existing relations; newly archived items will no longer be checked.'],
    ['开启相似度计算后，新入库项目会自动与老入库项目对比计算相似度。', 'With similarity detection on, newly archived items are automatically compared with existing warehouse records.'],
    ['相似度计算已开启', 'Similarity detection enabled'],
    ['相似度计算已关闭', 'Similarity detection disabled'],
    ['相似度强度', 'Similarity strength'],
    ['越高越不容易误判；切换后不会自动重算已有相似关系。', 'Higher levels reduce false positives; switching does not automatically recalculate existing relations.'],
    ['宽松', 'Relaxed'],
    ['标准', 'Balanced'],
    ['严格', 'Strict'],
    ['全局重算', 'Recalculate everything'],
    ['按当前强度重算整个仓库的相似关系，每个项目都会重新计算。', 'Recalculates similarity for every record in the warehouse at the current strength.'],
    ['计算量较大，可能出现卡顿。确定要重算整个仓库的相似关系吗？', 'This is a heavy operation and may briefly freeze the UI. Recalculate similarity for the entire warehouse?'],
    ['相似关系已全部重算', 'All similarity relations recalculated'],
    ['队列运行期间不能重算相似度。', 'Similarity cannot be recalculated while the queue is running.'],
    ['请关闭当前页面，然后运行项目根目录中的 HamsterArchive.exe。', 'Close this page, then run HamsterArchive.exe from the application folder.'],
    ['7-Zip 程序位置', '7-Zip location'],
    ['默认使用软件随附的便携版 7-Zip，也可选择其他 7z.exe', 'Uses the bundled portable 7-Zip by default; any other 7z.exe can be selected'],
    ['仓库 / WAREHOUSE', 'Warehouse / WAREHOUSE']
  ]]
];

const patternSections = [
  ['相似度·重算进度', [
    [/^相似度强度已切换为“(.+)”；已有关系不会自动重算$/, 'Similarity strength switched to “$1”; existing relations were not recalculated'],
    [/^正在重算 (\d+)% · 预计剩余 (\d+) 秒$/, 'Recalculating $1% · about $2 s remaining'],
    [/^正在重算 (\d+)%$/, 'Recalculating $1%'],
    [/^重算完成 · 用时 ([\d.]+) 秒$/, 'Done in $1 s'],
    [/^已重算 (\d+) \/ (\d+) 项 · 正在重算相似关系$/, 'Recalculated $1 / $2 items · computing relations'],
    [/^已重算 (\d+) \/ (\d+) 项$/, 'Recalculated $1 / $2 items']
  ]],
  ['设置摘要与单位', [
    [/^等级 (\d+)$/, 'Level $1'],
    [/^分卷 ([\d.]+) (GB|MB)$/, '$1 $2 volumes'],
    [/^确认并按 (.+) 分卷$/, 'Confirm and split at $1'],
    [/^视频抽帧 (\d+) 帧\/视频$/, '$1 video frames/video'],
    [/^缩略图上限 (\d+) 张$/, 'Thumbnail limit $1'],
    [/^过滤 <(\d+) MB$/, 'Filter < $1 MB'],
    [/^自定义「(.+)」$/, 'Custom “$1”']
  ]],
  ['队列与任务', [
    [/^已选择 (\d+) 项（按住 Ctrl 可多选）$/, 'Selected $1 items (hold Ctrl to multi-select)'],
    [/^已选择 (\d+) 项$/, 'Selected $1 items'],
    [/^已选 (\d+) 项$/, 'Selected $1 items'],
    [/^(\d+) 个子目录 · 未压缩$/, '$1 subfolders · uncompressed'],
    [/^(\d+) 个子目录 · (.+)$/, '$1 subfolders · $2'],
    [/^(\d+) 个文件 · (\d+) 卷$/, '$1 files · $2 volumes'],
    [/^(\d+) 个文件$/, '$1 files'],
    [/^(\d+) 个子目录$/, '$1 subfolders'],
    [/^(\d+) 项$/, '$1 items'],
    [/^第 (\d+) 帧 · (\d+) 秒$/, 'Frame $1 · $2 s'],
    [/^(\d+) 星$/, '$1 stars'],
    [/^选择 (.+)$/, 'Select $1'],
    [/^打开任务位置 (.+)$/, 'Open task location: $1'],
    [/^复制任务名 (.+)$/, 'Copy task name: $1'],
    [/^移除与“(.+)”的相似关系$/, 'Remove the similarity with “$1”'],
    [/^(\d+) 个普通归档的压缩包将移入 Windows 回收站$/, 'The archives of $1 regular items will be moved to the Windows Recycle Bin'],
    [/^(\d+) 个未压缩库存只删除仓库记录，原文件保持不变$/, '$1 uncompressed items lose only their warehouse records; the original files stay unchanged'],
    [/^(\d+) 条手动库存记录将被移除$/, '$1 manual inventory records will be removed'],
    [/^原文件名：/, 'Original name: '],
    [/^原始大小 /, 'Original size '],
    [/^原始 /, 'Original '],
    [/^压缩包：/, 'Archive: '],
    [/^压缩后 /, 'After compression '],
    [/^备份 · (.+)$/, 'Backup · $1'],
    [/^可能重复 · (\d+) 个相似项$/, 'Possible duplicate · $1 similar items'],
    [/^备份位置：/, 'Backup location: '],
    [/^入库 (.+)$/, 'Added $1'],
    [/ · 入库 /, ' · Added '],
    [/^入库日期：/, 'Inventory date: '],
    [/^原始名称：/, 'Original name: '],
    [/^共 (\d+) 项$/, '$1 items total'],
    [/^同一视频 · (\d+) 帧 · 平均取样/, 'Same video · $1 frames · evenly sampled'],
    [/^媒体预览 · (\d+) 张$/, 'Media preview · $1 images'],
    [/^(.+) · 尚未到达$/, '$1 · Not reached yet'],
    [/^(.+) · (\d+) 项库存 · (.+) GB$/, '$1 · $2 inventory items · $3 GB'],
    [/^(.+) 的封面$/, 'Cover of $1'],
    [/^(.+)（旧记录，仅日期）$/, '$1 (legacy record, date only)'],
    [/^已暂停 · /, 'Paused · '],
    [/^低于过滤阈值 (.+) MB$/, 'Below the $1 MB filter threshold'],
    [/^手动图片 (\d+)$/, 'Manual image $1'],
    [/^记录了 (\d+) 个根级跳过项（非视频、链接或无法读取的内容），当前不会自动移动。$/, 'Recorded $1 skipped root-level items (non-video, links or unreadable content); they are not moved automatically.']
  ]],
  ['进度与剩余时间', [
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 分钟$/, 'Completed $1/$2 items · estimated time remaining: $3 minutes'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 小时 (\d+) 分钟$/, 'Completed $1/$2 items · estimated time remaining: $3 hours $4 minutes'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 小时$/, 'Completed $1/$2 items · estimated time remaining: $3 hours'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (.+)$/, 'Completed $1/$2 items · estimated time remaining: $3'],
    [/^(\d+) 分钟$/, '$1 minutes'],
    [/^(\d+) 小时 (\d+) 分钟$/, '$1 hours $2 minutes'],
    [/^(\d+) 小时$/, '$1 hours'],
    [/^正在统计 (.+)（(\d+)\/(\d+)）…$/, 'Scanning $1 ($2/$3)…'],
    [/^正在生成 MD5：/, 'Generating MD5: ']
  ]],
  ['仓库与分页', [
    [/^第 (\d+) \/ (\d+) 页 · 共 (\d+) 项$/, 'Page $1 / $2 · $3 items total'],
    [/^第 (\d+) \/ (\d+) 页$/, 'Page $1 / $2'],
    [/^仓库：/, 'Warehouse: '],
    [/^已添加 (\d+) 张图片$/, 'Added $1 images'],
    [/^已为 (\d+) 项追加标签$/, 'Added tags to $1 items'],
    [/^已修改 (\d+) 项的备份位置$/, 'Updated backup location for $1 items'],
    [/^已删除 (\d+) 项$/, 'Deleted $1 items'],
    [/^已删除 (\d+) 项；(\d+) 项失败：(.+)$/, 'Deleted $1 items; $2 failed: $3']
  ]],
  ['批量与清理结果', [
    [/^已清除 (\d+) 个已完成任务$/, 'Cleared $1 completed tasks'],
    [/^已清除 (\d+) 个已取消任务$/, 'Cleared $1 cancelled tasks'],
    [/^已清除 (\d+) 个精确重复任务$/, 'Cleared $1 exact duplicate tasks'],
    [/^已清除 (\d+) 个可能重复的任务$/, 'Cleared $1 possible duplicate tasks'],
    [/^已确认 (\d+) 个重复或相似任务$/, 'Confirmed $1 duplicate or similar tasks'],
    [/^已并入 (\d+) 条记录，跳过 (\d+) 条已存在记录$/, 'Imported $1 records; skipped $2 existing records'],
    [/^没有可并入的新记录，已跳过 (\d+) 条$/, 'No new records to import; skipped $1'],
    [/^已打开相似度排除词表（当前 (\d+) 个词）$/, 'Opened similarity ignore list ($1 terms)'],
    [/^已重新载入 (\d+) 个排除词，并更新相似项目关系$/, 'Reloaded $1 ignore terms and updated similar-project relations'],
    [/^手动库存已添加，并保存 (\d+) 张图片$/, 'Manual inventory added with $1 images'],
    [/^已通过(.+)加入 (\d+) 个任务$/, 'Added $2 tasks via $1'],
    [/^没有可加入的文件夹或视频（(.+)）$/, 'No folders or videos to add ($1)'],
    [/^仓库压缩包已导出：(.+)$/, 'Warehouse archive exported: $1'],
    [/^已切换仓库位置$/, 'Warehouse location switched'],
    [/^(\d+) 个项目入库失败，原文件已移动；(\d+) 个已加入队列$/, '$1 items failed because the source moved; $2 were queued'],
    [/^已将 (\d+) 个库内未压缩项目送入队列$/, 'Queued $1 uncompressed warehouse items'],
    [/^所选内容中没有可加入队列的未压缩项目$/, 'No selected uncompressed items can be queued'],
    [/^从任务列表移除所选 (\d+) 项？已入库档案和源文件不会删除。$/, 'Remove the selected $1 tasks? Archived files and source files will not be deleted.'],
    [/^已从任务列表移除 (\d+) 项；归档库记录不受影响。$/, 'Removed $1 tasks from the list; warehouse records are unaffected.'],
    [/^已清除 (\d+) 个已完成任务；仓库记录、压缩包和源文件均未删除。$/, 'Cleared $1 completed tasks; warehouse records, archives and source files were not deleted.'],
    [/^已清除 (\d+) 个已取消任务；仓库记录、压缩包和源文件均未删除。$/, 'Cleared $1 cancelled tasks; warehouse records, archives and source files were not deleted.'],
    [/^任务列表已清理；(\d+) 个安全或大小异常任务仍等待确认。$/, 'Task list cleaned; $1 safety or size-anomaly tasks still await confirmation.'],
    [/^任务列表已清空；已入库档案和源文件均未删除。$/, 'Task list cleared; archived files and source files were not deleted.'],
    [/^已把 (\d+) 个未压缩仓库项目送入队列，标记为“库内项目压缩”。$/, 'Queued $1 uncompressed warehouse items as “warehouse item compression”.'],
    [/^已批量确认 (\d+) 个重复或相似任务。$/, 'Confirmed $1 duplicate or similar tasks in bulk.'],
    [/^已选择不压缩直接入库，共 (\d+) 个任务；原文件将保留在原位置。$/, 'Uncompressed intake selected for $1 tasks; sources stay in place.'],
    [/^该项目只有 ([\d.]+) MB，低于当前 (\d+) MB 的入库阈值。$/, 'This item is only $1 MB, below the current $2 MB intake threshold.'],
    [/^已添加单项任务：(.+)$/, 'Added single task: $1']
  ]],
  ['仓库操作与撤回', [
    [/^撤回：(.+)$/, 'Undo: $1'],
    [/^已撤回：(.+)。$/, 'Undone: $1.'],
    [/^修改“(.+)”的整理信息$/, 'Edit organization details of “$1”'],
    [/^移除“(.+)”与“(.+)”的相似关系$/, 'Remove the similarity between “$1” and “$2”'],
    [/^删除“(.+)”的图片$/, 'Delete images of “$1”'],
    [/^为“(.+)”添加图片$/, 'Add images to “$1”'],
    [/^新增手动库存“(.+)”$/, 'Add manual inventory “$1”'],
    [/^为 (\d+) 项追加标签$/, 'Add tags to $1 items'],
    [/^批量修改 (\d+) 项备份位置$/, 'Change backup location for $1 items'],
    [/^已重新计算“(.+)”的相似项目，并同步更新对应关系。$/, 'Recalculated similar projects of “$1” and updated the relations.'],
    [/^已双向移除“(.+)”与“(.+)”的相似关系。$/, 'Removed the similarity between “$1” and “$2” in both directions.'],
    [/^已更新仓库条目“(.+)”的整理信息。$/, 'Updated organization details of “$1”.'],
    [/^已更新仓库条目“(.+)”的封面。$/, 'Updated the cover of “$1”.'],
    [/^已删除图片：(.+)$/, 'Deleted image: $1'],
    [/^已手动新增库存“(.+)”。$/, 'Added manual inventory “$1”.'],
    [/^已为仓库条目“(.+)”添加图片。$/, 'Added images to “$1”.'],
    [/^已删除手动库存“(.+)”。$/, 'Deleted manual inventory “$1”.'],
    [/^已删除外部仓库记录“(.+)”；外部压缩包保留在原位置。$/, 'Deleted imported record “$1”; the external archive stays in place.'],
    [/^已删除仓库内容“(.+)”；对应归档已移入 Windows 回收站。$/, 'Deleted “$1”; its archives were moved to the Windows Recycle Bin.'],
    [/^已删除未压缩仓库内容“(.+)”；原文件保持不变。$/, 'Deleted uncompressed item “$1”; the original file is unchanged.'],
    [/^已把原文件复原到：(.+)$/, 'Restored the original file to: $1'],
    [/^已把 (\d+) 条仓库内容的备份位置修改为：(.+)。$/, 'Changed the backup location of $1 warehouse items to: $2.'],
    [/^已为 (\d+) 条仓库内容追加标签：(.+)$/, 'Added tags to $1 warehouse items: $2'],
    [/^“(.+)”追加后会超过 30 个标签。$/, '“$1” would exceed 30 tags.'],
    [/^仓库已复制到：(.+)。原仓库保留在：(.+)。$/, 'Warehouse copied to: $1. The original remains at: $2.'],
    [/^已切换到现有仓库：(.+)。$/, 'Switched to the existing warehouse: $1.'],
    [/^仓库已导出为压缩包：(.+)$/, 'Warehouse exported as archive: $1'],
    [/^已并入外部仓库 (\d+) 条，跳过 (\d+) 条已存在记录。$/, 'Imported $1 external records; skipped $2 existing ones.'],
    [/^外部仓库没有可并入的新记录；已存在 (\d+) 条。$/, 'The external warehouse has no new records; $1 already exist.'],
    [/^所选 (\d+) 项：$/, 'Selected $1 items: ']
  ]],
  ['扫描与文件校验', [
    [/^开始扫描主目录：(.+)$/, 'Started scanning the source directory: $1'],
    [/^扫描完成：新增 (\d+) 个任务，过滤 (\d+) 个小项目，记录 (\d+) 个根级跳过项。$/, 'Scan finished: $1 tasks added, $2 small items filtered, $3 root-level skips recorded.'],
    [/^扫描时跳过无法读取的内容：(.+)（(.+)）$/, 'Skipped unreadable content while scanning: $1 ($2)'],
    [/^已跳过无法读取的目录：(.+)（(.+)）$/, 'Skipped the unreadable folder: $1 ($2)'],
    [/^已跳过无法读取的文件：(.+)（(.+)）$/, 'Skipped the unreadable file: $1 ($2)'],
    [/^未压缩入库已跳过无法读取的目录：(.+)（(.+)）$/, 'Skipped the unreadable folder: $1 ($2)'],
    [/^未压缩入库已跳过无法读取的文件：(.+)（(.+)）$/, 'Skipped the unreadable file: $1 ($2)'],
    [/^清单目录已跳过：(.+)（(.+)）$/, 'Skipped manifest directory: $1 ($2)'],
    [/^未压缩清单已跳过：(.+)（(.+)）$/, 'Skipped uncompressed manifest: $1 ($2)'],
    [/^无法读取：(.+)$/, 'Could not read: $1'],
    [/^项目无法读取，已跳过：(.+)$/, 'Item unreadable and skipped: $1'],
    [/^散列期间源文件发生变化：(.+)$/, 'The source changed during hashing: $1'],
    [/^压缩期间源文件消失：(.+)$/, 'The source disappeared during compression: $1'],
    [/^压缩期间源文件发生变化：(.+)$/, 'The source changed during compression: $1'],
    [/^跨磁盘复制校验失败：(.+)$/, 'Cross-disk copy check failed: $1'],
    [/^归档库中已经存在同名文件：(.+)$/, 'A file with the same name already exists in the library: $1']
  ]],
  ['磁盘空间与进程', [
    [/^(.+)剩余空间无法读取，已停止任务以避免生成不完整压缩包。$/, 'Free space on the $1 could not be read; the task was stopped to avoid an incomplete archive.'],
    [/^(.+)剩余空间读取失败，已停止任务：(.+)$/, 'Reading free space on the $1 failed; the task was stopped: $2'],
    [/^(.+)可用空间不足，无法安全处理当前任务。$/, 'Not enough space on the $1 to process this task safely.'],
    [/^Windows 进程控制失败（(\d+)）：(.+)$/, 'Windows process control failed ($1): $2'],
    [/^Windows 进程控制在 (\d+) 秒内没有响应，已停止等待。$/, 'Windows process control did not respond within $1 seconds; stopped waiting.'],
    [/^Windows 回收站查询失败：(.+)$/, 'Windows Recycle Bin query failed: $1']
  ]],
  ['路径与命名校验', [
    [/^(.+)不能为空。$/, '$1 cannot be empty.'],
    [/^(.+)不能超过 120 个字符。$/, '$1 cannot exceed 120 characters.'],
    [/^(.+)包含 Windows 文件名不允许的字符，或以句点、空格结尾。$/, '$1 contains characters not allowed in Windows file names, or ends with a period or space.'],
    [/^(.+)使用了 Windows 保留名称。$/, '$1 uses a reserved Windows name.'],
    [/^(.+)已经不存在。$/, 'The $1 no longer exists.'],
    [/^无法打开(.+)：(.+)$/, 'Could not open the $1: $2']
  ]],
  ['更新与网络', [
    [/^发现新版本 (.+)$/, 'New version available: $1'],
    [/^检查更新失败：(.*)$/, 'Update check failed: $1'],
    [/^更新失败：(.*)$/, 'Update failed: $1'],
    [/^更新包发行清单无效：(.*)$/, 'The update package manifest is invalid: $1'],
    [/^所选更新包版本 (.+) 不高于当前版本 (.+)。$/, 'Selected package version $1 is not newer than current version $2.'],
    [/^下载更新 (\d+)%$/, 'Downloading update $1%'],
    [/^检查更新超时（(\d+) 秒），请检查网络或代理设置。$/, 'Update check timed out ($1 s); check the network or proxy settings.'],
    [/^无法连接 GitHub：(.+)$/, 'Could not connect to GitHub: $1'],
    [/^GitHub 更新检查失败（HTTP (\d+)）。$/, 'GitHub update check failed (HTTP $1).'],
    [/^SHA256 摘要下载失败（HTTP (\d+)）。$/, 'SHA256 digest download failed (HTTP $1).'],
    [/^更新包下载失败（HTTP (\d+)）。$/, 'Update package download failed (HTTP $1).'],
    [/^已写入版本 (.+) 的程序文件，启动验证进程。$/, 'Program files for version $1 written; starting validation.'],
    [/^启动验证版本不一致：期望 (.+)，实际 (.+)。$/, 'Validated version mismatch: expected $1, got $2.'],
    [/^PowerShell 更新助手过早退出（代码 (\d+)）。$/, 'The PowerShell update helper exited early (code $1).'],
    [/^PowerShell 更新助手在 (\d+) 秒内没有确认启动。$/, 'The PowerShell update helper did not confirm startup within $1 seconds.'],
    [/^自动更新助手未能启动：(.+)$/, 'The automatic update helper could not start: $1'],
    [/^无法读取更新失败记录：(.+)$/, 'Could not read the update failure record: $1']
  ]],
  ['媒体处理', [
    [/^媒体处理超时：(.+)$/, 'Media processing timed out: $1'],
    [/^(.+) 退出码 (\d+)：(.+)$/, '$1 exited with code $2: $3'],
    [/^FFmpeg 探测失败：(.+)；未能从固定版本输出中解析时长或分辨率。$/, 'FFmpeg probe failed: $1; duration or resolution could not be parsed from the pinned-version output.'],
    [/^FFmpeg 探测成功：(.+) · (.+)×(.+) · (.+) 秒。$/, 'FFmpeg probe succeeded: $1 · $2×$3 · $4 s.'],
    [/^FFmpeg 视频抽帧失败，改用系统缩略图：(.+) · (.+)$/, 'FFmpeg frame extraction failed; falling back to the system thumbnail: $1 · $2'],
    [/^已跳过无法生成预览的媒体：(.+) · (.+)$/, 'Skipped media without a preview: $1 · $2']
  ]],
  ['队列阶段与重复提示', [
    [/^相似项目关系重建失败：(.+)$/, 'Rebuilding similarity relations failed: $1'],
    [/^回收站复核暂时不可用：(.+) · (.+)$/, 'Recycle Bin review is temporarily unavailable: $1 · $2'],
    [/^发现 (\d+) 个相似项目$/, 'Found $1 similar items'],
    [/^(\d+) 个内容完全相同的文件，(\d+) 个相似项目或视频$/, '$1 identical files, $2 similar projects or videos'],
    [/^(\d+) 个内容完全相同的文件$/, '$1 identical files'],
    [/^(\d+) 个相似项目或视频$/, '$1 similar projects or videos'],
    [/^发现(.+)，需要确认后才能(.+)。$/, 'Found $1; confirmation is required before $2.'],
    [/^发现 (.+)，已延后等待确认$/, 'Found $1; deferred for confirmation'],
    [/^(.+)（压缩率 (.+%)），等待核验$/, '$1 (compression ratio $2); awaiting review'],
    [/^压缩体积异常：(.+)；完整性测试已通过，但必须人工确认后才会入库。$/, 'Abnormal archive size: $1. The integrity test passed, but manual confirmation is required before cataloging.'],
    [/^缩略图生成未完成：(.+)$/, 'Thumbnail generation did not finish: $1'],
    [/^归档已删除，但缩略图清理失败：(.+)$/, 'The archive was deleted, but thumbnail cleanup failed: $1'],
    [/^异常成品已删除，但缩略图清理失败：(.+)$/, 'The abnormal output was deleted, but thumbnail cleanup failed: $1'],
    [/^多卷压缩包删除未完成，已回滚：(.+)$/, 'Multi-volume archive deletion did not finish; rolled back: $1'],
    [/^撤回图片时恢复文件失败：(.+)$/, 'Restoring the image during undo failed: $1'],
    [/^原文件位置已存在同名内容，已停止复原：(.+)$/, 'Something with the same name already exists at the original location; restoration stopped: $1'],
    [/^移动位置已经存在同名项目：(.+)$/, 'An item with the same name already exists at the move destination: $1'],
    [/^库内项目“(.+)”压缩入库失败，原文件已移动或发生变化：(.+)$/, 'Compressing warehouse item “$1” failed; the original moved or changed: $2'],
    [/^恢复暂停任务失败，已取消当前任务并停止队列：(.+)$/, 'Resuming the paused task failed; the task was cancelled and the queue stopped: $1'],
    [/^恢复任务失败，已安全取消当前任务并停止队列：(.+)$/, 'Resuming the task failed; the task was cancelled safely and the queue stopped: $1'],
    [/^回收站安全熔断：(.+) 自动移入回收站已关闭，后续任务没有启动。$/, 'Recycle Bin safety halt: $1 Automatic Recycle Bin moves were disabled and later tasks were not started.'],
    [/^已验证入库；有 (\d+) 个内容无法读取，源项目为防止遗漏而保留$/, 'Verified and cataloged; $1 unreadable items kept the source in place to avoid omissions'],
    [/^下一项预计需要 (\d+) 分钟，剩余 (\d+) 分钟，本时段不再启动新任务。$/, 'The next item needs about $1 minutes but only $2 remain; no new task starts in this window.'],
    [/^当前不在定时运行时段，队列等待计划开始时间。$/, 'Outside the scheduled window; the queue waits for the start time.'],
    [/^第 (\d+) 条仓库记录缺少 id。$/, 'Warehouse record #$1 is missing its id.'],
    [/^仓库记录 id 重复：(.+)$/, 'Duplicate warehouse record id: $1'],
    [/^第 (\d+) 个任务缺少 id。$/, 'Task #$1 is missing its id.'],
    [/^任务 id 重复：(.+)$/, 'Duplicate task id: $1'],
    [/^检测到旧版 JSON 存档，但尚未生成 warehouse\.sqlite。请先运行 (.+) 转换“(.+)”。$/, 'A legacy JSON save exists but warehouse.sqlite has not been created. Run $1 to convert “$2”.'],
    // Keep catch-all separators last so specific patterns above win.
    [/^(.+)：(.+) \/ (.+)$/, '$1: $2 / $3']
  ]]
];

// Queue stages often contain counts or a current filename, so they cannot all
// be represented as exact dictionary keys. Translate only fixed UI wording and
// leave paths, names and counters untouched.
const stageFragmentSections = [
  ['队列阶段', [
    ['程序上次运行时被中断，可重新扫描或重试。', 'The previous run was interrupted. Scan again or retry.'],
    ['正在生成逐文件清单与 MD5', 'Generating file manifest and MD5'],
    ['正在生成未压缩入库清单与 MD5', 'Generating uncompressed inventory manifest and MD5'],
    ['正在生成 MD5：', 'Generating MD5: '],
    ['正在加密压缩', 'Encrypting and compressing'],
    ['正在压缩', 'Compressing'],
    ['并生成 ', ' and creating '],
    [' 分卷', ' volumes'],
    ['正在复核源文件未发生变化', 'Checking that source files are unchanged'],
    ['正在执行 7-Zip 完整性测试', 'Running the 7-Zip integrity test'],
    ['正在把已验证成品移入归档库', 'Moving verified archives into the library'],
    ['超过 10 GiB', 'Over 10 GiB'],
    ['名称可能重复', 'Name may be duplicated'],
    ['等待手动确认', 'Awaiting manual confirmation'],
    ['等待压缩', 'Queued for compression'],
    ['等待未压缩直接入库', 'Queued for uncompressed intake'],
    ['未压缩直接入库', 'Uncompressed intake'],
    ['库内项目压缩 · 等待压缩', 'Warehouse item compression · queued'],
    ['已确认，等待未压缩直接入库', 'Confirmed; queued for uncompressed intake'],
    ['已确认，等待库内项目压缩', 'Confirmed; queued for warehouse item compression'],
    ['已确认，等待压缩', 'Confirmed, queued for compression'],
    ['已批量确认重复风险，等待未压缩直接入库', 'Duplicate risk confirmed in bulk; queued for uncompressed intake'],
    ['已批量确认重复风险，等待库内项目压缩', 'Duplicate risk confirmed in bulk; queued for warehouse item compression'],
    ['已批量确认重复风险，等待压缩', 'Duplicate risk confirmed in bulk, queued for compression'],
    ['已生成完整清单并直接入库（未压缩）', 'Manifest completed and added without compression'],
    ['异常成品已移入回收站，源项目保持原位', 'Abnormal archive moved to the Recycle Bin; source kept in place'],
    ['等待核验', 'awaiting review'],
    ['安全停止：原文件未进入回收站，仍在原位置', 'Safety stop: source did not enter the Recycle Bin and remains in place'],
    ['安全停止：回收站未保留原文件，请立即检查', 'Safety stop: the Recycle Bin did not retain the source; check immediately'],
    ['已验证入库；因回收站安全熔断，源项目保留在原位置', 'Verified and cataloged; source kept in place because of the Recycle Bin safety halt'],
    ['已验证入库；因队列正在停止，源项目已保留', 'Verified and cataloged; source kept because the queue is stopping'],
    ['已取消，源文件未修改', 'Cancelled; source was not changed'],
    ['处理失败，可重试', 'Processing failed; retry is available'],
    ['正在安全取消', 'Cancelling safely'],
    ['，但源项目后处理失败，原位置已保留', ', but source post-processing failed; it stays in place'],
    ['整个队列已停止，释放空间并确认目录可用后可重试。', 'The entire queue stopped; free up space, confirm the directory is available, then retry.']
  ]]
];

function buildExact(sections) {
  const map = new Map();
  for (const [section, entries] of sections) {
    for (const [source, target] of entries) {
      if (map.has(source)) {
        throw new Error(`i18n duplicate dictionary entry in “${section}”: ${source}`);
      }
      map.set(source, target);
    }
  }
  return map;
}

function buildPatterns(sections) {
  const list = [];
  const seen = new Set();
  for (const [section, entries] of sections) {
    for (const [pattern, replacement] of entries) {
      if (!(pattern instanceof RegExp)) {
        throw new Error(`i18n pattern is not a RegExp in “${section}”: ${pattern}`);
      }
      if (seen.has(pattern.source)) {
        throw new Error(`i18n duplicate pattern in “${section}”: ${pattern.source}`);
      }
      seen.add(pattern.source);
      const groupCount = new RegExp(`${pattern.source}|`).exec('').length - 1;
      for (const match of String(replacement).matchAll(/\$(\d+)/g)) {
        if (Number(match[1]) > groupCount) {
          throw new Error(`i18n pattern references missing group $${match[1]}: ${pattern.source}`);
        }
      }
      list.push([pattern, replacement]);
    }
  }
  return list;
}

function buildStageFragments(sections) {
  const list = [];
  const seen = new Set();
  for (const [section, entries] of sections) {
    for (const [source, target] of entries) {
      if (seen.has(source)) {
        throw new Error(`i18n duplicate stage fragment in “${section}”: ${source}`);
      }
      seen.add(source);
      list.push([source, target]);
    }
  }
  return list;
}

const exact = buildExact(exactSections);
const patterns = buildPatterns(patternSections);
const stageFragments = buildStageFragments(stageFragmentSections);
const exactObject = Object.fromEntries(exact);

let locale = 'zh-CN';
let translating = false;
let domObserver = null;
const originalText = new WeakMap();
const originalAttributes = new WeakMap();
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip'];
const MAX_CAPTURE_DEPTH = 3;

function translate(value, depth = 0) {
  if (typeof value !== 'string' || locale !== 'en-US') return value;
  const hit = exact.get(value);
  if (hit !== undefined) return hit;
  for (const [pattern, replacement] of patterns) {
    if (!pattern.test(value)) continue;
    return value.replace(pattern, (...args) => {
      const groups = args.slice(1, -2);
      return String(replacement).replace(/\$(\d+)/g, (_, index) => {
        const raw = groups[Number(index) - 1];
        if (raw === undefined) return '';
        return depth >= MAX_CAPTURE_DEPTH ? raw : translate(raw, depth + 1);
      });
    });
  }
  return value;
}

function translateStage(value) {
  if (typeof value !== 'string' || locale !== 'en-US') return value;
  const parts = value.split(' · ');
  let result = translate(value);
  if (result === value && parts.length > 1) {
    result = parts.map((segment) => translate(segment)).join(' · ');
    for (let index = 1; index < parts.length; index += 1) {
      const suffix = parts.slice(index).join(' · ');
      const translatedSuffix = translate(suffix);
      if (translatedSuffix === suffix) continue;
      result = [...parts.slice(0, index).map((segment) => translate(segment)), translatedSuffix].join(' · ');
      break;
    }
  }
  for (const [source, target] of stageFragments) result = result.split(source).join(target);
  return result;
}

function translateDom(root = document) {
  if (translating || !root) return;
  translating = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) nodes.push(current);
    for (const node of nodes) {
      const value = originalText.has(node) ? originalText.get(node) : node.nodeValue;
      originalText.set(node, value);
      const trimmed = value.trim();
      const stageText = node.parentElement?.closest?.('[data-i18n-stage]');
      const translated = locale === 'en-US'
        ? (stageText ? translateStage(trimmed) : translate(trimmed))
        : trimmed;
      if (trimmed) node.nodeValue = value.replace(trimmed, translated);
    }
    const selector = TRANSLATABLE_ATTRIBUTES.map((attribute) => `[${attribute}]`).join(',');
    for (const element of root.querySelectorAll?.(selector) || []) {
      for (const attribute of TRANSLATABLE_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        let values = originalAttributes.get(element);
        if (!values) {
          values = {};
          originalAttributes.set(element, values);
        }
        if (values[attribute] === undefined) values[attribute] = element.getAttribute(attribute);
        element.setAttribute(attribute, locale === 'en-US' ? translate(values[attribute]) : values[attribute]);
      }
    }
  } finally {
    translating = false;
  }
}

function setLocale(nextLocale) {
  locale = nextLocale === 'en-US' ? 'en-US' : 'zh-CN';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    translateDom(document.body);
    ensureDynamicTranslationObserver();
  }
  return locale;
}

function ensureDynamicTranslationObserver() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !document.body || domObserver) return;
  domObserver = new MutationObserver((records) => {
    if (translating) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) translateDom(node);
      }
    }
  });
  domObserver.observe(document.body, { childList: true, subtree: true });
}

const publicApi = {
  exact: exactObject,
  patterns,
  stageFragments,
  translate,
  translateStage,
  translateDom,
  setLocale,
  getLocale: () => locale
};

if (typeof window !== 'undefined') {
  ensureDynamicTranslationObserver();
  window.hamsterI18n = publicApi;
}

if (typeof module !== 'undefined') {
  module.exports = publicApi;
}
