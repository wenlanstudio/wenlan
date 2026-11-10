/**
 * 教学客户端身份契约（edu-client E1）。
 *
 * 与 wenshu-server（yudao）协议对齐：
 * - token 只活在 main 进程（safeStorage 落盘），renderer 经 `auth::request`
 *   代理发请求，永不接触 access_token / refresh_token（防 XSS）。
 * - tenant（学校）经 `tenant-id` header 传递，登录前用 `list-tenants` 选学校。
 */

/** 登录用户资料（renderer 可见的脱敏面） */
export interface WenshuUser {
  id: number
  username: string
  nickname: string
  avatar?: string
}

/** renderer 可见的登录态快照（不含任何 token） */
export interface AuthState {
  loggedIn: boolean
  tenantId: number | null
  user: WenshuUser | null
  /** 服务端角色标识（`/system/auth/get-permission-info` 的 roles），可能为空。 */
  roles: string[]
}

/** 登录前的学校（租户）选项 */
export interface TenantInfo {
  id: number
  name: string
}

/** main 进程请求代理的参数 */
export interface AuthRequestOptions {
  /** 相对 /admin-api 的路径，如 '/system/tenant/simple-list' */
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** JSON 请求体 */
  data?: unknown
  /** query 参数 */
  params?: Record<string, string | number>
  /**
   * 匿名请求（登录 / 租户列表 / 刷新）：不带 Authorization，401 不触发自动刷新。
   * 默认 false（带 token）。
   */
  anonymous?: boolean
}

/** main 进程请求代理的返回（已解包 yudao CommonResult{code,data,msg}） */
export interface AuthRequestResult<T = unknown> {
  ok: boolean
  status: number
  data: T
  /** ok=false 时的错误信息（业务 msg 或 HTTP 状态描述） */
  error?: string
}

/** 登录入参 */
export interface AuthLoginParams {
  tenantId: number
  username: string
  password: string
}

/** 登录 / 刷新等会改变登录态的操作结果 */
export type AuthActionResult =
  | { ok: true; state: AuthState }
  | { ok: false; error: string }

/** main 进程落盘的凭据（token 经 safeStorage 加密成 base64） */
export interface AuthPersisted {
  tenantId: number
  encAccessToken: string
  encRefreshToken: string
  expiresAt: string
  user: WenshuUser
}

export type AuthRequest = <T = unknown>(
  opts: AuthRequestOptions
) => Promise<AuthRequestResult<T>>

// ===== 学生工作台（edu-client E2，对齐 wenshu /teaching/student/*）=====

/** 我的发布物列表项（StudentReleaseRespVO） */
export interface StudentRelease {
  releaseId: number
  materialId: number
  materialName: string
  versionNo: number
  classId: number
  className: string
  courseId: number
  courseName: string
  /** 1资料查阅 2机房实训 3作业 4测试 5考试 */
  purpose: number
  publishTime: string
}

/** 学生版 md 拉取结果（StudentMarkdownRespVO） */
export interface StudentMarkdown {
  releaseId: number
  purpose: number
  /** reading / assignable / original */
  variant: string
  md: string
}
