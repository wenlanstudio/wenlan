import { ipcMain } from 'electron'
import { teachingSocket } from '../teachingSocket'

/**
 * 课堂 ws IPC。
 *
 * renderer 只发语义动作（进房/退房/报到/翻页），所有帧由 main 广播；token 与
 * ws 句柄始终留在主进程。上行 type 白名单式地收在 teachingSocket 里，renderer
 * 无法发出任意 ws 消息。
 */
export const registerTeachingSocketHandlers = (): void => {
  ipcMain.handle('teaching::ws-join', (_event, releaseId: number) =>
    teachingSocket.join(releaseId)
  )
  ipcMain.handle('teaching::ws-host', (_event, releaseId: number) =>
    teachingSocket.host(releaseId)
  )
  ipcMain.handle('teaching::ws-page', (_event, page: number) => {
    teachingSocket.sendPage(page)
  })
  ipcMain.handle('teaching::ws-follow', (_event, locked: boolean) => {
    teachingSocket.sendFollow(locked)
  })
  ipcMain.handle('teaching::ws-end', (_event, sessionId: number | null) =>
    teachingSocket.end(sessionId)
  )
  ipcMain.handle('teaching::ws-leave', () => teachingSocket.leave())

  // 竞答（M2b 发题/收卷/作废）：全部是 fire-and-forget 上行，结果靠广播回来
  ipcMain.handle('teaching::ws-race-questions', () => {
    teachingSocket.sendRaceQuestions()
  })
  ipcMain.handle(
    'teaching::ws-race-open',
    (_event, questionId: number, limitSec: number) => {
      teachingSocket.sendRaceOpen(questionId, limitSec)
    }
  )
  ipcMain.handle('teaching::ws-race-close', (_event, openId: number) => {
    teachingSocket.sendRaceClose(openId)
  })
  ipcMain.handle('teaching::ws-race-void', (_event, openId: number) => {
    teachingSocket.sendRaceVoid(openId)
  })
  // 学生作答：choice 是本班显示序下标，服务端负责还原与判分。
  ipcMain.handle(
    'teaching::ws-race-answer',
    (_event, openId: number, choice: number) => {
      teachingSocket.sendRaceAnswer(openId, choice)
    }
  )
}
