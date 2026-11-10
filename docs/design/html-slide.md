# HTML 放映稿 · 文览「映」宿主实现说明

> **权威契约**：`md2slides/docs/html-deck-contract.md`（HTML 放映稿契约 v1）
> 本文只描述**文览作为宿主**的接线与边界；文稿必须满足什么，一律以契约为准。
>
> **状态（2026-11-10）**：契约条款已裁决并落地 ①–④（校验与拒绝、摄取模型、
> 步进动画触发、文档）。R1 保留硬要求 / R8 允许绑定步进的动画（触发时机归宿主）。
> 「0 页自动包单页」兜底**已删除**；不合规文稿现在会被结构化拒绝。
> 详见契约 §11；§4 是历史待改造表的更新版。

## 1. 产品行为

文览「文件 → 打开文件」支持 `html` / `htm` 放映稿：打开后由**映视图**（`present` 叶）
按 md2slides 播放器契约放映，不做 muya 编辑、不改写源码（纯放映，见视图模型 §6）。

- 不进 muya，无「文/栏/页/本/表/图/码」等编辑/透镜面；打开即锁定到放映型叶（览/映）。
- 不支持从 HTML 放映稿导出 PPTX（缺 compose/IR 中间表示）。
- 不重跑图表预通行 / 物理分页 / 代码染色——合规文稿的 DOM 原样交给播放器。

## 2. 宿主接线（现状）

```
deckPane.vue (renderer, 零 md2slides 依赖)
   ├─ isHtmlSlidePath(pathname) → 按扩展名分流
   ├─ md2s:build { html, mdDir, slideWidth, slideHeight, runOpts }   ← 而非 { md }
   └─ 跳过 md2s:exec-capability（无文览源码、无可跑块）与 PPTX 导出
              │ postMessage（跨源，目标源钉死为放映服务源）
              ▼
resources/md2slides/deck.html (本地放映服务，绕开编辑器 CSP)
   └─ dist/deck-full.js → doBuild(msg)
        └─ msg.html != null → buildHtml()：跳过 compose → deckCore.run({skipBuild:true})
                                          → createDeckPlayer()
```

`deck-core.run({skipBuild:true})` 跳过「图表预通行 / 物理分页 / 代码染色」三道**改写 DOM**
的工序——合规文稿是作者编排好的终态，宿主不该再动它。

> 资产重打：改 md2slides 源码后 dev 不会自动生效，须
> `cd md2slides && npm run pack:marktext` → `cd wenlan && node scripts/sync-md2slides.mjs`。
> 判断跑的是新包还是旧包，直接 grep `resources/md2slides/dist/deck-full.js` 里的新符号最快。

## 3. 边界

- 文稿在**跨源 iframe** 中渲染；相对图片改道本地服务 `/f?p=`，白名单仅含文稿所在目录。
- `innerHTML` 注入不执行 `<script>`；契约 R3 仍显式禁止脚本。
- 不做 HTML 清洗后「尽力放映」——清洗改变作者意图，与契约 P7 冲突。

## 4. 已落地改造（2026-11-10）

| 原问题                                   | 现在                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0 页自动包单页                           | **已删除**；`validateHtmlDeck` 判定 E_NO_SLIDES 并结构化拒绝                                           |
| 无校验，任何 HTML 都注入                 | `md2slides/core/htmlDeck/validate.js` 在摄取 ② 阶段跑 R1–R12                                           |
| 整篇 `root.innerHTML = msg.html`         | DOMParser 提取唯一 `#deck` 子树 + 全部 `<style>` 后 `importNode`                                       |
| 渲染进程正则抠旧 `md2slides-canvas` meta | 校验器读 `wenlan-deck:canvas`，随 `md2s:ready` 回传；单一真源                                          |
| 兜底白底 CSS                             | 宿主只钉死画布尺寸，配色交文稿 `<style>`                                                               |
| 错误只回一句 `message`                   | `md2s:error{stage:"validate", issues[]}`；deckPane 按条渲染 rule/code/where/message/fix（同类聚合 ×N） |
| 播放器不触发动画                         | `kit/player.js::syncAnims` 按页进入/步成为当前切换 `.md2s-anim-play`，导出冻结                         |

保留 `kit/steps.js` 的 `if (!section) return []`（引擎级防御，0 页播放器不应崩）。
`kit/steps.js` 与 `core/htmlDeck/validate.js` 的 `ANIM_PLAY_CLASS` 有单测断言防漂移。

> **注意**：现有 `yarn-slides` 三份文稿尚未按契约 §9 迁移，现在点「映」会被
> **明确拒绝并显示逐条诊断**——这是预期行为。宿主不写兼容代码。

## 5. 已改动文件索引

- `common/filesystem/paths.ts`：`HTML_SLIDE_EXTENSIONS` + `hasHtmlSlideExtension`（main 侧）。
- `main/filesystem/markdown.ts`：`normalizeOpenPath`（接纳 html/htm）。
- `main/app/index.ts`：`app-open-files-by-id` 改用 `normalizeOpenPath`。
- `main/menu/actions/file.ts`：打开对话框加「HTML slide deck」过滤器。
- `renderer/.../deckPane.vue`：扩展名分流、发 `html`、跳过 ▶/导出。
- `renderer/store/editorView.ts` + `viewSwitcher`：HTML 文档锁定放映型叶、隐藏编辑类入口。
  > 渲染进程**严禁**引 `common/filesystem/paths`（会拽入 node `fs/fs-extra` 链导致白屏），
  > 扩展名判定用 `window.path.extname` 就地做。
- `md2slides/host/marktext/deck-full-entry.js`：`doBuild` 的 `msg.html` 分支。
- `md2slides/host/browser/deck-core.js`：`run({skipBuild:true})`。
- `md2slides/kit/steps.js`：`buildStepPlan(undefined)` 返回空步表（引擎护栏）。
