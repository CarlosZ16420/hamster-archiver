# Hamster Archiver 4.6.17

## 中文

### 未压缩目录与反馈

- 压缩包状态简化为“未压缩”；原文件位置的“打开”旁增加“修改”，移除下方重复重设按钮。
- 更新目录说明明确：检查原地址与仓库的一致性，不改动原文件；新增自动更新，修改与删除必须手动确认。
- 无变化时提示“项目名与本地目录内容一致”，项目名超过 15 个字符省略，日志保留完整项目名。已进入更新或压缩队列的项目明确提示先完成或取消任务。
- Toast 移到右下角返回按钮上方；自动跳过选项与分割线保持间距。

### 二次压缩备份位置

- 单项确认直接列出原项目备份位置与当前压缩设置，可保留或更新。
- 批量确认列出冲突数量与当前备份位置，可保留原位置、逐项确认或更新并继续。
- 逐项确认只拦住位置不同的项目，队列提供确认入口，其余项目正常执行。任务冻结排队时的位置，大任务仍需单独确认风险。

### 仓库浏览

- 缩略图视图按钮使用大中小三态 SVG，默认中档；在该视图再次点击按大→中→小循环，保留大小偏好。图标保留明暗呼吸，外侧圆角矩形框缓慢扩散到约 1.15 倍并淡出；减少动态效果时显示静态轮廓。
- 大、中、小缩略图统一每页显示三行；点击上一页、下一页或使用左右方向键时保持页面上下位置。列表“大小 / 状态”的最小和默认宽度收窄为 64px。
- 移除工具菜单里的缩略图大小设置。列表不再重复未压缩标签；渲染全部标签，超出列宽的内容裁切，不遮挡备份位置。

### 更新、说明与默认值

- 启动静默检查和用户主动联网检查都只接受 `main` 分支上的正式稳定 Release，历史列表也排除非 `main` 版本；用户明确选择本机 ZIP 时仍可安装版本号更高且校验通过的测试版本。
- 中英文 README 的四张界面截图改为引用发行包内实际包含的 `README.assets` 文件；极小文件 MD5 跳过的新配置默认阈值调整为 1 KB。

### 升级与数据

中英文同步更新。不改变 SQLite 仓库格式或用户资料位置，无需迁移或重建；更新目录始终保留原文件。

## English

### Uncompressed folders and feedback

- Simplify archive status to Uncompressed. Add Edit beside Open at the original location and remove the redundant relocation button below.
- Folder refresh explains that it checks the original location against the Warehouse without changing source files. Additions update automatically; modifications and deletions require confirmation.
- An unchanged check reports that the item matches local folder contents, truncating names beyond 15 characters while retaining the full name in logs. Items already queued for refresh or compression explain that the existing task must finish or be canceled first.
- Toasts appear above the floating return button. Auto-skip settings keep clear spacing from the divider.

### Backup locations on later compression

- Single-item confirmation lists the original backup location and current compression setting, with keep or update choices.
- Batch confirmation shows the conflict count and current backup location, with Keep Original Location, Review Each Item, or Update & Continue.
- Individual review blocks only conflicting items, with a queue confirmation action; other items run normally. Tasks freeze the queued locations, and large tasks still require separate risk confirmation.

### Warehouse browsing

- The thumbnail button uses large, medium, and small SVG states, defaults to medium, and cycles large → medium → small when clicked again in thumbnail view. Size preferences remain saved. The icon keeps its brightness breathing while a rounded rectangle expands to about 1.15× and fades; reduced-motion mode shows a static outline.
- Large, medium, and small thumbnail modes all show three rows per page. Previous, Next, and arrow-key paging preserve the vertical window position. The Size / Status column now has a 64 px minimum and default width.
- Remove the thumbnail size menu control. List rows omit the duplicate Uncompressed tag and render all tags, clipping overflow within the tag column so backup locations remain unobstructed.

### Updates, documentation, and defaults

- Startup and user-requested online checks both accept only stable Releases from `main`, and the online history excludes non-`main` versions. A user-selected local ZIP can still install a higher, integrity-checked test version.
- All four README screenshots now reference files actually included under `README.assets`. The default tiny-file MD5 skip threshold for new configurations is now 1 KB.

### Upgrade and data

Chinese and English are synchronized. The SQLite Warehouse format and user-data locations are unchanged; no migration or rebuild is required. Folder refresh always preserves source files.
