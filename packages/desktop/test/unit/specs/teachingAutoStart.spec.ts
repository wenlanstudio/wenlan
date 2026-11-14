import { beforeEach, describe, expect, it, vi } from 'vitest'
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
 * M2c 文览联动刀（ADR-24）：`autoStart` 是示视图打开时的自动开房入口，
 * 权威判定在服务端——这里钉住 renderer 侧的四态消化与幂等：
 * ① hit → classroom 整体置 host 态并带 auto（叠码/首页卡数据源）；
 * ② none → 全程静默，classroom 不动；③ multi / no_release → 不进房，
 * message 落 autoNotice 供教学首页卡降级；④ 已在课中不重复调（幂等）。
 */
const hitPayload = (sessionId = 68) => ({
  ok: true,
  hit: true,
  sessionId,
  auto: {
    status: 'hit' as const,
    sessionId,
    classId: 65,
    className: '2024级大数据1班',
    courseId: 38,
    courseName: '数据仓库工程实践',
    releaseId: 39,
    entryToken: 'tok',
    joinUrl: 'http://host/admin-api/teaching/reading/h5?entryToken=tok',
    location: '计算机实验室3'
  }
})

const autoHostMock = vi.fn()

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ;(window as unknown as Record<string, unknown>).teachingSocket = {
    autoHost: autoHostMock,
    host: vi.fn().mockResolvedValue({ ok: false, error: 'unused' }),
    end: vi.fn().mockResolvedValue(undefined),
    // store setup 的 listenClassroom 要挂 ws 帧监听：给空订阅（返回退订函数）
    onMessage: vi.fn().mockReturnValue(() => undefined),
    onStatus: vi.fn().mockReturnValue(() => undefined)
  }
})

describe('teaching store · autoStart 课表自动开房（ADR-24）', () => {
  it('hit：进房并填 auto（封面叠码与首页卡数据源）', async() => {
    autoHostMock.mockResolvedValue(hitPayload())
    const store = useTeachingStore()
    await store.autoStart()
    expect(store.classroom.sessionId).toBe(68)
    expect(store.classroom.role).toBe('host')
    expect(store.classroom.className).toBe('2024级大数据1班')
    expect(store.classroom.auto?.courseName).toBe('数据仓库工程实践')
    expect(store.classroom.auto?.location).toBe('计算机实验室3')
    expect(store.classroom.auto?.joinUrl).toContain('entryToken=tok')
    expect(store.classroom.autoNotice).toBe('')
  })

  it('none：静默，classroom 不动', async() => {
    autoHostMock.mockResolvedValue({ ok: true, hit: false })
    const store = useTeachingStore()
    await store.autoStart()
    expect(store.classroom.sessionId).toBeNull()
    expect(store.classroom.auto).toBeNull()
    expect(store.classroom.autoNotice).toBe('')
  })

  it('multi / no_release：不进房，message 落 autoNotice 降级提示', async() => {
    autoHostMock.mockResolvedValue({
      ok: true,
      hit: false,
      notice: {
        status: 'multi',
        message: '同一时段多个班在课表命中：2024级软件工程班、2024级大数据1班',
        className: '2024级大数据1班'
      }
    })
    const store = useTeachingStore()
    await store.autoStart()
    expect(store.classroom.sessionId).toBeNull()
    expect(store.classroom.auto).toBeNull()
    expect(store.classroom.autoNotice).toContain('2024级软件工程班')
    expect(store.classroom.className).toBe('2024级大数据1班')
  })

  it('真 error（未登录/网络）与 none 同等静默', async() => {
    autoHostMock.mockResolvedValue({ ok: false, hit: false, error: 'HTTP 401' })
    const store = useTeachingStore()
    await store.autoStart()
    expect(store.classroom.sessionId).toBeNull()
    expect(store.classroom.autoNotice).toBe('')
  })

  it('幂等：已在课中不再调 autoHost（连点示视图不重复判定）', async() => {
    autoHostMock.mockResolvedValue(hitPayload())
    const store = useTeachingStore()
    await store.autoStart()
    await store.autoStart()
    expect(autoHostMock).toHaveBeenCalledTimes(1)
  })

  it('endClassroom 清掉 auto 与 autoNotice（下课后不残留）', async() => {
    autoHostMock.mockResolvedValue(hitPayload())
    const store = useTeachingStore()
    await store.autoStart()
    await store.endClassroom()
    expect(store.classroom.sessionId).toBeNull()
    expect(store.classroom.auto).toBeNull()
    expect(store.classroom.autoNotice).toBe('')
  })
})
