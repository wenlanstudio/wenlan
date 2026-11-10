import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuthState } from '@shared/types/auth'

/**
 * 教学客户端登录态（renderer 侧，Pinia）。
 *
 * 数据源是 main 进程单例：getState 拿初始快照，onStateChanged 订阅后续变化
 * （登录/登出/刷新都会 broadcast）。token 不在本 store 里，只在 main。
 */
export const useAuthStore = defineStore('auth', () => {
  const state = ref<AuthState>({ loggedIn: false, tenantId: null, user: null, roles: [] })
  const ready = ref(false)

  /**
   * 学生态判据：优先看服务端角色标识；当前学生账号由名单开通、未必配角色，
   * 因此 `/teaching` 教育版实例（vue-router hash 路由）作为回退判据。
   * 两者都成立时只影响 UI 裁剪与只读锁，不改登录态与 token。
   */
  const isStudent = computed(() => {
    const roles = state.value.roles ?? []
    if (roles.some((role) => role.toLowerCase().includes('student'))) return true
    return window.location.hash.startsWith('#/teaching')
  })

  async function init(): Promise<void> {
    state.value = await window.auth.getState()
    ready.value = true
  }

  function apply(next: AuthState): void {
    state.value = next
    ready.value = true
  }

  // 应用壳与账号栏都会调用：只挂一次 IPC 监听。
  let listening = false
  function listen(): void {
    if (listening) return
    listening = true
    window.auth.onStateChanged((next) => {
      state.value = next
      ready.value = true
    })
  }

  return { state, ready, isStudent, init, apply, listen }
})
