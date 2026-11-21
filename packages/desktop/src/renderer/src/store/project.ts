import { nextTick, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  addFile,
  unlinkFile,
  addDirectory,
  unlinkDirectory,
  resortTree,
  updateFileMtime,
  expandAncestors,
  findFileNode,
  findFolderNode
} from './treeCtrl'
import {
  RENAME_PAIR_WINDOW_MS,
  isDirRenamePair,
  takeRenamePartner,
  type DirMapping
} from './treeRenamePair'
import { usePreferencesStore } from './preferences'
import bus from '../bus'
import { create, paste, rename, type FileCreateType, type PasteOptions } from '../util/fileSystem'
import { isNewFileTemplateKind, renderNewFileTemplate } from '../util/newFileTemplates'
import { PATH_SEPARATOR } from '../config'
import notice from '../services/notification'
import { getFileStateFromData } from './help'
import { useLayoutStore, type LayoutPartial } from './layout'
import { useEditorStore } from './editor'
import { debouncedSendBufferedState } from './bufferedState'
import type { TreeNode, TreeFolderNode } from '../components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'

type ProjectTree = TreeNode
type TreeChange = FileChangeDetail

const normalizeProjectRoot = (pathname: string | null | undefined): string => {
  return pathname ? window.path.normalize(pathname) : ''
}

const createProjectRoot = (pathname: string): ProjectTree | null => {
  const normalizedPathname = normalizeProjectRoot(pathname)
  if (!normalizedPathname) return null

  let name = window.path.basename(normalizedPathname)
  if (!name) {
    // Root directory such as "/" or "C:\"
    name = normalizedPathname
  }

  return {
    pathname: normalizedPathname,
    name,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
}

interface BufferedProjectState {
  rootDirectory: string
}

const createBufferedProjectState = (state: unknown): BufferedProjectState => {
  const s = (state || {}) as { rootDirectory?: string; projectTree?: { pathname?: string } }
  return {
    rootDirectory: normalizeProjectRoot(s.rootDirectory || s.projectTree?.pathname)
  }
}

interface OpenProjectOptions {
  scheduleBufferUpdate?: boolean
  /** 教育窗口首次落在「教学」tab 时，只换树根、不抢当前 tab。 */
  activateTab?: boolean
}

interface CreateCacheEntry {
  dirname: string
  type: 'file' | 'directory' | string
  // Optional template kind for "New from template" (e.g. 'deck' | 'quiz').
  // Undefined for the plain blank-file create.
  template?: string
}

interface ClipboardEntry {
  type: 'copy' | 'cut' | string
  src: string
  dest?: string
}

interface PendingEvent {
  type: string
  change: TreeChange
}

export const useProjectStore = defineStore('project', () => {
  // Heterogeneous UI state: assigned file nodes, folder nodes, and the empty
  // "no selection" object/null across sidebar components; a single non-`any`
  // union breaks both the assignments and the field reads, so it stays a hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeItem = ref<any>({})
  const createCache = ref<CreateCacheEntry | Record<string, never>>({})
  const newFileNameCache = ref<string>('')
  const renameCache = ref<string | null>(null)
  // Text of whichever inline rename/create input is open. It lives here (not in
  // the row components) so the click-away handler can commit the edit.
  const nameInputValue = ref<string>('')
  const clipboard = ref<ClipboardEntry | null>(null)
  const projectTree = ref<ProjectTree | null>(null)
  const treeVersion = ref(0)
  const pendingTreeEvents = ref<PendingEvent[]>([])

  const preferencesStore = usePreferencesStore()

  watch(
    [() => preferencesStore.fileSortBy, () => preferencesStore.fileSortOrder],
    ([sortBy, sortOrder]) => {
      if (projectTree.value) {
        resortTree(projectTree.value, String(sortBy), String(sortOrder))
      }
    }
  )

  // Typora-style file panel: opening a file fixes the tree root to that file's
  // folder. Navigating *inside* the tree must not re-root it — clicking a file
  // in a subfolder only switches the active tab. Only a file outside the current
  // root (open dialog / CLI / a tab from another folder) re-roots the panel.
  // Keeping the root also keeps the main-process watcher on the original folder,
  // which watches the whole subtree recursively. See issue #26.
  const editorStoreForTree = useEditorStore()
  watch(
    () => editorStoreForTree.currentFile?.pathname,
    (pathname) => {
      if (!pathname) return
      const dirname = window.path.dirname(pathname)
      if (!dirname) return
      const root = projectTree.value?.pathname
      if (root) {
        // No-op when the root already matches (also guards the main-process
        // isSamePathSync early-return and the bootstrap re-open).
        if (window.fileUtils.isSamePathSync(root, dirname)) return
        // A file below the current root is tree-internal navigation; leave both
        // the visible root and its recursive watcher untouched.
        if (window.fileUtils.isChildOfDirectory(root, dirname)) return
      }
      window.electron.ipcRenderer.send('mt::switch-directory', dirname)
    }
  )

  function OPEN_PROJECT(
    pathname: string,
    { scheduleBufferUpdate = true, activateTab = true }: OpenProjectOptions = {}
  ): void {
    const layoutStore = useLayoutStore()
    const tree = createProjectRoot(pathname)
    if (!tree) return

    projectTree.value = tree
    // The old tree's selection and in-progress name inputs do not survive a new root.
    activeItem.value = {}
    CLEAR_NAME_INPUT_STATE()
    // Renaming stashes from the previous root must not pair across projects.
    CLEAR_RENAME_PAIR_STATE()

    if (activateTab) {
      const layout: LayoutPartial = {
        sidebarTab: 'files',
        showSideBar: true
      }
      layoutStore.SET_LAYOUT(layout, { scheduleBufferUpdate })
      layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
    }

    // Process pending events that arrived before projectTree was initialized.
    for (const event of pendingTreeEvents.value) {
      _processTreeEvent(event.type, event.change)
    }
    pendingTreeEvents.value = []

    if (scheduleBufferUpdate) {
      debouncedSendBufferedState()
    }
  }

  function CREATE_BUFFERED_STATE(): BufferedProjectState {
    return createBufferedProjectState({
      projectTree: projectTree.value
    })
  }

  function RESTORE_BUFFERED_STATE(state: unknown): void {
    const { rootDirectory } = createBufferedProjectState(state)
    if (rootDirectory) {
      if (projectTree.value?.pathname === rootDirectory) return
      OPEN_PROJECT(rootDirectory, { scheduleBufferUpdate: false })
    } else {
      projectTree.value = null
      pendingTreeEvents.value = []
      activeItem.value = {}
      CLEAR_NAME_INPUT_STATE()
      CLEAR_RENAME_PAIR_STATE()
    }
  }

  function LISTEN_FOR_LOAD_PROJECT(): void {
    window.electron.ipcRenderer.on(
      'mt::open-directory',
      (_e, pathname, options?: { activateTab?: boolean }) => {
        OPEN_PROJECT(String(pathname), { activateTab: options?.activateTab !== false })
      }
    )
  }

  function LISTEN_FOR_UPDATE_PROJECT(): void {
    window.electron.ipcRenderer.on('mt::update-object-tree', (_e, payload) => {
      const data = (payload as {
        type: string
        change?: TreeChange
        changes?: Array<{ type: string; change: TreeChange }>
      }) ?? {}
      // The main process batches the bulk initial scan into metadata-only
      // changes. Replay them in order, then bump the version once so the tree
      // component re-renders a single time instead of once per file.
      if (data.type === 'batch' && data.changes) {
        if (!projectTree.value) {
          for (const event of data.changes) {
            pendingTreeEvents.value.push(event)
          }
          return
        }
        for (const event of data.changes) {
          _applyTreeEvent(event.type, event.change, true)
        }
        treeVersion.value++
        return
      }

      const { type, change } = data
      if (!projectTree.value) {
        pendingTreeEvents.value.push({ type, change: change as TreeChange })
        return
      }
      _processTreeEvent(type, change as TreeChange)
    })
  }

  function _processTreeEvent(type: string, change: TreeChange): void {
    _applyTreeEvent(type, change, false)
    // The mutations above are in place, so watchers need a counter to react to.
    treeVersion.value++
  }

  // --- external-rename pairing ----------------------------------------------
  // chokidar emits a rename as a bare `add`(new) + `unlink`(old) pair (add
  // first on Windows, unlink first on Linux). Pair the two so that open tabs
  // follow the new path (RENAME_IF_NEEDED keeps tab id, content and save
  // state) and the "removed on disk" dirty mark never fires for a mere
  // rename. Without pairing, an external rename of an open file lights the
  // phantom dirty dot and Ctrl+S would resurrect the file under its old name.
  //
  // Known limits (accepted): single-file windows (type='file' watcher) still
  // report the removal, and the main process' openedFiles bookkeeping is not
  // updated for external renames.
  interface RenamePairEntry {
    pathname: string
    birthTime?: number | Date
    at: number
    timer?: ReturnType<typeof setTimeout>
  }

  const renamePairState = {
    recentAdds: new Map<string, RenamePairEntry>(),
    pendingUnlinks: new Map<string, RenamePairEntry>(),
    pendingDirUnlinks: new Map<string, RenamePairEntry>(),
    pendingDirAdds: new Map<string, RenamePairEntry>(),
    dirMappings: [] as DirMapping[],
    // Birthtimes of a removed subtree: a directory rename unlinks the whole
    // folder before the per-file `unlink` events arrive, so the old child
    // rows (their birthTimes) are already gone when the pairing runs.
    removedDirBirthTimes: new Map<string, { birthTime?: number | Date; at: number }>()
  }

  const dropEntry = (map: Map<string, RenamePairEntry>, key: string): void => {
    const entry = map.get(key)
    if (entry?.timer) clearTimeout(entry.timer)
    map.delete(key)
  }

  // Re-stashing the same path must not orphan the previous entry's timer.
  const stashEntry = (map: Map<string, RenamePairEntry>, entry: RenamePairEntry): void => {
    dropEntry(map, entry.pathname)
    map.set(entry.pathname, entry)
  }

  function CLEAR_RENAME_PAIR_STATE(): void {
    const { recentAdds, pendingUnlinks, pendingDirUnlinks, pendingDirAdds } = renamePairState
    for (const key of [...recentAdds.keys()]) dropEntry(recentAdds, key)
    for (const key of [...pendingUnlinks.keys()]) dropEntry(pendingUnlinks, key)
    for (const key of [...pendingDirUnlinks.keys()]) dropEntry(pendingDirUnlinks, key)
    for (const key of [...pendingDirAdds.keys()]) dropEntry(pendingDirAdds, key)
    renamePairState.dirMappings = []
    renamePairState.removedDirBirthTimes.clear()
  }

  // Keep the sidebar selection on the renamed node (same as RENAME_IN_SIDEBAR).
  function retargetActiveItem(src: string, dest: string): void {
    if (activeItem.value?.pathname === src) {
      activeItem.value = {
        ...activeItem.value,
        pathname: dest,
        name: window.path.basename(dest)
      }
    }
  }

  function followExternalRename(src: string, dest: string): void {
    retargetActiveItem(src, dest)
    useEditorStore().RENAME_IF_NEEDED({ src, dest })
    // Re-point the per-file watcher and the main-process opened-files list so
    // content changes on the renamed file still reach the retargeted tab
    // (and the stale watcher on the old path stops firing for it). Main
    // dedupes repeated notifications for an already-retargeted tab.
    window.electron.ipcRenderer.send('mt::window-change-file-path', dest, src)
  }

  const pairOptions = (at: number) => ({
    at,
    windowMs: RENAME_PAIR_WINDOW_MS,
    dirMappings: renamePairState.dirMappings
  })

  function handleRuntimeUnlink(change: TreeChange): void {
    const editorStore = useEditorStore()
    const { pathname } = change
    const at = Date.now()

    // Read the row's birthTime before the removal; a directory rename has
    // already removed the folder row, so fall back to the captured subtree.
    const row = findFileNode(projectTree.value!, pathname)
    const birthTime = row?.birthTime ?? renamePairState.removedDirBirthTimes.get(pathname)?.birthTime
    unlinkFile(projectTree.value!, change)

    const partner = takeRenamePartner(
      renamePairState.recentAdds,
      { pathname, birthTime, at },
      pairOptions(at)
    )
    if (partner) {
      if (partner.timer) clearTimeout(partner.timer)
      followExternalRename(pathname, partner.pathname)
      return
    }

    // No partner (yet). Defer the dirty mark by one pairing window so a
    // slightly delayed rename partner can still claim this unlink; a real
    // removal just lights the dot ~600ms later, imperceptibly.
    stashEntry(renamePairState.pendingUnlinks, {
      pathname,
      birthTime,
      at,
      timer: setTimeout(() => {
        renamePairState.pendingUnlinks.delete(pathname)
        editorStore.SET_SAVE_STATUS_WHEN_REMOVE({ pathname })
      }, RENAME_PAIR_WINDOW_MS)
    })
  }

  function handleRuntimeAdd(change: TreeChange): void {
    const editorStore = useEditorStore()
    const { pathname, data, isMarkdown, birthTime } = change as typeof change & {
      birthTime?: number | Date
    }
    addFile(projectTree.value!, change as Parameters<typeof addFile>[1], String(preferencesStore.fileSortBy), String(preferencesStore.fileSortOrder))
    if (isMarkdown && newFileNameCache.value && pathname === newFileNameCache.value) {
      const fileState = getFileStateFromData(data as Record<string, unknown>)
      editorStore.UPDATE_CURRENT_FILE(fileState)
      newFileNameCache.value = ''
    }

    const at = Date.now()
    // Linux order: the unlink arrived first and is waiting for this add.
    const partner = takeRenamePartner(
      renamePairState.pendingUnlinks,
      { pathname, birthTime, at },
      pairOptions(at)
    )
    if (partner) {
      if (partner.timer) clearTimeout(partner.timer)
      followExternalRename(partner.pathname, pathname)
      return
    }

    // Windows order: stash this add as the rename destination candidate.
    stashEntry(renamePairState.recentAdds, {
      pathname,
      birthTime,
      at,
      timer: setTimeout(() => renamePairState.recentAdds.delete(pathname), RENAME_PAIR_WINDOW_MS)
    })
  }

  function handleRuntimeAddDir(change: TreeChange): void {
    addDirectory(projectTree.value!, change)
    const { pathname } = change
    const at = Date.now()

    for (const [key, entry] of renamePairState.pendingDirUnlinks) {
      if (isDirRenamePair(entry.pathname, pathname, entry.at, at)) {
        dropEntry(renamePairState.pendingDirUnlinks, key)
        renamePairState.dirMappings.push({ from: entry.pathname, to: pathname, at })
        return
      }
    }

    // Reverse order (unlinkDir arriving after addDir): stash for the pairing.
    stashEntry(renamePairState.pendingDirAdds, {
      pathname,
      at,
      timer: setTimeout(() => renamePairState.pendingDirAdds.delete(pathname), RENAME_PAIR_WINDOW_MS)
    })
  }

  function handleRuntimeUnlinkDir(change: TreeChange): void {
    const { pathname } = change
    const at = Date.now()

    // Capture the subtree's file birthTimes before the folder row (and its
    // children) is removed — the delayed per-file unlinks still need them.
    // Prune stale captures from long-past folder removals first.
    const staleCutoff = at - RENAME_PAIR_WINDOW_MS * 10
    for (const [key, captured] of renamePairState.removedDirBirthTimes) {
      if (captured.at < staleCutoff) renamePairState.removedDirBirthTimes.delete(key)
    }
    const folder = findFolderNode(projectTree.value!, pathname)
    if (folder) {
      const collect = (node: typeof folder): void => {
        for (const file of node.files) {
          renamePairState.removedDirBirthTimes.set(file.pathname, {
            birthTime: file.birthTime,
            at
          })
        }
        for (const child of node.folders) collect(child)
      }
      collect(folder)
    }
    unlinkDirectory(projectTree.value!, change)

    for (const [key, entry] of renamePairState.pendingDirAdds) {
      if (isDirRenamePair(entry.pathname, pathname, entry.at, at)) {
        dropEntry(renamePairState.pendingDirAdds, key)
        renamePairState.dirMappings.push({ from: pathname, to: entry.pathname, at })
        return
      }
    }

    stashEntry(renamePairState.pendingDirUnlinks, {
      pathname,
      at,
      timer: setTimeout(() => {
        renamePairState.pendingDirUnlinks.delete(pathname)
      }, RENAME_PAIR_WINDOW_MS)
    })
  }

  function _applyTreeEvent(type: string, change: TreeChange, fromBatch: boolean): void {
    const editorStore = useEditorStore()
    switch (type) {
      case 'add': {
        if (!fromBatch) {
          handleRuntimeAdd(change)
          break
        }
        const { pathname, data, isMarkdown } = change
        addFile(projectTree.value!, change as Parameters<typeof addFile>[1], String(preferencesStore.fileSortBy), String(preferencesStore.fileSortOrder))
        if (isMarkdown && newFileNameCache.value && pathname === newFileNameCache.value) {
          const fileState = getFileStateFromData(data as Record<string, unknown>)
          editorStore.UPDATE_CURRENT_FILE(fileState)
          newFileNameCache.value = ''
        }
        break
      }
      case 'unlink':
        if (!fromBatch) {
          handleRuntimeUnlink(change)
          break
        }
        unlinkFile(projectTree.value!, change)
        editorStore.SET_SAVE_STATUS_WHEN_REMOVE(change)
        break
      case 'addDir':
        if (!fromBatch) {
          handleRuntimeAddDir(change)
          break
        }
        addDirectory(projectTree.value!, change)
        break
      case 'unlinkDir':
        if (!fromBatch) {
          handleRuntimeUnlinkDir(change)
          break
        }
        unlinkDirectory(projectTree.value!, change)
        break
      case 'change':
        if (change?.mtimeMs !== undefined) {
          updateFileMtime(projectTree.value!, change as Parameters<typeof updateFileMtime>[1], String(preferencesStore.fileSortBy), String(preferencesStore.fileSortOrder))
        }
        break
      default:
        if (window.electron?.process?.env?.NODE_ENV === 'development') {
          console.log(`Unknown directory watch type: "${type}"`)
        }
        break
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CHANGE_ACTIVE_ITEM(item: any): void {
    activeItem.value = item
  }

  /** Expands the folders leading to `pathname`; false when it is not in the tree. */
  function REVEAL_PATH(pathname: string | null | undefined): boolean {
    if (!pathname || !projectTree.value) return false
    return expandAncestors(projectTree.value, pathname) !== null
  }

  function REVEAL_FILE_IN_SIDE_BAR(pathname?: string | null): void {
    const editorStore = useEditorStore()
    const target = pathname ?? editorStore.currentFile?.pathname
    if (!target) return

    const layoutStore = useLayoutStore()
    layoutStore.SET_LAYOUT({ showSideBar: true, sidebarTab: 'files' })
    // The tree mounts on the next flush, so the row cannot be found before it.
    nextTick(() => bus.emit('SIDEBAR::reveal-path', target))
  }

  function CHANGE_CLIPBOARD(data: ClipboardEntry | null): void {
    clipboard.value = data
  }

  // Rename and create share one "input is open" state, so they clear together.
  function CLEAR_NAME_INPUT_STATE(): void {
    createCache.value = {}
    renameCache.value = null
    nameInputValue.value = ''
  }

  // Clicking or blurring away accepts the edit, mirroring the Enter key and the
  // Finder / Windows Explorer gesture instead of discarding it (#3207, #3385).
  function COMMIT_NAME_INPUT(): void {
    const value = nameInputValue.value
    if (renameCache.value) {
      RENAME_IN_SIDEBAR(value)
      return
    }
    const { dirname } = createCache.value as CreateCacheEntry
    if (!dirname) return
    if (value) CREATE_FILE_DIRECTORY(value)
    else CLEAR_NAME_INPUT_STATE()
  }

  function SET_FOLDER_COLLAPSED(folder: TreeFolderNode, isCollapsed: boolean): void {
    folder.isCollapsed = isCollapsed
  }

  function ASK_FOR_OPEN_PROJECT(): void {
    window.electron.ipcRenderer.send('mt::ask-for-open-project-in-sidebar')
  }

  function LISTEN_FOR_SIDEBAR_CONTEXT_MENU(): void {
    bus.on('SIDEBAR::show-in-folder', () => {
      const { pathname } = activeItem.value
      window.electron.shell.showItemInFolder(pathname)
    })
    bus.on('SIDEBAR::copy-path', () => {
      const { pathname } = activeItem.value
      if (typeof pathname !== 'string' || !pathname) return
      window.electron.clipboard.writeText(pathname)
    })
    bus.on('SIDEBAR::reveal-file', (pathname: unknown) => {
      REVEAL_FILE_IN_SIDE_BAR(typeof pathname === 'string' ? pathname : null)
    })
    const startCreate = (type: string, template?: string): void => {
      // App-menu entry point has no tree context: without an open project the
      // active item is empty and dirname would be computed from undefined.
      if (!projectTree.value) {
        notice.notify({
          title: 'New File',
          type: 'warning',
          message: 'Open a folder first to create files in it.'
        })
        return
      }
      const { pathname, isDirectory } = activeItem.value
      // No selection yet (fresh project): fall back to the project root.
      const dirname = pathname
        ? (isDirectory ? pathname : window.path.dirname(pathname))
        : projectTree.value.pathname
      // A falsy/unknown template kind is normalized away so the blank-file
      // fast path stays byte-identical to before.
      const templateKind = isNewFileTemplateKind(template) ? template : undefined
      createCache.value = { dirname, type, template: templateKind }
      nameInputValue.value = ''
      bus.emit('SIDEBAR::show-new-input')
    }
    // mitt events are single-payload, so the template create uses its own
    // event instead of a second argument on SIDEBAR::new.
    bus.on('SIDEBAR::new', (type: unknown) => startCreate(String(type)))
    bus.on('SIDEBAR::new-template', (kind: unknown) => {
      startCreate('file', typeof kind === 'string' ? kind : undefined)
    })
    // File-menu "New in Project" lands here (see main/menu/actions/file.ts).
    window.electron.ipcRenderer.on('mt::sidebar::new-file-in-project', (_e, kind: unknown) => {
      startCreate('file', typeof kind === 'string' ? kind : undefined)
    })
    bus.on('SIDEBAR::remove', async() => {
      const { pathname } = activeItem.value
      if (typeof pathname !== 'string' || !pathname) return
      try {
        const trashed = await window.electron.ipcRenderer.invoke('mt::fs-trash-item', pathname)
        // The node is gone; drop the selection so Delete cannot retarget it.
        if (trashed && activeItem.value?.pathname === pathname) {
          activeItem.value = {}
        }
      } catch (err) {
        notice.notify({
          title: 'Error while deleting',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    })
    bus.on('SIDEBAR::copy-cut', (type: unknown) => {
      const { pathname: src } = activeItem.value
      clipboard.value = { type: String(type), src }
    })
    bus.on('SIDEBAR::paste', async() => {
      const cb = clipboard.value
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : window.path.dirname(pathname)
      if (cb && cb.src) {
        let dest = dirname + PATH_SEPARATOR + window.path.basename(cb.src)

        if (window.path.normalize(cb.src) === window.path.normalize(dest)) {
          if (cb.type === 'cut') {
            notice.notify({
              title: 'Paste Forbidden',
              type: 'warning',
              message: 'Source and destination must not be the same.'
            })
            return
          }
          // Copy in same folder: generate unique name (e.g. "file (copy).md", "file (copy 2).md")
          const ext = window.path.extname(cb.src)
          const base = window.path.basename(cb.src, ext)
          let suffix = 1
          const MAX_COPIES = 99
          dest = dirname + PATH_SEPARATOR + base + ' (copy)' + ext
          while (await window.fileUtils.pathExists(dest)) {
            suffix++
            if (suffix > MAX_COPIES) {
              notice.notify({
                title: 'Too many copies',
                type: 'warning',
                message: `Maximum of ${MAX_COPIES} copies reached. Please clean up first.`
              })
              return
            }
            dest = dirname + PATH_SEPARATOR + base + ` (copy ${suffix})` + ext
          }
        }

        cb.dest = dest

        paste(cb as PasteOptions)
          .then(() => {
            clipboard.value = null
          })
          .catch((err) => {
            notice.notify({
              title: 'Error while pasting',
              type: 'error',
              message: err instanceof Error ? err.message : String(err)
            })
          })
      }
    })
    bus.on('SIDEBAR::rename', () => {
      const { pathname } = activeItem.value
      renameCache.value = pathname
      nameInputValue.value = typeof pathname === 'string' ? window.path.basename(pathname) : ''
      bus.emit('SIDEBAR::show-rename-input')
    })
  }

  async function CREATE_FILE_DIRECTORY(name: string): Promise<void> {
    const cache = createCache.value as CreateCacheEntry
    const { dirname, type } = cache
    // A second call after the input closed (or with no create target) is a no-op.
    if (!dirname) return
    // Close the input before the async work: a later click then sees no open
    // input and cannot submit the same edit twice.
    CLEAR_NAME_INPUT_STATE()

    if (type === 'file' && !window.fileUtils.hasMarkdownExtension(name)) {
      name += '.md'
    }

    const fullName = dirname + PATH_SEPARATOR + name

    // Seeded content for template creates; blank files stay ''.
    let content = ''
    if (type === 'file' && isNewFileTemplateKind(cache.template)) {
      const baseName = name.replace(/\.(?:md|markdown)$/i, '')
      content = renderNewFileTemplate(cache.template, baseName)
    }

    try {
      // Creating over an existing path would silently overwrite it (outputFile
      // truncates). Refuse instead of destroying the existing file (#1946).
      if (await window.fileUtils.pathExists(fullName)) {
        notice.notify({
          title: 'Error in Side Bar',
          type: 'error',
          message: `A ${type} named "${name}" already exists in this folder.`
        })
        return
      }

      await create(fullName, type as FileCreateType, content)
      if (type === 'file') {
        newFileNameCache.value = fullName
      }
    } catch (err) {
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }

  function RENAME_IN_SIDEBAR(name: string): void {
    const editorStore = useEditorStore()
    const src = renameCache.value
    if (!src) return
    // Close the input before the async work: a later click then sees no open
    // input and cannot submit the same rename twice.
    CLEAR_NAME_INPUT_STATE()
    // An empty name would move the node onto its parent directory.
    if (!name) return
    const dirname = window.path.dirname(src)
    const dest = dirname + PATH_SEPARATOR + name
    if (window.path.normalize(dest) === window.path.normalize(src)) return
    rename(src, dest)
      .then(() => {
        // Keep the selection on the new path so a following F2 / Delete acts on
        // the renamed node instead of the one that no longer exists.
        retargetActiveItem(src, dest)
        editorStore.RENAME_IF_NEEDED({ src, dest })
      })
      .catch((err) => {
        notice.notify({
          title: 'Error while renaming',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
  }

  function OPEN_SETTING_WINDOW(): void {
    window.electron.ipcRenderer.send('mt::open-setting-window')
  }

  return {
    activeItem,
    createCache,
    newFileNameCache,
    renameCache,
    nameInputValue,
    clipboard,
    projectTree,
    treeVersion,
    pendingTreeEvents,
    OPEN_PROJECT,
    CREATE_BUFFERED_STATE,
    RESTORE_BUFFERED_STATE,
    LISTEN_FOR_LOAD_PROJECT,
    LISTEN_FOR_UPDATE_PROJECT,
    CHANGE_ACTIVE_ITEM,
    REVEAL_PATH,
    REVEAL_FILE_IN_SIDE_BAR,
    CHANGE_CLIPBOARD,
    CLEAR_NAME_INPUT_STATE,
    COMMIT_NAME_INPUT,
    SET_FOLDER_COLLAPSED,
    ASK_FOR_OPEN_PROJECT,
    LISTEN_FOR_SIDEBAR_CONTEXT_MENU,
    CREATE_FILE_DIRECTORY,
    RENAME_IN_SIDEBAR,
    OPEN_SETTING_WINDOW
  }
})
