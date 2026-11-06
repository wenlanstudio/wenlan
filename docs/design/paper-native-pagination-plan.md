# 页叶原生分页实施方案（方案 C）

> 状态：**草案，待评审**；未改动任何代码。
> 与 `view-model.md` §2 / §5 的 A″ 裁决冲突，评审通过后需同步修订该文。
> 关联：N3 硬验收（`paper-page-count.spec.ts`）、#7 两个分片边界、M0/M1/M2 事务与身份层。

---

## 0. 结论先行

方案 C 的目标是把页叶从「只读第二实例 + 手工裁剪克隆」变成「**活引擎 + 纸面 CSS**」：光标直接落在文字上，随打随分页，DOM 不再被搬进页卡。

这与「文内核唯一、览是表象」的方向一致：纸叶不再是第二套渲染管线，而是文内核的一个 CSS 视口。M0 事务层、M1 块身份（已挂在活引擎 DOM 上）天然复用；M2 的单块浮层 `blockEditor.vue` 反而成为可退役的临时脚手架。

**但必须先做技术验证（S0 Spike）再决定是否实施**，原因是两个硬事实：

1. 屏幕端 Chromium **没有 CSS Paged Media**：`@page` 只在 `@media print` / `printToPDF` 生效。屏幕上唯一能产生 fragmentainer 的是 CSS multi-column（MDN：每个列框即一个片段，与打印页等价）。
2. `contenteditable` + multicol 的**跨列光标错位是已知问题**，公开资料明确写「光标大概率落在错误列甚至页面外，目前没有纯 CSS 修复方案」，且 IME 候选框坐标同步在复杂 contenteditable 中本就脆弱。Muya 有自己的块模型与 `Selection` 管理，比裸 contenteditable 更有希望，但光标命中仍依赖浏览器 `caretRangeFromPoint` / `getClientRects`，**未实测前不能假定可用**。

因此本方案是「**Spike 驱动的方案**」：S0 不通过则止步，转 §3 的 C2 或维持现状，不进入 S1。

---

## 1. 为什么现在可以重新讨论：A″ 裁决的前提被绕过了

`view-model.md` §5「M4.3b 调研结论」列出四条理由，结论是「真分片渲染与卡内可编辑不可兼得」。逐条核对方案 C：

| M4.3b 理由                                               | 方案 C 是否仍成立 | 说明                                                        |
| -------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| ① DOM 层重组导致 `insertBefore` NotFoundError / 撤销栈空 | **不成立**        | C 不搬 DOM，活引擎原地，只切换 CSS                          |
| ② 页成员关系进块树后随键入改写 json1 op path             | **不成立**        | C 的分页是纯 CSS 呈现，「页成员」根本不进块树，op path 不变 |
| ③ 分栏结构依赖 `begin` 标记，无标记文档无结构可借        | **不成立**        | C 不需要任何结构标记，所有文档统一由浏览器分片              |
| ④ 引擎插入锚点与 DOM 1:1 耦合，搬进页容器打断三角        | **不成立**        | 同上，无搬移                                                |

即：A″ 否决的是「**真分片容器重组 + 卡内编辑**」，C 的前提是「**不重组，让浏览器自己分片**」。这不是推翻调研结论，而是绕过它的前提。这一点是方案 C 成立的理论依据，也是评审时最需要确认的地方。

代价是：A″ 的「页卡是真 DOM 容器」（`.mu-paper-page`）不再成立，页变成 CSS 列；所有依赖页卡 DOM 的判别器、样式作用域、分片锚都要重做。

---

## 2. 技术现实与几何对齐

### 2.1 屏幕端可用的分片机制

| 机制                                                            | 屏幕可用 | 说明                                                                 |
| --------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `@page` / paged media                                           | 否       | 仅 print / printToPDF                                                |
| CSS multicol（`column-width` + `column-fill: auto` + 固定高度） | 是       | 唯一的屏幕 fragmentainer；`break-inside` / `orphans` / `widows` 生效 |
| 手工测量 + DOM 搬运                                             | 是       | 现状 A″，`paperProjection.vue`                                       |
| 连续纸带 + 页边界 overlay                                       | 是       | 不分片，只画页线，见 §3 C2                                           |

Chromium RenderingNG 改进了 fragmentation 实现（Rachel Andrew, CSS Day 2025, _Multicol and Fragmentation_），但**没有保证 multicol 与 `@page` 的分片结果完全等价**——尤其表格 `thead` 重复、`li` marker 续号、`pre` 折行。这正是 N3 硬验收要重新覆盖的内容。

### 2.2 几何对齐（S1 必须实测校准）

现状屏测：`pageContentHeight = (pageHeightMm - 40) * MM_TO_PX * zoom`，纸卡宽 210mm、上下各 20mm。
打印链：`printService.css` 的 `@page { margin: 15mm 20mm }`，另有导出链 `.markdown-body` 样式。两者数值口径需实测确认，不能照抄。

multicol **无法给每一列单独加页边距**（padding 只作用于容器整体）。最小骨架：

```css
.paper-native {
  --paper-w: 210mm;
  --paper-content-w: 170mm; /* 210 - 左右 20mm */
  --paper-content-h: 257mm; /* 待与打印链校准 */
  column-width: var(--paper-content-w);
  column-gap: 40mm; /* 左右页边距合计 + 页间隙 */
  column-fill: auto; /* 必须，否则内容被平衡而非溢出成新列 */
  height: var(--paper-content-h);
  padding: 20mm 20mm 15mm;
  overflow-x: auto;
  overflow-y: hidden;
  box-sizing: border-box;
}
.paper-native pre {
  white-space: pre-wrap;
} /* 与打印链同源，见 paperLens.css:199 */
```

纸张视觉（白底、阴影、页码）由 `repeating-linear-gradient` 背景 + 绝对定位 overlay 承担，**不新增 DOM 页卡**。列数 = `scrollWidth / (column-width + column-gap)`，即屏显页数；页码用 overlay 复用 `usePaperPagination` 的现有机制。

**这是与 A″ 最大的视觉差异**：multicol 的列是横向排列的。要「像 Word 纵向翻页」，见 §3。

---

## 3. 三条技术路线

|                  | C1 横向多列视口                         | C1c 单列视口 + scrollLeft 翻页               | C2 连续纸带 + 页边界线                  |
| ---------------- | --------------------------------------- | -------------------------------------------- | --------------------------------------- |
| DOM              | 活引擎原地，multicol 自动分片           | 同 C1，视口只显示一列                        | 活引擎原地，**完全不分片**              |
| 页数来源         | 列数                                    | 列数                                         | 测量出的页边界线数量                    |
| 编辑             | 浏览器原生分片 + contenteditable        | 同左                                         | 100% 原生连续编辑，无分片上下文         |
| 光标跨列风险     | 高                                      | 高（但只显示一列，可 `scrollIntoView` 补救） | 无                                      |
| 视觉             | 多页横向并排（InDesign 对开页感）       | 单页，横向滚动翻页                           | 纵向连续滚动（Typora / Word Web 感）    |
| N3 同源性        | 理论最好（同为 Chromium fragmentation） | 同左                                         | 需保证页线位置 ≡ 打印分页位置，仍要测量 |
| 需删除的手工手术 | 全部                                    | 全部                                         | 全部（页线复用测量层）                  |
| 实现风险         | 最高                                    | 高                                           | 最低                                    |

**推荐顺序**：先 Spike 验证 C1/C1c 的编辑可用性；通过 → 走 C1c（最接近 Word、可补救跨列光标）；不通过 → 转 C2（DOM 不分片，编辑零风险，页线是测量投影，N3 仍可验收）。

C2 需要用户拍板接受「不再有页卡 DOM，页是画出来的线」——它与 §1 的架构收益一致，只是把「分页」从布局降为装饰。

---

## 4. 范围边界：分屏右 pane 不适用

`index.vue` 中 `paperProjection.vue` 有两个挂载点：单叶页全屏、分屏右 pane（`rightLeaf === 'page'`）。

- **单叶页全屏**：可切 C。当前 `.paper-fullscreen .pane-left { display:none }` + 纸叶显示 paperProjection；改为左 pane 活引擎显示 + `paper-native` class，全屏容器不再挂 paperProjection。
- **分屏（文 × 页）**：活引擎在左 pane，右 pane 不可能同时显示同一 DOM。必须**保留 A″ 真分片投影**作为只读面。

因此 `paperProjection.vue` 与 `paperPagination.ts` 的裁剪手术**不能删除**，只能降级为「分屏右 pane 专用」。这直接影响 §6 的清理范围，也意味着 M1 分片锚（`data-fragment-id`）与 M2 单块编辑层在分屏路径上仍需保留。

feature flag 建议按渲染位置而非全局：`paperRenderer: 'native' | 'fragmented'` 只对单叶全屏生效；分屏右 pane 恒为 `fragmented`。

---

## 5. 架构改动清单

| 文件                                           | 动作                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `index.vue`                                    | 单叶页全屏分支：不再挂 `paperProjection`，改为显示 `.lens-host` 并加 `paper-native` 容器/class；分屏分支保持现状                |
| `editor.vue`                                   | `applyLens()` 增加 `page` 分支挂 `paper-native`；`usePaperPagination` 的 overlay 复用为页码/页线层；`switchDocument`/身份层不动 |
| `assets/styles/paperLens.css`                  | 新增 `.paper-native` 一族（multicol 几何 + 纸张背景 + `break-*` 策略）；保留 `.mu-paper-page` 一族给分屏右 pane                 |
| `util/paperPagination.ts`                      | 新增 `countNativePages()` / `pageBoundaries()`；`measurePaperBlocksV2` 等手工拟合保留给分屏路径，暂不删                         |
| `paperProjection.vue`                          | 降级为分屏右 pane 专用；加 flag 判断，单叶全屏不再挂载                                                                          |
| `sync/blockIdentity.ts` / `fragmentAnchor.ts`  | 活引擎侧不动；分片锚在分屏路径继续用                                                                                            |
| `sync/editSession.ts` + `blockEditor.vue`      | 单叶全屏路径可退役（活引擎本身可编辑）；**分屏路径保留**；`Muya.replaceBlockMarkdown` 保留给 M3 块级控件                        |
| `sync/projectionVersion.ts`                    | 纸叶不再是投影，单叶全屏路径无需版本守卫；分屏路径保留                                                                          |
| `test/e2e/paper-page-count.spec.ts`            | 重写，见 §7                                                                                                                     |
| `docs/design/view-model.md` / `sync-design.md` | A″ 裁决改写、§5 落地切片更新、M2 编辑面描述更新                                                                                 |

**明确不动**：M0 事务流（`transactionHub.ts`）、打印链（`printService.css` / `pdf.ts`）、md2slides 放映链、览/示 iframe。

---

## 6. 阶段拆分

| 阶段             | 交付物                                                                    | 出口条件（Go / No-Go）                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S0 Spike**     | 独立最小页面（不接产品代码）：multicol 容器 + Muya 单实例 + 5 个验证用例  | ① 跨列点击光标落在正确列；② 跨列键入/删除不丢字；③ 中文 IME 候选框跟随光标；④ 跨列选区 + 复制；⑤ 同一内容 multicol 列数 = `printToPDF` 页数。**任一失败 → 转 C2 或止步** |
| **S1 渲染切换**  | flag 后的 `paper-native` 渲染：纸面几何、列数、页码 overlay、打印几何校准 | 视觉与 N3 参考文档页数一致；切叶零重建（DOM 不搬移）                                                                                                                     |
| **S2 编辑闭环**  | 活引擎直接可写；光标跨列、IME、选区、undo/redo、随打随分页                | M0 事务链完整；`doc-changed` 广播一次/事务；N2 P95 ≤300ms 基准记录                                                                                                       |
| **S3 验收重做**  | 新 e2e 判别器与用例（§7）                                                 | 全绿；旧 `paper-page-count.spec.ts` 在 `fragmented` flag 下仍全绿（双轨）                                                                                                |
| **S4 清理**      | 单叶全屏路径删 M2 浮层与版本守卫；分屏路径保留；文档改写                  | 无死代码；`view-model.md` / `sync-design.md` 与代码一致                                                                                                                  |
| **S5 推广/回滚** | flag 默认值切换、灰度、回滚预案                                           | 观察期无回归后默认 `native`；一键回 `fragmented`                                                                                                                         |

S0 的 5 个用例必须在**真实 Electron + 打包后的 Muya** 下跑（不能用裸 contenteditable 代替），否则结论无效。

---

## 7. 验收重做

### 7.1 N3 硬验收（10 例）

旧判别器全部失效：`.mu-paper-deck[data-page-count]`、`.mu-paper-page` 卡片数、`.mu-paper-deck pre.mu-code-block` 克隆数、`.mu-paper-kids-part` 等。

新判别器建议：

- 页数 = `nativePageCount`（列数，或 C2 的页线数），挂在容器 `data-page-count`；
- 一致性断言仍为 `screenCount === pdfCount`（`countPdfPages` 解压对象流数 PDF 页）；
- 保留原有「填充远离页界」的测试数据（40 段 / 28 段首页），使 ±10% 字体漂移不改变页数；
- 新增「分片位置」断言：跨页块的断点在屏幕与 PDF 中位于同一逻辑行（用已知文本锚点，而非像素）。

### 7.2 #7 两个边界

| 边界                                                      | 现状手术                                 | C 之后                                                              |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| 折行行内部（`pre` 内 `white-space: pre` 盖过 `pre-wrap`） | `paperLens` 显式补 span 规则             | 由 Chromium 原生分片处理；保留 e2e 判别（单逻辑长行跨页）作为回归   |
| 超页 li / 引用子块                                        | `kidCutPoints` + `fragmentKids` 裁剪手术 | 原生分片；保留 e2e 判别（超页 li / 引用子块）验证浏览器行为符合预期 |

要点：**用例保留、判别器重写**。它们从「验证我们的手术」变成「验证浏览器原生分片没跑偏」。

### 7.3 新增编辑验收

跨列光标与键入、跨页选区、中文 IME、跨列 undo/redo、键入触发新增页时的 `scrollIntoView`、切叶（文↔页）零重建且光标保留、分屏右 pane 仍为只读投影且可点击编辑（M2 路径）。

---

## 8. 风险登记

| 风险                                                            | 等级     | 缓解                                                                                        |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| contenteditable + multicol 光标错位 / IME 漂移                  | **致命** | S0 一票否决；不通过转 C2                                                                    |
| multicol 与 `@page` 分片不等价（表格 thead、li 续号、pre 折行） | 高       | N3 + #7 用例双轨跑；必要时在 `break-*` 上做最小补偿，禁止回到 DOM 搬运                      |
| 列是横向的，不像 Word 纵向                                      | 高       | C1c 单列视口 + `scrollLeft` 翻页；或 C2 连续纸带。需用户拍板                                |
| multicol 无法给每列单独页边距                                   | 中       | `column-gap` + 背景渐变模拟；S1 实测校准                                                    |
| 随打随分页的实时测量成本（N2 P95 ≤300ms）                       | 中       | 原生分片本应零 JS 测量；页码 overlay 用 `ResizeObserver` 合帧，禁全量 O(n) 哈希进键入热路径 |
| 分屏右 pane 与全屏路径行为分叉                                  | 中       | flag 按位置生效；两套 e2e 同时跑                                                            |
| M2 浮层退役后分屏路径无人维护                                   | 低       | S4 明确「保留」，不删                                                                       |
| A″ 裁决与既有文档冲突                                           | 低       | S4 统一改写，改动前先评审本文                                                               |

**回滚**：S1–S3 期间 `paperRenderer` flag 默认 `fragmented`；任一阶段失败，切回 flag 即恢复现状，旧代码与旧 e2e 全量保留到 S4 之后。

---

## 9. 与设计文档的关系

本文是**方案草案**，不修改 `view-model.md` 的立法地位。评审通过后需同步：

- `view-model.md` §2：删「全屏纸叶可见面 = 真分片投影 / 活引擎 display:none」，改为「单叶全屏 = 活引擎 + 原生分片 CSS；分屏右 pane = A″ 真分片投影」；
- `view-model.md` §5：M4.3b 结论补「该结论针对 DOM 重组路径；C 路径不重组，不受其约束」；
- `view-model.md` §6 实现地图：新增 `paper-native` 一族，标注 `paperProjection.vue` 降级；
- `sync-design.md` §9 M2：单叶全屏路径的编辑层退役说明；D6 的「激活期冻结重排」在 C 路径不再适用（原生连续分页）。

---

## 10. 需要拍板的开放问题

1. **页的排布**：C1c（单列视口 + 横向翻页）还是 C2（纵向连续纸带 + 页线）算「像 Word」？两者对编辑的实现完全不同。
2. **分屏右 pane**：确认保留 A″ 只读真分片投影（本文默认），还是分屏也降级为「只显示文视图」？
3. **是否接受「没有页卡 DOM」**：这会影响 M1 分片锚与 M2 编辑层的存续范围。
4. **S0 不通过的退路**：转 C2，还是维持现状 + 继续用 M2 富文本单块编辑层？
5. **A″ 裁决的改写时机**：S4 一次性改写，还是 S1 起就标注双轨？
6. **N2 P95 ≤300ms 是否作为 Go 门槛**：原生分片理论上更快，但页码 overlay 与 `doc-changed` 链路仍需实测。
