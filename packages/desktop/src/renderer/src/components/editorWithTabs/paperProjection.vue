<template>
  <div class="paper-projection paper-projection-view">
    <div
      ref="host"
      class="paper-projection-muya"
    />
    <div
      ref="deck"
      class="mu-paper-deck"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * paperProjection — 纸叶真分片投影（视图模型 §5 / M4.3b，A″ 裁决）。
 *
 * 只读 muya 第二实例 + 行级拟合（util/paperPagination paginateBlocksV2）+
 * 分片执行器：段落裁剪窗对（头窗 = 原块截 keep 行；尾窗 = 克隆块上移）、
 * 表格行手术（续表 = 克隆外壳 + GFM 表头 + 移入的行）、其余整块搬移进页卡。
 *
 * 为什么敢拆 DOM：调研结论（§5 M4.3b）——真分片只能活在只读面。本组件的
 * muya 实例不接 json-change、不进保存/undo 管线，无插入锚点与 op path 之忧；
 * 每次重建 = setContent 全量重渲染 → 量测 → 分片 → 换装 deck。
 *
 * muya 宿主 visibility:hidden（保布局——量测需要真实几何）而非 display:none；
 * 被搬出的块成为 deck（可见子树）的子节点，正常渲染。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Muya, type IMuyaOptions } from '@muyajs/core'
import { usePreferencesStore } from '@/store/preferences'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'
import {
  measurePaperBlocksV2,
  paginateBlocksV2,
  parsePaperGeometry,
  type PaperBlockBoxV2,
  type PaperSeamV2
} from '@/util/paperPagination'

const props = defineProps<{
  markdown: string
}>()

const preferencesStore = usePreferencesStore()
const { language } = storeToRefs(preferencesStore)

const host = ref<HTMLDivElement | null>(null)
const deck = ref<HTMLDivElement | null>(null)
const muya = shallowRef<Muya | null>(null)

const PROJECTION_DEBOUNCE_MS = 250
let applyTimer = 0

const sum = (xs: number[]): number => xs.reduce((a, c) => a + c, 0)

/** 内容坐标 y → 页序（boundaries = [0, seam.y, ...]，页 p = [b[p], b[p+1])）。 */
const pageIndexOf = (boundaries: number[], y: number): number => {
  let page = 0
  while (page + 1 < boundaries.length && y >= boundaries[page + 1]!) page += 1
  return page
}

/** 段落裁剪窗对（头窗 = 原块截 keep 行；尾窗 = 克隆块上移已留量）。
 *  窗是 BFC：块自身的 margin 出不来——窗 margin-bottom 补回原块
 *  margin-bottom，后续块的自然塌陷间隙才与拟合账目一致。p 的 margin-top
 *  恒 0（gh：0 0 10px），公式写全以备未来其它块型。 */
const fragmentLines = (
  b: PaperBlockBoxV2,
  seams: PaperSeamV2[],
  cards: HTMLElement[],
  boundaries: number[],
  zoom: number
): void => {
  const lineStarts: number[] = []
  let acc = 0
  for (const h of b.lines!) {
    lineStarts.push(acc)
    acc += h
  }
  const segs = [0, ...seams.map(s => s.split!.keep), b.lines!.length]
  const cs = getComputedStyle(b.el!)
  const mt = (Number.parseFloat(cs.marginTop) || 0) * zoom
  const mb = (Number.parseFloat(cs.marginBottom) || 0) * zoom
  for (let s = 0; s < segs.length - 1; s++) {
    const from = segs[s]!
    const to = segs[s + 1]!
    if (to <= from) continue // keep=0 的段（整段推下页）无内容
    const page =
      cards[s === 0 ? pageIndexOf(boundaries, b.top) : pageIndexOf(boundaries, seams[s - 1]!.y)]!
    const win = document.createElement('div')
    win.className = 'mu-paper-clip'
    if (s === 0) {
      win.style.height = `${mt + lineStarts[to]! - lineStarts[from]!}px`
      win.appendChild(b.el!)
    } else {
      const clone = b.el!.cloneNode(true) as HTMLElement
      clone.style.transform = `translateY(${-(mt + lineStarts[from]!)}px)`
      win.style.height = `${lineStarts[to]! - lineStarts[from]!}px`
      win.appendChild(clone)
    }
    win.style.marginBottom = `${mb}px`
    page.appendChild(win)
  }
}

/** 表格行手术（md2slides splitTable 同款）：原表留首页行；续表 = 克隆外壳 +
 *  GFM 表头（rows[0]）克隆 + 移入的行。keep 记 body 行累计数（表头另算）。 */
const fragmentTable = (
  b: PaperBlockBoxV2,
  seams: PaperSeamV2[],
  cards: HTMLElement[],
  boundaries: number[]
): void => {
  const figure = b.el as HTMLElement
  const table = figure.querySelector(':scope > table')
  const rows = table
    ? (Array.from(
        table.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr')
      ) as HTMLElement[])
    : []
  if (!table || rows.length < 2 || !b.table) {
    cards[pageIndexOf(boundaries, b.top)]!.appendChild(figure)
    return
  }
  const segs = [0, ...seams.map(s => s.split!.keep), b.table.rowHeights.length]
  for (const tr of rows.slice(1 + segs[1]!)) tr.remove()
  cards[pageIndexOf(boundaries, b.top)]!.appendChild(figure)
  for (let s = 1; s < segs.length - 1; s++) {
    const page = cards[pageIndexOf(boundaries, seams[s - 1]!.y)]!
    const contFig = figure.cloneNode(false) as HTMLElement
    contFig.classList.add('mu-paper-table-cont')
    const contTable = table.cloneNode(false) as HTMLElement
    contTable.appendChild(rows[0]!.cloneNode(true))
    for (const tr of rows.slice(1 + segs[s]!, 1 + segs[s + 1]!)) contTable.appendChild(tr)
    contFig.appendChild(contTable)
    page.appendChild(contFig)
  }
}

/** 分片执行器：量测（自然几何）→ 拟合 → 页卡换装。 */
const fragment = (): void => {
  const muyaInst = muya.value
  const deckEl = deck.value
  if (!muyaInst || !deckEl) return
  const root = muyaInst.domNode
  const container = root?.querySelector<HTMLElement>(':scope > .mu-container')
  if (!root || !container) return

  const geometry = parsePaperGeometry(props.markdown ?? '')
  deckEl.style.setProperty('--paper-page-width', `${geometry.pageWidthMm}mm`)
  deckEl.style.setProperty('--paper-page-height', `${geometry.pageHeightMm}mm`)

  const m = measurePaperBlocksV2(container, geometry)
  // 空量测守卫：分片本身把块搬出 muya 容器——若一次过期的 fragment 在
  // 搬移之后才量测（重建竞态），会读到 0 块并把上一副好牌换成交白卷。
  // 保留现有 deck，等下一次重建（世代号新者胜，见 rebuild）。
  if (!m.blocks.length) return
  const layout = paginateBlocksV2(m.blocks, m.pageContentHeight)
  const boundaries = [0, ...layout.seams.map(s => s.y)]
  const zoom = Number.parseFloat(getComputedStyle(container).zoom || '1') || 1

  deckEl.replaceChildren()
  const cards: HTMLElement[] = []
  for (let k = 0; k < layout.pageCount; k++) {
    // 卡兼领 mu-container：块搬进卡后仍在「容器」作用域内，paperLens 的全部
    // 块度量规则（.mu-container p/h1/pre/…）零改动命中——搬出作用域会让
    // 字体/度量全部失配，卡片比拟合账目高出一截（e2e 卡高断言抓到过）。
    const card = document.createElement('div')
    card.className = 'mu-paper-page mu-container'
    const badge = document.createElement('div')
    badge.className = 'mu-paper-page-num'
    badge.textContent = String(k + 1)
    card.appendChild(badge)
    deckEl.appendChild(card)
    cards.push(card)
  }
  deckEl.dataset.pageCount = String(layout.pageCount)

  for (let i = 0; i < m.blocks.length; i++) {
    const b = m.blocks[i]!
    const el = b.el
    if (!el) continue
    const seams = layout.seams.filter(s => s.split?.block === i)
    if (!seams.length) {
      cards[pageIndexOf(boundaries, b.top)]!.appendChild(el)
    } else if (b.table && seams.some(s => s.split!.kind === 'table-rows')) {
      fragmentTable(b, seams, cards, boundaries)
    } else if (b.lines) {
      fragmentLines(b, seams, cards, boundaries, zoom)
    } else {
      // 无子结构的超页块（高图 / 长 pre）：真分片下无法表达——整块进首屏
      // 页、溢出可见（v1 穿缝的对应物，A″ 已知视觉，§5）。
      cards[pageIndexOf(boundaries, b.top)]!.appendChild(el)
    }
  }
}

/** 世代号：新重建使旧的 rAF 链作废——挂载重建与 fonts.ready 重建可能
 *  交叠，过期 fragment 会在前一次分片搬空容器后才量测（读 0 块）。 */
let rebuildGen = 0

const rebuild = (): void => {
  const gen = ++rebuildGen
  const muyaInst = muya.value
  if (!muyaInst) return
  muyaInst.setContent(props.markdown ?? '')
  // 双 rAF：等 muya 渲染提交布局后再量测分片。
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (gen === rebuildGen) fragment()
    })
  )
}

watch(
  () => props.markdown,
  () => {
    window.clearTimeout(applyTimer)
    applyTimer = window.setTimeout(rebuild, PROJECTION_DEBOUNCE_MS)
  }
)

onMounted(() => {
  if (!host.value) return
  const options: Partial<IMuyaOptions> = {
    ...buildMuyaViewOptions(),
    markdown: props.markdown,
    locale: getMuyaLocale(language.value),
    readOnly: true,
    focusMode: false,
    columnsLayout: 'flat'
  }
  const instance = new Muya(host.value, options)
  instance.init()
  muya.value = instance
  rebuild()
  void document.fonts?.ready.then(rebuild)
})

onBeforeUnmount(() => {
  window.clearTimeout(applyTimer)
  muya.value?.destroy()
  muya.value = null
})
</script>

<style scoped>
.paper-projection-view {
  height: 100%;
  overflow: auto;
  background: var(--editorBgColor);
  padding: 16px 0;
  position: relative;
}

/* muya 宿主：保布局（量测需要真实几何）、不显示、不吃事件。 */
.paper-projection-muya {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  left: 0;
  top: 0;
}

.mu-paper-deck {
  width: var(--paper-page-width, 210mm);
  margin: 0 auto;
}
</style>
