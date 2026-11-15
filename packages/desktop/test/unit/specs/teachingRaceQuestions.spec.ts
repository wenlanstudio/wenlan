import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// teaching store 的 import 链经 treeCtrl → config 在模块求值期读 window.path
// （preload 注入件，jsdom 没有）——必须在 store import 之前就位，故用 vi.hoisted。
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>
  w.path = {
    sep: '/',
    normalize: (p: string) => p,
    basename: (p: string) => p.split('/').pop() ?? p,
    dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
    isAbsolute: (p: string) => p.startsWith('/'),
    relative: (from: string, to: string) => to.slice(from.length + 1)
  }
})
import { useTeachingStore } from '../../../src/renderer/src/store/teaching'

/**
 * 发题诚实化（2026-11-15）：拉题失败（main 返回明确错误）与回帧丢失（超时）
 * 都亮失败态——只有真回帧且列表为空才显示「没有可发的题」。
 *
 * store 的 wsListening 是模块级守卫（Electron 单实例设计），多 pinia 实例下
 * 只注册一次 onMessage——所以全文件共用一个 store 实例，喂帧用首次注册的
 * handler，用例间手动重置 race 状态。
 */
const teacherAuthState = {
  loggedIn: true,
  tenantId: 1,
  user: { id: 1, username: 'teacher', nickname: '教师' },
  roles: ['teacher']
}

const raceQuestionsMock = vi.fn()
let frameHandler: ((m: { type: string; content: Record<string, unknown> }) => void) | null = null

const feedFrame = (type: string, content: Record<string, unknown>): void => {
  frameHandler?.({ type, content })
}

const resetRaceState = (store: ReturnType<typeof useTeachingStore>): void => {
  store.race.loading = false
  store.race.error = ''
  store.race.questions = []
  store.race.openId = null
  store.race.pageQuizKeys = []
}

// wsListening 是模块级守卫：store 只在首个 pinia 上注册 onMessage——
// 全文件固定一个 pinia+store，handler 跨用例喂帧，用例间手动重置 race 状态。
setActivePinia(createPinia())

beforeEach(() => {
  vi.clearAllMocks()
  raceQuestionsMock.mockReset()
  ;(window as unknown as Record<string, unknown>).auth = {
    getState: vi.fn(() => Promise.resolve(teacherAuthState)),
    onStateChanged: vi.fn().mockReturnValue(() => undefined)
  }
  ;(window as unknown as Record<string, unknown>).teachingSocket = {
    raceQuestions: raceQuestionsMock,
    onMessage: vi.fn((handler: typeof frameHandler) => {
      // wsListening 守卫下只有首个 store 实例会注册；捕获 handler 供全文件喂帧
      frameHandler = handler
      return () => undefined
    }),
    onStatus: vi.fn().mockReturnValue(() => undefined)
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('teaching store · 拉题诚实化', () => {
  it('上行失败（main 明确报错）→ 亮 error，不伪装成空列表', async() => {
    const store = useTeachingStore()
    resetRaceState(store)
    raceQuestionsMock.mockResolvedValue({ ok: false, error: '尚未进入课堂会话' })
    store.loadRaceQuestions()
    await vi.waitFor(() => expect(store.race.loading).toBe(false))
    expect(store.race.error).toBe('尚未进入课堂会话')
    expect(store.race.questions).toEqual([])
  })

  it('回帧到达且列表为空 → 干净空态（error 保持空）', () => {
    const store = useTeachingStore()
    resetRaceState(store)
    raceQuestionsMock.mockResolvedValue({ ok: true })
    store.loadRaceQuestions()
    feedFrame('teaching.race.question-list', { questions: [], openId: null })
    expect(store.race.loading).toBe(false)
    expect(store.race.error).toBe('')
    expect(store.race.questions).toEqual([])
  })

  it('回帧丢帧 → 4 秒超时亮失败态（不再伪装成「没有可发的题」）', async() => {
    vi.useFakeTimers()
    const store = useTeachingStore()
    resetRaceState(store)
    raceQuestionsMock.mockResolvedValue({ ok: true })
    store.loadRaceQuestions()
    expect(store.race.loading).toBe(true)
    await vi.advanceTimersByTimeAsync(4000)
    expect(store.race.loading).toBe(false)
    expect(store.race.error).not.toBe('')
  })

  it('回帧到达且带题 → 填充列表；pageQuizKeys 是放映页独立槽位不被清掉', () => {
    const store = useTeachingStore()
    resetRaceState(store)
    store.setPageQuizKeys(['q3'])
    raceQuestionsMock.mockResolvedValue({ ok: true })
    store.loadRaceQuestions()
    feedFrame('teaching.race.question-list', {
      questions: [{ id: 1, questionKey: 'q1', stem: '题一', point: 5, type: 'single' }],
      openId: null
    })
    expect(store.race.questions.map((q) => q.questionKey)).toEqual(['q1'])
    expect(store.race.pageQuizKeys).toEqual(['q3'])
  })
})
