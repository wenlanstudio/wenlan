import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { AuthState } from '@shared/types/auth'

/**
 * 教学客户端登录态（renderer 侧，Pinia）。
 *
 * 数据源是 main 进程单例：getState 拿初始快照，onStateChanged 订阅后续变化
 * （登录/登出/刷新都会 broadcast）。token 不在本 store 里，只在 main。
 */
export const useAuthStore = defineStore('auth', () => {
  const state = ref<AuthState>({ loggedIn: false, tenantId: null, user: null })
  const ready = ref(false)

  async function init(): Promise<void> {
    state.value = await window.auth.getState()
    ready.value = true
  }

  function apply(next: AuthState): void {
    state.value = next
    ready.value = true
  }

  function listen(): void {
    window.auth.onStateChanged((next) => {
      state.value = next
      ready.value = true
    })
  }

  return { state, ready, init, apply, listen }
})
