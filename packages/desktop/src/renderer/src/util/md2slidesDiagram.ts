/**
 * md2slidesDiagram.ts — 映支视图（页览/放映）的图表桥。
 *
 * deck 页面（deck-full）里 compose 自己跑，mermaid / echarts 由页面侧渲染；但
 * graphviz(dot) / plantuml / matplotlib 页面里画不了，经 postMessage 托**本进程**离屏出图：
 *
 *   graphviz → 优先系统 dot.exe（-Tpng -Gdpi=192，直接冻结位图）；没装或失败
 *              才回退 `@viz-js/viz`（WASM，与 muya 编辑器同款依赖）→ SVG → PNG
 *              （2x，画白底）。与「文」视图共用 graphvizRender 的同一决策。
 *   plantuml → 既有 `mt::diagram::fetch-plantuml` IPC（main 进程 net.fetch 到
 *              plantuml server）→ PNG 字节 → data URL
 *   matplotlib → 既有 `mt::diagram::render-external` IPC（main 进程 spawn Python，
 *              与「文」视图同一条通道、同一个开关）→ SVG → PNG（同 graphviz 的栅格口径）
 *
 * 出来的是**冻结位图**：注入 deck 那一刻定死，分页 / 查看器 / IR / PPTX 导出全链
 * 路同一份字节（"所见即所导"；SVG 是带样式依赖的活物，搬家会变样——裁决见
 * md2slides 仓 docs/design/integration-marktext.md §5.2 与对话记录）。
 */

import { serializeSvg, type SerializedSvg } from './diagramExport'
import { renderGraphvizWithExe } from './graphvizRender'
import type { instance as vizInstance } from '@viz-js/viz'

const PNG_SCALE = 2
const MAX_PIXELS = 4e7
const BACKGROUND = '#ffffff'

/** viz 实例是 WASM 编译器，加载一次全进程复用（muya 的 render.ts 同款用法）。 */
type Viz = NonNullable<Awaited<ReturnType<typeof vizInstance>>>
let vizPromise: Promise<Viz> | null = null

const getViz = (): Promise<Viz> => {
  if (!vizPromise) {
    vizPromise = import('@viz-js/viz').then(async({ instance }) => {
      const viz = await instance()
      if (!viz) throw new Error('viz WASM 初始化失败')
      return viz
    })
  }
  return vizPromise
}

/** SVG 序列化结果 → PNG data URL（data: URL 装 SVG：CSP 下不用 blob，也不污染 canvas）。 */
const rasterizeToDataUrl = (svg: SerializedSvg): Promise<string> =>
  new Promise((resolve, reject) => {
    const scale = Math.min(PNG_SCALE, Math.sqrt(MAX_PIXELS / (svg.width * svg.height)))
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(svg.width * scale))
      canvas.height = Math.max(1, Math.round(svg.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('dot 图栅格化失败：拿不到 2D 上下文'))
        return
      }
      context.fillStyle = BACKGROUND
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('dot 图栅格化失败：SVG 装载失败'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`
  })

/**
 * dot 源码 → PNG data URL（离屏）。
 *
 * 优先用系统的 dot.exe：`-Tpng -Gdpi=192` 已经是冻结位图，正好是 deck 要的
 * 那一份字节，直接注入即可，不必再经 SVG 栅格。没装或跑不通时静默回退 viz
 * WASM → SVG → 2x 栅格（原链路），保证讲义在任何机器上都能放映。
 */
export const renderGraphvizToDataUrl = async(source: string): Promise<string> => {
  const exe = await renderGraphvizWithExe(source)
  if (exe.ok) return exe.dataUrl

  const viz = await getViz()
  if (!viz) throw new Error('dot 图渲染失败：viz WASM 实例未就绪')
  const element = viz.renderSVGElement(source)
  const svg = serializeSvg(element, { inlineStyles: false, background: BACKGROUND })
  return rasterizeToDataUrl(svg)
}

/** plantuml 源码 → PNG data URL（编码后走既有 IPC；server 来自偏好，缺省用官方）。 */
export const renderPlantumlToDataUrl = async(source: string, server: string): Promise<string> => {
  const { encode } = await import('plantuml-encoder')
  const result = await window.diagram.fetchPlantuml(server, encode(source), 'png')
  if (!result.ok) throw new Error(`plantuml 渲染失败：${result.error}`)

  // Uint8Array → base64 分块转换（spread 大数组会爆调用栈）。
  let binary = ''
  for (let i = 0; i < result.data.length; i += 0x8000) {
    binary += String.fromCharCode(...result.data.subarray(i, i + 0x8000))
  }
  return `data:${result.mime};base64,${btoa(binary)}`
}

/** base64（UTF-8 字节）→ 文本；atob 只给 latin1，必须过一遍 TextDecoder 才不会把中文弄坏。 */
const decodeBase64Utf8 = (data: string): string => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** SVG 文本 → PNG data URL；尺寸取解码后的 naturalWidth/Height（matplotlib 的 SVG 带 pt 尺寸）。 */
const rasterizeMarkup = (markup: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const naturalWidth = image.naturalWidth || 960
      const naturalHeight = image.naturalHeight || 720
      const scale = Math.min(PNG_SCALE, Math.sqrt(MAX_PIXELS / (naturalWidth * naturalHeight)))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('matplotlib 图栅格化失败：拿不到 2D 上下文'))
        return
      }
      context.fillStyle = BACKGROUND
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('matplotlib 图栅格化失败：SVG 装载失败'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })

/**
 * matplotlib 源码 → PNG data URL。
 *
 * 与「文」视图同一条 IPC（`window.diagram.renderExternal`），因此共用同一个开关与
 * Python 路径偏好：文视图能画的，览/映就能画；文视图关着，这边也会明确报错。
 * IPC 回的是 SVG（编辑器要矢量），deck 要**冻结位图**（分页 / IR / PPTX 同一份字节），
 * 所以在这里栅格成 PNG。
 */
export const renderMatplotlibToDataUrl = async(source: string): Promise<string> => {
  const result = await window.diagram.renderExternal('matplotlib', source)
  if (!result.ok) throw new Error(`matplotlib 渲染失败：${result.error}`)
  return rasterizeMarkup(decodeBase64Utf8(result.data))
}
