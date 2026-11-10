/**
 * 教学客户端身份单例（main 进程，edu-client E1）。
 *
 * 协议对齐 wenshu-server（yudao）：
 * - 登录 `/admin-api/system/auth/login`（tenant 经 `tenant-id` header）；
 * - 刷新 `/system/auth/refresh-token`、登出 `/system/auth/logout`；
 * - 用户资料 `/system/auth/get-permission-info`（返回 data.user: id/nickname/avatar）。
 *
 * 安全边界：access_token / refresh_token 只活在 main（safeStorage 加密落盘
 * `userData/auth.json`），renderer 经 `auth::request` 代理发请求，永不接触 token。
 * 401 时自动用 refresh_token 换新并重试一次，多窗口共享同一登录态（单例）。
 */
import { app, BrowserWindow, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import type {
  AuthActionResult,
  AuthLoginParams,
  AuthPersisted,
  AuthRequestOptions,
  AuthRequestResult,
  AuthState,
  TenantInfo,
  WenshuUser
} from '@shared/types/auth'

const DEFAULT_BASE_URL = 'http://localhost:48080'
const AUTH_FILE = 'auth.json'
const AUTH_API_PREFIX = '/admin-api'

/** 登录 / 刷新 / 权限接口里 user 的最小面（yudao AuthPermissionInfoRespVO.UserVO） */
interface PermissionUser {
  id: number
  username: string
  nickname?: string
  avatar?: string
}

interface LoginData {
  userId: number
  accessToken: string
  refreshToken: string
  expiresTime: string
}

interface RawRequestExtra {
  params?: Record<string, string | number>
  anonymous?: boolean
  tenantId?: number
}

class AuthManager {
  private userDataPath: string
  private baseUrl: string

  private accessToken: string | null = null
  private refreshToken: string | null = null
  private expiresAt: string | null = null
  private tenantId: number | null = null
  private user: WenshuUser | null = null
  private roles: string[] = []

  private initPromise: Promise<void> | null = null
  private listeners = new Set<(state: AuthState) => void>()

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath
    this.baseUrl = process.env.WENSHU_BASE_URL || DEFAULT_BASE_URL
  }

  /**
   * 启动时从磁盘恢复登录态（safeStorage 解密），失败 = 未登录。
   *
   * 幂等，可在 app ready 之前调用：Windows 上 safeStorage 要等 ready 之后才可用，
   * ready 前判可用性恒为 false 会让每次重启都丢登录，所以内部先等 ready。
   * 依赖登录态的入口（getState 通道、login/logout/request）都先 await 本方法。
   */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.restore()
    }
    return this.initPromise
  }

  /** main 侧订阅登录态变化（renderer 走 `auth::state-changed` 广播）。 */
  onStateChange(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async restore(): Promise<void> {
    await app.whenReady()
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[auth] safeStorage 不可用，token 仅存内存、不落盘')
      return
    }
    try {
      const raw = await fs.promises.readFile(this.authFilePath(), 'utf-8')
      const persisted = JSON.parse(raw) as AuthPersisted
      this.accessToken = safeStorage.decryptString(Buffer.from(persisted.encAccessToken, 'base64'))
      this.refreshToken = safeStorage.decryptString(Buffer.from(persisted.encRefreshToken, 'base64'))
      this.expiresAt = persisted.expiresAt
      this.tenantId = persisted.tenantId
      this.user = persisted.user
      log.info('[auth] 已恢复登录态 userId=%s', this.user?.id)
      this.broadcast()
      // 角色不落盘：每次恢复后异步补一次，避免旧缓存与服务端授权不一致。
      void this.refreshRoles()
    } catch {
      // 无文件 / 损坏 / 解密失败 → 未登录，静默
    }
  }

  getState(): AuthState {
    return {
      loggedIn: this.accessToken != null,
      tenantId: this.tenantId,
      user: this.user,
      roles: [...this.roles]
    }
  }

  /** 仅 main 内部使用：ws 握手 URL 需要 access_token，绝不暴露给 renderer。 */
  getAccessToken(): string | null {
    return this.accessToken
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  private async refreshRoles(): Promise<void> {
    try {
      const resp = await this.rawRequest(
        '/system/auth/get-permission-info',
        'GET',
        undefined,
        {}
      )
      if (!resp.ok) return
      const info = resp.data as { roles?: string[] } | null
      this.roles = Array.isArray(info?.roles) ? info.roles : []
      this.broadcast()
    } catch {
      // 角色只用于 UI 裁剪，拉取失败保持空数组，不阻塞登录态。
    }
  }

  async login(params: AuthLoginParams): Promise<AuthActionResult> {
    // 先等启动恢复结束，免得恢复出的旧 token 覆盖这次新登录
    await this.init()
    const resp = await this.rawRequest('/system/auth/login', 'POST', params, {
      tenantId: params.tenantId,
      anonymous: true
    })
    if (!resp.ok) {
      return { ok: false, error: resp.error ?? '登录失败' }
    }
    const data = resp.data as LoginData
    this.accessToken = data.accessToken
    this.refreshToken = data.refreshToken
    this.expiresAt = data.expiresTime
    this.tenantId = params.tenantId
    this.user = null

    // 拉用户资料（昵称 / 头像）
    this.roles = []
    const profile = await this.rawRequest('/system/auth/get-permission-info', 'GET', undefined, {})
    if (profile.ok) {
      const info = profile.data as { user?: PermissionUser; roles?: string[] } | null
      const u = info?.user
      if (u) {
        this.user = {
          id: u.id,
          username: u.username,
          nickname: u.nickname || u.username,
          avatar: u.avatar
        }
      }
      this.roles = Array.isArray(info?.roles) ? info.roles : []
    }
    await this.persist()
    this.broadcast()
    return { ok: true, state: this.getState() }
  }

  async logout(): Promise<void> {
    await this.init()
    try {
      await this.rawRequest('/system/auth/logout', 'POST', undefined, {})
    } catch {
      // 网络失败也照常清本地态
    }
    this.accessToken = null
    this.refreshToken = null
    this.expiresAt = null
    this.user = null
    this.roles = []
    this.tenantId = null
    try {
      await fs.promises.unlink(this.authFilePath())
    } catch {
      // 文件不存在即可
    }
    this.broadcast()
  }

  async listTenants(): Promise<TenantInfo[]> {
    const resp = await this.rawRequest('/system/tenant/simple-list', 'GET', undefined, {
      anonymous: true
    })
    if (!resp.ok) {
      return []
    }
    return (resp.data as TenantInfo[]) ?? []
  }

  /** renderer 请求代理：带 token 发请求，401 自动刷新重试一次。 */
  async request<T = unknown>(opts: AuthRequestOptions): Promise<AuthRequestResult<T>> {
    await this.init()
    const method = opts.method ?? 'GET'
    const extra: RawRequestExtra = { params: opts.params, anonymous: opts.anonymous }
    const result = await this.rawRequest(opts.url, method, opts.data, extra)
    if (result.status === 401 && !opts.anonymous && this.refreshToken) {
      if (await this.tryRefresh()) {
        return (await this.rawRequest(opts.url, method, opts.data, extra)) as AuthRequestResult<T>
      }
    }
    return result as AuthRequestResult<T>
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) {
      return false
    }
    try {
      const resp = await this.rawRequest(
        `/system/auth/refresh-token?refreshToken=${encodeURIComponent(this.refreshToken)}`,
        'POST',
        undefined,
        { anonymous: true }
      )
      if (resp.ok) {
        const data = resp.data as LoginData
        this.accessToken = data.accessToken
        this.refreshToken = data.refreshToken
        this.expiresAt = data.expiresTime
        await this.persist()
        return true
      }
    } catch {
      // 刷新失败 → 保持现状，下次请求再触发
    }
    return false
  }

  private async persist(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable() || !this.accessToken || !this.refreshToken) {
      return
    }
    const persisted: AuthPersisted = {
      tenantId: this.tenantId ?? 0,
      encAccessToken: safeStorage.encryptString(this.accessToken).toString('base64'),
      encRefreshToken: safeStorage.encryptString(this.refreshToken).toString('base64'),
      expiresAt: this.expiresAt ?? '',
      user: this.user as WenshuUser
    }
    await fs.promises.writeFile(this.authFilePath(), JSON.stringify(persisted), 'utf-8')
  }

  private authFilePath(): string {
    return path.join(this.userDataPath, AUTH_FILE)
  }

  private async rawRequest(
    url: string,
    method: string,
    data: unknown,
    extra: RawRequestExtra
  ): Promise<AuthRequestResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const tid = extra.tenantId ?? this.tenantId
    if (tid != null) {
      headers['tenant-id'] = String(tid)
    }
    if (!extra.anonymous && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`
    }
    try {
      const res = await fetch(this.buildUrl(url, extra.params), {
        method,
        headers,
        body: data != null ? JSON.stringify(data) : undefined
      })
      const text = await res.text()
      let payload: Record<string, unknown> = {}
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {}
      } catch {
        payload = {}
      }
      const status = res.status
      if (!res.ok) {
        return { ok: false, status, data: payload.data, error: (payload.msg as string) || `HTTP ${status}` }
      }
      // yudao CommonResult：code === 0 成功。token 失效也是 HTTP 200 + code 401，
      // 统一成 status 401，request() 的「刷新后重试一次」才会生效。
      if (typeof payload.code === 'number' && payload.code !== 0) {
        return {
          ok: false,
          status: payload.code === 401 ? 401 : status,
          data: payload.data,
          error: (payload.msg as string) || `业务错误 ${payload.code}`
        }
      }
      return { ok: true, status, data: payload.data }
    } catch (err) {
      return { ok: false, status: 0, data: undefined, error: (err as Error).message }
    }
  }

  private buildUrl(url: string, params?: Record<string, string | number>): string {
    let full = url.startsWith('http') ? url : `${this.baseUrl}${AUTH_API_PREFIX}${url}`
    if (params && Object.keys(params).length > 0) {
      const qs = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
      full += (full.includes('?') ? '&' : '?') + qs
    }
    return full
  }

  private broadcast(): void {
    const state = this.getState()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('auth::state-changed', state)
    }
    for (const listener of this.listeners) {
      listener(state)
    }
  }
}

let instance: AuthManager | null = null

export function initAuthManager(userDataPath: string): void {
  if (!instance) {
    instance = new AuthManager(userDataPath)
  }
}

export function getAuthManager(): AuthManager {
  if (!instance) {
    throw new Error('AuthManager 未初始化，请先调用 initAuthManager')
  }
  return instance
}

/** 当前是否已登录（菜单模板等构建期读取）；单例未初始化时视为未登录。 */
export function isLoggedIn(): boolean {
  return instance?.getState().loggedIn ?? false
}

/** main 侧订阅登录态变化；单例未初始化（如单测里单独构造菜单）时为空操作。 */
export function onAuthStateChange(listener: (state: AuthState) => void): () => void {
  return instance ? instance.onStateChange(listener) : () => undefined
}

// 打开教学客户端窗口的回调由 App 注入（IPC handler 注册早于 App 构造）。
let openTeachingWindowHandler: (() => void) | null = null

export function setOpenTeachingWindowHandler(fn: () => void): void {
  openTeachingWindowHandler = fn
}

export function openTeachingWindow(): void {
  if (openTeachingWindowHandler) {
    openTeachingWindowHandler()
  } else {
    log.warn('[auth] openTeachingWindow 未接线（App 尚未初始化）')
  }
}
