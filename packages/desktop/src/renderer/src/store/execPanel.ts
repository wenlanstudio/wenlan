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

/** 面板高度的持久化键（renderer 侧 localStorage，与侧栏宽度同一套惯例）。 */
const HEIGHT_KEY = 'exec-panel-height'
/** 拖拽下限：再矮就只剩两三行，块清单与输出都没法读。 */
export const PANEL_MIN_HEIGHT = 160
/** 默认高度：够看块清单 + 一屏输出，又不至于一开就把编辑区挤没。 */
export const PANEL_DEFAULT_HEIGHT = 280
const DEFAULT_HEIGHT = PANEL_DEFAULT_HEIGHT

const readHeight = (): number => {
  const raw = Number(localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(raw) && raw >= PANEL_MIN_HEIGHT ? raw : DEFAULT_HEIGHT
}

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
  /** 面板高度（px）。拖动时每帧更新，松手才落盘。 */
  const height = ref(readHeight())

  /**
   * @param persist 拖动过程中传 false（每帧写 localStorage 白费 IO），
   *                mouseup / 双击最大化时传 true 落盘。
   */
  const setHeight = (px: number, persist = false): void => {
    const next = Math.max(PANEL_MIN_HEIGHT, Math.round(px))
    height.value = next
    if (persist) localStorage.setItem(HEIGHT_KEY, String(next))
  }

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

  return { visible, open, total, runnable, running, height, setHeight, toggle, setOpen, sync }
})
