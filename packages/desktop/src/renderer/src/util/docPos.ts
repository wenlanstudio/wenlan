// 公共坐标的纯组合换算层（视图模型 §6.0）。同步定位的量纲只有一个：源码行。
// 归一化后的文档位置是实数行位 ℓ* ∈ [1, N]（整数部分 = 行，小数部分 = 块内
// 行进度）。各面用「行覆盖」声明自己单位 ↔ 行的换算（σᵢ），用私有的、活读的
// 几何把 (单元, 进度) 实现成滚动位置（Rᵢ）；同步 = σᵢ → 行 → σⱼ⁻¹ → Rⱼ，
// 视图之间从不直接换算——N 张换算表，不是 N² 张两两表。
//
// 两阶层纪律：**结构版本化**（覆盖随 mdRev 重建，锚带版本、过期丢弃）与
// **几何活读**（top/height 在应用时现量，晚到资源只改几何、不动换算）。

/** 一个单元占据的行区间 [start, end]（1 基含端点）。 */
export interface LineSpan {
  start: number
  end: number
}

/**
 * 从各单元的首行表构造行覆盖：单元 i 占 [starts[i], starts[i+1] − 1]，末块
 * 封口到 totalLines。starts 非降；相邻单元同行开始（零行块：行内标记被解析
 * 吸收）时区间退化为单点，块内进度恒 0。
 */
export function spansFromStarts(starts: ArrayLike<number>, totalLines: number): LineSpan[] {
  const spans: LineSpan[] = []
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!
    const next = i + 1 < starts.length ? starts[i + 1]! : totalLines + 1
    spans.push({ start, end: Math.max(start, next - 1) })
  }
  return spans
}

/**
 * σᵢ⁻¹：行 → 单元下标（首现规则）。二分取最后一个 start ≤ line 的单元；
 * 行落覆盖空隙或超尾归最近前驱（末块区间本来就吞到文档尾）；line 在首单元
 * 之前（frontmatter 等行表外的头部）返回 null。
 */
export function locateSpan(spans: LineSpan[], line: number): number | null {
  if (!spans.length || line < spans[0]!.start) return null
  let lo = 0
  let hi = spans.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (spans[mid]!.start <= line) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 块内行进度 x = (ℓ* − a) / d ∈ [0, 1]（d = 单元行数；零行块恒 0，越界夹取）。
 * 这是规范化的块内坐标——在行空间定义，与像素无关，跨面可迁移的最细粒度。
 */
export function spanProgress(span: LineSpan, realLine: number): number {
  const d = span.end - span.start + 1
  if (d <= 0) return 0
  return Math.min(1, Math.max(0, (realLine - span.start) / d))
}

/** 块内行进度 → 实数行位（spanProgress 的逆，同一线性尺）。 */
export function spanRealLine(span: LineSpan, x: number): number {
  const d = span.end - span.start + 1
  return span.start + Math.min(1, Math.max(0, x)) * d
}

/**
 * 实现算子（Rᵢ 的单元内部分）：单元在其视图里的几何（top/height，活读）×
 * 块内行进度 → 该行位应落在的内容坐标。Rᵢ(ℓ*) = top(u) + x·h(u)。
 */
export function pixelForRealLine(top: number, height: number, span: LineSpan, realLine: number): number {
  return top + height * spanProgress(span, realLine)
}

/**
 * 读出算子（ρᵢ 的单元内部分）：视口顶在内容坐标里的位置 y + 含它的单元几何
 * → 实数行位。ρᵢ = a + d·(y − top)/h。ρᵢ ∘ Rᵢ = id（单元边界精确、块内按
 * 比例近似——两边块高不同（换行宽窄、晚到图片）时块内是投影对齐，块界不动）。
 */
export function realLineForPixel(top: number, height: number, span: LineSpan, y: number): number {
  if (height <= 0) return span.start
  const x = Math.min(1, Math.max(0, (y - top) / height))
  return span.start + x * (span.end - span.start + 1)
}
