import { ipcMain } from 'electron'
import { getAuthManager, openTeachingWindow } from '../auth'
import type { AuthLoginParams, AuthRequestOptions } from '@shared/types/auth'

/**
 * 教学客户端身份 IPC（edu-client E1）。
 *
 * token 永不进 renderer：renderer 只经 `auth::request` 代理发请求，
 * main 注入 Authorization + tenant-id。其余通道暴露脱敏登录态。
 */
export const registerAuthHandlers = (): void => {
  const auth = () => getAuthManager()

  ipcMain.handle('auth::request', (_event, opts: AuthRequestOptions) => auth().request(opts))

  ipcMain.handle('auth::login', (_event, params: AuthLoginParams) => auth().login(params))

  ipcMain.handle('auth::logout', () => auth().logout())

  ipcMain.handle('auth::get-state', () => auth().getState())

  ipcMain.handle('auth::list-tenants', () => auth().listTenants())

  ipcMain.handle('auth::open-teaching-window', () => {
    openTeachingWindow()
  })
}
