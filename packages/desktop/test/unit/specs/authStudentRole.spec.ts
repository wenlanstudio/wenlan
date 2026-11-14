import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AuthState } from '@shared/types/auth'
import { useAuthStore } from '../../../src/renderer/src/store/auth'

/**
 * B 方案（2026-11-14）单交互面：isStudent 只认服务端角色。
 *
 * 前置 = 文枢 `d751e33` 开号绑定 `wenshu-student` 标记角色 + 存量回填。
 * 护栏：① 无角色不是学生；② 带标记角色是学生；③ hash 不再参与判定——
 * 旧实现里教师打开 `/teaching` 启动壳会被 hash 回退误判成学生，导致
 * 发布/发题/成绩入口全灭。学生态不再由窗口类型决定。
 */
const stateWith = (roles: string[]): AuthState => ({
  loggedIn: true,
  tenantId: 1,
  user: null,
  roles
})

describe('auth store · isStudent 纯角色化（B 方案）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.location.hash = '#/editor'
  })

  it('无学生角色时不判学生', () => {
    const store = useAuthStore()
    store.apply(stateWith([]))
    expect(store.isStudent).toBe(false)
  })

  it('文枢 wenshu-student 标记角色判学生', () => {
    const store = useAuthStore()
    store.apply(stateWith(['wenshu-student']))
    expect(store.isStudent).toBe(true)
  })

  it('角色标识大小写不敏感', () => {
    const store = useAuthStore()
    store.apply(stateWith(['WENSHU-STUDENT']))
    expect(store.isStudent).toBe(true)
  })

  it('教师打开 /teaching 启动壳不再被误判成学生', () => {
    window.location.hash = '#/teaching'
    const store = useAuthStore()
    store.apply(stateWith(['teacher', 'admin']))
    expect(store.isStudent).toBe(false)
  })

  it('hash 为 /teaching 且 roles 为空时也不兜底判学生', () => {
    window.location.hash = '#/teaching'
    const store = useAuthStore()
    store.apply(stateWith([]))
    expect(store.isStudent).toBe(false)
  })

  it('登录态/角色变化后实时重算', () => {
    const store = useAuthStore()
    store.apply(stateWith([]))
    expect(store.isStudent).toBe(false)
    store.apply(stateWith(['wenshu-student']))
    expect(store.isStudent).toBe(true)
    store.apply({ loggedIn: false, tenantId: null, user: null, roles: [] })
    expect(store.isStudent).toBe(false)
  })
})
