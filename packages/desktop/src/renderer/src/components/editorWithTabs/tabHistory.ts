import type { ISerializedHistory } from '@muyajs/core'
import { SyntheticHistory, type IFileHistoryLike } from './syntheticHistory'

// 按 tab 保存的引擎历史与保存跟踪历史。
//
// 引擎的撤销栈（`getHistory()`）与桌面端 store 的 `tab.history`（驱动保存 /
// 脏标记）形状不同：前者是 ot-json1 操作表，后者是桌面端自己的形状。因此这里
// 存两份按 tab id 索引的状态：
//
//   - 引擎历史：视图切换（word/page ↔ word/columns）与 tab 切换都会销毁引擎
//     实例，撤销栈随实例一起消失；存下来才能在新的实例里恢复。
//   - 合成历史：单调递增、从不复用的保存跟踪 id（见 `syntheticHistory.ts`），
//     任何一方改动文档都要用它算脏标记。
//
// 两个 map 都只在渲染进程内存里，刷新即丢——这与既有的 tab 切换恢复机制
// （同一会话内）一致。

const engineHistoryByTab = new Map<string, ISerializedHistory>()

/** 读某 tab 的引擎撤销栈；从未记录过返回 undefined。 */
export const readEngineHistory = (id: string): ISerializedHistory | undefined =>
  engineHistoryByTab.get(id)

/** 记录某 tab 的引擎撤销栈。 */
export const writeEngineHistory = (id: string, history: ISerializedHistory): void => {
  engineHistoryByTab.set(id, history)
}

const syntheticHistoryByTab = new Map<string, SyntheticHistory>()

export const getSyntheticHistory = (id: string, baselineContent: string): SyntheticHistory => {
  let tracker = syntheticHistoryByTab.get(id)
  if (!tracker) {
    tracker = new SyntheticHistory(baselineContent)
    syntheticHistoryByTab.set(id, tracker)
  }
  return tracker
}

// Re-baseline a tab's id allocator to the given content (id 0). Called after
// `setContent` reloads the document so the freshly loaded content is clean.
export const resetSyntheticHistory = (id: string, baselineContent: string): void => {
  syntheticHistoryByTab.set(id, new SyntheticHistory(baselineContent))
}

export const makeSyntheticHistory = (id: string, content: string): IFileHistoryLike => {
  return getSyntheticHistory(id, content).build(content)
}

// Drop per-tab bookkeeping for tabs that no longer exist. Tab ids are unique
// over the session, so without pruning these maps (and the content -> id map
// each `SyntheticHistory` holds) would grow unbounded as tabs are opened and
// closed. Driven by a watcher on the store's live tab id set.
export const pruneClosedTabState = (liveTabIds: Set<string>): void => {
  for (const id of engineHistoryByTab.keys()) {
    if (!liveTabIds.has(id)) engineHistoryByTab.delete(id)
  }
  for (const id of syntheticHistoryByTab.keys()) {
    if (!liveTabIds.has(id)) syntheticHistoryByTab.delete(id)
  }
}
