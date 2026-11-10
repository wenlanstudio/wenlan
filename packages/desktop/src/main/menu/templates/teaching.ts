import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { t } from '../../i18n'
import { isLoggedIn } from '../../auth'

/**
 * 教育版「教学」菜单（D10 叠加态）。
 *
 * 不新增 IPC 通道：直接复用 renderer 命令中心已监听的
 * `mt::execute-command-by-id`，触发静态命令 `teaching.publish` / `teaching.classroom`。
 * 未登录的实例表面零教学概念（N1）：只在登录后可见；登录态变化时
 * AppMenu 重建编辑器菜单，这里按构建时的登录态取值。
 */
export default function(): MenuItemConstructorOptions {
  return {
    id: 'teachingMenu',
    label: t('teaching.menu'),
    visible: isLoggedIn(),
    submenu: [
      {
        label: t('teaching.publish'),
        click(_menuItem, browserWindow) {
          const win = browserWindow as BrowserWindow | undefined
          win?.webContents.send('mt::execute-command-by-id', 'teaching.publish')
        }
      },
      {
        // 课堂：在课堂中则下课，否则按当前文档最近一次发布的班开班。
        // 精确选班（多班）留给状态栏下拉，菜单这里是"一键继续上次那个班"。
        label: t('teaching.classroomMenu'),
        click(_menuItem, browserWindow) {
          const win = browserWindow as BrowserWindow | undefined
          win?.webContents.send('mt::execute-command-by-id', 'teaching.classroom')
        }
      },
      {
        // 发题控制台：课堂进行中才有内容；没开课会提示先开班。
        label: t('teaching.quizMenu'),
        click(_menuItem, browserWindow) {
          const win = browserWindow as BrowserWindow | undefined
          win?.webContents.send('mt::execute-command-by-id', 'teaching.quiz')
        }
      }
    ]
  }
}
