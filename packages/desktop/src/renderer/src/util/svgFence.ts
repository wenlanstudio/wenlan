/**
 * svgFence.ts — ` ```svg ` 围栏的 SVG 文本 → PNG data URL。
 *
 * 与 md2slides `host/browser/svgHost.js` 同口径（同一份校验规则），这样「文 / 栏 / 页」
 * 与「览 / 示」看到的是同一张图：围栏在进 DOM 之前就被冻结成 2x 位图，
 * 分页量到的高度是真的，导出拿到的媒体是 .png，python-pptx 也认。
 *
 * 为什么不放进 muya：muya 是独立 workspace 包，不依赖 desktop；栅格要用
 * `Image` + `canvas`，属于宿主设施。走 `renderExternalDiagram` 回调，
 * 与 matplotlib / dot.exe 同构（buildMuyaViewOptions 会把回调注入每个实例）。
 *
 * SVG 作为 `<img>` 的 data URL 加载时处于 secure static mode：不执行脚本、
 * 不加载外部资源——所以 `<foreignObject>` / 外链图片 / 外部字体画不出来，
 * 对这几样直接硬失败，不给一张空白图。
 */

const XMLNS = 'http://www.w3.org/2000/svg'
const PNG_SCALE = 2
const MAX_PIXELS = 4e7
const RE_SVG_START = /<svg\b/i
const RE_VIEWBOX = /\bviewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)\s*["']/i
const RE_WIDTH = /\bwidth\s*=\s*["']([^"']+)["']/i
const RE_HEIGHT = /\bheight\s*=\s*["']([^"']+)["']/i
const RE_COMMENT = /<!--[\s\S]*?-->/g

/** 只认无单位或 px 的数值；百分比 / cm / em 在分页里没有可量基准。 */
const pxOf = (value: string | undefined): number | null => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/.exec(String(value ?? ''))
  const n = m ? Number(m[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 取 `<svg …>` 开标签原文。不能用 `/<svg[^>]*>/`：`aria-label="a > b"`
 * 会把正则截在半路，排在后面的 viewBox 就读不到了。
 */
const svgOpenTag = (source: string): string => {
  const start = RE_SVG_START.exec(source)?.index ?? -1
  if (start < 0) return ''
  let quote = ''
  for (let i = start + 4; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = ''
    }
    else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return source.slice(start, i + 1)
  }
  return ''
}

/** viewBox 优先（`width="100%"` 没有可量基准），其次数值 width/height。 */
const svgIntrinsicSize = (open: string): { width: number; height: number } | null => {
  const vb = RE_VIEWBOX.exec(open)
  if (vb) {
    const width = Number(vb[3])
    const height = Number(vb[4])
    if (width > 0 && height > 0) return { width, height }
  }
  const width = pxOf(RE_WIDTH.exec(open)?.[1])
  const height = pxOf(RE_HEIGHT.exec(open)?.[1])
  return width && height ? { width, height } : null
}

/**
 * PlantUML 会写 `<!--?plantuml-src …-->`，注释里带 `--`，XML 不允许连续
 * 两个连字符 ⇒ 整个 SVG 不是合法 XML。注释只是元数据，去掉不影响画面。
 */
const stripSvgComments = (source: string): string => source.replace(RE_COMMENT, '')

/** DOMParser 解析失败是静默的（塞 <parsererror>），必须显式验根。 */
const parseSvgDocument = (text: string): { root: SVGSVGElement | null; ok: boolean } => {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc?.documentElement
  const ok = root?.nodeName === 'svg' && !doc.querySelector('parsererror')
  return { root: ok ? (root as unknown as SVGSVGElement) : null, ok: !!ok }
}

/** 全白位图比没有更糟（多半是 foreignObject / 外部资源），抽查墨迹比例。 */
const isBlank = (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean => {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const stride = 4 * 37
  let total = 0
  let ink = 0
  for (let i = 0; i < data.length; i += stride) {
    total += 1
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink += 1
  }
  return total > 0 && ink / total < 0.0005
}

export interface NormalizedSvg {
  markup: string
  width: number
  height: number
}

/**
 * 校验并规范化围栏源码，产出可独立使用的 SVG markup。
 *
 * @param code 围栏里的完整 SVG/XML 源码
 * @throws 空围栏 / 非完整 svg / 缺尺寸 / 非法 XML / foreignObject
 */
export const normalizeSvgFence = (code: string): NormalizedSvg => {
  const source = String(code ?? '').trim()
  if (!source) throw new Error('svg 围栏是空的：请放完整的 <svg>…</svg>')

  const open = svgOpenTag(source)
  if (!open) throw new Error('svg 围栏里要放完整的 <svg viewBox="0 0 宽 高">…</svg>，不接受片段或外链路径')

  const size = svgIntrinsicSize(open)
  if (!size) {
    throw new Error('svg 围栏量不出尺寸：请写 viewBox="0 0 宽 高"（推荐）或数值 width/height；width="100%" 没有可量基准')
  }

  let parsed = parseSvgDocument(source)
  if (!parsed.ok && source.includes('<!--')) parsed = parseSvgDocument(stripSvgComments(source))
  if (!parsed.ok) {
    throw new Error('svg 围栏不是合法 XML：检查标签闭合、属性引号，以及 & 是否写成 &amp;')
  }

  const svg = parsed.root
  if (!svg) throw new Error('SVG 解析失败：拿不到 <svg> 根元素')
  svg.setAttribute('xmlns', XMLNS)
  svg.setAttribute('width', String(size.width))
  svg.setAttribute('height', String(size.height))
  if (svg.getElementsByTagName('foreignObject').length > 0) {
    throw new Error('svg 围栏含 <foreignObject>：浏览器不绘制塞进 <img> 的 foreignObject，请改用 <text> 或先导出 PNG')
  }

  return {
    markup: new XMLSerializer().serializeToString(svg),
    width: size.width,
    height: size.height,
  }
}

/**
 * @param code 围栏里的完整 SVG/XML 源码
 * @returns PNG data URL（2x，白底）
 * @throws normalizeSvgFence 的全部条件，外加栅格空白 / canvas 不可用
 */
export const rasterizeSvgFence = async(code: string): Promise<string> => {
  const { markup, width, height } = normalizeSvgFence(code)
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  return new Promise<string>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(PNG_SCALE, Math.sqrt(MAX_PIXELS / (width * height)))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('SVG 栅格失败：拿不到 2D 上下文'))
        return
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      if (isBlank(context, canvas)) {
        reject(new Error('SVG 栅格出来是空白：多半用了外链图片或外部字体，请内嵌素材或先导出 PNG'))
        return
      }
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('SVG 装载失败：不是可被当作图片加载的合法 SVG'))
    image.src = dataUrl
  })
}
