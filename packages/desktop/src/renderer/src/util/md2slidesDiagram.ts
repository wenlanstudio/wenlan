/**
 * md2slidesDiagram.ts — 示支视图（页览/放映）的图表桥。
 *
 * deck 页面（deck-full）里 compose 自己跑，mermaid / echarts 由页面侧渲染；但
 * graphviz(dot) 与 plantuml 页面里画不了，经 postMessage 托**本进程**离屏出图：
 *
 *   graphviz → `@viz-js/viz`（WASM，与 muya 编辑器同款依赖——编辑器里长什么样，
 *              deck 里就是什么样，同库同版本）→ SVG → PNG（2x，画白底）
 *   plantuml → 既有 `mt::diagram::fetch-plantuml` IPC（main 进程 net.fetch 到
 *              plantuml server）→ PNG 字节 → data URL
 *
 * 出来的是**冻结位图**：注入 deck 那一刻定死，分页 / 查看器 / IR / PPTX 导出全链
 * 路同一份字节（"所见即所导"；SVG 是带样式依赖的活物，搬家会变样——裁决见
 * md2slides 仓 docs/design/integration-marktext.md §5.2 与对话记录）。
 */

import { serializeSvg, type SerializedSvg } from './diagramExport'
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

/** dot 源码 → PNG data URL（离屏；viz 的 SVG 自带表现属性，不需内联样式补偿）。 */
export const renderGraphvizToDataUrl = async(source: string): Promise<string> => {
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
