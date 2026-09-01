# 4.5.14 UI 与主题配色评估

评估日期：2026-08-31
性质：只读评估，未修改任何产品代码与文档之外的内容。

## 范围与方法

本轮评估覆盖 `src/renderer/` 全部渲染层资产（`styles.css`、`index.html`、`app.js`、`i18n.js`、`ui-state.js`、`tag-autocomplete.js`），并对照 `docs/UI.md` 的约束逐条核查。方法包括：

1. 通读 `styles.css` 全部 1466 行与 `index.html` 全部 574 行；
2. 用脚本从 `styles.css` 提取 5 套主题（经典、白昼、黑夜、森林、暮光）的全部语义变量，按 WCAG 相对亮度公式批量计算 205 组前景/背景组合的对比度；
3. 用脚本核对 CSS 类选择器与 HTML/JS 实际类名（含动态拼接）的对应关系，并对候选死规则逐个做全词检索复核；
4. 抽查关键交互路径：主题应用与迁移（`app.js`）、i18n 替换机制（`i18n.js`）、虚拟目录树渲染、删除确认与提交流程、toast 实现；
5. 检查 `prefers-reduced-motion`、`aria-live`、`role` 语义等无障碍特性是否存在。

深色/浅色原生控件的 `color-scheme`、主题改名迁移（`THEME_ALIASES`）、`focus-visible`、事件单次绑定等约束项均已正确落实，不再列为问题。

## 总体结论

UI 底子良好：语义化 CSS 变量、主题只改变量不改结构、原生 `<dialog>`、每主题独立 `color-scheme`、中英文覆盖完整。主要问题集中在四个层面：

1. 浅色主题（尤其默认的"白昼"）多处文字对比度低于 WCAG AA；
2. 存在一个明确的主题 bug：活跃度热力图 level 0 硬编码白色，深色主题下刺眼；
3. 删除确认对话框的默认提交按钮指向不可逆操作，违反 `docs/UI.md` 自身原则；
4. `styles.css` 叠加了三代覆盖层，含约 25 组已核实死规则，维护成本持续累积。

## 一、主题配色问题（按严重度排列）

### P0-1 活跃度热力图 level 0 硬编码白色（明确 bug）

`styles.css` 中 `.activity-cell[data-level="0"], .activity-legend i[data-level="0"] { background: #fff }` 覆盖了语义变量 `--activity-0`。`app.js` 的 `activityLevel()` 对 `inventoryCount === 0` 的日期返回 0，而 16 周网格中多数格子为 0，因此黑夜/暮光主题下"最近 16 周"面板会呈现整片亮白方块；同时 `--activity-0` 成为死变量，与 `docs/UI.md`"主题必须覆盖活跃度色阶"的契约不符。

**建议**：改为 `background: var(--activity-0)`。黑夜（`#24282a`）与暮光（`#232d3a`）已定义该变量，其余主题亦已定义，无需新增。

### P1-1 默认主题"白昼"次要文字对比度不达标

`--muted: #78787f` 的实测对比度：panel 4.38:1、paper 4.09:1、panel-nested 4.13:1、thead 4.13:1，均低于 AA 的 4.5:1。`--muted` 是全应用使用频率最高的文字色，且大量出现在 10.5–12px 小字号上（字段标签、组摘要、帮助文字），实际可读性更差。经典主题 `muted/paper` 为 4.49:1，贴线。

浅色主题中 muted 叠加在 `ok-bg`/`warn-bg`/`info-bg` 色块上的组合（备份位置设置区、手动入库提示、安全对话框说明等）实测 3.87–4.49:1，同样不达标。深色主题（黑夜/暮光）全部通过。

**建议**：白昼 `--muted` 加深至约 `#6b6b73`（≈5.1:1），经典微调一档；或引入"小字号次要文字"专用变量，凡 <12px 说明文字一律使用。

### P1-2 主按钮与警告按钮文字对比不足

| 组合 | 经典 | 白昼 | 森林 | 黑夜 | 暮光 |
|---|---|---|---|---|---|
| `--on-accent` / `--accent`（主按钮） | 3.82 | 4.38 | 通过 | 通过 | 5.09（通过） |
| `--on-warning` / `--amber`（警告按钮） | 4.42 | 3.42 | 3.84 | 通过 | 通过 |

按钮文字 12.5px 粗体按 WCAG 属正常字号，需 4.5:1。

**建议**：浅色主题 `--accent` 略加深（如白昼 `#c8552e` → `#b34a24`，色相不变）；`--on-warning` 改为更深的近黑色。深色主题不受影响。

### P1-3 星级评分几乎不可见

- 空星 `--star-empty` 对 `panel-soft` 实测 1.26–2.26:1，作为图形组件也低于 3:1；
- 实心星 `--star` 作为 11px 文字在经典/白昼/森林为 3.04–4.08:1。

评分同时是展示与可点击控件（`.rating-buttons`），当前仅靠颜色区分。

**建议**：加深 `--star-empty`（如白昼 `#b9b9c0`）；实心星按各主题校至 4.5:1。

### P2-1 选择态语义不统一

同为"选中"状态：队列表格行用 `--selected`（暖橙调）；仓库卡片选中用琥珀/warn 底色；文本列表行选中与激活用绿色 `ok-bg`。三种颜色表达同一概念，且绿色选中与"成功状态胶囊""绿色标签胶囊"语义冲突。

**建议**：统一收敛为一个 accent 系选中变量。

### P2-2 命名与过渡的一致性问题

- `--accent-dark` 在深色主题中实际比 `--accent` 更亮（黑夜 `#f08d69` > `#e5714a`），名称与行为相反，机械套用易埋雷。建议改名为 `--accent-text` 一类，并沿用现有 `THEME_ALIASES`（`app.js`）做旧值迁移。
- 主题切换时仅 body 有 0.2s 过渡，面板/文字即时跳变，切主题会闪。建议统一为全部瞬时或主要着色属性补齐过渡。
- `.discovery-hero` 的暖棕暗部叠加 `rgba(25,16,10,.82)` 在森林主题绿色渐变上略显浑浊，可考虑叠加色主题化。

### 低风险备忘（不强制）

- 边框 `--line` 对 panel 实测 1.14–1.49:1，属装饰性低对比，有阴影兜底，可接受；但进度条轨道 `--track` 对 `--panel-inset` 约 1.15–1.33:1，功能性图形几乎不可见，建议略加深。
- 标签胶囊一律绿色（`ok-fg/ok-bg`），与成功状态同色，信息密度高时易混淆，属可选优化。

## 二、UI 结构与交互问题

### P0-2 危险对话框默认按钮指向不可逆操作

删除仓库项目对话框中"确认删除"为 `type="submit"`（`index.html`），对话框内按 Enter 会直接触发删除流程（`app.js` 的 submit 处理无二次拦截）。这违反 `docs/UI.md` 修改原则中"危险动作……默认按钮不能指向不可逆操作"的既有约定，同类模式也适用于破坏性 confirm 流程。

**建议**：取消按钮设为默认提交，或对批量删除增加显式输入确认。

### P1-4 字号体系偏小且无 token

正文 13px，大量 9–10.5px 胶囊与说明（标签 9px、文件数角标 9px、step 10.5px、组摘要 11.5px）。这是长时间使用的桌面归档工具，9px 级文字可读性偏低；且字号散落为魔法数（10/10.5/11/11.5/12/12.5px 混用）。

**建议**：建立 `--font-*` 字号阶梯并设 11px 下限（角标/胶囊不低于 11px，说明文字不低于 12px）。

### P1-5 Toast 无障碍缺失

`#toast` 无 `role="status"`/`aria-live`，4.5 秒自动消失，不可悬停暂停、无手动关闭；错误类消息（如"N 项失败"）可能未读完即消失。

**建议**：补 `aria-live="polite"`；错误消息延长驻留并提供关闭按钮。

### P2-3 虚拟目录树可访问性语义不完整

行为普通 `div`，虽设置了 `aria-expanded`，但无 `role="tree"/"treeitem"` 配合时该属性对读屏器无效；虚拟化导致读屏器只能感知可视行（虚拟化本身合理，属已知取舍）。

**建议**：至少补齐 tree 系 role 与键盘折叠按键；白名单标记 `.similar-name-mark.whitelistable` 建议使用真实按钮语义。

### P2-4 缺少 `prefers-reduced-motion`

按钮悬停位移、进度过渡、backdrop-filter 均无条件生效。建议补一段 reduced-motion 降级。

## 三、i18n 架构备忘（长期项）

`i18n.js` 采用"事后全文替换 + MutationObserver"架构。工程质量本身扎实（重复键抛错、WeakMap 缓存原文、阶段文本按 ` · ` 分段匹配），短期不必改动，但存在三个结构性限制：

1. 词典未命中的字符串会在英文界面静默残留中文，无缺失上报机制；
2. 每次 DOM 变更都遍历文本节点，大仓库 + 虚拟树重渲染时有可测开销；
3. 英文普遍比中文长 1.5–2 倍，虽已用省略号/定宽（撤回按钮 76px、更新胶囊 132px）缓解，仍有截断歧义风险。

**建议**：近期仅增加开发模式下的"未翻译字符串"审计日志；远期预留 `data-i18n` 键位方案，不在 4.5.x 内强制。

## 四、可维护性问题（CSS 分层债务）

`styles.css` 叠加了三代覆盖：基础 4.5 样式 → "NEWUI 落地" → "NEWUI 4.4 alignment" → "Final prototype alignment pass"。后层反复改写前层（`.group-head` 由 grid 改 flex、`min-height` 42px 又被改回 22px）；同宽度媒体查询被拆成多个孤立块（680/700/820 各出现两次）。

经全词检索复核，以下选择器在 HTML/JS（含动态拼接）中已无任何引用（动态状态类如 `awaiting_*`、`catalog-card`、`virtual-tree-row` 已排除）：

```
.hero  .eyebrow  .subtitle
.library-actions  .library-action-row  .library-filter-row
.library-tool-row  .library-title  .library-panel
.lower-grid  .path-grid
.manifest-list  .manifest-file
.compact-title  .section-title
.bulk-tag-input  .discovery-heading
.completion-options  .completion-path  .safety-option
.archive-password-line  .video-frame-badge
.catalog-image-tools  .catalog-image-picker-row
.ignore-terms-setting
```

**建议**：做一次收敛——删除死规则、合并同名媒体查询、只保留最终态，并考虑按 tokens/base/components 拆分文件。收敛前后应逐页对照中英文与宽窄窗口的渲染快照，确保视觉零变化。

## 五、建议修改优先级

| 优先级 | 事项 | 类型 |
|---|---|---|
| P0 | 热力图 level 0 改用 `var(--activity-0)` | 主题 bug |
| P0 | 删除对话框默认按钮改为安全项 | 交互安全 |
| P1 | 白昼/经典加深 `--muted`、`--accent`、`--amber` 文字对 | 对比度达标 |
| P1 | 加深 `--star-empty`，校准 `--star` | 对比度达标 |
| P2 | 统一三处"选中"色；`--accent-dark` 改名迁移；主题切换过渡统一 | 一致性 |
| P2 | toast `aria-live`、reduced-motion、虚拟树 role | 无障碍 |
| P3 | CSS 死规则清理与媒体查询合并；字号 token 化并设下限 | 可维护性 |

**回归门槛建议**：本轮使用的批量对比度脚本（从 `styles.css` 提取语义变量、按 WCAG 公式计算全部主题 × 语义组合）值得固化为仓库内工具并接入 `npm run check`，把"文字对 ≥4.5:1、图形对 ≥3:1"作为主题变量的自动断言，避免后续调色回退。

## 附录：对比度审计口径

- 公式：WCAG 2.x 相对亮度与对比度比值；半透明色按指定背景合成后计算。
- 阈值：正常文字 ≥4.5:1；≤12px 说明文字同样按 4.5:1 从严；图形/UI 组件 ≥3:1。
- 覆盖：5 主题 × 41 组语义组合（正文、次要文字、五种状态胶囊、按钮四态、日志色、星级、toast、输入框、边框、进度轨道等），共 205 组；另有活跃度色阶相邻级差与发现卡片渐变附加项。
- 结果概要：53/205 组未达标；其中黑夜主题仅非文本项未达标，白昼主题未达标最多（19 组）。
