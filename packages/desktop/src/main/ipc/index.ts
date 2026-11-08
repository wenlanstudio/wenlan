import { registerBootInfo } from './bootInfo'
import { registerFsHandlers } from './fs'
import { registerPathHandlers } from './paths'
import { registerRipgrepHandlers } from './ripgrep'
import { registerUploaderHandlers } from './uploader'
import { registerFontsHandlers } from './fonts'
import { registerShellHandlers } from './shell'
import { registerWindowHandlers } from './window'
import { registerCmdHandlers } from './cmd'
import { registerI18nHandlers } from './i18n'
import { registerDialogHandlers } from './dialog'
import { registerDiagramHandlers } from './diagram'
import { registerMatplotlibHandlers } from './matplotlib'
import { registerLinkHtmlHandler } from './linkHtml'
import { registerMd2slidesHandlers } from './md2slides'
import { registerMdcode2runHandlers } from './mdcode2run'
import { registerAuthHandlers } from './auth'

export const registerSandboxIpcHandlers = (): void => {
  registerBootInfo()
  registerFsHandlers()
  registerPathHandlers()
  registerRipgrepHandlers()
  registerUploaderHandlers()
  registerFontsHandlers()
  registerShellHandlers()
  registerWindowHandlers()
  registerCmdHandlers()
  registerI18nHandlers()
  registerDialogHandlers()
  registerDiagramHandlers()
  registerMatplotlibHandlers()
  registerLinkHtmlHandler()
  registerMd2slidesHandlers()
  registerMdcode2runHandlers()
  registerAuthHandlers()
}
