# 分栏块化设计（方案 3：分栏进入块树）

> 状态：**已落地**（Phase 1–4 完成）。本文档是 `<!-- begin/split/end -->` 分栏在
> **muya 块树**层面的唯一设计依据；代码与本文档不一致时，先改本文档。

## 1. 为什么要改（背景）

分栏最初（Phase 2 成果）**只存在于 DOM 层**：`utils/columns/editorLayout.ts` 在编辑器
DOM 上把兄弟块 regroup 成 `.mu-mdcols-group > .mu-mdcols-col`，而块树对此毫不知情
——它以为那些块仍然是 `.mu-container` 的直接子节点。

由此产生三个硬约束：

| 约束 | 原因 |
|---|---|
| 分栏视图**只能只读** | 引擎插入新块用 DOM 相对锚点（`Parent.insertBefore` → `this.domNode.insertBefore(new, ref.domNode)`），而分栏后「块树的下一个兄弟」在 DOM 上已不同源，锚点落进栏里 → `NotFoundError` |
| 分栏视图**不能撤销** | 撤销栈在块树上；分栏视图是另一个引擎实例，栈是空的 |
| 分栏视图的保存**走不通** | 同上：改不了 ⇒ 存不了 |

结论：**分栏必须进入块树**，成为一等公民。这样「分栏视图」才真的是「同一份文档的另一种排版」。

现状：`editorLayout.ts` 及其测试已删除，DOM 后处理不再是分栏的来源；分栏由块树节点
`columns` / `column` 直接表达。

## 2. 状态形状

```
columns            （分栏组）
  column           （一栏）
    paragraph      （内容块）
    paragraph
  column
    paragraph
```

| 节点 | state.name | meta | children |
|---|---|---|---|
| 分栏组 | `columns` | `{ ratio?: number[] }` | `column[]` |
| 一栏 | `column` | 无 | `TState[]`（普通内容块） |

`meta.ratio` 是 `begin` 标记里占比的**解析缓存**（类比 `order-list.meta.sourceMarkers`
「仅为无编辑往返保留的原始标记」）。它不参与序列化——见 §4。

实现位置：

| 物 | 位置 |
|---|---|
| 状态类型 | `state/types.ts`（`IColumnsState` / `IColumnState` + `isColumnsState` / `isColumnState` 守卫） |
| 块类 | `block/extra/columns/index.ts`（`Columns`）、`block/extra/columns/column.ts`（`Column`） |
| 导入建结构 | `state/markdownToState.ts` 的 `_buildColumnGroups` / `_collectColumnMarkers` |
| 序列化 | `state/stateToMarkdown.ts` |

两个块类都覆写 `path` 与 `isContainerBlock`，与既有的容器块（列表 / 引用 / 表格）走
同一套 json1 op 路由——这是撤销栈能穿透到栏内的前提。

## 3. 标记归属：标记仍然活在段落文本里

这是本设计最关键的一处取舍。

**标记不放进 meta，而是仍然留在它所贴的那个段落的 text 里**（`段落正文\n<!-- split -->`），
理由有三条，任何一条单独都足以否决「把标记搬进结构」的方案：

1. **可编辑**：TODO1 #1 要求「分栏符在 page 视图中可编辑」。标记是文本 ⇒ 用户能选中、
   删掉、改占比；搬进结构后它就不再是文本，得另做一套编辑 UI。
2. **行内徽标零成本**：徽标是 inlineRenderer 渲染段落 text 里的注释得到的
   （`inlineRenderer/renderer/htmlTag.ts`）。标记留在 text 里 ⇒ 徽标路径一行不改。
3. **往返保真**：序列化时段落 text 原样输出 ⇒ markdown 一个字节都不变。

于是**标记出现两个地方**：段落的 text（真值，可编辑）+ 块树结构（派生物）。
结构在**导入时**由标记位置推导；标记被改掉后结构会过期：

- 跨视图：columns 视图每次进入都重新导入 ⇒ 结构自动重建 ⇒ 自愈；
- 视图内：columns 视图里徽标不可见（CSS 隐藏）⇒ 用户改不到标记 ⇒ 不会产生过期。

**代价（已知并接受）**：在 page 视图里删掉一个标记后，本引擎实例内的结构仍是旧的
（仍按两栏渲染）。下次切到 columns 视图重新导入即修正。若要彻底修正，需要在
`columns` 块上做「结构自检」——本期不做，记为遗留。

### 3.1 两种标记形态

| 形态 | markdown | 导入结果 |
|---|---|---|
| 行内（贴段落） | `正文\n<!-- split -->` | 标记并入该段 text；该段是**左栏的最后一块** |
| 块级（独立成块） | `正文\n\n<!-- split -->` | 标记是一个独立的 `html-block`，作为**左栏的最后一块** |

两者在块树里的位置一致（都是所在栏的最后一个子节点），渲染时统一隐藏。

组内允许两种形态混合；栏边界始终以标记位置为准，与导出管线一致。

## 4. 序列化：结构不产出标记

`columns` / `column` 只是**容器**，序列化时按顺序输出子节点，**不自己吐标记**：

```
columns → 依次输出每个 column 的 children
column  → 依次输出自己的 children
```

标记由段落 text（或那个 html-block）自己带出来 ⇒ 输出的 markdown 与导入前**逐字节相同**。

## 5. 两种渲染模式

同一份状态，两种排版：

| 模式 | 使用者 | DOM |
|---|---|---|
| `flat`（默认） | page 视图 | `.mu-columns` / `.mu-column` 都是 `display: contents` ⇒ 视觉上与「没有分栏结构」完全一致 |
| `columns` | columns 视图 | `.mu-columns` 是 flex 行，`.mu-column` 是 flex 列，按 `meta.ratio` 给 `flex-grow`；徽标隐藏 |

模式由 muya 选项 `columnsLayout` 决定（每个引擎实例一份）：

- 选项定义：`src/types.ts` 的 `IMuyaOptions`、默认 `'flat'`（`config/index.ts` 的
  `MUYA_DEFAULT_OPTIONS.columnsLayout`）；
- 开关落点：`muya.ts` 的 `getContainer()` 给根节点加 `CLASS_NAMES.MU_COLUMNS_LAYOUT`；
- CSS 落点：`assets/styles/blockSyntax.css` 的
  `.mu-editor.mu-columns-layout .mu-columns` / `.mu-column`（徽标在 columns 模式下隐藏）。

**为什么两个视图必须用同一套状态形状**：撤销栈是 json1 op 列表，op 的 path 相对状态树。
扁平状态里第 4 个块的 path 是 `[3]`，结构化状态里是 `[3, 0, 1]`——两种形状的 op **不能互换**。
所以 page 视图也必须带结构（只是渲染成 flat），撤销栈才能跨视图传递。

## 6. 合法性判定沿用 §1.3 七条

结构只在**合法成组**时建立：孤立 split/end、begin 无 end、嵌套 begin、超过 3 栏、
占比非法——这些情形一律**不建结构**，标记按原样留在文档里（降级为普通内容），
诊断仍由 `analyzeColumns(markdown)` 产出（带行号，是诊断真值）。

判定复用 `utils/columns/syntax.ts`：`analyzeColumns`（诊断真值）与
`analyzeColumnMarkers`（导入期建结构用），**不另写一套状态机**。

## 7. 落地情况

| Phase | 内容 | 状态 | 落点 |
|---|---|---|---|
| 1 | 状态类型 + 导入建结构 + 序列化保真 + 块类 + flat 渲染 | ✅ | `state/types.ts`、`state/markdownToState.ts`、`state/stateToMarkdown.ts`、`block/extra/columns/`、`blockSyntax.css` |
| 2 | `columnsLayout` 选项 + 分栏渲染 + 徽标隐藏 | ✅ | `types.ts`、`config/index.ts`、`muya.ts`、`blockSyntax.css` |
| 3 | 桌面端 columns 视图改用引擎渲染 | ✅ | `desktop/.../editorWithTabs/columnsPreview.vue`（引擎选项 `columnsLayout: 'columns'`，撤销走引擎 action） |
| 4 | 清理 `editorLayout.ts`（DOM 后处理随之废弃）+ 滚动锚点适配新结构 | ✅ | 删除 `utils/columns/editorLayout.ts` 及其测试、`src/index.ts` 导出、e2e 钩子；`desktop/.../util/viewScrollSync.ts` 改认 `.mu-columns` > `.mu-column` |

导出管线不受影响：导出走 `MarkdownToHtml` 的 token 变换（`data-mdcols` 占位元素 +
`exportStyle.css`），与编辑器块树是两条独立链路。

## 8. 遗留

- page 视图内删除标记后，本实例的栏结构过期（跨视图自愈，见 §3）。
- 分栏内编辑（栏与栏之间拖动内容、跨栏合并）未定义语义，暂不承诺。
- columns 视图的工具栏 / 快捷键完整度未与 page 视图对齐。
- e2e（Playwright）用例已按新结构改写，但尚未在本机实跑（环境无浏览器）。
