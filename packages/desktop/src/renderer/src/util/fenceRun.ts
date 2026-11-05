import type { Md2rBlockInfo } from '@shared/types/mdcode2run'

/**
 * 围栏按钮 → 源码行号的桥。
 *
 * muya 的块模型没有「源码第几行」这个概念（DOM 上也没有 data-line），而
 * mdcode2run.run() 要 0 基开栏行号。按钮点击时能拿到的只有块体原文，所以用
 * parse() 的块清单按块体精确反查——比按 DOM 顺序数第 N 个围栏稳（frontmatter、
 * 图表、math 等共享 Code 类，顺序会错位）。
 */

/** 围栏体文本：跳过开栏行与闭栏行（end 为闭栏后的下一行，0 基、不含）。 */
export const codeSlice = (md: string, b: Pick<Md2rBlockInfo, 'line' | 'end'>): string => {
  const lines = md.split('\n')
  return lines.slice(b.line + 1, Math.max(b.line + 1, b.end - 1)).join('\n')
}

/**
 * 按块体原文反查围栏。多个块正文相同（讲义里很常见）时优先取可执行块；
 * 仍重复则取文档中第一个。找不到返回 null（parse 未完成 / 未保存文档）。
 */
export const findFenceByCode = (
  md: string,
  blocks: Md2rBlockInfo[],
  text: string
): Md2rBlockInfo | null => {
  if (!text) return null
  const matches = blocks.filter(b => codeSlice(md, b) === text)
  if (matches.length === 0) return null
  return matches.find(b => b.runnable) ?? matches[0] ?? null
}
