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
 * 分片执行器：段落/代码块裁剪窗对（头窗 = 原块截 keep 行；尾窗 = 克隆块
 * 上移）、表格行手术（续表 = 克隆外壳 + GFM 表头 + 移入的行）、子单元手术
 * （列表/引用：原块留首页单元，续段 = 克隆外壳 + 移入单元，OL 续号）、
 * 其余整块搬移进页卡。
 *
 * 为什么敢拆 DOM：调研结论（§5 M4.3b）——真分片只能活在只读面。本组件的
 * muya 实例不接 json-change、不进保存/undo 管线，无插入锚点与 op path 之忧；
 * 每次重建 = setContent 全量重渲染 → 量测 → 分片 → 换装 deck。
 *
 * muya 宿主 visibility:hidden（保布局——量测需要真实几何）而非 display:none；
 * 被搬出的块成为 deck（可见子树）的子节点，正常渲染。
 *
 * 分栏（2026-11-10）：纸面按 `<!-- begin/split/end -->` 真排成左右双栏，而不是
 * 像编辑面那样用 display:contents 摊平——打印链 exportStyle.css 的
 * .mdcols-group 本来就是 flex 行，摊平会让「屏显所见 = 打印所得」破功。布局
 * 由 paperLens.css 在 .paper-projection 作用域内直给 .mu-columns（量测宿主与
 * 页卡同规则），**不切引擎的 columnsLayout**：那个类会把 pagebreak 徽标一并
 * 隐藏，屏测的强制缝依据就没了。超页的栏组按横带逐页裁切（fragmentBand）。
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
  lineBandOffsets,
  parsePaperGeometry,
  parsePaperTheme,
  type PaperBlockBoxV2,
  type PaperSeamV2
} from '@/util/paperPagination'
// 论文主题双作用域单源：本文件的 .paper-theme-thesis 组作用于纸面（量测
// 面 + 投影面），.markdown-body 组在应用 DOM 里无宿主（惰性）。挂类必须
// 发生在量测前（fragment 开头），主题的排版值才进分页账目。
import '@/assets/themes/export/thesis.theme.css'

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
  // 长度 n+1：末段的 to === n 必须取得到「块底」这个累计值，否则窗高变成
  // NaNpx 退回 auto（整块高），下一页多出一截空白（见 lineBandOffsets）。
  const lineStarts = lineBandOffsets(b.lines!)
  const segs = [0, ...seams.map((s) => s.split!.keep), b.lines!.length]
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

/**
 * 分栏组横带裁切（纸面真双栏）：组是 flex 行、两栏并排，无法拆成顺序块流，
 * 故整组当作一条可任意高度切的「横带」——每页一个裁剪窗，窗内是同一个组
 * （续片为深克隆）按累计偏移上移，窗高 = 该片吃到的页容量。段内两栏仍并排，
 * 与打印链 Chromium 对 .mdcols-group 的碎片化同构。
 *
 * seams 的 split.keep 是**累计视觉 px**（不是单元计数），segs 因此直接就是
 * 横带切点；transform 只动视觉位置，不改组内部布局与栏宽。
 */
const fragmentBand = (
  b: PaperBlockBoxV2,
  seams: PaperSeamV2[],
  cards: HTMLElement[],
  boundaries: number[]
): void => {
  const el = b.el as HTMLElement
  const height = b.band?.height ?? el.getBoundingClientRect().height
  const segs = [0, ...seams.map((s) => s.split!.keep), height]
  for (let s = 0; s < segs.length - 1; s++) {
    const from = segs[s]!
    const to = segs[s + 1]!
    if (to <= from) continue
    const page = cards[pageIndexOf(boundaries, b.top + from)]!
    const win = document.createElement('div')
    win.className = 'mu-paper-band-clip'
    win.style.height = `${to - from}px`
    const group = (s === 0 ? el : el.cloneNode(true)) as HTMLElement
    group.classList.add('mu-paper-band')
    group.style.transform = `translateY(${-from}px)`
    win.appendChild(group)
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
  const segs = [0, ...seams.map((s) => s.split!.keep), b.table.rowHeights.length]
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

/**
 * 子单元手术（#7：列表 li / 引用子块；#7 边界②：跨段子元素）：单元区间
 * → DOM 归属还原（kids + kidOwners）。整属本段的子元素照旧搬移——原块留
 * 首页段（其余摘除）、续段 = 克隆外壳（保留 class/attrs/样式）+ 移入的
 * 子元素；OL 续段按「首页起点 + 段内首个完整 li 序」改 start（Chromium 碎
 * 片化里同一个 <ol> 跨页连号，克隆出的新 <ol> 会从 1 重计，须显式续号）。
 * 跨段的子元素（超页 li / 超页引用子块——缝落进它内部）做裁剪手术：原块
 * 内截高（overflow hidden）；续段克隆该子元素、translateY 上移段前已耗量
 * + 截高。li 的续段克隆不重显 marker（Chromium 碎片化 marker 只随首段）。
 */
const fragmentKids = (
  b: PaperBlockBoxV2,
  seams: PaperSeamV2[],
  cards: HTMLElement[],
  boundaries: number[]
): void => {
  const el = b.el as HTMLElement
  const childEls = Array.from(el.children).filter((kid) =>
    el.tagName === 'UL' || el.tagName === 'OL' ? kid.tagName === 'LI' : kid instanceof HTMLElement
  ) as HTMLElement[]
  if (!b.kids || !b.kids.length || !childEls.length) {
    cards[pageIndexOf(boundaries, b.top)]!.appendChild(el)
    return
  }
  const kids = b.kids
  // 归属缺省（纯层合成数据）= 平铺逐单元对应；越界归属夹回。
  const owners = kids.map((_, i) => Math.min(b.kidOwners?.[i] ?? i, childEls.length - 1))
  // 单元前缀和 + 各子元素的单元区间 [unitStart, unitEnd)（单元按序连续
  // 归属同一子元素——切点按视口坐标排序保证）。
  const prefix: number[] = [0]
  for (const h of kids) prefix.push(prefix[prefix.length - 1]! + h)
  const spans: Array<[number, number] | undefined> = new Array(childEls.length).fill(undefined)
  for (let u = 0; u < kids.length; u++) {
    const o = owners[u]!
    const span = spans[o]
    if (span) span[1] = u + 1
    else spans[o] = [u, u + 1]
  }
  const segs = [0, ...seams.map((s) => s.split!.keep), kids.length]
  const baseStart = Number.parseInt(el.getAttribute('start') ?? '1', 10) || 1

  // 段 0：原块留段内单元——整属的留原处，跨段的截高，其余摘除。
  for (let o = 0; o < childEls.length; o++) {
    const span = spans[o]
    if (!span) continue
    const [us, ue] = span
    const kid = childEls[o]!
    if (ue <= segs[1]!) continue // 整属段 0：留原处
    if (us < segs[1]!) {
      kid.style.height = `${prefix[segs[1]!]! - prefix[us]!}px`
      kid.style.overflow = 'hidden'
    } else {
      kid.remove()
    }
  }
  cards[pageIndexOf(boundaries, b.top)]!.appendChild(el)

  // 段 1..n：续段外壳。整属子元素移入（再延伸到后段的截高）；跨段起头
  // 的克隆（translateY 上移段前已耗量 + 截高 + 隐藏 marker）。
  for (let s = 1; s < segs.length - 1; s++) {
    const page = cards[pageIndexOf(boundaries, seams[s - 1]!.y)]!
    const shell = el.cloneNode(false) as HTMLElement
    shell.classList.add('mu-paper-kids-cont')
    // OL 续号：段内首个完整 li 的序（若段首个是跨段克隆，其后首个完整
    // li = 跨段子元素 + 1；纯克隆段无可见序，取值不影响显示）。
    let numberedIdx: number | null = null
    for (let o = 0; o < childEls.length; o++) {
      const span = spans[o]
      if (!span) continue
      const [us, ue] = span
      if (ue <= segs[s]! || us >= segs[s + 1]!) continue // 与本段无交集
      const kid = childEls[o]!
      if (us >= segs[s]!) {
        if (numberedIdx === null) numberedIdx = o
        if (ue > segs[s + 1]!) {
          kid.style.height = `${prefix[segs[s + 1]!]! - prefix[us]!}px`
          kid.style.overflow = 'hidden'
        }
        shell.appendChild(kid)
      } else {
        if (numberedIdx === null) numberedIdx = o + 1
        const clone = kid.cloneNode(true) as HTMLElement
        clone.classList.add('mu-paper-kids-part')
        clone.style.transform = `translateY(${-(prefix[segs[s]!]! - prefix[us]!)}px)`
        clone.style.height = `${prefix[Math.min(ue, segs[s + 1]!)!]! - prefix[segs[s]!]!}px`
        clone.style.overflow = 'hidden'
        // Chromium 碎片化里 li 的 marker 只随首段；续段克隆不得重显。
        if (el.tagName === 'UL' || el.tagName === 'OL') clone.style.listStyle = 'none'
        shell.appendChild(clone)
      }
    }
    if (el.tagName === 'OL') {
      shell.setAttribute('start', String(baseStart + (numberedIdx ?? 0)))
    }
    page.appendChild(shell)
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

  // 纸面主题（frontmatter paperTheme）：量测面与投影面同拍挂类——量测在
  // 隐藏 muya 宿主里做，只挂投影面会让主题排版不进分页账目（卡高漂移）。
  // 挂类先于 measurePaperBlocksV2，本代 fragment 的量测即含主题排版。
  // 目前唯一主题 = thesis；新主题在 thesis.theme.css 旁加同构 CSS 后在此登记。
  const thesis = parsePaperTheme(props.markdown ?? '') === 'thesis'
  root.classList.toggle('paper-theme-thesis', thesis)
  deckEl.classList.toggle('paper-theme-thesis', thesis)

  const m = measurePaperBlocksV2(container, geometry)
  // 量测竞态由 rebuild 的世代号守卫负责（过期 fragment 不跑）；这里**不因
  // 0 块早退**——空文档（新文件/加载失败的 tab）必须照常出一张空白 A4 卡，
  // 否则纸叶全屏就是整屏空白（其它叶空文档都有可见面，Word 空白页同义）。
  const layout = paginateBlocksV2(m.blocks, m.pageContentHeight)
  const boundaries = [0, ...layout.seams.map((s) => s.y)]
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
    const seams = layout.seams.filter((s) => s.split?.block === i)
    if (!seams.length) {
      cards[pageIndexOf(boundaries, b.top)]!.appendChild(el)
    } else if (b.table && seams.some((s) => s.split!.kind === 'table-rows')) {
      fragmentTable(b, seams, cards, boundaries)
    } else if (b.kids && seams.some((s) => s.split!.kind === 'kids')) {
      fragmentKids(b, seams, cards, boundaries)
    } else if (b.band && seams.some((s) => s.split!.kind === 'band')) {
      fragmentBand(b, seams, cards, boundaries)
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
    // 引擎保持 flat：分栏布局是纸面投影自己的版式（paperLens.css），切
    // columnsLayout 会连 pagebreak 徽标一起隐藏，强制分页符就量不到了。
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
