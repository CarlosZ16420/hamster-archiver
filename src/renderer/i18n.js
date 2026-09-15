'use strict';

// Post-hoc translation layer: the renderer keeps Chinese as the source language
// and swaps known interface phrases to English at runtime. User data (titles,
// tags, paths and notes) is never translated.
//
// Dictionary entries use [Chinese, English] pairs so that duplicate keys fail
// loudly at load time instead of being silently collapsed by an object literal.
// Pattern captures are preserved by default because they commonly contain user
// titles, tags, paths, or operating-system errors. A pattern must opt specific
// captures into recursive translation when those captures are known UI text.

const exactSections = [
  ['更新窗口', [
    ['暂无正式发行版。', 'No releases yet.'],
    ['更新说明过长，请在发布页查看全文。', 'Release notes too long. View full text in Releases.'],
    ['发现新版本', 'Update Available'],
    ['更新内容', 'What’s New'],
    ['当前版本', 'Installed Version'],
    ['当前已是最新版本。', 'You’re up to date.'],
    ['下载并校验更新后再安装，用户数据会保留。', 'Verified before install; data kept.'],
    ['部分历史更新说明未能加载，请在发布页查看完整记录。', 'Some notes didn’t load. Open Releases for full history.'],
    ['此版本没有匹配的更新包，请手动更新或打开发布页。', 'No compatible update. Update manually or open Releases.'],
    ['此版本未提供当前语言的独立说明，以下显示原文。', 'No English notes; showing original.'],
    ['此版本未附带更新说明。', 'No release notes.'],
    ['稍后', 'Later'],
    ['打开发布页', 'Open Releases'],
    ['立即更新', 'Update'],
    ['正在准备更新…', 'Preparing…'],
    ['请重新检查更新。', 'Check for updates again.']
  ]],
  ['全局与品牌', [
    ['仓鼠症大结局', 'Hamster Archiver'],
    ['Hamster Archive', 'Hamster Archiver'],
    ['Hamster Archiver · 本地优先的归档工具', 'Hamster Archiver · Local-first archiving'],
    ['本地优先的归档工具', 'Local-first archiving'],
    ['请从桌面程序启动', 'Launch from the desktop app'],
    ['这个页面需要本地文件与 7-Zip 权限，不能作为普通网页单独打开。', 'This page needs desktop access to local files and 7-Zip.'],
    ['请关闭当前页面，然后运行项目根目录中的 HamsterArchiver.exe。', 'Close this page and run HamsterArchiver.exe.'],
    ['桌面桥接未加载：请运行 HamsterArchiver.exe，不要直接打开网页文件。', 'Desktop access is unavailable. Run HamsterArchiver.exe instead.'],
    ['页面导航', 'Page navigation'],
    ['归档工作台', 'Workbench'],
    ['GitHub 仓库', 'GitHub repository'],
    ['欢迎反馈', 'Feedback']
  ]],
  ['主题与语言', [
    ['主题', 'Theme'],
    ['语言', 'Language'],
    ['检查更新', 'Check for updates'],
    ['手动更新', 'Update from File'],
    ['暂时无法获取最新版本', 'Can’t Check for Updates'],
    ['切换到 English', 'Switch to English'],
    ['切换到中文', 'Switch to Chinese'],
    ['简体中文', 'Chinese (Simplified)'],
    ['经典', 'Classic'],
    ['白昼', 'Daylight'],
    ['黑夜', 'Night'],
    ['森林', 'Forest'],
    ['暮光', 'Twilight'],
    ['选择界面主题', 'Theme']
  ]],
  ['通用按钮与短词', [
    ['关闭', 'Close'],
    ['取消', 'Cancel'],
    ['确定', 'OK'],
    ['确认', 'Confirm'],
    ['继续', 'Continue'],
    ['操作确认 / CONFIRM', 'CONFIRM'],
    ['请确认操作', 'Confirm Action'],
    ['确认启用', 'Enable'],
    ['确认入库', 'Add to Warehouse'],
    ['删除成品', 'Delete output'],
    ['确认清空', 'Clear'],
    ['确认并继续', 'Continue'],
    ['选择并导入', 'Import'],
    ['确认切换', 'Switch'],
    ['开始重算', 'Recalculate'],
    ['复原到原位置', 'Restore'],
    ['确认删除', 'Delete'],
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
    ['保存', 'Save'],
    ['开始', 'Start'],
    ['结束', 'End'],
    ['跳到', 'Jump to'],
    ['页', 'page'],
    ['至', 'to'],
    ['拖放', 'Drop'],
    ['粘贴', 'Paste'],
    ['无', 'None'],
    ['未记录', 'Not recorded'],
    ['项', 'items'],
    ['，', ','],
    ['：', ':'],
    ['；', ';'],
    ['。', '.']
  ]],
  ['工作台·收纳设置', [
    ['01 · 收纳设置', '01 · ARCHIVE SETUP'],
    ['这次从哪里收，存到哪里', 'Choose source and destination'],
    ['需备份目录', 'Source Folder'],
    ['压缩包保存在', 'Archive Folder'],
    ['扫描时会把所选目录下的每个文件夹或视频分别加入队列，跳过其他根级文件；启用小项目过滤时，低于当前阈值的项目也不会入队（默认 100 MB）', 'Queues each folder/video. Skips other top-level files and items under the limit (default 100 MB).'],
    ['视频抽帧 3 帧/视频 · 缩略图上限 30 张 · 过滤 <100 MB', '3 frames/video · max 30 thumbnails · excludes items under 100 MB'],
    ['选填', 'Optional'],
    ['必填', 'Required'],
    ['推荐勾选，便于识别哪些文件被备份了', 'Recommended for tracking archived files.']
  ]],
  ['工作台·归档后处理', [
    ['归档后处理', 'After archiving'],
    ['保留原文件 · 不记录备份位置', 'Keep originals · no backup location'],
    ['保留原文件', 'Keep Originals'],
    ['归档后不移动原文件', 'Keep Originals'],
    ['归档后移动原文件', 'Move Originals'],
    ['归档后移入回收站', 'Move to Recycle Bin'],
    ['完成后移动原文件', 'Move Originals'],
    ['完成后移入回收站', 'Move to Recycle Bin'],
    ['完成后移动到指定位置', 'Move to Folder'],
    ['仅在压缩、验证、入库全部成功后移动；失败时保留源文件', 'Moves only after all steps pass; failures keep originals.'],
    ['归档后移动位置', 'Move-to Folder'],
    ['完成后移入 Windows 回收站', 'Move to Recycle Bin'],
    ['可从回收站恢复；异常时安全停止', 'Recoverable; errors stop safely.'],
    ['记录备份位置', 'Save Backup Location'],
    ['云盘、移动硬盘或其他备份去向', 'Cloud, external drive, or other backup'],
    ['不记录备份位置', 'No Backup Location'],
    ['启用后，每个任务只要验证并入库成功，就会把对应源文件夹或视频移入 Windows 回收站。是否启用？', 'Move each verified source to the Recycle Bin after archiving?']
  ]],
  ['工作台·高级压缩设置', [
    ['高级压缩设置', 'Compression'],
    ['7z · 等级 1 · 时间戳命名 · 分卷 10 GB · 无密码', '7z · Level 1 · Timestamp · 10 GB volumes · No password'],
    ['压缩格式', 'Archive format'],
    ['7z（默认）', '7z (default)'],
    ['ZIP', 'ZIP'],
    ['格式', 'format'],
    ['压缩率', 'Compression'],
    ['0 · 不压缩', '0 · Store only'],
    ['1 · 快速（默认）', '1 · Fast (default)'],
    ['3 · 标准', '3 · Standard'],
    ['5 · 较高', '5 · High'],
    ['7 · 高', '7 · Very High'],
    ['9 · 极限', '9 · Maximum'],
    ['等级', 'level'],
    ['压缩包命名方式', 'File Naming'],
    ['时间戳 + 随机数（默认）', 'Timestamp + random ID (default)'],
    ['原文件名 + 8 位随机数（过长时截断）', 'Original name + 8-digit ID'],
    ['自定义名 + 8 位随机数', 'Custom name + 8-digit ID'],
    ['时间戳命名', 'Timestamp naming'],
    ['原文件名命名', 'Original-name naming'],
    ['自定义命名', 'Custom naming'],
    ['自定义名称', 'Custom name'],
    ['原文件名', 'Original file name'],
    ['填写符合 Windows 文件命名规范的自定义名', 'Enter a valid Windows file name'],
    ['分卷压缩', 'Split Archives'],
    ['超过单卷上限时自动拆分；默认 10 GiB，与旧版行为一致。', 'Splits archives above the volume limit. Default: 10 GiB.'],
    ['单卷大小', 'Volume size'],
    ['分卷大小单位', 'Volume size unit'],
    ['不主动分卷', 'Automatic Splitting Off'],
    ['安全上限保持为 10 GiB：即使关闭主动分卷，超过 10 GiB 的任务仍须确认并按 10 GiB 分卷。分卷发布、校验、删除与回滚始终按整组处理。', '10 GiB safety limit. Larger jobs need approval and 10 GiB volumes; volume sets stay together.'],
    ['解压密码', 'Archive password'],
    ['留空则不设置密码', 'Leave blank for no password'],
    ['记录解压密码', 'Record archive password'],
    ['把任务实际使用的密码作为专属词条写入仓库；不勾选时只记录“已加密”。', 'Save each archive password, or show only “Encrypted”.'],
    ['已设置密码', 'Password set'],
    ['无密码', 'No password'],
    ['已加密', 'Encrypted'],
    ['未加密', 'Not encrypted']
  ]],
  ['工作台·入库与预览', [
    ['入库与预览', 'Indexing & Previews'],
    ['视频帧备份', 'Video frame backup'],
    ['按总时长平均抽取画面，并在仓库中按视频成组显示', 'Sample frames evenly and group them by video.'],
    ['帧/视频', 'frames/video'],
    ['每个视频保存的帧数', 'Frames saved per video'],
    ['小项目过滤', 'Small-item filter'],
    ['扫描和拖入时跳过低于阈值的视频或文件夹', 'Skip videos and folders below the size limit.'],
    ['最小项目大小', 'Minimum item size'],
    ['不抽取视频帧', 'Don’t extract video frames'],
    ['不过滤小项目', 'Don’t filter small items'],
    ['单个项目缩略图上限', 'Preview Limit per Item'],
    ['包括图片缩略图与视频抽帧，避免超大项目生成过多预览。', 'Limits image thumbnails and video frames per item.'],
    ['张', 'images']
  ]],
  ['工作台·更多设置', [
    ['更多设置', 'More'],
    ['定时运行关闭 · 数据与维护工具', 'Schedule off · Data & tools'],
    ['定时运行关闭', 'Scheduled run off'],
    ['定时运行', 'Scheduled run'],
    ['时间不足时不再启动下一项；到结束时间会安全暂停', 'Stops new jobs near end time, then pauses safely.'],
    ['定时开始时间', 'Scheduled start time'],
    ['定时结束时间', 'Scheduled end time'],
    ['相似度排除词表', 'Similarity ignore list'],
    ['相似判断的“白名单”。每行一个词；不影响仓库搜索、MD5 或文件大小重复检查。', 'One ignored term per line. Search, MD5, and size checks are unaffected.'],
    ['打开词表', 'Open list'],
    ['重新载入', 'Reload'],
    ['用户数据区', 'User data area'],
    ['切换时保留旧目录', 'Keeps the old folder'],
    ['切换时保留旧目录，确认后重启应用生效', 'Keeps old folder. Restart to apply.'],
    ['切换', 'Switch'],
    ['压缩暂存目录', 'Archive staging directory'],
    ['默认在压缩包存储点同目录下新建 staging 文件夹', 'Creates staging beside the archive folder.'],
    ['数据与维护工具', 'Data & Tools'],
    ['保存设置', 'Save settings']
  ]],
  ['队列·工具栏与汇总', [
    ['02 · 扫描与队列', '02 · QUEUE'],
    ['先预览，再开始归档', 'Review, then archive'],
    ['添加单个文件夹', 'Add folder'],
    ['添加单个视频', 'Add video'],
    ['扫描目录', 'Scan Folder'],
    ['开始压缩入库', 'Archive'],
    ['不压缩直接入库', 'Add Uncompressed'],
    ['拖拽或粘贴文件夹、视频，快速加入队列', 'Drop or paste a folder or video'],
    ['任务', 'Tasks'],
    ['等待确认', 'Needs Review'],
    ['等待处理', 'Queued'],
    ['等待压缩', 'Queued'],
    ['已完成', 'Completed'],
    ['原始总量', 'Original size'],
    ['确认内容一致并继续', 'Continue Anyway'],
    ['确认相似并继续', 'Continue Anyway'],
    ['核验后确认入库', 'Approve & Add'],
    ['删除异常成品', 'Delete Output'],
    ['确认安全警告', 'Acknowledge'],
    ['未选择任务', 'No tasks selected'],
    ['移除所选', 'Remove'],
    ['设置', 'Settings'],
    ['相似报告', 'Similarity report'],
    ['开启后，检测到相似项目时会给出详细报告', 'Show details for similar items.'],
    ['自动跳过', 'Auto-skip Exact Matches'],
    ['自动跳过已经完整存在于仓库中的项目', 'Skip items already stored in full.'],
    ['卡顿规避', 'Performance'],
    ['超大文件夹简化处理', 'Sample Very Large Folders'],
    ['对于文件数量超过', 'For folders containing more than'],
    ['的文件夹，', 'files,'],
    ['选取', 'select'],
    ['个代表文件记录 MD5、计算相似度', 'sample files for MD5 and similarity'],
    ['超大文件夹阈值', 'Very large folder threshold'],
    ['代表文件数量', 'Representative file count'],
    ['MD5计算跳过极小文件', 'Skip Tiny Files for MD5'],
    ['小于', 'Under'],
    ['KB 的文件不记录 MD5', 'KB files won’t get an MD5'],
    ['极小文件阈值', 'Tiny file threshold'],
    ['超大文件夹阈值必须是 1—100000 的整数。', 'Large-folder threshold: integer from 1 to 100,000.'],
    ['代表文件数量必须是 1—100000 的整数。', 'Sample file count: integer from 1 to 100,000.'],
    ['极小文件阈值必须是 1 KB—1 GB 之间的整数。', 'The tiny file threshold must be an integer from 1 KB to 1 GB.'],
    ['跳过后', 'After skipping'],
    ['在队列中删除对应项（日志中仍保留）', 'Remove from queue (keep in log)'],
    ['在队列中保留对应项', 'Keep in queue'],
    ['等待下次入库', 'Next Run'],
    ['重复项处理', 'Duplicates'],
    ['清除可能重复项', 'Remove Possible Duplicates'],
    ['清除完全重复项', 'Remove Exact Duplicates'],
    ['同意全部重复项', 'Approve All Duplicates'],
    ['清理队列', 'Clear Queue'],
    ['清空已完成队列', 'Clear Completed'],
    ['清空已取消队列', 'Clear Canceled'],
    ['一键清空队列', 'Clear All'],
    ['一键清空队列…', 'Clear All…'],
    ['选择全部任务', 'Select all tasks'],
    ['完成本项后暂停', 'Pause After This Item'],
    ['暂停', 'Pause'],
    ['暂停当前任务', 'Pause'],
    ['继续当前任务', 'Resume'],
    ['取消当前任务', 'Cancel Task'],
    ['还没有任务。点击“扫描目录”选择目录并开始扫描。', 'No tasks yet. Select “Scan Folder” to begin.'],
    ['队列检查 / SIMILARITY', 'SIMILARITY CHECK'],
    ['正在生成相似报告…', 'Building report…'],
    ['相似报告生成失败，请检查项目位置后重试。', 'Couldn’t build report. Reselect and retry.'],
    ['位置', 'Location'],
    ['红色 · 名称或相似证据', 'Red · similar name or evidence'],
    ['金色 · 内容或名称完全一致', 'Gold · exact content or name'],
    ['内容完全一致的文件会在队列生成 MD5 后显示；当前报告只显示名称和大小证据。', 'Exact matches appear after MD5. Current report shows name and size only.'],
    ['其余内容完全一致的文件会在队列生成 MD5 后显示；当前已复用仓库中同一源项目未变化文件的已有 MD5。', 'Remaining exact matches appear after MD5. Reused MD5 for unchanged files.'],
    ['已复用仓库中同一源项目的已有 MD5；未重新读取文件内容。', 'Reused existing MD5 values without rereading file contents.'],
    ['当前项目目录', 'Current project directory'],
    ['当前没有可跳转的仓库项目。', 'No linked Warehouse item.'],
    ['跳转到项目', 'Open Item'],
    ['项目存在相似证据', 'Similar evidence found'],
    ['项目名称完全一致', 'Exact project name'],
    ['项目完全重复', 'Exact Duplicate'],
    ['完成', 'Done'],
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
    ['生成清单与 MD5', 'Building Manifest'],
    ['压缩中', 'Compressing'],
    ['完整性验证', 'Verifying'],
    ['移入库目录', 'Saving to Warehouse'],
    ['归档完成/源文件处理失败', 'Archived / Cleanup Failed'],
    ['失败', 'Failed'],
    ['已取消', 'Canceled'],
    ['已自动跳过', 'Auto-skipped'],
    ['与仓库内项目完全一致，已自动跳过', 'Identical to a Warehouse item; auto-skipped'],
    ['重复待确认', 'Duplicate Review'],
    ['大小异常待核验', 'Size Review'],
    ['回收站安全警告', 'Recycle Bin Warning']
  ]],
  ['运行日志', [
    ['03 · 运行日志', '03 · LOG'],
    ['空闲', 'Idle'],
    ['暂无日志', 'No Activity Yet'],
    ['当前任务已暂停', 'Task Paused'],
    ['队列运行中', 'Running'],
    ['等待定时时段', 'Waiting for Schedule'],
    ['安全停止：等待确认', 'Safety Stop · Review Needed'],
    ['不到 1 分钟', 'Less than 1 minute'],
    ['开始调用 7-Zip；密码参数已隐藏。', 'Starting 7-Zip. Password hidden.'],
    ['开始调用 7-Zip；本任务未设置密码。', 'Starting 7-Zip. No password set.'],
    ['开始全局重算仓库相似关系…', 'Rebuilding all similarity links…'],
    ['已按当前设置完成全局重算。', 'Similarity rebuild complete.'],
    ['用户已核对压缩体积异常，并确认入库。', 'Unusual archive size reviewed and approved.'],
    ['用户删除了大小异常成品；源项目未移动、未删除。', 'Unusual output deleted; source kept.'],
    ['用户已确认回收站安全警告；队列仍保持停止，后续任务需手动重新开始。', 'Recycle Bin warning acknowledged. Queue stopped; restart manually.'],
    ['运行中的任务已安全取消。', 'The running task was canceled safely.']
  ]],
  ['仓库·概览', [
    ['仓库概览', 'Warehouse overview'],
    ['本周入库', 'Added this week'],
    ['导出仓库', 'Export Warehouse'],
    ['并入外部仓库', 'Import Warehouse'],
    ['随机漫步', 'Surprise Me'],
    ['库存', 'Inventory'],
    ['标签', 'Tags'],
    ['查看库存记录统计', 'View Item Stats'],
    ['查看仓库容量统计', 'View Storage Stats'],
    ['记录统计', 'Record statistics'],
    ['统计周期', 'Statistics period'],
    ['月', 'Month'],
    ['年', 'Year'],
    ['最近 20 周', 'Last 20 weeks'],
    ['最近二十周入库活跃度', 'Warehouse activity over 20 weeks'],
    ['少', 'Less'],
    ['多', 'More'],
    ['正在从仓库中挑选一项随机内容…', 'Picking something from the Warehouse…'],
    ['仓库还是空的，添加库存后这里会自动出现推荐。', 'Warehouse empty. Add items for suggestions.'],
    ['仓库中暂时没有可以推荐的内容。', 'Nothing to suggest yet.'],
    ['从全部库存中为你随机抽取了一项。', 'Picked randomly from your Warehouse.']
  ]],
  ['仓库·工具栏与批量操作', [
    ['模糊搜索标题、标签、备份位置、路径…', 'Search titles, tags, locations, and paths…'],
    ['仓库筛选与视图工具', 'Warehouse Filters and Views'],
    ['按标签筛选', 'Filter by tag'],
    ['全部标签', 'All tags'],
    ['按备份位置筛选', 'Filter by backup location'],
    ['全部备份位置', 'All backup locations'],
    ['按星级筛选', 'Filter by rating'],
    ['清除入库日期筛选', 'Clear inventory date filter'],
    ['全部星级', 'All ratings'],
    ['未评分', 'Unrated'],
    ['入库', 'Added'],
    ['入库日期', 'Inventory date'],
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
    ['刷新仓库', 'Refresh Warehouse'],
    ['设置仓库位置', 'Set Warehouse Location'],
    ['在文件浏览器中查看仓库', 'Open Warehouse in File Explorer'],
    ['当前仓库位置', 'Current Warehouse location'],
    ['仓库内容', 'Warehouse content'],
    ['选择当前页', 'Select current page'],
    ['批量追加标签', 'Add Tags'],
    ['批量修改备份位置', 'Change Backup Location'],
    ['删除所选', 'Delete selected'],
    ['手动新增库存', 'Add Item'],
    ['上一页', 'Previous'],
    ['下一页', 'Next'],
    ['仓库分页', 'Warehouse pagination'],
    ['选择仓库页码', 'Choose Page'],
    ['放大的仓库缩略图', 'Enlarged Warehouse thumbnail'],
    ['仓库中暂无归档记录', 'Warehouse is empty'],
    ['没有符合当前条件的仓库内容', 'No matching items'],
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
    ['未压缩入库', 'Uncompressed'],
    ['可能重复', 'Possible duplicate'],
    ['高度匹配', 'Strong Match'],
    ['相似标题', 'Similar title'],
    ['手动库存条目', 'Manual Item']
  ]],
  ['仓库·详情与整理信息', [
    ['选择一条仓库记录', 'Select a Warehouse Item'],
    ['这里会显示整理信息、完整目录、文件名、MD5、分卷信息和可用缩略图。', 'Details, files, MD5 values, volumes, and previews appear here.'],
    ['整理信息', 'Details'],
    ['标题', 'Title'],
    ['例如：摄影，旅行，待整理（用逗号分隔）', 'e.g. photography, travel, review (comma-separated)'],
    ['例如：百度网盘 / 家庭备份盘 A', 'e.g. Baidu Drive / Home backup disk A'],
    ['例如：百度网盘 / 移动硬盘 A', 'e.g. Baidu Drive / Removable disk A'],
    ['例如：旅行, 摄影', 'e.g. travel, photography'],
    ['例如：旅行, 摄影, 待复查', 'e.g. travel, photography, to review'],
    ['备份位置', 'Backup location'],
    ['备份 ·', 'Backup ·'],
    ['备注', 'Notes'],
    ['记录来源、内容特点、后续处理计划等，支持直接粘贴图片', 'Add source, details, or next steps; paste images directly'],
    ['说明这项库存是什么、在哪里，或之后准备如何处理…', 'Describe the item, its location, or next steps…'],
    ['完成管理', 'Done'],
    ['管理', 'Manage'],
    ['相似项目', 'Similar projects'],
    ['可能重复 · 相似项目', 'Possible Duplicates'],
    ['定位相似文件', 'Find Match'],
    ['重新计算', 'Recalculate'],
    ['一键加入白名单', 'Ignore Term'],
    ['相似度设置 / WHITELIST', 'SIMILARITY / IGNORE LIST'],
    ['加入相似度白名单', 'Ignore a Similarity Term'],
    ['以下词汇在相似度计算中将被忽略', 'Ignored in similarity checks'],
    ['白名单词汇', 'Ignored Term'],
    ['点击标记常用词', 'Click to ignore this term'],
    ['当前没有已关联的相似项目。', 'No linked similar items.'],
    ['压缩包名称已复制', 'Archive name copied'],
    ['解压密码已复制', 'Archive password copied'],
    ['压缩包：未生成（未压缩）', 'Archive: not created (uncompressed)'],
    ['压缩包已加密，但密码未记录', 'Encrypted · password not saved'],
    ['压缩后 未压缩', 'After compression: uncompressed'],
    ['未发现原文件', 'Original file not found'],
    ['已执行移入回收站，但回收站中未找到该文件——回收站可能已满，文件或已被永久删除', 'Not found in Recycle Bin; may be permanently deleted.'],
    ['源文件已进入回收站', 'Source moved to Recycle Bin'],
    ['源文件已移动', 'Source file moved'],
    ['原文件位置：', 'Original location:'],
    ['原文件位置', 'Original file location'],
    ['文件位置', 'File location'],
    ['任务位置', 'Task location'],
    ['复原后的原文件位置', 'Restored original file location'],
    ['打开原文件当前位置', 'Open original file location'],
    ['从回收站复原到原位置', 'Restore to Original Location'],
    ['原文件在 Windows 回收站中。要将文件从回收站移出到原位置吗？', 'Restore this file from the Recycle Bin?'],
    ['该原文件在 Windows 回收站中。要将文件从回收站移出到原位置吗？', 'Restore this file from the Recycle Bin?'],
    ['原文件已复原，并已打开原位置', 'Restored; original location opened'],
    ['已打开原文件当前位置', 'Original file location opened'],
    ['删除图片', 'Delete image'],
    ['设为项目封面', 'Set as project cover'],
    ['当前项目封面', 'Current project cover'],
    ['媒体预览', 'Media preview'],
    ['日期未知', 'Date unknown'],
    ['（旧记录，仅日期）', '(legacy record, date only)'],
    ['完整目录结构', 'Complete directory tree'],
    ['这个归档中没有文件。', 'This archive contains no files.'],
    ['无 MD5', 'No MD5'],
    ['手动库存记录 · 未关联压缩包或文件清单', 'Manual item · no archive or manifest'],
    ['这是手动库存记录', 'This is a manual inventory record'],
    ['它只保存名称、备注及整理信息，不代表程序已经生成或验证过压缩包。', 'Stores details only. No archive was created or verified.'],
    ['删除这张图片？', 'Delete this image?']
  ]],
  ['手动库存与批量整理对话框', [
    ['手动添加图片', 'Add Images'],
    ['添加图片', 'Add images'],
    ['选择项目图片', 'Choose project images'],
    ['＋ 选择项目图片', '＋ Choose project images'],
    ['也可以在这里按 Ctrl+V 粘贴图片', 'Press Ctrl+V to paste images'],
    ['移除这张图片', 'Remove this image'],
    ['手动库存 / MANUAL', 'MANUAL ITEM'],
    ['新增一条库存内容', 'Add a Warehouse Item'],
    ['名称（必填）', 'Name (required)'],
    ['备注（选填）', 'Notes (optional)'],
    ['标签（选填，逗号分隔）', 'Tags (optional, comma-separated)'],
    ['原始位置（选填，可填写网址）', 'Original Location (optional; URL allowed)'],
    ['备份位置（选填）', 'Backup location (optional)'],
    ['图片（选填，可多选）', 'Images (optional; multiple)'],
    ['文件路径或 https://…', 'File path or https://…'],
    ['添加到仓库', 'Add to Warehouse'],
    ['批量整理', 'Bulk organization'],
    ['追加标签', 'Add tags'],
    ['标签自动补全', 'Tag autocomplete'],
    ['按 Tab 补全', 'Press Tab to complete'],
    ['修改备份位置', 'Change backup location'],
    ['用逗号分隔。标签须以文字或数字开头，可使用文字、数字、空格、短横线、下划线和间隔号；单个最多 30 字。', 'Comma-separated. Start with a letter or number. Use letters, numbers, spaces, - _ ·. Max 30 characters.']
  ]],
  ['风险确认与删除对话框', [
    ['启用回收站自动处理', 'Enable Recycle Bin Automation'],
    ['确认体积异常', 'Confirm size anomaly'],
    ['清空任务列表', 'Clear task list'],
    ['批量确认重复风险', 'Confirm duplicate risks in bulk'],
    ['开启相似度计算', 'Enable similarity detection'],
    ['关闭相似度计算', 'Disable similarity detection'],
    ['全局重算相似关系', 'Rebuild All Similarity Links'],
    ['删除项目图片', 'Delete project image'],
    ['复原原文件', 'Restore original file'],
    ['未压缩入库 / CAUTION', 'UNCOMPRESSED INTAKE / CAUTION'],
    ['确认不压缩直接入库', 'Add Without Compression?'],
    ['本次入库将不会执行压缩，可能导致用户备份时出现遗漏，请确认风险。', 'No archive will be made; backups may miss this item.'],
    ['不再提示', 'Don’t show again'],
    ['确认并直接入库', 'Add Uncompressed'],
    ['把未压缩项目送入队列', 'Queue uncompressed items'],
    ['库内项目压缩 / CAUTION', 'WAREHOUSE ITEM COMPRESSION / CAUTION'],
    ['本功能仅用于给库内“未压缩项目”压缩备份使用。', 'For uncompressed Warehouse items only.'],
    ['确认并送入队列', 'Add to Queue'],
    ['压缩入库', 'Compress and archive'],
    ['更新备份位置', 'Update backup location'],
    ['更新并继续', 'Update & Continue'],
    ['保留原位置并继续', 'Keep Existing & Continue'],
    ['删除仓库项目', 'Delete Warehouse Items'],
    ['确认删除所选内容', 'Delete Selected Items?'],
    ['只有必要操作全部成功后，对应仓库记录才会删除。', 'Records delete only after all steps succeed.'],
    ['尝试将原文件位置复原', 'Restore Original Files'],
    ['仅处理仍在回收站或归档后移动位置中的原文件；复原失败时会保留对应仓库记录和压缩包。', 'Restore from Recycle Bin or move-to folder. Failures keep records and archives.'],
    ['所选项目没有可以尝试复原的原文件记录。', 'No selected items have restorable originals.']
  ]],
  ['使用说明对话框', [
    ['使用说明', 'Instructions'],
    ['使用说明 / QUICK START', 'QUICK START'],
    ['把资源添加到仓库', 'Add Items to the Warehouse'],
    ['在归档工作台中，扫描需要备份的目录，按需选择入库方式，建立本地仓库。', 'In Workbench, scan a folder and choose how to archive it.'],
    ['手动云备份压缩包', 'Back Up Archives to the Cloud'],
    ['本工具只负责本地记录，您可以将压缩包存放点设置为云盘自动同步的目录，或自行上传压缩包。', 'Local records only. Save archives in a synced folder or upload them.'],
    ['按需处理单个资源', 'Add One Item'],
    ['新手引导 · 1/6', 'GETTING STARTED · 1/6'],
    ['新手引导 · 2/6', 'GETTING STARTED · 2/6'],
    ['新手引导 · 3/6', 'GETTING STARTED · 3/6'],
    ['新手引导 · 4/6', 'GETTING STARTED · 4/6'],
    ['新手引导 · 5/6', 'GETTING STARTED · 5/6'],
    ['新手引导 · 6/6', 'GETTING STARTED · 6/6'],
    ['仓库还是空的', 'Your Warehouse is empty'],
    ['先到归档工作台选择文件夹或视频，完成第一次入库后，这里就会显示可以搜索和整理的内容。', 'Open Workbench and add a folder or video. Your items will appear here.'],
    ['首先进行收纳设置', 'Start with Archive Setup'],
    ['必须填写的只有压缩包存放位置', 'Only the Archive Folder is required'],
    ['可以设置收纳后，自动改动原文件的位置，不勾选任何选项，就不会移动', 'Move originals after archiving; leave both off to keep them.'],
    ['把内容加入队列并开始', 'Add Items and Start'],
    ['也可以直接把要收纳的内容拖拽到这里，快速开始', 'Or drop a folder or video here'],
    ['不再提示此引导', 'Don’t Show This Guide Again'],
    ['跳过引导', 'Skip guide'],
    ['进入归档工作台', 'Open Workbench'],
    ['下一步', 'Next'],
    ['也可以把单个文件夹或视频直接拖入应用，单独加入任务列表。', 'You can also drop one folder or video into the app.'],
    ['本应用会跳过主目录中的零散图片和其他文件。如需处理，请先把它们收纳到文件夹中。', 'Loose top-level files are skipped. Put them in a folder to include them.']
  ]],
  ['安全熔断对话框', [
    ['安全熔断 / SAFETY HALT', 'SAFETY STOP'],
    ['队列已立即停止', 'Queue Stopped'],
    ['已保护其余原文件', 'Remaining Originals Are Safe'],
    ['队列已立即停止，后续任务没有启动。', 'Queue stopped; later tasks not started.'],
    ['触发原因', 'What triggered the halt'],
    ['现在请检查', 'Check these now'],
    ['确认原文件是否仍在原位置', 'Check the original location'],
    ['检查 Windows 回收站是否保留了对应项目', 'Check the Windows Recycle Bin'],
    ['核对无误后，再手动重新开始队列', 'Restart only after checking the files'],
    ['自动移入回收站已经关闭', 'Automatic Recycle Bin Moves Off'],
    ['确认本提示不会自动恢复队列，也不会重新启用删除操作。', 'Closing won’t resume the queue or re-enable deletion.'],
    ['知道了，保持安全停止', 'Keep Safety Stop'],
    ['安全警告已确认；队列保持停止，自动移入回收站已关闭', 'Warning acknowledged. Queue stopped; automatic moves off.']
  ]],
  ['渲染层·提示与确认', [
    ['设置已保存', 'Settings saved'],
    ['正在扫描下一级目录，请稍候…', 'Scanning folders…'],
    ['扫描未入队', 'Not Added'],
    ['这些内容不会移动。', 'These items won’t be moved.'],
    ['正在读取完整目录和缩略图…', 'Loading files and previews…'],
    ['详情读取失败，请重新选择项目重试。', 'Couldn’t load details. Reselect and retry.'],
    ['仓库整理信息已保存', 'Warehouse details saved'],
    ['仓库已刷新', 'Warehouse refreshed'],
    ['仓库已复制并切换；原位置仍保留', 'Warehouse copied and switched; original kept.'],
    ['任务名称已复制', 'Task name copied'],
    ['已打开任务所在位置', 'Task location opened'],
    ['相似关系已重新计算', 'Similarity recalculated'],
    ['已双向移除相似关系', 'Similarity link removed both ways'],
    ['项目封面已更新', 'Project cover updated'],
    ['图片已删除，可在“撤回”中恢复', 'Image deleted. Use Undo to restore it.'],
    ['确定删除这张图片？删除后可以通过仓库顶部的“撤回”恢复。', 'Delete this image? You can restore it with Undo.'],
    ['未能加入所选内容。', 'Couldn’t add the selected item.'],
    ['已撤回最近一次仓库操作', 'Last Warehouse action undone'],
    ['缩略图读取失败', 'Couldn’t read thumbnail'],
    ['手动库存已添加', 'Manual inventory added'],
    ['单个项目最多添加 100 张图片。', 'Up to 100 images per item.'],
    ['没有等待确认的重复任务', 'No duplicate tasks need review.'],
    ['没有发现可清除的重复任务', 'No duplicate tasks to clear'],
    ['没有发现可清除的完全重复任务', 'No complete duplicate tasks to clear'],
    ['目录结构中没有可定位的相似文件或文件夹', 'No similar files or folders found.'],
    ['所选仓库内容已删除。', 'Selected Warehouse items deleted.'],
    ['当前已是最新版本', 'You are using the latest version'],
    ['正在检查…', 'Checking…'],
    ['正在读取更新包…', 'Reading update package…'],
    ['更新包已校验', 'Update package verified'],
    ['更新包已校验，等待重新启动', 'Update verified; restart pending'],
    ['正在校验更新…', 'Verifying update…'],
    ['正在下载更新…', 'Downloading update…'],
    ['自动更新未能启动，程序仍停留在当前版本', 'Update didn’t start; current version remains.'],
    ['完整性测试已经通过，但压缩前后体积比例超出安全阈值。请先人工核对日志和源项目；确认仍要入库吗？', 'Verified, but archive size is unusual. Check log/source. Add anyway?'],
    ['删除这次异常任务生成的压缩文件和缩略图？源文件会完整保留在原位置，且不会加入仓库。', 'Delete this job’s archives/previews? Original stays and isn’t added.'],
    ['从任务列表清除所有名称或标题可能重复的项目？已入库档案和源文件不会删除。', 'Remove possible name/title duplicates? Archives and originals stay.'],
    ['从任务列表清除所有完全重复项（项目完全重复或含内容完全一致的文件）？已入库档案和源文件不会删除。', 'Remove all exact duplicates from the queue? Archives and originals are kept.'],
    ['清空整个任务列表？如果当前正在运行，会停止当前任务并阻止后续任务启动。已入库档案和源文件不会删除。', 'Clear the queue? Running and later tasks stop. Archives and originals stay.'],
    ['同意任务列表中全部名称重复、标题相似或视频大小相同的风险，并让它们进入等待压缩状态？', 'Approve all duplicate warnings and queue these items?'],
    ['选择外部仓库压缩包（.zip）后，会把其中的仓库记录、缩略图和解压密码记录一并并入当前仓库。相同 ID 的记录会跳过；外部压缩包实体不会被移动或删除。是否继续？', 'Import records, previews, and passwords from a Warehouse ZIP? Existing IDs skip; ZIP unchanged.']
  ]],
  ['主进程·IPC 与文件对话框错误', [
    ['已拒绝非本地界面的请求。', 'Rejected request from non-local page.'],
    ['仓库记录标识无效。', 'Invalid Warehouse record ID.'],
    ['请选择 PNG、JPEG、WebP 或 GIF 图片。', 'Choose a PNG, JPEG, WebP or GIF image.'],
    ['单张图片不能超过约 25 MB。', 'Image limit: about 25 MB.'],
    ['图片内容无效或无法读取。', 'Invalid or unreadable image.'],
    ['界面在加载完成前已关闭。', 'The window closed before the interface finished loading.'],
    ['归档任务运行期间不能更新，请先暂停或完成当前任务。', 'Can’t update while archiving. Pause or finish first.'],
    ['队列运行期间不能修改用户数据区。', 'Can’t change data folder while queue runs.'],
    ['只允许打开 HTTP 或 HTTPS 链接。', 'Only HTTP or HTTPS links can be opened.'],
    ['复制内容过长。', 'The content to copy is too long.'],
    ['这个任务没有可打开的原文件位置。', 'No original location to open.'],
    ['没有找到指定仓库记录。', 'The Warehouse item wasn’t found.'],
    ['没有记录原文件位置，无法从回收站复原。', 'No original location; can’t restore from Recycle Bin.'],
    ['没有记录可打开的原文件当前位置。', 'No current original location to open.']
  ]],
  ['主进程·队列与核心模块（校验与错误）', [
    ['每条归档最多设置 30 个标签。', 'Each archive can have at most 30 tags.'],
    ['目录', 'Directory'],
    ['单个标签不能超过 30 个字符。', 'Tag limit: 30 characters.'],
    ['标签只能使用文字、数字、空格、短横线、下划线或间隔号，并且必须以文字或数字开头。', 'Tags: start with a letter/number; use spaces, hyphens, underscores, or middle dots.'],
    ['标题不能为空。', 'The title can’t be empty.'],
    ['标题不能超过 200 个字符。', 'Title limit: 200 characters.'],
    ['星级必须是 0 到 5 的整数。', 'Rating: integer 0–5.'],
    ['备注不能超过 5000 个字符。', 'Notes can’t exceed 5000 characters.'],
    ['备份位置不能超过 200 个字符。', 'Backup location: max 200 characters.'],
    ['解压密码最多 128 个字符，且不能包含换行或控制字符。', 'Password: max 128 characters; no line breaks or controls.'],
    ['名称不能为空。', 'The name can’t be empty.'],
    ['名称不能超过 200 个字符。', 'The name can’t exceed 200 characters.'],
    ['原始位置不能超过 2000 个字符，也不能包含换行或控制字符。', 'Original location: max 2,000 chars; no line breaks/controls.'],
    ['备份位置不能超过 200 个字符，也不能包含换行或控制字符。', 'Backup location: max 200 chars; no line breaks/controls.'],
    ['删除目标不在允许的仓库子目录内。', 'Deletion target outside allowed Warehouse folders.'],
    ['缩略图引用无效或不属于当前仓库。', 'Invalid thumbnail or wrong Warehouse.'],
    ['Windows 回收站服务不可用。', 'Windows Recycle Bin unavailable.'],
    ['系统回收站服务不可用。', 'Recycle Bin service unavailable.'],
    ['归档记录缺少压缩包目录，已拒绝删除。', 'Record lacks archive folder; deletion blocked.'],
    ['归档文件', 'Archive files'],
    ['缩略图目录', 'Thumbnails directory'],
    ['暂存磁盘', 'Staging disk'],
    ['成品磁盘', 'Output disk'],
    ['压缩暂存目录未配置，无法安全删除多卷压缩包。', 'Set a staging folder for safe volume-set deletion.'],
    ['压缩暂存目录与成品不在同一磁盘，无法保证多卷压缩包原子删除。', 'Different drives prevent atomic volume-set deletion.'],
    ['相似度排除词表位置未配置。', 'Similarity ignore list isn’t set.'],
    ['要加入白名单的词语不能包含换行或控制字符。', 'Ignore term can’t contain line breaks or controls.'],
    ['要加入白名单的词语不能为空。', 'An ignore term can’t be empty.'],
    ['要加入白名单的词语不能超过 200 个字符。', 'An ignore term can’t exceed 200 characters.'],
    ['要加入白名单的词语至少包含一个文字或数字。', 'Ignore term needs a letter or number.'],
    ['仓库撤销记录已达到上限 10 条；最早的一条记录已被移出。', 'Undo history is limited to 10 actions. The oldest action was removed.'],
    ['没有可以撤回的仓库操作。', 'Nothing to undo.'],
    ['原始仓库记录不存在，无法撤回。', 'Original Warehouse record missing; can’t undo.'],
    ['不能移除项目与自身的关系。', 'Can’t link an item to itself.'],
    ['相似项目不存在，请刷新后重试。', 'Similar item missing. Refresh and retry.'],
    ['没有找到指定归档记录。', 'Archive record not found.'],
    ['这张缩略图不存在，不能设为封面。', 'Thumbnail missing; can’t set as cover.'],
    ['这张图片不存在或已被删除。', 'Image missing or deleted.'],
    ['当前程序无法保存所选图片。', 'Can’t save selected image.'],
    ['单个项目最多手动添加 100 张图片。', 'Max 100 manually added images per item.'],
    ['请先选择仓库内容。', 'Select Warehouse items first.'],
    ['请输入要追加的标签。', 'Enter the tags to add.'],
    ['请先选择要删除的仓库内容。', 'Select Warehouse items to delete.'],
    ['部分仓库记录不存在，请刷新后重试。', 'Some Warehouse records missing. Refresh and retry.'],
    ['备份位置不能为空。', 'Backup location required.'],
    ['当前系统不支持自动从回收站复原。', 'Automatic Recycle Bin restore isn’t supported.'],
    ['没有在 Windows 回收站中找到对应原文件，或系统未能完成复原。', 'Original not found in the Recycle Bin, or restore failed.'],
    ['记录的移动目标中已找不到原文件。', 'Original missing from move destination.'],
    ['跨磁盘复原校验失败，文件数量或大小不一致。', 'Cross-drive restore failed: file count or size mismatch.'],
    ['跨磁盘复原校验失败，文件大小不一致。', 'Cross-drive restore failed: size mismatch.'],
    ['当前原文件不在可复原状态。', 'Original isn’t restorable.'],
    ['未知条目', 'Unknown entry'],
    ['仓库记录不存在。', 'Warehouse record missing.'],
    ['没有记录原文件位置，无法自动复原。', 'No original location was recorded, so it can’t be restored automatically.'],
    ['队列运行期间不能修改设置。', 'Can’t change settings while queue runs.'],
    ['队列运行期间不能修改设置', 'Can’t change settings while queue runs'],
    ['勾选“记录备份位置”后，请填写备份位置。', '“Save Backup Location” is on. Enter a location.'],
    ['解压密码最多 128 个字符，且不能包含换行或控制字符。留空表示不设置密码。', 'Password: max 128 characters; no line breaks or controls. Blank means none.'],
    ['每个视频的缩略帧数必须是 1—20 的整数。', 'Frames per video: integer 1–20.'],
    ['单个项目的缩略图上限必须是 1—500 的整数。', 'Preview limit: integer 1–500.'],
    ['压缩格式只能选择 7z 或 ZIP。', 'The archive format must be 7z or ZIP.'],
    ['压缩率等级必须是 0—9 的整数。', 'Compression level: integer 0–9.'],
    ['单卷大小必须是 64 MiB—10 GiB 之间的整数。', 'The volume size must be between 64 MiB and 10 GiB.'],
    ['小文件过滤阈值必须在 1 MB—100 GB 之间。', 'Small-file limit: 1 MB–100 GB.'],
    ['定时运行需要填写不同的开始和结束时间。', 'Schedule start and end must differ.'],
    ['请选择有效的压缩包命名方式。', 'Choose a valid archive naming mode.'],
    ['请选择有效的自动跳过后处理方式。', 'Choose a valid auto-skip action.'],
    ['请选择有效的相似度强度。', 'Choose a valid similarity strength.'],
    ['发行清单缺少关键文件完整性记录。', 'The release manifest is missing critical-file integrity records.'],
    ['发行清单版本不受支持。', 'The release manifest version is unsupported.'],
    ['归档后移动与移入回收站不能同时启用。', 'Move-to folder and Recycle Bin can’t both be enabled.'],
    ['请先确认回收站安全警告，再决定是否重新启用自动移入回收站。', 'Acknowledge Recycle Bin warning before enabling automatic moves.'],
    ['请填写归档后移动位置。', 'Choose a move-to folder.'],
    ['队列运行期间不能修改仓库位置。', 'Can’t change Warehouse folder while queue runs.'],
    ['仓库位置不能为空。', 'Warehouse folder required.'],
    ['新仓库与当前仓库不能互相包含。', 'New and current Warehouse folders overlap.'],
    ['所选仓库位置不是空目录，也不包含 warehouse.sqlite。请选择空目录或已有仓库。', 'Choose an empty folder or an existing Warehouse containing warehouse.sqlite.'],
    ['请选择导出文件位置。', 'Choose where to export the file.'],
    ['导出仓库必须保存为 .zip 压缩包。', 'Warehouse export must be a .zip file.'],
    ['导出压缩包生成失败，文件为空。', 'Exported archive is empty.'],
    ['外来仓库文件必须是 .zip 压缩包。', 'External Warehouse must be a .zip file.'],
    ['压缩包内没有找到 warehouse.sqlite。', 'warehouse.sqlite wasn’t found inside the archive.'],
    ['请选择仓库目录或 .zip 压缩包。', 'Choose a Warehouse folder or .zip file.'],
    ['所选目录不是有效的仓库目录：缺少 warehouse.sqlite。', 'Invalid Warehouse folder: warehouse.sqlite missing.'],
    ['移动位置已经存在同名项目', 'Same name at move destination'],
    ['已备份原文件存放磁盘空间不足；源项目仍保留在原位置。', 'Not enough destination space; source kept.'],
    ['跨磁盘移动复核失败，复制后的文件数量或大小不一致。', 'Cross-drive move failed: file count or size mismatch.'],
    ['跨磁盘移动复核失败，视频大小不一致。', 'Cross-drive move failed: video size mismatch.'],
    ['已验证入库，源项目已移到完成位置', 'Archived; source moved to destination.'],
    ['已验证入库，源项目已移入回收站', 'Archived; source moved to Recycle Bin.'],
    ['已验证并入库', 'Verified and cataloged'],
    ['大小异常已人工确认并入库', 'Size issue approved and archived.'],
    ['归档成功，但移动源项目失败，原位置已保留', 'Archived; source move failed, original kept.'],
    ['归档成功，但移入回收站失败', 'Archived; Recycle Bin move failed'],
    ['没有找到指定任务。', 'The specified task wasn’t found.'],
    ['当前任务不处于等待确认状态。', 'Task isn’t awaiting approval.'],
    ['当前任务没有等待确认的大小异常。', 'No size issue needs review.'],
    ['当前任务没有可删除的异常成品。', 'No unusual output to delete.'],
    ['当前没有与该项目对应的回收站安全警告。', 'No Recycle Bin warning for this task.'],
    ['当前没有可暂停的任务。', 'There is no task to pause.'],
    ['当前阶段不能暂停，请等待文件移动完成。', 'Can’t pause while files are moving.'],
    ['当前任务不能重试。', 'This task can’t be retried.'],
    ['请在当前队列结束后重试。', 'Retry after the queue finishes.'],
    ['任务已取消。', 'The task was canceled.'],
    ['任务已重新加入队列。', 'The task was queued again.'],
    ['队列已经在运行。', 'The queue is already running.'],
    ['任务列表中没有可以直接入库的项目。', 'No tasks can be added uncompressed.'],
    ['任务列表中没有可以压缩入库的项目。', 'No tasks are ready for compression.'],
    ['已经在任务列表中', 'Already in the task list'],
    ['没有可复用的原文件位置或清单', 'No reusable source or manifest'],
    ['原文件类型已经变化', 'Original file type changed'],
    ['对应的未压缩仓库项目已经不存在。', 'Uncompressed Warehouse item missing.'],
    ['所选目录不是文件夹。', 'The selected folder isn’t a folder.'],
    ['所选目录已经不存在。', 'Selected folder no longer exists.'],
    ['单项归档当前只支持文件夹或视频文件。', 'Single-item archiving: folders or videos only.'],
    ['运行中的任务不能直接移除，请先取消它。', 'Cancel a running task before removing it.'],
    ['大小异常的成品已经生成，请先确认入库，不能直接从任务列表移除。', 'Output exists. Approve or delete before removing task.'],
    ['回收站安全警告尚未确认，不能直接移除对应任务。', 'Acknowledge Recycle Bin warning before removing task.'],
    ['回收站安全警告尚未确认，队列保持停止。', 'Recycle Bin warning pending; queue stopped.'],
    ['回收站没有保留原文件，队列已停止。', 'Original missing from Recycle Bin; queue stopped.'],
    ['源项目没有进入回收站，仍保留在原位置。为避免后续项目发生永久删除，队列已安全停止。', 'Source stayed in place. Queue stopped to protect later items.'],
    ['无法确认源项目是否保留在回收站，且原位置已经不存在。队列已安全停止，请立即检查回收站。', 'Source missing from its location and unconfirmed in the Recycle Bin. Queue stopped safely; check the Recycle Bin now.'],
    ['源项目在原位置和回收站中都未找到。回收站可能已满或超出配额，文件可能已被永久删除；队列已安全停止。', 'Source missing from its location and Recycle Bin. It may be permanently deleted. Queue stopped.'],
    ['归档已入库；原文件仍在原位置，自动移入回收站已关闭', 'Archived. Original kept; automatic moves off.'],
    ['归档已入库；未能在回收站或原位置找到源文件，自动移入回收站已关闭', 'Archived. Source missing from its location and Recycle Bin; automatic moves off.'],
    ['队列状态异常，已安全停止', 'Queue error; stopped safely'],
    ['任务执行结束后仍处于等待状态，为防止重复运行已停止队列。', 'Task stayed queued after completion. Queue stopped to prevent reruns.'],
    ['检测到任务状态没有推进，已停止队列以避免重复执行。', 'Task stalled; queue stopped to prevent reruns.'],
    ['磁盘空间安全停止，等待用户处理', 'Stopped for disk space; action needed'],
    ['当前任务已暂停；程序保持打开即可稍后继续。', 'Task paused. Keep app open to resume.'],
    ['当前任务已继续运行。', 'This task resumed.'],
    ['已按要求完成一项，队列现已暂停。', 'Item finished; queue paused.'],
    ['当前可执行任务已经处理完毕。', 'All runnable tasks finished.'],
    ['当前任务完成后将暂停队列。', 'Pause after this task.'],
    ['下一项任务完成后将暂停队列。', 'Pause after next task.'],
    ['已到定时结束时间，当前任务已安全暂停。', 'Scheduled end reached; task paused safely.'],
    ['归档队列已启动。', 'The archive queue started.'],
    ['标题相似', 'Similar title'],
    ['标题一致', 'Identical title'],
    ['包含标题相似的视频', 'Similar video titles'],
    ['视频大小完全一致', 'Identical video size'],
    ['目录名相似', 'Similar folder name'],
    ['目录名完全一致', 'Identical folder name'],
    ['文件内容完全一致', 'Identical file content'],
    ['文件名相似', 'Similar file name'],
    ['没有找到指定队列项目。', 'Queue item not found.'],
    ['队列相似报告已关闭。', 'Queue similarity reports are off.'],
    ['等待内容完全一致核验', 'Waiting for exact-match check'],
    ['项目与仓库中的现有项目完全一致，已按设置自动跳过。', 'Exact Warehouse match; auto-skipped.'],
    ['项目的原始位置与完整目录结构均和仓库记录一致，已按设置自动跳过。', 'The source location and complete directory structure match a Warehouse record; auto-skipped.'],
    ['用户已确认内容完全一致提示，任务重新进入队列。', 'Exact match approved; task requeued.'],
    ['用户已确认内容完全一致提示，任务复用已生成清单并重新进入队列。', 'Exact match approved. Manifest reused; task requeued.'],
    ['用户已确认相似报告，任务复用已生成清单并重新进入队列。', 'Similarity approved. Manifest reused; task requeued.'],
    ['用户已确认名称或相似项目提示；内容完全一致核验仍将在生成完整 MD5 后执行。', 'Duplicate warning approved. Exact-content checks will still run after MD5 generation.'],
    ['名称重复', 'Duplicate name'],
    ['名称可能重复', 'Name may be duplicated'],
    ['存在内容完全一致的文件', 'Identical-content files exist'],
    ['直接入库', 'add without compression'],
    ['压缩', 'compression'],
    ['已跳过链接或重解析点', 'Skipped links or reparse points'],
    ['根级非视频文件', 'Root-level non-video file'],
    ['仓库记录保存失败', 'Couldn’t save the Warehouse record'],
    ['归档成品发布后的处理失败', 'Post-publication archive processing failed'],
    ['重复风险', 'Duplicate risk'],
    ['归档任务标识无效，无法登记成品所有权。', 'Invalid archive task ID; output ownership could not be recorded.'],
    ['归档成品名称无效，无法登记成品所有权。', 'Invalid archive output name; output ownership could not be recorded.'],
    ['归档成品超出最终输出目录，无法登记成品所有权。', 'Archive output is outside the final output folder; ownership could not be recorded.'],
    ['跨磁盘恢复副本校验失败。', 'Cross-drive recovery copy verification failed.'],
    ['归档成品发布凭据缺少最终目录或暂存目录，已拒绝自动补偿。', 'Archive publication credentials lack the final or staging folder; automatic recovery was blocked.'],
    ['归档成品发布凭据无效，已拒绝自动补偿。', 'Invalid archive publication credentials; automatic recovery was blocked.'],
    ['归档成品发布凭据超出最终输出目录，已拒绝自动补偿。', 'Archive publication credentials point outside the final output folder; automatic recovery was blocked.']
  ]],
  ['主进程·队列与核心模块（完成与状态提示）', [
    ['已验证入库；因回收站安全熔断，源项目保留在原位置', 'Archived; source kept after Recycle Bin safety stop.'],
    ['已验证入库；因队列正在停止，源项目已保留', 'Archived; source kept while queue stops.'],
    ['已取消，源文件未修改', 'Canceled; source wasn’t changed'],
    ['已取消，成品已移回恢复目录，源文件未修改', 'Canceled; output moved to the recovery folder and source files were not changed'],
    ['处理失败，可重试', 'Failed; retry available'],
    ['已验证入库并复制到完成位置，但原位置副本未能删除，请手动核对', 'Archived and copied to the destination, but the original copy could not be removed. Check both locations manually.'],
    ['归档执行器没有返回本任务的发布凭据；为避免误删用户文件，成品未自动移动。', 'The archiver did not return publication credentials for this task. Output was not moved automatically, protecting user files.'],
    ['未提交的本任务生成物已清理', 'Uncommitted output for this task was cleaned up'],
    ['归档已入库，源文件后处理已完成，但仓库状态保存失败；请查看日志且不要重试', 'The archive and source cleanup completed, but the Warehouse state could not be saved. Check the log and do not retry.'],
    ['异常成品已移入回收站，源项目保持原位', 'Bad archive recycled; source kept.'],
    ['任务已生成清单和缩略图并直接入库；未生成压缩包，原文件保持原位。', 'Added uncompressed; manifest/previews created, original kept.'],
    ['库内未压缩项目已完成压缩，原仓库记录已升级。', 'Uncompressed item archived; record upgraded.'],
    ['任务已完成完整性测试并成功入库。', 'Verified and added to Warehouse.'],
    ['已生成完整清单并直接入库（未压缩）', 'Manifest added without compression'],
    ['库内项目压缩', 'Warehouse item compression'],
    ['回收站复核暂时不可用', 'Recycle Bin recheck unavailable'],
    ['回收站安全熔断期间未执行源文件后处理。', 'Source cleanup skipped during Recycle Bin stop.']
  ]],
  ['主进程·更新与媒体', [
    ['发行源返回了无法识别的版本号。', 'Invalid version from release source.'],
    ['内置更新来源配置版本不受支持，已安全跳过 CNB 回退。', 'The built-in update-source configuration version is unsupported; CNB fallback was safely skipped.'],
    ['CNB 回退配置使用了不受支持的版本发现方式。', 'CNB fallback uses an unsupported version-discovery method.'],
    ['未配置 CNB 最新版本地址和发布页，已安全跳过 CNB 回退。', 'CNB latest-version and Releases URLs are not configured; CNB fallback was safely skipped.'],
    ['CNB API 回退配置不完整；必须同时配置最新 Release API、历史 API 和发布页。', 'CNB API fallback requires the latest Release API, history API, and Releases page.'],
    ['CNB 公开发布页回退配置不完整；必须同时配置 latest 跳转地址和发布页。', 'CNB public-page fallback requires both the latest redirect and Releases page.'],
    ['当前运行环境不支持联网检查更新。', 'Online update checks aren’t supported here.'],
    ['等待主程序退出', 'Waiting for app to exit'],
    ['主程序在 90 秒内没有退出。', 'App didn’t exit within 90 seconds.'],
    ['已创建程序文件回滚副本。', 'Program rollback copy created.'],
    ['更新包中缺少 HamsterArchiver.exe。', 'HamsterArchiver.exe is missing from the update package.'],
    ['新版本未在 45 秒内完成启动验证。', 'New version failed startup check in 45 s.'],
    ['更新验证成功。', 'The update was validated.'],
    ['已恢复旧版本程序文件。', 'Previous program files restored.'],
    ['SHA256 摘要地址不是受信任的 GitHub HTTPS 地址。', 'The SHA256 digest URL isn’t a trusted GitHub HTTPS address.'],
    ['SHA256 摘要地址不是受信任的 CNB HTTPS 地址。', 'The SHA256 digest URL isn’t a trusted CNB HTTPS address.'],
    ['更新包地址不是受信任的 GitHub HTTPS 地址。', 'Untrusted GitHub HTTPS update URL.'],
    ['更新包地址不是受信任的 CNB HTTPS 地址。', 'Untrusted CNB HTTPS update URL.'],
    ['CNB 更新元数据缺少受信任的来源标记。', 'CNB metadata lacks a trusted-source marker.'],
    ['CNB 更新元数据与本机信任配置不一致。', 'CNB metadata doesn’t match local trust settings.'],
    ['当前运行环境不支持流式下载更新包。', 'Streaming updates aren’t supported here.'],
    ['更新包目录结构无效，找不到程序文件。', 'Invalid update layout; program files missing.'],
    ['自动更新目前仅支持 Windows 便携版。', 'Auto-update supports portable Windows only.'],
    ['从压缩包更新目前仅支持 Windows 便携版。', 'ZIP updates support portable Windows only.'],
    ['请选择 .zip 格式的新版本压缩包。', 'Choose a new-version package in .zip format.'],
    ['所选更新包已经不存在。', 'Selected update package not found.'],
    ['所选更新包不是文件。', 'Selected update isn’t a file.'],
    ['更新包发行清单版本不受支持。', 'Unsupported update manifest version.'],
    ['所选更新包不是 Windows x64 便携版。', 'Selected package isn’t portable Windows x64.'],
    ['更新包发行清单中的版本号无效。', 'Invalid version in update manifest.'],
    ['这个 Release 没有可用的 Windows 更新包。', 'This release has no usable Windows update package.'],
    ['Release 缺少 SHA256 摘要，已停止更新。', 'Release lacks SHA256; update stopped.'],
    ['更新包 SHA256 校验失败，文件可能已损坏。', 'Update SHA256 failed; file may be corrupt.'],
    ['更新包版本与 Release 标签不一致。', 'Update version doesn’t match release tag.'],
    ['FFmpeg 无法读取有效的视频时长或画面尺寸。', 'FFmpeg couldn’t read video duration or size.'],
    ['更新完成提示文件不在受信任的用户数据更新目录中。', 'The update-completion notice is outside the trusted user-data update folder.'],
    ['更新完成提示版本不受支持。', 'The update-completion notice version is unsupported.'],
    ['CNB 下载信任配置不可用。', 'CNB download trust configuration is unavailable.'],
    ['CNB 最新 Release API', 'CNB latest Release API'],
    ['CNB Release 历史 API', 'CNB Release history API'],
    ['CNB 发布页', 'CNB Releases page'],
    ['SHA256 摘要地址', 'SHA256 digest URL'],
    ['更新包地址', 'Update package URL'],
    ['请求超时', 'Request timed out'],
    ['CNB latest 跳转缺少 Location', 'CNB latest redirect is missing the Location header'],
    ['CNB latest 跳转地址无效', 'CNB latest redirect URL is invalid'],
    ['CNB latest 跳转离开了配置的公开 Release 页面', 'CNB latest redirect left the configured public Releases page'],
    ['CNB latest 跳转缺少有效版本标签', 'CNB latest redirect does not contain a valid version tag'],
    ['请选择名称符合 HamsterArchiver-Setup-vX.Y.Z-win-x64.exe 的安装程序。', 'Choose an installer named HamsterArchiver-Setup-vX.Y.Z-win-x64.exe.'],
    ['安装程序版本与 Release 标签不一致。', 'The installer version does not match the Release tag.'],
    ['安装版自动更新目前仅支持 Windows。', 'Automatic installed-app updates are supported on Windows only.'],
    ['这个 Release 没有可用的 Windows 安装程序。', 'This Release has no usable Windows installer.'],
    ['Release 缺少安装程序 SHA256 摘要，已停止更新。', 'The Release lacks an installer SHA256 digest; update stopped.'],
    ['安装程序 SHA256 校验失败，文件可能已损坏。', 'Installer SHA256 verification failed; the file may be corrupt.'],
    ['从安装程序更新目前仅支持 Windows。', 'Installer-based updates are supported on Windows only.'],
    ['所选安装程序已经不存在。', 'The selected installer no longer exists.'],
    ['所选安装程序不是文件。', 'The selected installer is not a file.']
  ]],
  ['主进程·存储与路径', [
    ['不能把磁盘根目录设为用户数据区。', 'Data folder can’t be a drive root.'],
    ['软件主目录不能为空。', 'The application folder can’t be empty.'],
    ['用户数据位置文件已损坏，请恢复 user-data-location.json 后再启动。', 'The user-data location file is damaged. Restore user-data-location.json before starting the app.'],
    ['用户数据位置文件没有配置有效目录，请恢复 user-data-location.json 后再启动。', 'The user-data location file does not contain a valid folder. Restore user-data-location.json before starting the app.'],
    ['用户数据位置不能使用依赖当前工作目录的裸盘符。', 'The user-data location can’t be a bare drive letter that depends on the current working folder.'],
    ['用户数据位置不能直接指向磁盘根目录。', 'The user-data location can’t point directly to a drive root.'],
    ['所选目录包含未完成的数据迁移。请保留原数据，并改用新的空目录或先人工核对该目录。', 'The selected folder contains an unfinished data migration. Keep the original data and choose a new empty folder, or inspect this folder manually first.'],
    ['新旧用户数据区不能互相包含。', 'New and old data folders can’t overlap.'],
    ['所选目录不是空目录，也没有找到可识别的 Hamster Archiver 用户数据。', 'The selected folder is neither empty nor recognizable Hamster Archiver user data.'],
    ['用户数据布局无效。', 'The user data layout is invalid.'],
    ['请选择需要备份的目录、文件夹或视频。', 'Choose a folder or video to back up.'],
    ['暂存目录不能与所选源项目互相包含。', 'Staging folder can’t overlap the source.'],
    ['压缩包存储点不能与所选源项目互相包含。', 'Archive output can’t overlap the source.'],
    ['仓库位置不能与所选源项目互相包含。', 'Warehouse folder can’t overlap the source.'],
    ['归档后移动位置不能与源项目互相包含。', 'Move-to folder can’t overlap the source.'],
    ['当前扫描目录、暂存目录、压缩包存储点和仓库位置不能为空。', 'Scan, staging, archive, and Warehouse folders are required.'],
    ['暂存目录与库目录不能互相包含。', 'Staging and library folders overlap.'],
    ['仓库位置不能与暂存目录或压缩包存储点互相包含。', 'Warehouse folder can’t overlap staging or archive output.'],
    ['启用归档后移动时，必须填写移动位置。', 'Choose move-to folder.'],
    ['归档后移动位置不能与源项目、暂存目录、成品目录或仓库位置互相包含。', 'Move-to folder can’t overlap source, staging, output, or Warehouse.'],
    ['7-Zip 路径不是文件。', 'The 7-Zip path isn’t a file.'],
    ['源文件在扫描后发生变化，请重新扫描后再归档。', 'Source changed after scan; rescan before archiving.'],
    ['没有可安全读取并归档的文件。', 'No readable files to archive.'],
    ['没有可安全读取并入库的文件。', 'No readable files to add.'],
    ['7-Zip 成功退出，但没有找到输出压缩包。', '7-Zip exited, but no output archive was found.'],
    ['压缩包或原始文件大小无效', 'Archive or original size is invalid'],
    ['压缩包比原始内容大超过 5%', 'Archive is over 5% larger than source'],
    ['压缩后体积不足原始内容的 1%', 'Archive is under 1% of source size'],
    ['自动复原回收站内容仅支持 Windows。', 'Automatic Recycle Bin restoration is Windows-only.'],
    ['原文件位置已经存在同名内容，无法从回收站复原。', 'Same-named item at the original location. Can’t restore.'],
    ['无效的进程编号。', 'Invalid process id.']
  ]],
  ['设置·相似度计算', [
    ['相似度计算', 'Similarity detection'],
    ['默认开启 · 标准', 'Enabled by default · Standard'],
    ['启用相似度计算', 'Enable similarity detection'],
    ['关闭相似度计算，不会清空旧有相似度关系，新入库项目不再计算相似度。', 'Turning this off keeps existing links but stops checking new items.'],
    ['开启相似度计算后，新入库项目会自动与老入库项目对比计算相似度。', 'New items will be checked against existing Warehouse items.'],
    ['相似度计算已开启', 'Similarity detection enabled'],
    ['相似度计算已关闭', 'Similarity detection disabled'],
    ['相似度强度', 'Similarity strength'],
    ['越高越不容易误判；切换后不会自动重算已有相似关系。', 'Higher values reduce false matches; existing links stay.'],
    ['宽松', 'Relaxed'],
    ['标准', 'Balanced'],
    ['严格', 'Strict'],
    ['全局重算', 'Recalculate everything'],
    ['按当前强度重算整个仓库的相似关系，每个项目都会重新计算。', 'Rebuild similarity links for every Warehouse item.'],
    ['计算量较大，可能出现卡顿。确定要重算整个仓库的相似关系吗？', 'This may briefly freeze the app. Rebuild all similarity links?'],
    ['相似关系已全部重算', 'All similarity links rebuilt'],
    ['队列运行期间不能重算相似度。', 'Can’t recalculate while queue runs.']
  ]]
];

function countNoun(count, singular, plural = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : plural}`;
}

const patternSections = [
  ['相似度·重算进度', [
    [/^相似度强度已切换为“(.+)”；已有关系不会自动重算$/, 'Similarity set to “$1”; existing links unchanged.', { translateCaptures: [1] }],
    [/^相似度引擎已更新（强度：(.+)），正在后台重建相似项目关系…$/, 'Similarity engine updated ($1); rebuilding links in the background…', { translateCaptures: [1] }],
    [/^正在重算 (\d+)% · 预计剩余 (\d+) 秒$/, 'Recalculating $1% · about $2 s remaining'],
    [/^正在重算 (\d+)%$/, 'Recalculating $1%'],
    [/^重算完成 · 用时 ([\d.]+) 秒$/, 'Done in $1 s'],
    [/^已重算 (\d+) \/ (\d+) 项 · 正在重算相似关系$/, ([count, total]) => `Recalculated ${count} / ${countNoun(total, 'item')} · computing relations`],
    [/^已重算 (\d+) \/ (\d+) 项$/, ([count, total]) => `Recalculated ${count} / ${countNoun(total, 'item')}`]
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
    [/^已选择 (\d+) 项$/, ([count]) => `Selected ${countNoun(count, 'item')}`],
    [/^已选 (\d+) 项$/, ([count]) => `Selected ${countNoun(count, 'item')}`],
    [/^(\d+) 个子目录 · 未压缩$/, ([count]) => `${countNoun(count, 'subfolder')} · uncompressed`],
    [/^(\d+) 个子目录 · (.+)$/, ([count, detail]) => `${countNoun(count, 'subfolder')} · ${detail}`, { translateCaptures: [2] }],
    [/^(\d+) 个文件 · (\d+) 卷$/, ([files, volumes]) => `${countNoun(files, 'file')} · ${countNoun(volumes, 'volume')}`],
    [/^(\d+) 个文件$/, ([count]) => countNoun(count, 'file')],
    [/^(\d+) 个子目录$/, ([count]) => countNoun(count, 'subfolder')],
    [/^(\d+) 项$/, ([count]) => countNoun(count, 'item')],
    [/^第 (\d+) 帧 · (\d+) 秒$/, 'Frame $1 · $2 s'],
    [/^(\d+) 星$/, ([count]) => countNoun(count, 'star')],
    [/^选择 (.+)$/, 'Select $1'],
    [/^打开任务位置 (.+)$/, 'Open task location: $1'],
    [/^复制任务名 (.+)$/, 'Copy task name: $1'],
    [/^移除与“(.+)”的相似关系$/, 'Remove the similarity with “$1”'],
    [/^(\d+) 个普通归档的压缩包将移入 Windows 回收站$/, ([count]) => `Move ${countNoun(count, 'archive')} to the Recycle Bin`],
    [/^(\d+) 个未压缩库存只删除仓库记录，原文件保持不变$/, ([count]) => `${countNoun(count, 'uncompressed item')}: ${Number(count) === 1 ? 'record deleted' : 'records deleted'}; originals kept.`],
    [/^(\d+) 条手动库存记录将被移除$/, ([count]) => `Remove ${countNoun(count, 'manual item')}`],
    [/^原文件名：/, 'Original name:'],
    [/^原始大小 /, 'Original size'],
    [/^原始 /, 'Original'],
    [/^压缩包：/, 'Archive:'],
    [/^压缩后 /, 'After compression'],
    [/^备份 · (.+)$/, 'Backup · $1'],
    [/^可能重复 · (\d+) 个相似项$/, ([count]) => `Possible duplicate · ${countNoun(count, 'similar item')}`],
    [/^备份位置：/, 'Backup location:'],
    [/^入库 (.+)$/, 'Added $1'],
    [/ · 入库 /, '· Added'],
    [/^入库日期：(.+) · 清除$/, 'Inventory date: $1 · Clear'],
    [/^入库日期：/, 'Inventory date:'],
    [/^原始名称：/, 'Original name:'],
    [/^共 (\d+) 项$/, ([count]) => `${countNoun(count, 'item')} total`],
    [/^同一视频 · (\d+) 帧 · 平均取样/, ([count]) => `Same video · ${countNoun(count, 'frame')} · evenly sampled`],
    [/^媒体预览 · (\d+) 张$/, ([count]) => `Media preview · ${countNoun(count, 'image')}`],
    [/^(.+) · 尚未到达$/, '$1 · Not reached yet'],
    [/^(.+) · (\d+) 项库存 · (.+) GB$/, ([date, count, size]) => `${date} · ${countNoun(count, 'inventory item')} · ${size} GB`],
    [/^(.+) 的封面$/, 'Cover of $1'],
    [/^(.+)（旧记录，仅日期）$/, '$1 (legacy record, date only)'],
    [/^已暂停 · /, 'Paused ·'],
    [/^低于过滤阈值 (.+) MB$/, 'Below the $1 MB filter threshold'],
    [/^手动图片 (\d+)$/, 'Manual image $1'],
    [/^已移动到：(.+)$/, 'Moved to: $1'],
    [/^记录了 (\d+) 个根级跳过项（非视频、链接或无法读取的内容），当前不会自动移动。$/, ([count]) => `Skipped ${countNoun(count, 'top-level non-video/link/unreadable item')}; not moved.`],
    [/^卡顿规避：(\d+) 个文件中选取 (\d+) 个代表文件记录 MD5、计算文件相似度。$/, ([total, selected]) => `Performance mode: using ${selected} of ${countNoun(total, 'file')} for MD5 and similarity checks.`],
    [/^卡顿规避：已跳过 (\d+) 个小于 (\d+) KB 的极小文件，不计算 MD5。$/, ([count, limit]) => `Performance: skipped MD5 for ${countNoun(count, 'file')} under ${limit} KB.`],
    [/^内容完全一致补充核验未完成，继续使用常规重复保护：(.+)$/, 'Extra exact-match check failed; standard protection remains: $1', { translateCaptures: [1] }],
    [/^内容完全一致核验前源文件发生变化：(.+)$/, 'Source changed before exact-match check: $1'],
    [/^内容完全一致核验期间源文件发生变化：(.+)$/, 'Source changed during exact-match check: $1'],
    [/^已验证成品发布完成：同盘重命名 ([\d.]+) 个文件，用时 ([\d.]+) 毫秒。$/, ([count, milliseconds]) => `Archive published: renamed ${countNoun(count, 'file')} on the same drive in ${milliseconds} ms.`],
    [/^已验证成品发布完成：跨盘复制 ([\d.]+) 个文件，用时 ([\d.]+) 毫秒。$/, ([count, milliseconds]) => `Archive published: copied ${countNoun(count, 'file')} across drives in ${milliseconds} ms.`]
  ]],
  ['进度与剩余时间', [
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 分钟$/, '$1/$2 done · ~$3 min left'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 小时 (\d+) 分钟$/, '$1/$2 done · ~$3h $4m left'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (\d+) 小时$/, '$1/$2 done · ~$3h left'],
    [/^已完成 (\d+)\/(\d+) 项 · 预计还需 (.+)$/, '$1/$2 done · ~$3 left', { translateCaptures: [3] }],
    [/^(\d+) 分钟$/, ([count]) => countNoun(count, 'minute')],
    [/^(\d+) 小时 (\d+) 分钟$/, ([hours, minutes]) => `${countNoun(hours, 'hour')} ${countNoun(minutes, 'minute')}`],
    [/^(\d+) 小时$/, ([count]) => countNoun(count, 'hour')],
    [/^正在统计 (.+)（(\d+)\/(\d+)）…$/, 'Scanning $1 ($2/$3)…'],
    [/^正在生成 MD5：/, 'Generating MD5:']
  ]],
  ['仓库与分页', [
    [/^第 (\d+) \/ (\d+) 页 · 共 (\d+) 项$/, ([page, pages, count]) => `Page ${page} / ${pages} · ${countNoun(count, 'item')} total`],
    [/^第 (\d+) \/ (\d+) 页$/, 'Page $1 / $2'],
    [/^仓库：/, 'Warehouse:'],
    [/^已添加 (\d+) 张图片$/, ([count]) => `Added ${countNoun(count, 'image')}`],
    [/^已为 (\d+) 项追加标签$/, ([count]) => `Added tags to ${countNoun(count, 'item')}`],
    [/^已修改 (\d+) 项的备份位置$/, ([count]) => `Updated backup location for ${countNoun(count, 'item')}`],
    [/^已删除 (\d+) 项$/, ([count]) => `Deleted ${countNoun(count, 'item')}`],
    [/^已删除 (\d+) 项；(\d+) 项失败：(.+)$/, ([deleted, failed, reason]) => `Deleted ${countNoun(deleted, 'item')}; ${countNoun(failed, 'item')} failed: ${reason}`, { translateCaptures: [3] }]
  ]],
  ['批量与清理结果', [
    [/^已清除 (\d+) 个已完成任务$/, ([count]) => `Cleared ${countNoun(count, 'completed task')}`],
    [/^已清除 (\d+) 个已取消任务$/, ([count]) => `Cleared ${countNoun(count, 'canceled task')}`],
    [/^已清除 (\d+) 个完全重复任务$/, ([count]) => `Cleared ${countNoun(count, 'complete duplicate task')}`],
    [/^已清除 (\d+) 个可能重复的任务$/, ([count]) => `Cleared ${countNoun(count, 'possible duplicate task')}`],
    [/^已确认 (\d+) 个重复或相似任务$/, ([count]) => `Approved ${countNoun(count, 'duplicate/similar task')}`],
    [/^已并入 (\d+) 条记录，跳过 (\d+) 条已存在记录$/, ([imported, skipped]) => `Imported ${countNoun(imported, 'record')}; skipped ${countNoun(skipped, 'existing record')}`],
    [/^没有可并入的新记录，已跳过 (\d+) 条$/, ([count]) => `No new records to import; skipped ${countNoun(count, 'existing record')}`],
    [/^已打开相似度排除词表（当前 (\d+) 个词）$/, ([count]) => `Opened similarity ignore list (${countNoun(count, 'term')})`],
    [/^已重新载入 (\d+) 个排除词，并更新相似项目关系$/, ([count]) => `Reloaded ${countNoun(count, 'ignore term')}; similarity updated.`],
    [/^“(.+)”已加入相似度白名单；已有关系不会自动重算$/, 'Added “$1” to ignore list; existing links unchanged.'],
    [/^“(.+)”已在相似度白名单中$/, '“$1” is already ignored'],
    [/^手动库存已添加，并保存 (\d+) 张图片$/, ([count]) => `Manual inventory added with ${countNoun(count, 'image')}`],
    [/^已通过(.+)加入 (\d+) 个任务$/, ([source, count]) => `Added ${countNoun(count, 'task')} via ${source}`, { translateCaptures: [1] }],
    [/^没有可加入的文件夹或视频（(.+)）$/, 'No folders or videos to add ($1)', { translateCaptures: [1] }],
    [/^仓库压缩包已导出：(.+)$/, 'Warehouse archive exported: $1'],
    [/^已切换仓库位置$/, 'Warehouse location switched'],
    [/^(\d+) 个项目未能加入队列：(.+)；(\d+) 个已加入队列$/, ([failed, reason, queued]) => `${countNoun(failed, 'item')} couldn’t be queued: ${reason}; ${countNoun(queued, 'item')} queued`, { translateCaptures: [2] }],
    [/^(\d+) 个项目未能加入队列；(\d+) 个已加入队列$/, ([failed, queued]) => `${countNoun(failed, 'item')} couldn’t be queued; ${countNoun(queued, 'item')} queued`],
    [/^已将 (\d+) 个库内未压缩项目送入队列$/, ([count]) => `Queued ${countNoun(count, 'uncompressed Warehouse item')}`],
    [/^所选内容中没有可加入队列的未压缩项目$/, 'No selected uncompressed items to queue'],
    [/^所选未压缩项目中有 (\d+) 项已经记录了不同的备份位置。本次压缩入库设置为「(.+)」。是否用本次设置更新这些项目的备份位置？$/, ([count, location]) => `${countNoun(count, 'item')} ${Number(count) === 1 ? 'uses' : 'use'} another backup location. Use “${location}” instead?`],
    [/^其中 (\d+) 项记录为已移动或已进入回收站；复原失败时会保留对应仓库记录和压缩包。$/, ([count]) => `${countNoun(count, 'item')} ${Number(count) === 1 ? 'has' : 'have'} a moved or recycled original. If restoration fails, the corresponding Warehouse records and archives will be kept.`],
    [/^从任务列表移除所选 (\d+) 项？已入库档案和源文件不会删除。$/, ([count]) => `Remove ${countNoun(count, 'selected task')}? Archives and originals stay.`],
    [/^已从任务列表移除 (\d+) 项；归档库记录不受影响。$/, ([count]) => `Removed ${countNoun(count, 'task')}; Warehouse records unchanged.`],
    [/^已清除 (\d+) 个已完成任务；仓库记录、压缩包和源文件均未删除。$/, 'Cleared $1 completed; records, archives, originals kept.'],
    [/^已清除 (\d+) 个已取消任务；仓库记录、压缩包和源文件均未删除。$/, 'Cleared $1 canceled; records, archives, originals kept.'],
    [/^任务列表已清理；(\d+) 个安全或大小异常任务仍等待确认。$/, ([count]) => `Queue cleaned; ${countNoun(count, 'safety/size item')} still ${Number(count) === 1 ? 'needs' : 'need'} review.`],
    [/^任务列表已清空；已入库档案和源文件均未删除。$/, 'Queue cleared; archives and originals kept.'],
    [/^已把 (\d+) 个未压缩仓库项目送入队列，标记为“库内项目压缩”。$/, ([count]) => `Queued ${countNoun(count, 'item')} for Warehouse compression.`],
    [/^已批量确认 (\d+) 个重复或相似任务。$/, ([count]) => `Approved ${countNoun(count, 'duplicate/similar task')}.`],
    [/^已选择不压缩直接入库，共 (\d+) 个任务；原文件将保留在原位置。$/, ([count]) => `Add without compression selected for ${countNoun(count, 'task')}; sources stay in place.`],
    [/^已选择压缩入库，共 (\d+) 个任务。$/, ([count]) => `Compression selected for ${countNoun(count, 'task')}.`],
    [/^该项目只有 ([\d.]+) MB，低于当前 (\d+) MB 的入库阈值。$/, 'This item is only $1 MB, below the current $2 MB minimum item size.'],
    [/^已添加单项任务：(.+)$/, 'Added single task: $1'],
    [/^未能复用已有清单进行即时内容完全一致核验，将在队列运行时重新计算 MD5：(.+)$/, 'Manifest reuse failed; MD5 will be recalculated: $1', { translateCaptures: [1] }]
  ]],
  ['仓库操作与撤回', [
    [/^撤回：(.+)$/, 'Undo: $1', { translateCaptures: [1] }],
    [/^已撤回：(.+)。$/, 'Undone: $1.', { translateCaptures: [1] }],
    [/^修改“(.+)”的整理信息$/, 'Edit details for “$1”'],
    [/^修改“(.+)”的封面$/, 'Change the cover of “$1”'],
    [/^移除“(.+)”与“(.+)”的相似关系$/, 'Remove similarity between “$1” and “$2”'],
    [/^删除“(.+)”的图片$/, 'Delete images of “$1”'],
    [/^为“(.+)”添加图片$/, 'Add images to “$1”'],
    [/^新增手动库存“(.+)”$/, 'Add manual inventory “$1”'],
    [/^为 (\d+) 项追加标签$/, ([count]) => `Add tags to ${countNoun(count, 'item')}`],
    [/^批量修改 (\d+) 项备份位置$/, ([count]) => `Change ${countNoun(count, 'backup location')}`],
    [/^已重新计算“(.+)”的相似项目，并同步更新对应关系。$/, 'Rebuilt similar items for “$1” and synced links.'],
    [/^已双向移除“(.+)”与“(.+)”的相似关系。$/, 'Removed link between “$1” and “$2”.'],
    [/^已更新仓库条目“(.+)”的整理信息。$/, 'Updated organization details of “$1”.'],
    [/^已更新仓库条目“(.+)”的封面。$/, 'Updated the cover of “$1”.'],
    [/^已删除图片：(.+)$/, 'Deleted image: $1'],
    [/^已手动新增库存“(.+)”。$/, 'Added manual inventory “$1”.'],
    [/^已为仓库条目“(.+)”添加图片。$/, 'Added images to “$1”.'],
    [/^已删除手动库存“(.+)”。$/, 'Deleted manual inventory “$1”.'],
    [/^已删除外部仓库记录“(.+)”；外部压缩包保留在原位置。$/, 'Deleted imported record “$1”; external archive kept.'],
    [/^已删除仓库内容“(.+)”；对应归档已移入 Windows 回收站。$/, 'Deleted “$1”; its archives were moved to the Windows Recycle Bin.'],
    [/^已删除未压缩仓库内容“(.+)”；原文件保持不变。$/, 'Deleted uncompressed item “$1”; original kept.'],
    [/^已把原文件复原到：(.+)$/, 'Original restored to $1'],
    [/^已把 (\d+) 条仓库内容的备份位置修改为：(.+)。$/, ([count, location]) => `Changed ${countNoun(count, 'backup location')} to: ${location}`],
    [/^已为 (\d+) 条仓库内容追加标签：(.+)$/, ([count, tags]) => `Added tags to ${countNoun(count, 'Warehouse item')}: ${tags}`],
    [/^“(.+)”追加后会超过 30 个标签。$/, '“$1” would exceed 30 tags.'],
    [/^仓库已复制到：(.+)。原仓库保留在：(.+)。$/, 'Warehouse copied to $1; original at $2.'],
    [/^已切换到现有仓库：(.+)。$/, 'Switched to Warehouse: $1'],
    [/^仓库已导出为压缩包：(.+)$/, 'Warehouse exported: $1'],
    [/^已并入外部仓库 (\d+) 条，跳过 (\d+) 条已存在记录。$/, ([imported, skipped]) => `Imported ${countNoun(imported, 'external record')}; skipped ${countNoun(skipped, 'existing record')}.`],
    [/^外部仓库没有可并入的新记录；已存在 (\d+) 条。$/, ([count]) => `No new external records; ${countNoun(count, 'record')} already ${Number(count) === 1 ? 'exists' : 'exist'}.`],
    [/^所选 (\d+) 项：$/, ([count]) => `Selected ${countNoun(count, 'item')}:`]
  ]],
  ['扫描与文件校验', [
    [/^开始扫描主目录：(.+)$/, 'Scanning source: $1'],
    [/^开始扫描目录：(.+)$/, 'Scanning folder: $1'],
    [/^扫描完成：新增 (\d+) 个任务，过滤 (\d+) 个小项目，记录 (\d+) 个根级跳过项。$/, ([added, filtered, skipped]) => `Scan complete: ${countNoun(added, 'task')} added; ${countNoun(filtered, 'small item')} filtered; ${countNoun(skipped, 'top-level item')} skipped.`],
    [/^(\d+) 个低于 ([\d.]+) MB 的小项目$/, ([count, limit]) => `${countNoun(count, 'small item')} below ${limit} MB`],
    [/^(\d+) 个根目录非视频文件$/, ([count]) => countNoun(count, 'root-level non-video file')],
    [/^(\d+) 个链接或重解析点$/, ([count]) => countNoun(count, 'link or reparse point', 'links or reparse points')],
    [/^(\d+) 个无法读取的项目$/, ([count]) => countNoun(count, 'unreadable item')],
    [/^(\d+) 个不支持的项目$/, ([count]) => countNoun(count, 'unsupported item')],
    [/^扫描时跳过无法读取的内容：(.+)（(.+)）$/, 'Skipped unreadable item: $1 ($2)', { translateCaptures: [2] }],
    [/^“(.+)”不是支持的 PNG、JPEG、WebP 或 GIF 图片。$/, '“$1” is not a supported PNG, JPEG, WebP, or GIF image.'],
    [/^“(.+)”超过 25 MB。$/, '“$1” exceeds the 25 MB limit.'],
    [/^无法读取“(.+)”。$/, 'Couldn’t read “$1”.'],
    [/^已跳过无法读取的目录：(.+)（(.+)）$/, 'Skipped the unreadable folder: $1 ($2)', { translateCaptures: [2] }],
    [/^已跳过无法读取的文件：(.+)（(.+)）$/, 'Skipped the unreadable file: $1 ($2)', { translateCaptures: [2] }],
    [/^未压缩入库已跳过无法读取的目录：(.+)（(.+)）$/, 'Skipped the unreadable folder: $1 ($2)', { translateCaptures: [2] }],
    [/^未压缩入库已跳过无法读取的文件：(.+)（(.+)）$/, 'Skipped the unreadable file: $1 ($2)', { translateCaptures: [2] }],
    [/^清单目录已跳过：(.+)（(.+)）$/, 'Skipped manifest directory: $1 ($2)', { translateCaptures: [2] }],
    [/^未压缩清单已跳过：(.+)（(.+)）$/, 'Skipped uncompressed manifest: $1 ($2)', { translateCaptures: [2] }],
    [/^无法读取：(.+)$/, 'Couldn’t read: $1'],
    [/^项目无法读取，已跳过：(.+)$/, 'Item unreadable and skipped: $1'],
    [/^散列期间源文件发生变化：(.+)$/, 'The source changed during hashing: $1'],
    [/^压缩期间源文件消失：(.+)$/, 'Source disappeared during compression: $1'],
    [/^压缩期间源文件发生变化：(.+)$/, 'Source changed during compression: $1'],
    [/^跨磁盘复制校验失败：(.+)$/, 'Cross-disk copy check failed: $1'],
    [/^归档库中已经存在同名文件：(.+)$/, 'Same-named file already in library: $1']
  ]],
  ['磁盘空间与进程', [
    [/^(.+)剩余空间无法读取，已停止任务以避免生成不完整压缩包。$/, 'Free space unreadable on $1; job stopped to prevent an incomplete archive.'],
    [/^(.+)剩余空间读取失败，已停止任务：(.+)$/, 'Free space unreadable on $1; stopped: $2', { translateCaptures: [2] }],
    [/^(.+)可用空间不足，无法安全处理当前任务。$/, 'Not enough space on $1 for this job.'],
    [/^Windows 进程控制失败（(\d+)）：(.+)$/, 'Windows process control failed ($1): $2', { translateCaptures: [2] }],
    [/^Windows 进程控制在 (\d+) 秒内没有响应，已停止等待。$/, 'Windows process control timed out after $1 s.'],
    [/^Windows 回收站查询失败：(.+)$/, 'Windows Recycle Bin query failed: $1', { translateCaptures: [1] }]
  ]],
  ['路径与命名校验', [
    [/^(.+)不能为空。$/, '$1 can’t be empty.', { translateCaptures: [1] }],
    [/^(.+)不能超过 120 个字符。$/, '$1 can’t exceed 120 characters.', { translateCaptures: [1] }],
    [/^(.+)包含 Windows 文件名不允许的字符，或以句点、空格结尾。$/, 'Invalid Windows filename: $1', { translateCaptures: [1] }],
    [/^(.+)使用了 Windows 保留名称。$/, '$1 uses a reserved Windows name.', { translateCaptures: [1] }],
    [/^([^：:]+)已经不存在。$/, 'The $1 no longer exists.', { translateCaptures: [1] }],
    [/^界面加载失败 \((.+)\)：(.+)$/, 'Interface failed to load ($1): $2'],
    [/^完整性清单包含不安全路径：(.+)$/, 'The integrity manifest contains an unsafe path: $1'],
    [/^完整性清单路径超出程序目录：(.+)$/, 'An integrity-manifest path is outside the application folder: $1'],
    [/^完整性清单目标不是文件：(.+)$/, 'An integrity-manifest target is not a file: $1'],
    [/^发行清单包含重复路径：(.+)$/, 'The release manifest contains a duplicate path: $1'],
    [/^发行清单文件大小无效：(.+)$/, 'The release manifest contains an invalid file size: $1'],
    [/^发行清单 SHA-256 无效：(.+)$/, 'The release manifest contains an invalid SHA-256 value: $1'],
    [/^发行包缺少关键文件：(.+)$/, 'The release is missing a critical file: $1'],
    [/^发行包关键文件大小不一致：(.+)$/, 'A critical release file has the wrong size: $1'],
    [/^发行包关键文件 SHA-256 校验失败：(.+)$/, 'A critical release file failed SHA-256 verification: $1'],
    [/^无法打开(.+)：(.+)$/, 'Couldn’t open the $1: $2', { translateCaptures: [1, 2] }]
  ]],
  ['更新与网络', [
    [/^发现新版本 (.+)$/, 'New version available: $1'],
    [/^检查更新失败：(.+)；(.+)$/, 'Update check failed: $1; $2', { translateCaptures: [1, 2] }],
    [/^检查更新失败：(.*)$/, 'Update check failed: $1', { translateCaptures: [1] }],
    [/^(GitHub|CNB) 请求超时$/, '$1 request timed out'],
    [/^(GitHub|CNB) 连接失败：(.+)$/, '$1 connection failed: $2', { translateCaptures: [2] }],
    [/^(GitHub|CNB) 更新检查失败（HTTP (\d+)）$/, '$1 update check failed (HTTP $2)'],
    [/^(GitHub|CNB) Release 响应解析失败：(.+)$/, '$1 Release response couldn’t be parsed: $2', { translateCaptures: [2] }],
    [/^(GitHub|CNB) Release 响应缺少有效的正式版本$/, '$1 Release response has no valid stable version'],
    [/^CNB 回退配置无效：(.+)$/, 'CNB fallback configuration is invalid: $1', { translateCaptures: [1] }],
    [/^(.+)不是有效 URL。$/, '$1 is not a valid URL.', { translateCaptures: [1] }],
    [/^(.+)必须是不含凭证的 HTTPS URL。$/, '$1 must be an HTTPS URL without embedded credentials.', { translateCaptures: [1] }],
    [/^(.+)不是受信任的 (GitHub|CNB) HTTPS 地址。$/, '$1 is not a trusted $2 HTTPS URL.', { translateCaptures: [1] }],
    [/^(.+)重定向次数过多。$/, '$1 exceeded the redirect limit.', { translateCaptures: [1] }],
    [/^(.+)重定向缺少 Location。$/, '$1 redirect is missing the Location header.', { translateCaptures: [1] }],
    [/^(.+)重定向失败。$/, '$1 redirect failed.', { translateCaptures: [1] }],
    [/^不支持的更新来源：(.+)。$/, 'Unsupported update provider: $1.'],
    [/^(.+)重定向地址不是受信任的 (GitHub|CNB) HTTPS 地址。$/, 'The $1 redirect URL isn’t a trusted $2 HTTPS address.', { translateCaptures: [1] }],
    [/^更新失败：(.*)$/, 'Update failed: $1', { translateCaptures: [1] }],
    [/^更新包发行清单无效：(.*)$/, 'Invalid update manifest: $1', { translateCaptures: [1] }],
    [/^所选更新包版本 (.+) 不高于当前版本 (.+)。$/, 'Package $1 isn’t newer than installed $2.'],
    [/^所选安装程序版本 (.+) 不高于当前版本 (.+)。$/, 'Installer $1 isn’t newer than installed $2.'],
    [/^下载更新 (\d+)%$/, 'Downloading update $1%'],
    [/^检查更新超时（(\d+) 秒），请检查网络或代理设置。$/, 'Update timed out after $1 s. Check network or proxy.'],
    [/^无法连接 GitHub：(.+)$/, 'Couldn’t connect to GitHub: $1'],
    [/^GitHub 更新检查失败（HTTP (\d+)）。$/, 'GitHub update check failed (HTTP $1).'],
    [/^SHA256 摘要下载失败（HTTP (\d+)）。$/, 'SHA256 digest download failed (HTTP $1).'],
    [/^更新包下载失败（HTTP (\d+)）。$/, 'Update package download failed (HTTP $1).'],
    [/^已写入版本 (.+) 的程序文件，启动验证进程。$/, 'Version $1 installed; starting validation.'],
    [/^启动验证版本不一致：期望 (.+)，实际 (.+)。$/, 'Version mismatch: expected $1, got $2.'],
    [/^PowerShell 更新助手过早退出（代码 (\d+)）。$/, 'The PowerShell update helper exited early (code $1).'],
    [/^PowerShell 更新助手在 (\d+) 秒内没有确认启动。$/, 'PowerShell update helper didn’t start within $1 s.'],
    [/^PowerShell 输出：(.+)$/, 'PowerShell output: $1'],
    [/^诊断日志：(.+)$/, 'Diagnostic log: $1'],
    [/^自动更新助手未能启动：(.+)$/, 'Auto-update helper failed: $1', { translateCaptures: [1] }],
    [/^无法读取更新失败记录：(.+)$/, 'Couldn’t read update failure: $1', { translateCaptures: [1] }]
  ]],
  ['媒体处理', [
    [/^媒体处理超时：(.+)$/, 'Media timeout: $1'],
    [/^(.+) 退出码 (\d+)：(.+)$/, '$1 exited with code $2: $3'],
    [/^FFmpeg 探测失败：(.+)；未能从固定版本输出中解析时长或分辨率。$/, 'FFmpeg probe failed: $1. Couldn’t read duration or resolution.'],
    [/^FFmpeg 探测成功：(.+) · (.+)×(.+) · (.+) 秒。$/, 'FFmpeg probe succeeded: $1 · $2×$3 · $4 s.'],
    [/^FFmpeg 视频抽帧失败，改用系统缩略图：(.+) · (.+)$/, 'FFmpeg frames failed; using system thumbnail: $1 · $2'],
    [/^已跳过无法生成预览的媒体：(.+) · (.+)$/, 'Skipped media without a preview: $1 · $2']
  ]],
  ['队列阶段与重复提示', [
    [/^相似项目关系重建失败：(.+)$/, 'Similarity rebuild failed: $1', { translateCaptures: [1] }],
    [/^回收站复核暂时不可用：(.+) · (.+)$/, 'Recycle Bin review unavailable: $1 · $2', { translateCaptures: [2] }],
    [/^发现 (\d+) 个相似项目$/, ([count]) => `Found ${countNoun(count, 'similar item')}`],
    [/^发现 (\d+) 个相似候选$/, ([count]) => `Found ${countNoun(count, 'similar candidate')}`],
    [/^与仓库中 (\d+) 个项目完全一致$/, ([count]) => `Identical to ${countNoun(count, 'Warehouse project')}`],
    [/^完整项目与仓库内容完全一致$/, 'Exact Warehouse duplicate'],
    [/^项目完全重复$/, 'Complete project duplicate'],
    [/^(\d+) 个内容完全相同的文件，(\d+) 个相似项目或视频$/, ([files, items]) => `${countNoun(files, 'identical file')}, ${countNoun(items, 'similar project or video', 'similar projects or videos')}`],
    [/^(\d+) 个内容完全相同的文件$/, ([count]) => countNoun(count, 'identical file')],
    [/^(\d+) 个相似项目或视频$/, ([count]) => countNoun(count, 'similar project or video', 'similar projects or videos')],
    [/^(\d+) 个文件内容完全一致$/, ([count]) => countNoun(count, 'exact-match file')],
    [/^(\d+) 个目录名称完全一致$/, ([count]) => `${countNoun(count, 'folder name')} ${Number(count) === 1 ? 'is' : 'are'} identical`],
    [/^(\d+) 个文件名称相似$/, ([count]) => `${countNoun(count, 'file name')} ${Number(count) === 1 ? 'is' : 'are'} similar`],
    [/^(\d+) 个目录名称相似$/, ([count]) => `${countNoun(count, 'folder name')} ${Number(count) === 1 ? 'is' : 'are'} similar`],
    [/^内容完全一致候选待人工核对$/, 'Exact match needs review'],
    [/^内容完全一致候选核验达到读取预算，未完成的候选已转为人工复核；不会自动跳过。$/, 'Exact-match read limit reached. Review remaining matches; none auto-skipped.'],
    [/^内容完全一致候选已提前排除；读取 (\d+) 个文件后停止完整核验。$/, ([count]) => `No exact-match candidates remained after ${countNoun(count, 'file')}; check stopped.`],
    [/^发现(.+)，需要确认后才能(.+)。$/, 'Found $1. Confirm before $2.', { translateCaptures: [1, 2] }],
    [/^发现 (.+)，已延后等待确认$/, 'Found $1; awaiting approval', { translateCaptures: [1] }],
    [/^自动跳过项目完全重复的任务“(.+)”(：.+)?；源文件和仓库均未修改，队列项已删除。$/, ([title, summary]) => `Auto-skipped “${title}”${summary ? `: ${summary.slice(1).split('、').join(', ')}` : ''}. Originals and Warehouse unchanged; task removed.`],
    [/^自动跳过项目完全重复的任务“(.+)”(：.+)?；源文件和仓库均未修改，队列项已保留。$/, ([title, summary]) => `Auto-skipped “${title}”${summary ? `: ${summary.slice(1).split('、').join(', ')}` : ''}. Originals and Warehouse unchanged; task kept.`],
    [/^(.+)（压缩率 (.+%)），等待核验$/, '$1 (ratio $2); review needed', { translateCaptures: [1] }],
    [/^压缩体积异常：(.+)；完整性测试已通过，但必须人工确认后才会入库。$/, 'Unusual archive size: $1. Verified; approval required.', { translateCaptures: [1] }],
    [/^缩略图生成未完成：(.+)$/, 'Preview generation incomplete: $1', { translateCaptures: [1] }],
    [/^归档已删除，但缩略图清理失败：(.+)$/, 'Archive deleted; preview cleanup failed: $1', { translateCaptures: [1] }],
    [/^异常成品已删除，但缩略图清理失败：(.+)$/, 'Output deleted; preview cleanup failed: $1', { translateCaptures: [1] }],
    [/^多卷压缩包删除未完成，已回滚：(.+)$/, 'Volume-set deletion failed; rolled back: $1', { translateCaptures: [1] }],
    [/^撤回图片时恢复文件失败：(.+)$/, 'Restoring the image during undo failed: $1', { translateCaptures: [1] }],
    [/^原文件位置已存在同名内容，已停止复原：(.+)$/, 'Original location already contains “$1”; restore stopped.'],
    [/^移动位置已经存在同名项目：(.+)$/, 'Move destination already contains “$1”.'],
    [/^库内项目“(.+)”未能加入压缩队列：(.+)$/, 'Couldn’t queue “$1” for compression: $2', { translateCaptures: [2] }],
    [/^目标副本已验证，但原位置副本未能删除：(.+)$/, 'The destination copy was verified, but the original copy could not be removed: $1', { translateCaptures: [1] }],
    [/^成品补偿失败：(.+)$/, 'Output recovery failed: $1', { translateCaptures: [1] }],
    [/^缩略图补偿失败：(.+) · (.+)$/, 'Thumbnail recovery failed: $1 · $2', { translateCaptures: [2] }],
    [/^自动补偿未完成（(.+)），需要人工恢复：(.+)$/, 'Automatic recovery did not finish ($1). Manual recovery required at: $2', { translateCaptures: [1] }],
    [/^本任务成品已移回恢复目录：(.+)$/, 'Output for this task was moved to the recovery folder: $1'],
    [/^(.+)：(.+)；内存仓库未提交；(.+)。源文件保持原位。$/, '$1: $2; in-memory Warehouse changes were not committed; $3. Source files stayed in place.', { translateCaptures: [1, 2, 3] }],
    [/^用户已确认任务风险；大任务将按 (.+) 分卷。$/, 'Task risk approved; the large archive will use $1 volumes.'],
    [/^源文件后处理已经执行，但处理结果未能写回仓库：(.+)。请勿重试归档，并按运行日志核对源文件位置。$/, 'Source cleanup completed, but the result could not be saved to the Warehouse: $1. Do not retry; verify the source location against the log.', { translateCaptures: [1] }],
    [/^恢复暂停任务失败，已取消当前任务并停止队列：(.+)$/, 'Resume failed; task canceled and queue stopped: $1', { translateCaptures: [1] }],
    [/^恢复任务失败，已安全取消当前任务并停止队列：(.+)$/, 'Resume failed; task canceled and queue stopped: $1', { translateCaptures: [1] }],
    [/^回收站安全熔断：(.+) 自动移入回收站已关闭，后续任务没有启动。$/, 'Recycle Bin safety stop: $1 Automatic moves off; later jobs not started.', { translateCaptures: [1] }],
    [/^已验证入库；有 (\d+) 个内容无法读取，源项目为防止遗漏而保留$/, ([count]) => `Archived; ${countNoun(count, 'unreadable item')}, so source kept.`],
    [/^下一项预计需要 (\d+) 分钟，剩余 (\d+) 分钟，本时段不再启动新任务。$/, 'Next job ~$1 min; $2 min left. Not starting.'],
    [/^当前不在定时运行时段；已记录入库方式，队列将在计划开始时间自动运行。$/, 'Outside schedule. Mode saved; queue starts on schedule.'],
    [/^第 (\d+) 条仓库记录缺少 id。$/, 'Warehouse record #$1 is missing its id.'],
    [/^仓库记录 id 重复：(.+)$/, 'Duplicate Warehouse ID: $1'],
    [/^第 (\d+) 个任务缺少 id。$/, 'Task #$1 is missing its id.'],
    [/^任务 id 重复：(.+)$/, 'Duplicate task id: $1'],
    [/^检测到旧版 JSON 存档，但尚未生成 warehouse\.sqlite。请先运行 (.+) 转换“(.+)”。$/, 'Legacy JSON data found, but warehouse.sqlite is missing. Run $1 to convert “$2”.'],
    // Keep catch-all separators last so specific patterns above win.
    [/^(.+)：(.+) \/ (.+)$/, '$1: $2 / $3', { translateCaptures: [1] }]
  ]]
];

// Queue stages often contain counts or a current filename, so they cannot all
// be represented as exact dictionary keys. Translate only fixed UI wording and
// leave paths, names and counters untouched.
const stageFragmentSections = [
  ['队列阶段', [
    ['程序上次运行时被中断，可重新扫描或重试。', 'Previous run interrupted. Rescan or retry.'],
    ['正在生成逐文件清单与 MD5', 'Generating file manifest and MD5'],
    ['正在生成未压缩入库清单与 MD5', 'Building uncompressed manifest and MD5'],
    ['正在生成 MD5：', 'Generating MD5: '],
    ['正在生成缩略图并整理入库信息', 'Generating previews and Warehouse data'],
    ['正在更新相似关系并写入仓库记录', 'Updating similarity and Warehouse records'],
    ['正在移动已完成的源项目', 'Moving completed source'],
    ['正在把已完成的源项目移入回收站', 'Moving source to Recycle Bin'],
    ['正在核验内容完全一致：', 'Verifying identical content:'],
    ['正在筛选内容完全一致候选：', 'Filtering exact-match candidates:'],
    ['正在加密压缩', 'Encrypting/compressing'],
    ['正在压缩', 'Compressing'],
    ['并生成 ', ' and creating '],
    [' 分卷', ' volumes'],
    ['正在复核源文件未发生变化', 'Checking source files for changes'],
    ['正在执行 7-Zip 完整性测试', 'Running the 7-Zip integrity test'],
    ['正在把已验证成品移入归档库', 'Moving verified archives to library'],
    ['超过 10 GiB', 'Over 10 GiB'],
    ['名称可能重复', 'Name may be duplicated'],
    ['名称存在仓库候选', 'Same-name Warehouse item'],
    ['等待内容完全一致核验', 'Waiting for exact-match check'],
    ['内容完全一致候选待人工核对', 'Exact match needs review'],
    ['已自动跳过', 'Auto-skipped'],
    ['等待手动确认', 'Awaiting manual confirmation'],
    ['等待压缩', 'Queued for compression'],
    ['等待不压缩入库', 'Queued uncompressed'],
    ['等待选择入库方式', 'Choose an archive mode'],
    ['待选入库方式', 'Choose archive mode'],
    ['未压缩直接入库', 'Add without compression'],
    ['库内项目压缩 · 等待压缩', 'Warehouse item compression · queued'],
    ['已确认，等待不压缩入库', 'Confirmed; queued uncompressed.'],
    ['已确认，等待库内项目压缩', 'Confirmed; Warehouse compression queued.'],
    ['已确认，等待压缩', 'Confirmed, queued for compression'],
    ['已确认，等待选择入库方式', 'Confirmed; choose an archive mode'],
    ['已批量确认重复风险，等待不压缩入库', 'Duplicates approved; queued uncompressed.'],
    ['已批量确认重复风险，等待库内项目压缩', 'Duplicates approved; Warehouse compression queued.'],
    ['已批量确认重复风险，等待压缩', 'Duplicates approved; queued for compression.'],
    ['已批量确认重复风险，等待选择入库方式', 'Duplicates approved; choose archive mode.'],
    ['队列已进入定时等待。', 'Waiting for schedule.'],
    ['已生成完整清单并直接入库（未压缩）', 'Manifest added without compression'],
    ['异常成品已移入回收站，源项目保持原位', 'Bad archive recycled; source kept.'],
    ['等待核验', 'awaiting review'],
    ['安全停止：原文件未进入回收站，仍在原位置', 'Safety stop: source stayed outside Recycle Bin.'],
    ['安全停止：回收站未保留原文件，请立即检查', 'Safety stop: source missing from Recycle Bin. Check now.'],
    ['已验证入库；因回收站安全熔断，源项目保留在原位置', 'Archived; source kept after Recycle Bin safety stop.'],
    ['已验证入库；因队列正在停止，源项目已保留', 'Archived; source kept while queue stops.'],
    ['已取消，源文件未修改', 'Canceled; source wasn’t changed'],
    ['处理失败，可重试', 'Failed; retry available'],
    ['正在安全取消', 'Cancelling safely'],
    ['，但源项目后处理失败，原位置已保留', ', but source cleanup failed; original kept'],
    ['整个队列已停止，释放空间并确认目录可用后可重试。', 'Queue stopped. Free space, check the folder, then retry.']
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
    for (const [pattern, replacement, options = {}] of entries) {
      if (!(pattern instanceof RegExp)) {
        throw new Error(`i18n pattern is not a RegExp in “${section}”: ${pattern}`);
      }
      if (typeof replacement !== 'string' && typeof replacement !== 'function') {
        throw new Error(`i18n pattern replacement must be a string or function in “${section}”: ${pattern}`);
      }
      if (seen.has(pattern.source)) {
        throw new Error(`i18n duplicate pattern in “${section}”: ${pattern.source}`);
      }
      seen.add(pattern.source);
      const groupCount = new RegExp(`${pattern.source}|`).exec('').length - 1;
      if (typeof replacement === 'string') {
        for (const match of replacement.matchAll(/\$(\d+)/g)) {
          if (Number(match[1]) > groupCount) {
            throw new Error(`i18n pattern references missing group $${match[1]}: ${pattern.source}`);
          }
        }
      }
      const translateCaptures = Array.isArray(options.translateCaptures)
        ? [...new Set(options.translateCaptures.map(Number))]
        : [];
      if (translateCaptures.some((index) => !Number.isInteger(index) || index < 1 || index > groupCount)) {
        throw new Error(`i18n pattern has an invalid translated capture in “${section}”: ${pattern.source}`);
      }
      list.push([pattern, replacement, { translateCaptures }]);
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
// These exact messages are intentionally absent as source-code literals. Four
// are assembled from validated update-provider labels at runtime; the final one
// keeps already-persisted pre-4.6 queue logs readable after an upgrade.
const nonLiteralExactSources = Object.freeze([
  'SHA256 摘要地址不是受信任的 GitHub HTTPS 地址。',
  'SHA256 摘要地址不是受信任的 CNB HTTPS 地址。',
  '更新包地址不是受信任的 GitHub HTTPS 地址。',
  '更新包地址不是受信任的 CNB HTTPS 地址。',
  '用户已确认内容完全一致提示，任务重新进入队列。'
]);

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
  for (const [pattern, replacement, options] of patterns) {
    if (!pattern.test(value)) continue;
    return value.replace(pattern, (...args) => {
      const groups = args.slice(1, -2);
      const resolveCapture = (index) => {
        const raw = groups[Number(index) - 1];
        if (raw === undefined) return '';
        if (!options.translateCaptures.includes(Number(index)) || depth >= MAX_CAPTURE_DEPTH) return raw;
        return translate(raw, depth + 1);
      };
      if (typeof replacement === 'function') {
        return replacement(groups.map((_, index) => resolveCapture(index + 1)));
      }
      return replacement.replace(/\$(\d+)/g, (_, index) => resolveCapture(index));
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

function isUserText(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.('[data-i18n-user-text]'));
}

function translateDom(root = document) {
  if (translating || !root) return;
  translating = true;
  try {
    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE) {
      nodes.push(root);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let current;
      while ((current = walker.nextNode())) nodes.push(current);
    }
    for (const node of nodes) {
      if (isUserText(node)) continue;
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
    const elements = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.(selector)) elements.push(root);
    elements.push(...(root.querySelectorAll?.(selector) || []));
    for (const element of elements) {
      if (isUserText(element)) continue;
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
  nonLiteralExactSources,
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
