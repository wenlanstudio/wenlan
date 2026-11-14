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
   * 学生态判据：只认服务端下发的角色（文枢 `wenshu-student` 标记角色，
   * 2026-11-14 `d751e33` 起开号即绑定、存量账号已回填）。
   *
   * B 方案（单交互面）之前这里还拿 `#/teaching` hash 作回退——名单开通的
   * 学生账号未必配角色。该回退会让教师打开教学窗时被误判成学生，也把身份
   * 语义绑死在窗口类型上。角色下发齐备后回退删除：同一个窗里靠 RBAC 裁剪，
   * 不再按窗口类型猜身份。只影响 UI 裁剪与只读锁，不改登录态与 token。
   */
  const isStudent = computed(() => {
    const roles = state.value.roles ?? []
    return roles.some((role) => role.toLowerCase().includes('student'))
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
