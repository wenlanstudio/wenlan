/**
 * E4：实验副本落盘（发布物 → 课程工作区 `{projectsRoot}/{courseCode}/doc/`）。
 *
 * 发布定格（TEACHING-SPEC §五）：服务端是卷面权威，本地副本是**作答面**——
 * todo 回填与作答会写进副本文件。因此：
 *   - 同 releaseId 重开保留本地文件（服务端派生内容本就没变，学生回填成果不能丢）；
 *   - 换发布物（新 releaseId）整篇重写；「还原」= force 重写；
 *   - 归属记在 sidecar `.wenlan-copies.json`（fileName → releaseId），写入校验以它为准。
 *
 * 路径全部 main 侧拼装：渲染端只传 courseKey 与文件名（白名单字符清洗），不给
 * 任意路径；写入回填用 docPath，但必须落在 projectsRoot 内且 sidecar 认识它。
 * 纯函数（put/resolve/sanitize）零 electron 依赖可在 vitest 直测；IPC 注册在
 * initLabCopyHandlers()（与 projectsRoot.ts 同款风格）。
 */

import fs from 'fs'
import path from 'path'
import { ipcMain } from 'electron'
import { ensureProjectsRoot } from './projectsRoot'

/** sidecar 文件名（doc/ 目录内；JSON：fileName → { releaseId, savedAt }）。 */
const SIDECAR_NAME = '.wenlan-copies.json'

/** 文件名/课程目录段的清洗：路径分隔符与 Windows 保留字符一律去，点结尾去。 */
export const sanitizeSegment = (input: string): string => {
  const cleaned = String(input ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trimEnd()
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`不合法的目录/文件名：${JSON.stringify(input)}`)
  }
  return cleaned
}

export interface LabCopyPutResult {
  docPath: string
  /** true = 命中同 releaseId 旧副本，本地文件原样保留（学生回填成果不丢）。 */
  kept: boolean
}

const sidecarPathOf = (docDir: string): string => path.join(docDir, SIDECAR_NAME)

interface CopySidecar {
  [fileName: string]: { releaseId: number; savedAt: string }
}

const readSidecar = (docDir: string): CopySidecar => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sidecarPathOf(docDir), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CopySidecar)
      : {}
  } catch {
    return {}
  }
}

const writeSidecar = (docDir: string, map: CopySidecar): void => {
  fs.writeFileSync(sidecarPathOf(docDir), `${JSON.stringify(map, null, 2)}\n`, 'utf8')
}

/** 纯函数：sidecar 判定本副本应保留还是重写。 */
export const shouldKeepCopy = (
  sidecar: CopySidecar,
  fileName: string,
  releaseId: number,
  fileExists: boolean
): boolean => fileExists && sidecar[fileName]?.releaseId === releaseId

/** 纯函数：docPath 是否落在 root 内且 sidecar 认识它（回填写入的唯一合法通道）。 */
export const isWritableDocPath = (
  root: string,
  docPath: string,
  sidecar: CopySidecar
): boolean => {
  const resolved = path.normalize(path.resolve(docPath))
  const base = path.normalize(path.resolve(root))
  const rel = path.relative(base, resolved)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false
  const dir = path.dirname(resolved)
  if (path.basename(dir) !== 'doc') return false
  const fileName = path.basename(resolved)
  return fileName.endsWith('.md') && !!sidecar[fileName]
}

/** 落盘或保留副本（渲染端只给清洗前的 courseKey/文件名，路径在此拼装）。 */
export const putLabCopy = (
  root: string,
  opts: { courseKey: string; fileName: string; content: string; releaseId: number; force?: boolean }
): LabCopyPutResult => {
  const courseKey = sanitizeSegment(opts.courseKey)
  const fileName = sanitizeSegment(opts.fileName)
  if (!fileName.toLowerCase().endsWith('.md')) {
    throw new Error(`实验副本必须是 .md 文件：${fileName}`)
  }
  if (!Number.isFinite(opts.releaseId) || opts.releaseId <= 0) {
    throw new Error(`不合法的 releaseId：${opts.releaseId}`)
  }
  const docDir = path.join(root, courseKey, 'doc')
  fs.mkdirSync(docDir, { recursive: true })
  const docPath = path.join(docDir, fileName)
  const sidecar = readSidecar(docDir)
  const kept = !opts.force && shouldKeepCopy(sidecar, fileName, opts.releaseId, fs.existsSync(docPath))
  if (!kept) {
    fs.writeFileSync(docPath, opts.content, 'utf8')
    sidecar[fileName] = { releaseId: opts.releaseId, savedAt: new Date().toISOString() }
    writeSidecar(docDir, sidecar)
  }
  return { docPath, kept }
}

/** 回填/作答写回：只放行 sidecar 认识的、projectsRoot 内 doc/ 下的 .md。 */
export const writeLabDoc = (root: string, docPath: string, content: string): boolean => {
  const docDir = path.dirname(path.normalize(path.resolve(docPath)))
  if (!isWritableDocPath(root, docPath, readSidecar(docDir))) return false
  fs.writeFileSync(path.normalize(path.resolve(docPath)), content, 'utf8')
  return true
}

/** 「还原」：删掉 sidecar 归属后按服务端内容强制重写（下次 put 一定落新内容）。 */
export const restoreLabCopy = (
  root: string,
  opts: { courseKey: string; fileName: string; content: string; releaseId: number }
): LabCopyPutResult => putLabCopy(root, { ...opts, force: true })

export const initLabCopyHandlers = (): void => {
  ipcMain.handle(
    'teaching::lab-copy-put',
    (_e, opts: { courseKey: string; fileName: string; content: string; releaseId: number; force?: boolean }) =>
      putLabCopy(ensureProjectsRoot(), opts)
  )
  ipcMain.handle('teaching::lab-doc-write', (_e, opts: { docPath: string; content: string }) =>
    writeLabDoc(ensureProjectsRoot(), opts.docPath, opts.content)
  )
}
