import { BrowserWindow } from 'electron'
import log from 'electron-log'
import { getAuthManager } from './auth'

/**
 * 课堂 ws 客户端（M2b，仅 main 进程）。
 *
 * token 只活在 AuthManager 的 safeStorage 内存里，握手 URL 需要它，因此连接
 * 必须在 main；renderer 只能收到脱敏后的 `{type, content}` 帧，永远拿不到 token
 * 与 ws 句柄。协议对齐 race-h5.html：
 * - 端点 `/infra/ws?token=`，握手由 LoginUserHandshakeInterceptor 校验；
 * - 上行 content 必须二次序列化（框架 JsonWebSocketMessage.content 是 String）；
 * - 进房 `teaching.session.join {sessionId}`，下行 `teaching.session.*` /
 *   `teaching.race.*` 广播。
 */

interface ClassroomSession {
  id: number
  currentPage: number
  followLocked: boolean
}

interface WsMessage {
  type: string
  content: Record<string, unknown>
}

const RECONNECT_MS = 3000

class TeachingSocket {
  private socket: WebSocket | null = null
  private sessionId: number | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private manualClose = true
  private token = ''
  private baseUrl = ''

  /** 学生：按发布物找进行中的会话再进房。 */
  async join(releaseId: number): Promise<{ ok: boolean; sessionId?: number; error?: string }> {
    this.leave()
    if (typeof WebSocket === 'undefined') {
      return { ok: false, error: '当前运行环境不支持 WebSocket' }
    }
    const auth = getAuthManager()
    await auth.init()
    const res = await auth.request<ClassroomSession | null>({
      url: '/teaching/student/active-session',
      params: { releaseId }
    })
    if (!res.ok) {
      return { ok: false, error: res.error ?? `HTTP ${res.status}` }
    }
    const session = res.data
    if (!session?.id) {
      return { ok: false, error: '当前没有进行中的课堂会话' }
    }
    return this.attach(auth, session.id)
  }

  /**
   * 教师：开班并进房。
   *
   * 先查该发布物有没有进行中的会话（`/get` 只返回 active），有就复用——
   * 教师误点两次不该在 t_class_session 里堆出两条并行会话；没有才 create。
   * 两个接口都要 `teaching:session:manage`，权限不足时把服务端原话带回去。
   */
  async host(releaseId: number): Promise<{ ok: boolean; sessionId?: number; error?: string }> {
    this.leave()
    if (typeof WebSocket === 'undefined') {
      return { ok: false, error: '当前运行环境不支持 WebSocket' }
    }
    const auth = getAuthManager()
    await auth.init()
    const existing = await auth.request<ClassroomSession | null>({
      url: '/teaching/class-session/get',
      params: { releaseId }
    })
    if (!existing.ok) {
      return { ok: false, error: existing.error ?? `HTTP ${existing.status}` }
    }
    let sessionId = existing.data?.id ?? null
    if (sessionId == null) {
      const created = await auth.request<number>({
        url: '/teaching/class-session/create',
        method: 'POST',
        data: { releaseId }
      })
      if (!created.ok) {
        return { ok: false, error: created.error ?? `HTTP ${created.status}` }
      }
      sessionId = created.data ?? null
    }
    if (sessionId == null) {
      return { ok: false, error: '创建课堂会话失败' }
    }
    return this.attach(auth, sessionId)
  }

  /** 教师：上报当前页（服务端校验 host，失败会回 teaching.error）。 */
  sendPage(page: number): void {
    if (this.sessionId == null) return
    if (!Number.isFinite(page) || page < 1) return
    this.send('teaching.session.page', { sessionId: this.sessionId, page: Math.floor(page) })
  }

  /** 教师：跟随锁定开关。 */
  sendFollow(locked: boolean): void {
    if (this.sessionId == null) return
    this.send('teaching.session.follow', { sessionId: this.sessionId, locked })
  }

  /**
   * 教师：拉本会话可发题目（`teaching.race.questions`）。
   *
   * 结果是异步回帧 `teaching.race.question-list`，main 侧不缓存不转发队列——
   * renderer 自己监听该帧并按 `openId` 对齐当前轮，这里只负责驱动。
   */
  sendRaceQuestions(): void {
    if (this.sessionId == null) return
    this.send('teaching.race.questions', {})
  }

  /** 教师：发题（服务端校验 host、一题一轮，重复发会被 RACE_ALREADY_OPEN 挡回）。 */
  sendRaceOpen(questionId: number, limitSec: number): void {
    if (this.sessionId == null) return
    this.send('teaching.race.open', {
      sessionId: this.sessionId,
      questionId,
      limitSec: Math.floor(limitSec)
    })
  }

  /** 教师：收卷揭晓（到点服务端也会自动收，这里只是提前收）。 */
  sendRaceClose(openId: number): void {
    if (openId == null) return
    this.send('teaching.race.close', { openId })
  }

  /** 教师：作废进行中的题（记录保留、得分清零）。 */
  sendRaceVoid(openId: number): void {
    if (openId == null) return
    this.send('teaching.race.void', { openId })
  }

  /** 关闭会话并退房（不退出登录、不影响其他窗口）。 */
  async end(sessionId?: number | null): Promise<void> {
    const target = sessionId ?? this.sessionId
    if (target != null) {
      const auth = getAuthManager()
      await auth.request<boolean>({
        url: '/teaching/class-session/end',
        method: 'POST',
        params: { sessionId: target }
      })
    }
    this.leave()
  }

  private attach(
    auth: ReturnType<typeof getAuthManager>,
    sessionId: number
  ): { ok: boolean; sessionId?: number; error?: string } {
    const token = auth.getAccessToken()
    if (!token) {
      return { ok: false, error: '登录状态失效' }
    }
    this.sessionId = sessionId
    this.token = token
    this.baseUrl = auth.getBaseUrl()
    this.manualClose = false
    this.connect()
    return { ok: true, sessionId }
  }

  leave(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // 已断开的连接 close() 会抛，忽略
      }
      this.socket = null
    }
    this.sessionId = null
    this.token = ''
    this.emitStatus(false)
  }

  private connect(): void {
    const wsBase = this.baseUrl.replace(/^http/, 'ws')
    const url = `${wsBase}/infra/ws?token=${encodeURIComponent(this.token)}`
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      this.send('teaching.session.join', { sessionId: this.sessionId })
      this.emitStatus(true)
    }
    socket.onmessage = (event) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      if (!raw || raw === 'pong') return
      try {
        const frame = JSON.parse(raw) as { type?: string; content?: unknown }
        if (!frame.type) return
        let content: Record<string, unknown> = {}
        if (typeof frame.content === 'string') {
          content = JSON.parse(frame.content) as Record<string, unknown>
        } else if (frame.content && typeof frame.content === 'object') {
          content = frame.content as Record<string, unknown>
        }
        this.emit({ type: frame.type, content })
      } catch (err) {
        log.warn('[teaching-ws] 下行帧解析失败', err)
      }
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null
      this.emitStatus(false)
      if (!this.manualClose) this.scheduleReconnect()
    }
    socket.onerror = () => {
      // onclose 会跟上，重连统一在那里处理
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.manualClose) this.connect()
    }, RECONNECT_MS)
  }

  private send(type: string, content: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type, content: JSON.stringify(content) }))
  }

  private emit(message: WsMessage): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('teaching::ws-message', message)
    }
  }

  private emitStatus(connected: boolean): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('teaching::ws-status', {
        connected,
        sessionId: connected ? this.sessionId : null
      })
    }
  }
}

export const teachingSocket = new TeachingSocket()
