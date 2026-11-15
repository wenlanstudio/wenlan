import type { RaceQuestion } from '@/store/teaching'

export interface OrderedRaceQuestion extends RaceQuestion {
  /** 该题是否在放映当前页上（quiz 标记 id === questionKey 恒等链） */
  onPage: boolean
}

/**
 * 发题面板排序（缺口 B，2026-11-15 裁决）：放映当前页的题置顶，其余保持
 * 服务端返回顺序（sort 稳定，同组不乱序）。questionKey 缺失的老题按非本页处理。
 */
export function orderRaceQuestions(
  questions: RaceQuestion[],
  pageQuizKeys: string[]
): OrderedRaceQuestion[] {
  // 空串 questionKey（老数据）永不匹配本页
  const onPage = new Set(pageQuizKeys.filter(Boolean))
  return questions
    .map((q) => ({ ...q, onPage: Boolean(q.questionKey) && onPage.has(q.questionKey) }))
    .sort((a, b) => Number(b.onPage) - Number(a.onPage))
}
