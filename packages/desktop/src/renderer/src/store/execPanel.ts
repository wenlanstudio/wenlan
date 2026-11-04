import { ref } from 'vue'
import { defineStore } from 'pinia'

/**
 * 底部执行面板的「跨组件状态」。
 *
 * 面板开关住在状态栏（JetBrains 式：状态栏是窗口 chrome，底部工具窗口是编辑器
 * 列内的附属面），面板 body 住在编辑器列。两者是不同组件，故把开关态与计数放
 * 在这里共享，execPanel 只负责把自身状态同步进来，状态栏只负责读与 toggle。
 *
 * 为什么要共享而不是 Teleport：Teleport 依赖目标节点在挂载时已存在，而状态栏
 * 与编辑器列是兄弟分支，首帧顺序不可靠；共享状态没有这类时序问题。
 */
export const useExecPanelStore = defineStore('execPanel', () => {
  /** 是否值得露面（有围栏 / 已解析出块 / 解析报错）。 */
  const visible = ref(false)
  /** 展开态：body 是否渲染。折叠时状态栏上只剩一个按钮。 */
  const open = ref(false)
  /** 围栏总数与可跑块数（状态栏计数徽章）。 */
  const total = ref(0)
  const runnable = ref(0)
  /** 运行中的块数（状态栏脉冲点）。 */
  const running = ref(0)

  const toggle = (): void => {
    open.value = !open.value
  }

  const setOpen = (value: boolean): void => {
    open.value = value
  }

  const sync = (patch: {
    visible?: boolean
    total?: number
    runnable?: number
    running?: number
  }): void => {
    if (patch.visible !== undefined) visible.value = patch.visible
    if (patch.total !== undefined) total.value = patch.total
    if (patch.runnable !== undefined) runnable.value = patch.runnable
    if (patch.running !== undefined) running.value = patch.running
  }

  return { visible, open, total, runnable, running, toggle, setOpen, sync }
})
