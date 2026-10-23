# 技术任务书：在 MarkText（muya）中支持 `<!-- begin/split/end -->` 响应式分栏

---

## 0. 范围

**目标**：让人类作者用尽可能少的字符手写响应式分栏，支持一份文档内多组分栏且无歧义；在不支持该 HTML 的常规编辑器中降级时看不到源码。

**做**：

| 项 | 位置 |
|---|---|
| 三标记格式定义（`begin` / `split` / `end`，`begin` 可带栏宽占比） | §1 |
| 编辑态不动块结构；分栏只在预览视图与导出两处生效 | §4.4 |
| 顶层 token 上的注释 → 占位元素预变换（绕过 DOMPurify 不保留注释的限制） | §3.1 |
| 渲染层 CSS + DOM 后处理，布局只由渲染层产生 | §4.1 / §4.2 |
| 插入分栏组的命令 / 菜单 / 快捷键，用户不必手打注释 | §4.5 |
| 格式 lint：定位到行号的诊断 + 编辑器内提示 | §5 |
| 结构诊断的 warning 通道（预览视图展示，导出路径静默） | §4.1 第 7 条 |

**不做**（产品范围；实现禁令见 §8）：

- PPT 分页 / 分割引擎（另一个项目）
- Word 式水平双页（离散页 + 横向翻页）——属「分页引擎」那一期，与 PPT 同批
- 修 `spread-mode`——它是 `column-count: 2` 连续流式分栏，与「双页」无关（依据见 §1.5）
- 栏内内容独立可编辑（只作发现项，不作验收）
- 在实时编辑模式的 muya 块树里注入分栏 wrapper（会破坏块路径 / 选区 / Enter/Backspace）；**允许例外**：对识别出的标记渲染段尾行内徽标（`markdownToState` 并入段落 text + inlineRenderer，见 §4.6），不碰块结构 / 选区 / Enter/Backspace
- 渲染超过 3 栏的并排布局（超过则整组线性降级）
- 在源码之外另存栏宽（栏宽是 `begin` 标记的一部分）

**目标环境假设**（写入 README）：HTML 注释在浏览器、GitHub、Typora、Obsidian、marked 默认等处理 HTML 的渲染器中不显示，降级时用户只看到线性排列的段落。对默认转义 HTML 的环境（VS Code 内置预览、markdown-it `html:false`），注释会被转义为字面文本——这不是本方案能解决的。

**README 另须写明**：`begin` / `split` / `end` 三词在本格式中被保留。它们是极通用的英文词，若文档里另有 `<!-- end -->` 一类自用注释会被当作分栏标记，冲突时须改写其一。

---

## 1. 官方格式

### 1.1 语法

双栏（`begin` 不带占比 = 各栏等宽）：

```markdown
<!-- begin -->

A栏 markdown

<!-- split -->

B栏 markdown

<!-- end -->
```

带占比（冒号分隔的正整数，**和为 100**（百分比），个数 = 栏数；两栏 `<!-- begin 30:70 -->`，三栏 `<!-- begin 25:25:50 -->`）：

```markdown
<!-- begin 30:70 -->

A栏 markdown

<!-- split -->

B栏 markdown

<!-- end -->
```

一份文档内多组（组间为普通内容）：

```markdown
<!-- begin -->
A
<!-- split -->
B
<!-- end -->

中间普通内容

<!-- begin -->
C
<!-- split -->
D
<!-- split -->
E
<!-- end -->
```

### 1.2 规则

- `<!-- begin -->` 与 `<!-- end -->` 成对出现，界定一个分栏容器；相邻两标记之间（begin–split、split–split、split–end）的内容各为一栏
- 栏数 = split 数 + 1；begin 后无 split 表示只有一栏，不分栏
- 最多 3 栏：begin 与 end 之间最多 2 个 split
- 栏宽占比可选，**只写在 `begin` 上**（`<!-- begin R -->`，R 为**和为 100 的正整数序列**，即百分比；`30:70`、`25:25:50` 合法，`1:2` 因和不为 100 而不合法）；`split` / `end` 不变。源码即唯一真值，不在别处另存栏宽
- begin 之前、end 之后的内容是普通段落，不参与分栏；一份文档可有多组 begin/end，各自独立
- 标记之间的空行可有可无（HTML block 类型 2 以 `-->` 结束，不依赖空行）
- **标记必须独占一行且位于顶层**：不能写在列表项 / 引用 / 表格单元格内，也不能与正文文字同行。违反此条标记不生效（见 §1.3 #7）
- **编辑器渲染形态由标记与上一块的关系决定**（§4.6）：紧贴上一段落（之间无空行）时渲染为段尾行内徽标；前有空行、或上文是标题 / 列表 / 引用等非段落块时渲染为同款文字徽标（块级，点击激活源码编辑）。两种形态在 columns 视图与导出链路中的分栏效果完全一致，仅承载位置不同

### 1.3 合法 / 非法 / 不生效

本表是格式判定与提示文案的**唯一真值**：渲染层后处理（§4.1）与 lint（§5）都只实现它，不再各自复述规则。

总原则：非法一律剥除或降级 + 提示，**不猜测意图、不自动修复、不删除内容**。

| # | 情形 | 渲染层行为 | 级别 |
|---|---|---|---|
| 1 | 孤立 `split` / `end`（无对应 begin） | 剥除该标记 | warning |
| 2 | `begin` 到文档末尾无 `end` | 不包裹，剥除该 begin，内容原位保留 | warning |
| 3 | begin 与 end 之间再出现 begin | 剥除内层 begin（不支持嵌套） | warning |
| 4 | split 多于 2 个（多于 3 栏） | **整组降级**：标记全剥、不包裹、内容按原顺序线性保留 | warning |
| 5 | 占比非正整数，或和不为 100，或正整数个数 ≠ 栏数 | 按等宽渲染（不猜比例） | info |
| 6 | 注释未写闭合 `-->`（裸 `<!-- begin`） | 类型 2 会吞掉后续文档，同 §1.3 #2 处理 | warning |
| 7 | 标记位于非顶层位置（代码块 / 列表 / 引用 / 单元格 / 段落内联） | 不参与分栏，内容按原样正常渲染，不剥除不报错 | info |
| 8 | 标记前有空行，或上文是标题 / 列表 / 引用等非段落块（§4.6） | 分栏照常生效，编辑器显示同款文字徽标（块级，点击激活编辑） | info |

### 1.4 格式依据

标记选 HTML 注释，因为注释在主流渲染器中不可见、降级最干净。依据标准 CommonMark 的 HTML block 类型 2——与类型 7 不同，类型 2 **可以打断段落**：注释紧跟正文文字（之间无空行）时仍然生成顶层 html token（Phase 0 实测确认，见 §2 事实 a），这正是 §3.1 顶层 token 预变换的落点，也是 §4.6 行内化判据的语法基础。

### 1.5 用 `columns` 替换 `reading` 的依据

已确认事实：`util/theme.ts:243-253` 的 spread-mode 是 `column-count: 2` + `break-inside: avoid`，作用在**同一个可编辑的 muya 容器**上——「连续流式两栏长文档」，不是 Word 的「离散页 + 横向翻页」（后者需测高、切页、页间隙、横向翻页容器，属分页引擎范畴）。可编辑区内的跨栏点击定位在 Chromium 上另有已知问题。

据此：

1. **替换而非并存**：删它零功能损失（不存在「双页能力」被移除）；保留则需并列三个子视图并让两个半成品共存，还要留着 `spreadMode` prop/watch 与 `setSpreadMode` 整条链路。
2. **空白行缺陷已化解**（§2.2 h，实测见 §4.6）：编辑器内三标记注释不留可见痕迹的问题，改用「编辑态可视化」解决——**紧贴段落的标记行内化**：`markdownToState` 把注释并入上一段 `text`，`inlineRenderer` 渲染为段尾行内徽标（不占整行、光标安全、可选中删除）；**前有空行或上文非段落块时**退回块级兜底：`htmlPreview` 渲染同款文字徽标（点击激活源码编辑），徽标兼任 columns 视图 regroup 的边界载体。两条路径都不注入 wrapper、不碰块树 / 选区 / Enter/Backspace。验收记为「占位不可见、以文字徽标示意、零空白行」。
3. **长文阅读的落点由 `columns` 顺带承担**（要求见 §4.4 第 3 条）。
4. **分页引擎的插入点已就位**：本方案的后处理发生在 `MarkdownToHtml.renderHtml()` 中 `exportContainer.innerHTML` 赋值之后（§4.1），将来做水平双页 / PPT 切页时在同一位置加一层「测高 → 切页 → 包页容器」即可，无需重构导出管线。

---

## 2. Phase 0：侦察（产出报告后再进 Phase 1）

阅读 `packages/muya/AGENTS.md` 与 README。以下事实已由代码勘查确认（2026-10-22），仍需单测固化：

1. **注释在编辑器中内容不可见**：`htmlPreview.ts:52-77` —— 注释经 `PREVIEW_DOMPURIFY_CONFIG` sanitize 后是空串，`isEmptyHtmlBlock('')` 不匹配 → 走 else 分支 `innerHTML = ''`，不存在 "Empty HTML Block" 占位框。原设计中「编辑模式 sentinel」类改动整条删除，实时编辑链路零改动。是否仍占一行高度见 §2.2 h。
2. **注释块原文进出**：`markdownToState.ts:385-404`（非单 `<img>` 的 html token → `html-block`，text 为原文）；`stateToMarkdown.ts:175-178` 经 `_serializeHtmlBlock` 序列化。往返保真预期天然成立，待单测确认字节级不变（含 begin 上的占比）。
3. **导出注入点唯一**：`markdownToHtml.ts:192-253` —— `sanitizeExportHtml` 第 213 行，`exportContainer` 建于 215-219 行，mermaid / heading-id 均在其后。token 层变换经 `getHighlightHtml`（第 194 行）传入，后处理挂在 `exportContainer` 上，两层都成立。两条禁令：
   - **`renderToStaticHTML` 零影响**（`packages/muya/src/state/renderToStaticHTML.ts`，spec 对比原始输出，`sanitize:false`）。它**同样调用 `getHighlightHtml`**，故标记变换必须是该函数的 opt-in 选项。
   - **`sanitizeExportHtml` 内部禁止注入**：clipboard 的 `getClipboardHtml` 共用该函数，注入会让剪贴板 HTML 混进占位元素。
4. **导出出口清单**：`editor.vue:1336-1401` 的 `styledHtml` / `pdf` / `print` 三个 case 全部走 `exportStyledHTML → MarkdownToHtml.generate()`；另 `util/markdownToHtml.ts`（主题预览）与 muya examples 也调 `renderHtml`，会顺带获得分栏（无害，记录在案）。
5. **DOMPurify 配置**：`EXPORT_DOMPURIFY_CONFIG`（`config/index.ts:448-457`）现为 `ADD_ATTR: ['data-align']`，html profile 放行 `div` 与 `class`。该配置 `ALLOW_DATA_ATTR: false`，而 `ADD_ATTR` 是独立于 data-* 白名单的放行分支——`data-align` 今天就在导出链路里生效即为现成先例，故占位元素放行**基本可判定为通过**（§2.2 b 降级为回归单测）。
6. **视图体系已存在**：`store/editorView.ts` 有 MainView（word/ppt/excel/dev）+ subView + 持久化；`viewSwitcher/index.vue:23-36` 的子视图按钮由 `MAIN_VIEW_META` 驱动，改元数据即生效；`editorWithTabs/index.vue` 按 mainView/subView 分支渲染，`word/reading` 分支现为 `<editor spread-mode>`（`index.vue:18-26`）。`loadPersisted`（`editorView.ts:50-66`）只校验 `mainView` 不校验 `subView`（迁移见 §4.4 第 4 条）；现成有 `isSubViewValid`（`:84-86`）可复用。
7. **依赖关系**：`store/editor.ts` 不 import editorView，`editorView → editor` 无循环（§4.4 第 5 条的前提）。

**待实测项**（报告收尾）：

| # | 实测内容 | 用途 |
|---|---|---|
| a | **【决定性·已实测】段落内联注释**：`正文文字\n<!-- begin -->\nA栏`（注释独占一行、前后无空行）。实测 marked 18.1.0 **仍生成顶层 html token**（与 §1.2「空行可有可无」一致）。含义：① token 变换（§3.1）可正常命中，无需空白行；② 注释本就是独立 token，变换后仍与 `<p>` 平级，不触发 §3.1 担心的段落劈开；③ 真正边界风险转移到「非顶层标记是否被误判为顶层」（见 g） | 锁定 §3.1 落点：顶层 token 遍历正确；本项从可行性门槛降为回归单测 |
| b | 占位元素经 `ADD_ATTR: ['data-mdcols','data-ratio']` 后被保留；非三标记注释仍被默认剥除 | 回归单测（先例见事实 5） |
| c | fenced / 缩进代码块内的字面 `<!-- -->` 属于 code token，导出 HTML 中是转义文本 | 测试期望 |
| d | 用户 raw HTML 块内的标记（`<div><!-- split --></div>`）整体是一个顶层 token，占位元素会嵌套其中 | 后处理行为（对应 §4.1 第 8 条） |
| e | `hasColumnMarkers` 对 `<!-- begin 30:70 -->`、大小写、空白变体及代码块内文本的判定 | §4.4 第 5 条 |
| f | DOMPurify 3.x 能否放行注释 | 本方案不依赖该论断，记录即可 |
| g | 列表项 / 引用 / 表格单元格 / 同行行内 / 代码块内的注释。**实测（marked 18.1.0）全部非顶层**：列表 → 在 `list` 内；引用 → 在 `blockquote > paragraph` 内（行内 `html` 子 token）；表格 → `table` 内；代码块 / 缩进代码 → `code` 内（转义文本）；同行行内 → 段落内 `html` 子 token。顶层 `html` token 数 = 0 | §1.3 #7 与 lint 检查项 7 —— **已验证通过，构成真正的边界门槛** |
| h | 编辑器内三标记注释是否仍占一行空白高度 | §1.5 第 2 条 |

**验收**：7 条事实的单测固化 + a–h 的实测结论。a 实测为「生成顶层 token」——经分析属良性（见 a 行）：注释本就是独立 token，变换后不与 `<p>` 嵌套，不触发 §3.1 段落劈开风险，方案据此**通过**，a 降为回归单测。**真正的可行性门槛是 g**：若任一非顶层位置（列表 / 引用 / 表格 / 行内 / 代码块）的标记被误判为顶层 token，则 §1.3 #7 失效、token 变换会误触发分栏——须停在 Phase 0 重估。g 实测全部非顶层，**门槛通过**。

---

## 3. Phase 1：token 层标记变换 + 白名单

DOMPurify 3.x 默认且无法通过配置/hook 保留注释（§2.2 f），因此三标记注释不能作为透传节点经过它，改为在 sanitize **之前**做预变换。

### 3.0 单一真值模块

新增共享模块（建议 `packages/muya/src/utils/columns/syntax.ts`，从 `@muyajs/core` 入口导出）：

- 正则 / 解析器：匹配三个标记（允许首尾空白与大小写变体，占比为可选后缀）
- **唯一判定函数** `analyzeColumns(markdown): ColumnAnalysis`

  ```
  hasMarkers: boolean            // 源码含顶层 begin 标记
  groups: ColumnGroup[]          // 每组：{ markers, columns, ratio, degraded }
  diagnostics: ColumnDiagnostic[] // §1.3 全部情形 + 行号
  ```

- §1.3 的每条规则只在 `analyzeColumns` 里实现**一次**；预变换与 lint 都消费它，`hasColumnMarkers(markdown)` 是 `analyzeColumns().hasMarkers` 的派生
- 语法、变换、lint 三者共用同一套单测文件

### 3.1 预变换：为什么落在 lexer 而不是 HTML 字符串

对最终 HTML 字符串做全局替换会在段落内联注释上破坏结构：注释紧跟正文文字时，CommonMark 类型 2 不能打断段落，marked 按段落内行内 raw HTML 原样输出 → 替换后生成 `<p>文字<div…></div>…</p>`，浏览器解析时 div 强制闭合 `<p>`，段落被劈开（实测见 §2.2 a）。

| 方案 | 结论 |
|---|---|
| HTML 字符串全局替换 | ❌ 无法区分代码块 / raw HTML / 段落三种上下文 |
| `renderer.html` 钩子 | ❌ 对顶层 html token 与段落内联注释一视同仁，同样出问题 |
| **顶层 token 遍历** | ✅ 段落内 / 列表内 / 引用内 / 单元格内的注释天然不在顶层数组（§2.2 g） |

实现要点（`packages/muya/src/utils/marked/getHighlightHtml.ts`）：

1. 新增 opt-in 选项 `columns: boolean`（与 `inlineDiff` / `footnote` 等既有开关同构），**默认 false**；`renderHtml()` 显式传 true，`renderToStaticHTML` 不传（§2 事实 3）
2. **不改 `html += marked.parse(src)`**，改为在构建 marked 实例时注册 `hooks.processAllTokens`（仅在 `columns` 为 true 时），在其中就地改写顶层 token 的 `text`
3. 改写目标：`<div data-mdcols="begin" data-ratio="R"></div>`（有合法占比时）/ `<div data-mdcols="split"></div>` / `<div data-mdcols="end"></div>`。只匹配这三个词（`begin` 可带占比后缀），其余注释原样交给 DOMPurify 默认剥除
4. **只有成组的标记才改写**。孤立 split/end（#1）、begin 无 end（#2）、嵌套内层 begin（#3）、超 3 栏降级组（#4）都保持为普通注释 → 被 DOMPurify 剥除；#5 占比非法时 begin 仍改写但不带 `data-ratio`。判定全部来自 `analyzeColumns`，预变换不另跑一套状态机

> **为什么用 `processAllTokens` 而不是手动 `lexer()+parser()`（已实测）**
>
> marked 的 `parse(src)` 内部是：`preprocess → lexer → processAllTokens → walkTokens → parser → postprocess`。手动调用 `lexer()` + `parser()` 会**跳过 walkTokens**（实测：26 → 0 次调用）。muya 的 `walkTokens` 承担三件实质工作：heading 的 `headingStyle`/`marker` 标注、indented code 的 `lang` 清理、以及 ``` ```math ``` 块整形为 `multiplemath` token（数学渲染核心）。跳过它等于静默破坏数学块与标题样式。
>
> `processAllTokens` 正好位于 lexer 之后、walkTokens 之前，钩子内改写 token 即生效，且 parse 全流程（含 preprocess/postprocess/walkTokens）完整保留。实测四项：钩子收到的确实是最外层 token 数组；walkTokens 调用次数不变（34 = 34）；除占位元素外输出与未开启时**字节一致**；列表项/引用内的标记保持 inert。

### 3.2 白名单语义

在 `EXPORT_DOMPURIFY_CONFIG` 的 `ADD_ATTR: ['data-align']` 基础上追加 `'data-mdcols'` 与 `'data-ratio'`（`div` 已在 html profile 内，无需 `ADD_TAGS`）。三类输入的结果：

| 输入 | 结果 |
|---|---|
| 三标记 | 占位元素，净化后保留（分栏触发器，begin 可携带 `data-ratio`） |
| 其它注释 | 默认剥除 |
| 用户手写元素 | 维持既有策略：无 `class` 的剥除，带 `class` 的放行但**绝不触发分栏**——包裹只认 `data-mdcols`，触发源唯一 |

占位元素无子节点无其它属性，XSS 面为零；分栏容器只在后处理生成。

验收见 §7。

---

## 4. Phase 2：渲染 CSS + DOM 后处理（唯一布局来源）

### 4.1 DOM 后处理管线

在 `renderHtml()` 内、`exportContainer.innerHTML = html` 之后、mermaid/heading-id 之前，对 `exportContainer.children` 做一层后处理（**仅预览视图与导出路径执行；实时编辑模式不执行**）。触发源是 `data-mdcols` 占位元素（DOMPurify 不保留注释，预变换已把标记转成占位元素）；占比来自 begin 的 `data-ratio`，在此校验并映射为 `flex-grow`。

状态机：`外部` / `容器内` / `容器内-降级`，各分支行为即 §1.3 各行。

1. 遇 `begin`：从 `外部` 进入 `容器内`，记录起点与可选 `data-ratio`
2. 在 `容器内` 遇 `split`：记录切点，最多记录 2 个
3. 遇 `end`：把起点到 end 之间的节点按切点分组，每组包进 `<div class="mdcols-col">`，整体包进 `<div class="mdcols-group">`
4. 文档结束时仍在 `容器内`：剥除该 begin 占位元素，内容不包裹

以上四条骨架 + §1.3 的 #1–#7 构成完整行为；此外：

5. 包裹用渲染层内部 class（`mdcols-` 前缀），使意外碰撞概率极低
6. 生成的 DOM 不回写 markdown / muya JSON state
7. **warning 通道**：每条 warning 连同行号收进 `MarkdownToHtml.warnings`（`ColumnDiagnostic[]`），不写 console；导出 / PDF / 打印无 UI 时静默，由调用方决定是否展示
8. **先清理非顶层占位元素**：后处理开始前剥除残留在用户 raw HTML 块内部的占位元素（§2.2 d），避免空 div 混进产物
9. **与 `analyzeColumns` 的关系**：后处理是「渲染决策者」（只看得到占位元素与 DOM 结构），`analyzeColumns` 是「诊断真值」（只看得到源码）。二者共享 §3.0 语法与 §1.3 规则，并用同一批 fixture 交叉断言——同一份 markdown 的 `diagnostics` 与 `warnings` 必须逐条对应（§6）

### 4.2 布局 CSS

**布局 CSS 有两份，服务的出口不同**（2026-10-23 现状）：

| 文件 | 服务出口 | 类名 | 说明 |
|---|---|---|---|
| `assets/styles/blockSyntax.css` | **Columns 视图**（只读编辑器） | `.mu-mdcols-*` | 编辑器样式渲染，列内表格/代码撑满、跟随明暗主题 |
| `assets/styles/exportStyle.css` | 导出 HTML 文件 / PDF / 打印 | `.mdcols-*` | `generate()` 内联该样式表（`markdownToHtml.ts:310`），走 `github-markdown-css` |

两处规则要保持一致（列内内容水平垂直居中、长内容块例外左对齐），否则「预览」与「导出」会视觉不一致。

写入 `exportStyle.css` 的（导出侧）：

```css
.mdcols-group {
  display: flex;
  flex-wrap: wrap;
  gap: 1em;
}
.mdcols-group > .mdcols-col {
  flex: 1 1 0;        /* 等宽；有合法占比时由渲染层覆写为 flex-grow: N */
  min-width: 18em;    /* 屏幕窄窗下换行堆叠 */
}
.mdcols-col {
  /* 栏内内容水平垂直都居中（2026-10-23 追加） */
  display: flex;
  flex-direction: column;
  justify-content: center;  /* 主轴 = 垂直方向居中 */
  align-items: center;      /* 交叉轴 = 水平方向居中 */
  text-align: center;       /* 撑满宽度的块，其文字也居中 */
}
/* 例外：长内容块居中后难读 —— 块本身仍居中，但内部文字左对齐、宽度撑满 */
.mdcols-col > blockquote,
.mdcols-col > ol,
.mdcols-col > pre,
.mdcols-col > table,
.mdcols-col > ul {
  align-self: stretch;
  text-align: left;
}
.mdcols-col > *:first-child {
  margin-top: 0;      /* 包裹后 github-markdown-css 的 `> *` 外边距会让栏首多一条空隙 */
}
@media print {
  /* 纸张宽度固定（A4 正文区约 46em），18em 下限会让三栏 wrap 成 2+1 错位。
     打印 / PDF 不做响应式堆叠，始终按栏数并排。 */
  .mdcols-group > .mdcols-col {
    min-width: 0;
  }
}
```

- 栏数由生成的 `.mdcols-col` 数量天然决定（上限 3）；等宽 = 各栏 `flex: 1 1 0`
- 占比：`flex-basis: 0` 使 grow 权重直接决定宽度；`min-width` + `flex-wrap` 负责屏幕窄窗堆叠；`@media print` 取消该下限避免打印错位（该文件原本无任何 `@media print` 块）
- 仅布局，不含颜色 / 字体（导出恒为浅色主题，与既有导出行为一致）
- 兼容性：既有测试对本样式表只做 `toContain` 断言，新增规则不破坏；无导出字节快照断言

### 4.3 边界

§1.3 已定义全部非法与不生效情形的行为，此处只补渲染层特有的两条：

- **空栏**（两标记之间无内容）→ 包裹空元素，不报错
- **用户 raw HTML 块内的标记** → 占位元素嵌套在用户元素内，后处理扫顶层看不到，按第 8 条剥除

### 4.4 分栏预览视图（word/columns，桌面端）

复用既有视图体系，不新增主视图 / 子视图键。替换 reading 的依据见 §1.5。

1. **子视图改名**：`store/editorView.ts` 中 word 的 subViews 由 `page/reading` 改为 `page/columns`（key 用 `columns`，label 用英文 `Columns`，与同文件 `Page` / `Source` 的惯例一致；日后统一 i18n 再随大流）。`viewSwitcher` 按钮由 `MAIN_VIEW_META` 驱动，改元数据即生效。
2. **死代码清理**（已核实 6 处）：`util/theme.ts` 的 `SPREAD_STYLE_ID` 与 `setSpreadMode`（`:224-254`）、`editor.vue` 的 `spreadMode` prop（`:166`）与其 watch（`:638-642`）、onMounted 的调用（`:2069`，同段 `setEditorWidth` 保留）、onUnmounted 的复位（`:2144`）、`index.vue:25` 的 `spread-mode` 属性。**注意** spread-mode 是往 `document.head` 注入持久 `<style>` 的，删完代码必须刷新渲染进程（Ctrl+R 或重启 `pnpm run dev`），否则残留样式会让 `page` 视图莫名变两栏。
3. **预览组件**（新增，如 `editorWithTabs/columnsPreview.vue`）：
   - **⚠️ 已改道（2026-10-23）**：不再走导出管线 + `iframe srcdoc`。原方案让 Columns 用 `github-markdown-css` + `exportStyle.css`，与 Page 是两套样式，导致表格不撑满（`table{width:max-content}`）、主题不跟随（导出样式恒为浅色）、字体/行高偏好不生效。**现方案：Columns = Page 编辑器渲染为只读 + 只做分栏**，二者共用同一份样式与同一套 options，page 样式变动 columns 自动跟随，唯一区别就是分栏。
   - 实现：`new Muya(host, { ...buildMuyaViewOptions(), markdown, hideQuickInsertHint: true })`，然后把 `.mu-editor` 的 `contenteditable` 置 `false` 实现只读；渲染后调用 `applyEditorColumns(editorEl)`（`utils/columns/editorLayout.ts`）把标记块之间的兄弟块包进 `.mu-mdcols-group > .mu-mdcols-col`，标记块加 `mu-mdcols-hidden`（隐藏而非移除，便于 revert）
   - **安全性前提**：muya 没有 MutationObserver 把 DOM 变化同步回块树（已核实，仅 `utils/diagram/render.ts` 用了一个），所以在**只读**前提下重组兄弟节点是安全的；块对象仍指向原 domNode，故分栏生效期间不支持编辑
   - **顺带承担长文阅读**（§1.5 第 3 条）：滚动位置存 localStorage（按文档路径 key）
   - **渲染时机**：markdown 变更走 `muya.setContent()` + 下一 tick 重新分组（不再需要 300ms debounce，块树渲染比 `generate()` 便宜）
   - **选项来源**：`util/muyaViewOptions.ts` 的 `buildMuyaViewOptions()` 提供**所有影响外观的选项**（字体 / 字号 / 行高 / tabSize / 列表缩进 / 渲染开关 / 主题），editor.vue 与 columnsPreview 共用；编辑专用项（自动配对、quick insert、拼写检查、剪贴板与图片回调）留在 `editor.vue`
   - 只读：`contenteditable=false`，可选中复制；不向 muya 块树注入任何 wrapper（`applyEditorColumns` 只动 DOM 兄弟顺序，且可 `revertEditorColumns` 完整还原）；`getMarkdown()` 不参与该视图
4. **持久化迁移**：`loadPersisted` 只校验 `mainView`，老用户 localStorage 里存着 `subView:'reading'`，改元数据后会三个分支皆不匹配导致**视图空白**。加载时按 `isSubViewValid` 校验，`reading` 显式映射为 `columns`，其余非法值回落该主视图的默认子视图。
5. **无分栏文档自动隐藏与回退**：
   - 判定：`analyzeColumns(markdown).hasMarkers`（`@muyajs/core` 入口露出）——只有 begin 能开栏组，孤立 split/end 形不成分栏；代码块内的误判可接受（按钮显示、预览线性、lint 提示），策略偏向「显示」不误藏
   - 按钮过滤：`viewSwitcher/index.vue` 的子视图循环（`:23-36`）加 computed 过滤，`columns` 仅在有 begin 标记时渲染；无打开文件时同样隐藏
   - 自动回退：`editorView.ts` 增加 watch（`currentFile` markdown × `subView`）——`subView === 'columns'` 且当前文档无 begin 标记时 `setSubView('page')`，覆盖「columns 视图中切到无分栏标签页」与「加载时持久化 columns 但文档无分栏」（与第 4 条合并处理）。前提：`editorView → editor` 无循环（§2 事实 7）

> 第 1–5 条与 Phase 1 无依赖，可并行开发。

### 4.5 插入命令（不必手打注释）

用户手打三个注释词才能见到效果，对一个 Typora 化的编辑器是硬伤。落在既有命令体系内，不新造机制：

- **命令 id**：`columns.insert-group`（插入 begin + 一个空段落作为栏 1 起点）、`columns.insert-split`（组内插入 split）、`columns.end-group`（补 end）
- **注册位置**：`renderer/src/commands/index.ts` 的 `commands: CommandDescriptor[]`（既有形状 `id` / `description` / `shortcut` / `execute`）；i18n key 在 `commands/descriptions.ts` 登记（与既有 `table.*` / `paragraph.*` 同表）
- **快捷键**：挂在 `shortcut` 字段（同文件既有写法 `[isMac ? 'Cmd' : 'Ctrl', 'Scroll']`；本项目只做 Windows，用 `['Ctrl', ...]`）。**键位待定**：须先核对不与既有键位冲突（`table.*`、`format.*`、已裁决的 `Ctrl+T` = 表格）并记录占用矩阵，不预设键位
- **插入实现（§4.6 行内化后改写）**：标记走 `Muya.insertColumnMarker(comment)` 追加到光标所在顶层段落的末尾（注释在段内独占一行），inlineRenderer 渲染段尾徽标，导出链路仍按顶层 token 识别；光标停在注释之前，用户接着打字仍在注释的上一行，不会破坏标记。光标不在顶层段落（标题 / 列表 / 引用 / 代码块）时该方法拒绝，回退 `Muya.insertParagraph(location, text, outMost)` 块级插入，由 htmlPreview 渲染同款文字徽标承接（§4.6，点击激活源码编辑），columns 视图布局不受影响。`insert-split` / `end-group` 的预期用法是光标停在它们所结束那一栏的最后一段
- **菜单项**：挂到既有 Insert / Format 菜单（与 `paragraph.html-block` 等「插入块」命令同区）
- **诊断面板**（不是空态引导）：`columns` 视图对「有 begin 标记但一组都渲染不出来」的文档仍然可见（第 5 条只看 `hasMarkers`），此时顶部显示带行号的诊断列表 + 修复提示，修好即恢复。这正是 §4.1 第 7 条 warning 通道的真实消费方。**不做「无分栏文档的空态引导」**——那种文档已被自动回退，进不到这个视图

#### Phase 2 实现备注（与字面 spec 的三处偏差）

1. **§4.4 #3 的 options 提取只取渲染子集**。落点是新增 `util/muyaRenderOptions.ts` 的 `buildMuyaRenderOptions()`，editor.vue 与预览共用；但编辑/交互相关项（自动配对、字体、拼写检查、剪贴板回调）留在 `editor.vue`——预览不需要它们，把它们搬进 util 反而会把组件回调耦合进全局。达成 spec 的目的（杜绝渲染开关两份漂移），范围比字面窄。
2. **§4.5 快捷键暂不设**。spec 要求先审计键位占用矩阵再定，故三个命令当前只可从命令面板调用，`shortcut` 字段留空。
3. **§4.5 的光标落点改为注释之前**（§4.6 行内化后）：`insertColumnMarker` 把 caret 设回原文本末尾，用户接着打字在注释的上一行，标记不会被破坏；`insert-group` 以一个空段落收尾作为栏 1 的起点，光标落在该空段落内。不再需要「停在两标记之间」的额外光标跳转 API。

---

### 4.6 编辑态标记可视化（写作视图，桌面端）

§1.5 第 2 条：三标记注释在 WYSIWYG 写作视图里不留可见痕迹（事实 1 实测：sanitize 后空串，零高度）。按 §1.2 的新规则分配：**紧贴段落的标记行内化为段尾徽标，其余走块级兜底**（渲染同款文字徽标、点击激活源码编辑，徽标兼任 columns 视图的边界载体）。

#### 行内徽标（主形态）

- **机制**（三层，全部复用既有设施）：
  1. `markdownToState.ts` 的 `html` case：marker 注释的前一个顶层 token 是 `paragraph` 且中间无 `space` token（空行）时，把注释原文并入该段 `text`（`text += '\n' + comment`），不生成独立 `html-block`。判据由 `inlineAdjacency.spec.ts` 锁定
  2. `inlineRenderer/lexer.ts` 的 `tryHtmlTag` 已能把段落 text 里的注释识别为 `html_tag` token（`openTag` 即注释原文）——无需新规则
  3. `renderer/htmlTag.ts` 对「段首或其前是 `soft_line_break`」的注释 token 渲染段尾徽标（替代灰底原文 span）
- **同构保证**：行内徽标的显示条件（注释在段落 text 里独占一行）与导出链路的分栏生效条件（注释在源码里是顶层 token）互为镜像——显示徽标 ⟷ 分栏生效。同行手打的注释（`文字 <!-- begin --> 更多`）不显示徽标，与 §1.3 #7 一致
- **视觉**：行内小徽标，`⇤ 分栏开始` / `⇥ 分栏` / `⇥ 分栏结束`，0.85em、`--mdcols-marker-color`，hover 加深提示可交互；`data-kind` / `data-ratio` 供 columns 视图使用
- **约束**：编辑态专属，导出链路（`getHighlightHtml` token 变换）看不到此 DOM；序列化时段落 text 原样输出，markdown 往返天然保真；徽标 span 带 `MU_OUTPUT_REMOVE`，剪贴板 HTML 不泄漏徽标 DOM
- **语义提示**：行内 `split` 粘在左栏末段尾部——用户在该段**之后**新起的段落归右栏（与 Word 分栏符「此后的内容流进下一栏」一致，编辑器与导出行为一致）；在 split 段**之前**插段补充左栏则正常归左栏

#### 块级兜底（同款徽标 + 点击激活）

标记前有空行、或上文是标题 / 列表 / 引用等非段落块时保持独立 `html-block`，渲染**与行内徽标完全相同的徽标元素**（`mu-mdcols-marker mu-mdcols-inline mu-mdcols-<kind>`，文字由 CSS `::before` 提供）——一种视觉形态，不论标记怎么写：

- **渲染位置**：`htmlPreview.update()` 的 else 分支。原始 `text` 命中标记正则时渲染该徽标 span，同时携带 `data-kind` / `data-ratio`
- **为什么徽标必须留在 DOM 里**：它兼任 columns 视图的 regroup 边界载体——`editorLayout.ts` 靠 `.mu-mdcols-marker[data-kind]` 定栏边界，删掉它空行分隔写法的分栏布局会静默失效
- **编辑入口（点击激活）**：块级徽标不依附段落、没有行内徽标那样的选中 / 删除路径，点击它是唯一的编辑入口——`htmlPreview` 在 domNode 上委托 click，命中徽标则激活宿主 `html-block`（`mu-active` 让 CSS 收起 preview、显示 html-container 源码），并把光标送入源码末尾（`begin 30:70` 的占比在那里改）
- **两种徽标的位置判据**：视觉统一后，`editorLayout` 用「徽标是否在 `.mu-html-preview` 附件内」区分形态——段内行内徽标所在块并入相邻栏且只隐藏徽标 span；块级徽标整块隐藏（既有行为）
- **约束**：编辑态专属，导出链路看不到此 DOM；`getState` 仍返回 `{}`，markdown 往返不受影响；绝不改变 `html-preview` 在 muya 块树中的身份（仍是一个 Parent），块路径 / 选区 / Enter/Backspace 不受影响
- **用户引导**：lint rule 8（§1.3 #8）对该组提示按块级徽标显示，引导改为紧贴段落的行内写法

#### columns 视图的边界适配

`editorLayout.ts` 的 regroup 以「含 marker 的块」为边界（`markerOf` 的 `querySelector` 同时命中块级徽标与行内徽标；两种徽标是同一个 span，用「是否在 `.mu-html-preview` 附件内」区分形态）：

- 行内徽标所在的段落是左 / 右栏的**最后一块**，整段并入该栏，只隐藏徽标 span（`mu-mdcols-hidden`）
- 块级徽标所在块整块隐藏（既有行为）
- 组内允许两种形态混合；栏边界始终以标记位置为准，与导出管线一致

#### CSS

```css
/* 行内徽标（blockSyntax.css） */
.mu-mdcols-inline {
  display: inline-block; margin: 0 0.2em;
  font-size: 0.85em; line-height: 1;
  color: var(--mdcols-marker-color, var(--editor-color-30));
  white-space: nowrap; user-select: none; cursor: default;
}
.mu-mdcols-inline::before { content: '⇥ 分栏'; }
.mu-mdcols-inline.mu-mdcols-begin::before { content: '⇤ 分栏开始'; }
.mu-mdcols-inline.mu-mdcols-end::before { content: '⇥ 分栏结束'; }
.mu-mdcols-inline:hover { color: var(--editor-color-50); }

/* 块级兜底：同款徽标 span（htmlPreview.ts，点击激活源码编辑） */
```

- **验收**：紧贴段落的标记显示为段尾行内徽标、不占空白行；空行 / 标题后的标记显示同款文字徽标、点击可进源码编辑且 lint 提示 rule 8；两种形态在 columns 视图布局一致；选中行内徽标后 Delete 可删（分栏随之失效）；剪切 / 复制不泄漏徽标 DOM；md 往返保真（marker 始终紧贴所贴段落）。

## 5. Phase 3：格式 lint

lint 是 `analyzeColumns(markdown).diagnostics` 的展示层，不自己写正则、不自己写判定状态机。检查项即 §1.3 的七行 + §4.6 的形态提示（rule 8），提示文案以该表为准，另有一条禁令：

**不检查、不提示其它注释**：`<!-- TODO: … -->`、`<!-- 译者注 -->` 是常规写作用法，报警即误报。

**触发策略**（否则每次击键都弹窗，成为通知风暴）：

- 输入 debounce（如 500ms）后再跑 `analyzeColumns`
- 同一诊断（规则 + 行号）已提示过则不重复；文档改动使其消失时清除状态
- 分级：§1.3 中 warning 进通知面板，info 静默
- 结果需与后处理 `warnings` 交叉一致（§4.1 第 9 条）

**输出**：复用既有 notification service，诊断自带行号；若支持点击回调则跳转，否则在提示中给出行号供定位。不自动补标记、不改写文档、不写 console——普通用户看不见 console。

---

## 6. Phase 4：回归

- 跑现有 CommonMark / GFM conformance 测试，必须全绿（不许为本 feature 修改任何 spec 期望；`renderToStaticHTML` 不传 opt-in 开关，天然不受影响）
- 等价性风险已消除：§3.1 改用 `processAllTokens` 钩子后全程走 `marked.parse`，不再存在"手动 lexer+parser"与 `parse` 不等价的路径。conformance 全绿仍为基线要求，但不再承担兜底职责
- **同一批 markdown fixture 三处复用**：`analyzeColumns` 单测、token 变换单测、DOM 后处理单测共用同一份数据文件，并加一组 `diagnostics` ≡ `warnings` 的交叉断言
- 新增 fixture 覆盖 §7 矩阵，snapshot 对齐

---

## 7. 测试矩阵（各 Phase 验收的唯一真值）

### 白名单与管线（Phase 1）

| 用例 | 输入 | 期望 |
|---|---|---|
| 占位元素白名单 | `data-mdcols="begin"` / `data-ratio="30:70"` 经 EXPORT 配置 | 被保留（分栏触发器 / 占比来源） |
| 非三标记注释 | `<!-- foo -->` | 剥除，**零 lint 提示**（核心回归项） |
| 用户手写元素 | `<div class=mdcols-col>` | 放行但不触发分栏；仅可能获得样式（可接受） |
| 用户手写元素 | `<div style="position:fixed">` | **实测修正**：style 被**保留**（`PREVIEW_`/`EXPORT_DOMPURIFY_CONFIG` 均有意放行，见 config 注释，靠 DOMPurify 净化 style 值本身）。原表此行有误，非本特性引入 |
| XSS | `<script>` / `onerror` / 内联 style / `javascript:` / 条件注释 | 全被剥 |
| **段落内联注释** | `正文文字\n<!-- begin -->\nA栏` | 导出 HTML 与未开启特性时**字节一致**，`<p>` 未被劈开（核心回归项） |
| **非顶层标记** | 列表项 / 引用 / 表格单元格内注释 | 不产生占位元素，导出结果与未开启时一致；lint 提示 |
| **raw HTML 内标记** | `<div><!-- split --></div>` | 嵌套占位元素被剥除，产物不残留空 div |
| 代码块内含标记 | 代码块内 `<!-- split -->` | 不触发分栏；lint 提示非顶层 |
| 栏内含代码块 | 栏内 fenced code（含 `<script>` 文本） | 代码块正常渲染，`<script>` 为转义文本 |
| 往返 | `getMarkdown()` | 注释与内容（含 begin 占比）字节级不变 |
| conformance 路径 | `renderToStaticHTML` | 未开 opt-in 开关，spec 输出零变化 |
| clipboard 路径 | `getClipboardHtml` | 未开 opt-in 开关，无占位元素泄漏 |

### 渲染与降级（Phase 2）

| 用例 | 输入 | 期望 |
|---|---|---|
| 双栏等宽 | begin + 1 split + end + 2 段 | 1280px 双栏等宽 / 360px 堆叠 |
| 双栏占比 | `begin 30:70` | 按 30% : 70% |
| 三栏等宽 | begin + 2 split + end + 3 段 | 1280px 三栏 / 360px 堆叠 |
| 三栏占比 | `begin 25:25:50` | 按 25% : 25% : 50% |
| 占比非法-和不为 100 | `begin 1:2` | info 级提示；等宽渲染 |
| 占比非法-个数不符 | `begin 30:70` 用于 3 栏 | info 级提示；等宽渲染 |
| 占比非法-非正整数 | `begin 1:0` / `begin a:b` | info 级提示；等宽渲染 |
| 超过 3 栏 | begin + 3 个 split | 整组不包裹、标记全剥、内容按原顺序线性保留（不删内容、不渲染前 3 栏） |
| 多组分栏 | 两组 begin/end，中间隔普通内容 | 两组独立分栏，中间内容不包裹 |
| 单栏 | begin + end 无 split | 不分栏，标记剥除，内容保留 |
| 无标记 | 普通 markdown | 不受影响，conformance 不变 |
| begin 前 / end 后内容 | 前文 + 分栏 + 后文 | 前文 / 后文为普通段落 |
| 标记间无空行 | 标记紧贴内容 | 正常解析（类型 2 以 `-->` 结束） |
| 孤立 split / end | 无对应 begin | 剥除 + warning，不影响布局 |
| 未闭合 begin | begin 到文末无 end | 不包裹 + warning，内容保留 |
| 注释未闭合 | 裸 `<!-- begin` | warning「注释未闭合」；不吞后续文档渲染 |
| 嵌套 begin | begin 内含 begin | 内层 begin 剥除 + warning |
| 空栏 | 两标记之间无内容 | 包裹空元素，不报错 |
| 导出三出口 | styledHtml / PDF / print | 分栏与 CSS 一同带出，**且打印与 PDF 下三栏不被切成 2+1**（`@media print` 生效） |
| 编辑模式 | 实时 WYSIWYG | 紧贴段落的标记渲染为段尾行内徽标（`⇤ 分栏开始` / `⇥ 分栏` / `⇥ 分栏结束`），不占空白行、光标可停两侧、选中可删；前有空行 / 上文非段落块的标记渲染同款文字徽标，点击激活源码编辑（分栏仍生效，rule 8 提示）；源码层 `<!-- begin -->` 仍不可见（无 "Empty HTML Block"） |
| source-code 模式 | 源码视图 | 原始三标记注释（含占比）可见 |
| 行内化判定 | 紧贴 / 空行 / 标题后 / 列表内 / 文档开头 五种上下文 | 前两者之外均块级同款徽标 + rule 8 info；判定与 `analyzeColumns` 的 `marker.inline` 一致 |
| 行内化往返 | `正文\n<!-- begin -->\nA\n<!-- split -->\nB\n<!-- end -->` | `getMarkdown()` 后重开，三个 marker 仍紧贴对应段尾（行内化不漂移） |
| 行内化删除 | 选中段尾徽标后 Delete | 注释从段 text 中移除，分栏失效，其余内容无损 |
| 行内化误用 | 同行手打 `文字 <!-- begin --> 更多` | 不显示徽标（§1.3 #7 同行行内），导出不分栏，编辑器与导出一贯 |
| 混合形态 | begin 紧贴 + split 前空行 | columns 视图两组边界仍按标记位置切栏，布局正确 |

### 视图与命令（Phase 2 桌面端）

| 用例 | 输入 | 期望 |
|---|---|---|
| 分栏预览视图 | word/columns 只读 | 双 / 三 / 多组并排，窄窗堆叠；超 3 栏线性；占比非法等宽；iframe 只读、无 app CSS 泄漏 |
| 阅读落点 | word/columns 长文 | 正文限宽居中；重开回到上次滚动位置；markdown 变更经 debounce 才重渲染 |
| 诊断面板 | 有 begin 标记但全组非法 | columns 视图顶部列出带行号的诊断；修好后自动恢复 |
| 视图显隐-无分栏 | 全文无 begin 标记 | dock 仅 Page 按钮 |
| 视图显隐-有分栏 | 含 begin 标记 | dock 出 Page / Columns |
| 视图回退-切标签页 | columns 视图切到无分栏文档 | 自动回 page |
| 视图回退-持久化 | localStorage 存 columns/reading 但文档无分栏 | 加载不空白、回落有效子视图 |
| 插入命令 | 菜单触发三个命令 | 标记行内化插入（贴光标段尾、光标停在注释前）；`insert-group` 追加 begin + 一个空段落；快捷键不与既有键位冲突（附占用矩阵） |

### lint 与一致性

| 用例 | 输入 | 期望 |
|---|---|---|
| lint 八项 | 未配对 / 单栏 / 嵌套 / 超 3 栏 / 占比非法 / 非顶层 / 注释未闭合 / 块级兜底形态（rule 8） | 全部检出且级别符合 §1.3 |
| lint 静默 | 普通段落、普通注释 | 零误报；不自动改写文档 |
| lint 触发策略 | 连续击键 / 重复诊断 / info 级诊断 | 只提示一次；不重复；info 不进面板 |
| 三处交叉一致性 | 同一 fixture | `analyzeColumns().diagnostics` ≡ token 变换结果 ≡ 后处理 `warnings` |
| conformance | 现有测试 | 全绿 |

---

## 8. 负面清单（违反任何一条即返工）

§0「不做」划产品范围，以下是实现禁令：

- 不 bypass / 移除 DOMPurify
- **不对最终 HTML 字符串做全局标记替换**、**不用 `renderer.html` 钩子替换**（§3.1 会劈开段落）
- 不把变换注入 `renderToStaticHTML` 或 `sanitizeExportHtml` 内部（conformance 与 clipboard 路径必须零影响）
- 占位元素若确实无法被 `EXPORT_DOMPURIFY_CONFIG` 放行（§2.2 b 失败）→ 方案不可行，停在 Phase 0，且**不得改用其他触发器绕过**（如 `:::begin` 会在 GitHub 显示为字面文本，违反「降级看不到源码」）
- 不改 muya 的 JSON state 结构（每个标记仍是独立 HTML block）
- 不在实时编辑模式的块树里注入分栏 wrapper
- 不让触发源多元：包裹只认 `data-mdcols` 占位元素，用户手写元素绝不触发分栏
- 不猜测意图、不自动修复、不删除内容（§1.3 总原则）
- **不对普通注释报警**（§5）
- **语法、变换、lint 不各写一份正则或判定状态机**（必须共用 §3.0）
- 官方格式只定 §1 一种，不扩展开分支
- 不为通过测试修改 spec 期望
- 不顺手重构无关代码（diff 最小化；**例外仅限 §4.4 第 2 条的 spread-mode 死代码清理与第 3 条的 muya options 提取**，二者都是本 feature 的必要前提）
- 提交遵循 Conventional Commits

---

**执行顺序**：Phase 0 报告（7 条事实单测固化 + a–h 实测）→ Phase 1 → Phase 2（§4.4 视图改造与 §4.5 插入命令可与 Phase 1 并行）→ Phase 3 → Phase 4。任一阶段验收不通过，停在原地修，不进入下一阶段。

**门槛现状**：占位元素白名单放行已有 `data-align` 先例（§2 事实 5），§2.2 b 是回归单测而非可行性门槛；预变换落点已由顶层 token 遍历确定，§2.2 a 只做留证。**仍然成立的硬前提**：§2.2 b 若实测失败，方案不可行，停在 Phase 0。