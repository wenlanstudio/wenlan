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
    location: '计算机实验室3',
    scheduled: true,
    roomReopened: false
  }
})

const autoHostMock = vi.fn()

// autoStart 的教师身份门控（2026-11-15）会调 useAuthStore().init()，
// 而 init() 走 window.auth.getState()；jsdom 里不给这个夹具，原有用例全会
// 以 "Cannot read properties of undefined (reading 'getState')" 挂掉。
const teacherAuthState = {
  loggedIn: true,
  tenantId: 1,
  user: { id: 1, username: 'teacher', nickname: '教师' },
  roles: ['teacher']
}
let authState: Record<string, unknown> = teacherAuthState

beforeEach(() => {
  authState = { ...teacherAuthState }
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ;(window as unknown as Record<string, unknown>).auth = {
    getState: vi.fn(() => Promise.resolve(authState)),
    onStateChanged: vi.fn().mockReturnValue(() => undefined)
  }
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

  it('幂等：进房且 ws 连接确认后不再调 autoHost（断连时允许重进）', async() => {
    autoHostMock.mockResolvedValue(hitPayload())
    const store = useTeachingStore()
    await store.autoStart()
    // 51cb1047 起短路看 sessionId + connected：不确认连接态时重进房是有意行为
    // （否则发题上行能成、广播收不到）。这里模拟进房后 ws onStatus 帧到达。
    store.classroom.connected = true
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

  it('门控：未登录 / 学生一律零 autoHost 请求（不惊动教学链路）', async() => {
    autoHostMock.mockResolvedValue(hitPayload())

    authState = { loggedIn: false, tenantId: null, user: null, roles: [] }
    setActivePinia(createPinia())
    await useTeachingStore().autoStart()
    expect(autoHostMock).not.toHaveBeenCalled()

    authState = { loggedIn: true, tenantId: 1, user: null, roles: ['wenshu-student'] }
    setActivePinia(createPinia())
    await useTeachingStore().autoStart()
    expect(autoHostMock).not.toHaveBeenCalled()
  })
})

/**
 * 缺口 A（2026-11-15 发题对齐裁决）：当前文档的发布物优先——放映哪份讲义
 * 就开哪份发布物的房。优先级：课表命中班 ∈ 文档发布物 → 换开该发布物；
 * multi 且文档收敛 → 免降级；auto 未命中而文档有发布物 → 兜底开房。
 * releasesFor 读 localStorage（发布时 remember 写入），测试里直接种数据。
 */
const DOC_PATH = '/course/第6章 坐标轴的定制.md'
const seedDocReleases = (
  releases: Array<{ releaseId: number; classId: number; className: string }>
): void => {
  localStorage.setItem(
    'wenlan.teaching.publish.' + DOC_PATH,
    JSON.stringify({ contentHash: 'h', versionId: 1, versionNo: 1, releases })
  )
}

describe('teaching store · autoStart 文档对齐（缺口 A）', () => {
  it('课表命中班 ∈ 文档发布物且 releaseId 不同 → 换开文档对应发布物（带门户 joinUrl）', async() => {
    seedDocReleases([{ releaseId: 100, classId: 65, className: '2024级大数据1班' }])
    autoHostMock.mockResolvedValue(hitPayload(68)) // 课表命中 releaseId=39
    const hostMock = vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 101,
      joinUrl: 'http://host/admin-api/teaching/portal/h5'
    })
    ;(window as unknown as Record<string, unknown>).teachingSocket = {
      autoHost: autoHostMock,
      host: hostMock,
      end: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined)
    }
    const store = useTeachingStore()
    await store.autoStart(DOC_PATH)
    expect(hostMock).toHaveBeenCalledWith(100)
    expect(store.classroom.releaseId).toBe(100)
    expect(store.classroom.sessionId).toBe(101)
    expect(store.classroom.auto?.joinUrl).toContain('/teaching/portal/h5')
    // 课表的展示信息（课程名/教室）跟着换房保留
    expect(store.classroom.auto?.courseName).toBe('数据仓库工程实践')
  })

  it('课表命中的发布物就是文档的发布物 → 不换房，host 不被调', async() => {
    seedDocReleases([{ releaseId: 39, classId: 65, className: '2024级大数据1班' }])
    autoHostMock.mockResolvedValue(hitPayload(68))
    const hostMock = vi.fn()
    ;(window as unknown as Record<string, unknown>).teachingSocket = {
      autoHost: autoHostMock,
      host: hostMock,
      end: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined)
    }
    const store = useTeachingStore()
    await store.autoStart(DOC_PATH)
    expect(hostMock).not.toHaveBeenCalled()
    expect(store.classroom.releaseId).toBe(39)
    expect(store.classroom.sessionId).toBe(68)
  })

  it('multi 且文档只发给其中一个命中班 → 用文档收敛选班，免降级', async() => {
    seedDocReleases([{ releaseId: 100, classId: 64, className: '2024级软件工程班' }])
    autoHostMock.mockResolvedValue({
      ok: true,
      hit: false,
      notice: {
        status: 'multi' as const,
        message: '同一时段多个班在课表命中：2024级软件工程班、2024级大数据1班',
        classId: 64,
        className: '2024级软件工程班'
      }
    })
    const hostMock = vi.fn().mockResolvedValue({ ok: true, sessionId: 102, joinUrl: null })
    ;(window as unknown as Record<string, unknown>).teachingSocket = {
      autoHost: autoHostMock,
      host: hostMock,
      end: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined)
    }
    const store = useTeachingStore()
    await store.autoStart(DOC_PATH)
    expect(hostMock).toHaveBeenCalledWith(100)
    expect(store.classroom.releaseId).toBe(100)
    expect(store.classroom.className).toBe('2024级软件工程班')
  })

  it('auto 未命中（none）而文档有发布物 → 兜底按文档开房', async() => {
    seedDocReleases([{ releaseId: 100, classId: 65, className: '2024级大数据1班' }])
    autoHostMock.mockResolvedValue({ ok: true, hit: false })
    const hostMock = vi.fn().mockResolvedValue({
      ok: true,
      sessionId: 103,
      joinUrl: 'http://host/admin-api/teaching/portal/h5'
    })
    ;(window as unknown as Record<string, unknown>).teachingSocket = {
      autoHost: autoHostMock,
      host: hostMock,
      end: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined)
    }
    const store = useTeachingStore()
    await store.autoStart(DOC_PATH)
    expect(hostMock).toHaveBeenCalledWith(100)
    expect(store.classroom.sessionId).toBe(103)
    expect(store.classroom.auto?.joinUrl).toContain('/teaching/portal/h5')
  })

  it('无 pathname（旧调用方）保持旧行为：auto 未命中即静默', async() => {
    seedDocReleases([{ releaseId: 100, classId: 65, className: '2024级大数据1班' }])
    autoHostMock.mockResolvedValue({ ok: true, hit: false })
    const hostMock = vi.fn()
    ;(window as unknown as Record<string, unknown>).teachingSocket = {
      autoHost: autoHostMock,
      host: hostMock,
      end: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn().mockReturnValue(() => undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined)
    }
    const store = useTeachingStore()
    await store.autoStart()
    expect(hostMock).not.toHaveBeenCalled()
    expect(store.classroom.sessionId).toBeNull()
  })
})
