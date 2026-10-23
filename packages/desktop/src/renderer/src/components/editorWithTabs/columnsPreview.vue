<template>
  <div class="columns-preview">
    <!-- §4.5 — the real consumer of the warning channel: a document that has
         `begin` markers but cannot render a single group still lands here, so
         it needs the diagnostics instead of an empty pane. -->
    <div
      v-if="warnings.length"
      class="diagnostics"
    >
      <div
        v-for="(w, i) in warnings"
        :key="`${w.rule}-${w.line}-${i}`"
        class="diagnostic"
        :class="w.level"
      >
        <span class="line">L{{ w.line }}</span>
        <span class="msg">{{ w.message }}</span>
      </div>
    </div>
    <!-- The same engine as `page`, with the column groups laid out as real
         columns: a column group is a node of the block tree, so the engine
         renders the columns itself. Same component engine and same styles as
         `page`, so fonts, theme, line width and table width cannot drift
         apart. -->
    <div
      ref="host"
      class="editor-host"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Muya,
  analyzeColumns,
  wordCount as muyaWordCount
} from '@muyajs/core'
import type { ColumnDiagnostic } from '@muyajs/core'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { addCommonStyle } from '@/util/theme'
import { readViewAnchor, scrollViewToAnchor, syncScrollAnchor } from '@/util/viewScrollSync'
import { serializeCursor } from '@/util/cursor'
import bus from '@/bus'
import { makeSyntheticHistory, readEngineHistory, writeEngineHistory } from './tabHistory'

const props = defineProps<{
  markdown: string
}>()

const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()

const host = ref<HTMLDivElement | null>(null)
const warnings = ref<ColumnDiagnostic[]>([])
let muya: Muya | null = null

const scrollKey = (): string | null => {
  const pathname = (editorStore.currentFile as { pathname?: string } | null)?.pathname

  return pathname ? `marktext-columns-scroll:${pathname}` : null
}

// Muya replaces the mount element in place (`getContainer` → `replaceWith`),
// and the ref keeps pointing at the detached node, so every DOM lookup has to
// go through `muya.domNode` (the scroll container).

const currentTabId = (): string | null =>
  (editorStore.currentFile as { id?: string } | null)?.id ?? null

// 视图间滚动同步（TODO1 #4）：把锚点（内容块索引）恢复到与 word/page 相同
// 的文档区域。markdown 变化后也调用——page 视图的编辑会持续更新锚点，
// 这里跟随，两个视图始终停在同一个地方。
const restoreViewAnchor = (): void => {
  const el = host.value
  const id = currentTabId()
  if (!el || id == null) return
  const anchor = readViewAnchor(id)
  if (anchor !== null) scrollViewToAnchor(el, anchor)
}

// Any document mutation — typing, paste, undo, redo — publishes the derived
// snapshot so the store (and therefore the file on disk) sees it. This is the
// same contract as `editor.vue`'s `json-change` handler: without it an edit
// made in this view never reaches the store and is never saved.
const handleEngineChange = (): void => {
  if (!muya) return
  publishChange(muya.getMarkdown(), serializeCursor(muya.getSelection()))
}

// Saving and other store reads (#3803, #2938) flush pending rAF-batched edits
// through this bus event; this view's engine must receive it too, or an edit
// made in the same frame as the save is silently dropped.
const handleFlushActiveEditor = (): void => {
  muya?.flush()
}

const publishChange = (markdown: string, cursor: ReturnType<typeof serializeCursor>): void => {
  const id = currentTabId()
  if (!id || !muya) return

  // The engine history is kept per tab so the Page view can pick the stack up
  // again when it is re-created (view switches destroy the engine instance).
  writeEngineHistory(id, muya.getHistory())
  editorStore.LISTEN_FOR_CONTENT_CHANGE({
    id,
    markdown,
    wordCount: muyaWordCount(markdown),
    cursor,
    history: makeSyntheticHistory(id, markdown),
    toc: muya.getTOC(),
    blocks: muya.getState()
  })
}

/**
 * Undo / redo from the Columns view.
 *
 * The undo stack belongs to the document, not to a view. Both views build the
 * same block tree (a column group is a node of it), so the stack can be
 * handed from one view to the other. No manual publish here: undo/redo
 * dispatches a `json-change` of its own, which `handleEngineChange` publishes —
 * the same contract as `editor.vue`'s handleUndo.
 */
const handleUndo = (): void => {
  muya?.undo()
}

const handleRedo = (): void => {
  muya?.redo()
}

const render = (): void => {
  warnings.value = analyzeColumns(props.markdown).diagnostics
}

// A change produced by this view's own engine (an edit, an undo) comes back
// through the store. Rebuilding the tree would clear the undo stack we just
// used, and the content is already rendered — so skip it.
const isSameContent = (a: string, b: string): boolean =>
  a.replace(/[\r\n]+$/, '') === b.replace(/[\r\n]+$/, '')

const setContent = (): void => {
  if (!muya) return
  muya.setContent(props.markdown)
  // `setContent` rebuilds the block tree synchronously, but give Vue a tick so
  // any pending DOM work from the engine settles before the anchor is applied.
  void Promise.resolve().then(() => {
    render()
    // Follow the anchor the Page view keeps updating, so an edit there keeps
    // both views on the same region of the document (TODO1 #4).
    restoreViewAnchor()
  })
}

onMounted(() => {
  if (!host.value) return

  // Global <style> the editor normally installs on mount; the Columns view can
  // be the first one mounted (restored from the persisted view), so install it
  // here too.
  addCommonStyle({
    codeFontSize: preferencesStore.codeFontSize,
    codeFontFamily: preferencesStore.codeFontFamily,
    hideScrollbar: preferencesStore.hideScrollbar
  })

  muya = new Muya(host.value, {
    ...buildMuyaViewOptions(),
    markdown: props.markdown,
    locale: getMuyaLocale(preferencesStore.language),
    // 分栏视图：分栏组是块树里的节点，引擎自己把它排成栏（columnsLayout）。
    columnsLayout: 'columns',
    // No quick-insert hint, no quick-insert trigger.
    hideQuickInsertHint: true,
    hideLinkPopup: true,
    focusMode: false,
  })

  // The engine builds the document tree in `init()`, exactly like `editor.vue`
  // does — without it the view stays empty.
  muya.init({ focus: false })

  // `getContainer` swapped the mount node, so re-point the ref at the live one
  // (the scroll container).
  host.value = muya.domNode as HTMLDivElement

  // 撤销栈属于文档而非视图：本视图的引擎实例是新建的，把 Page 视图留下的
  // 撤销栈接过来，Ctrl+Z 才能在这里继续撤销（TODO1 #3）。
  const id = currentTabId()
  const savedEngineHistory = id ? readEngineHistory(id) : undefined
  if (savedEngineHistory) {
    muya.setHistory(savedEngineHistory)
  }

  render()

  const key = scrollKey()
  if (key) {
    const saved = Number(localStorage.getItem(key) ?? 0)
    if (saved > 0) host.value.scrollTop = saved
    host.value.addEventListener('scroll', () => {
      localStorage.setItem(key, String(host.value?.scrollTop ?? 0))
      // 视图间滚动同步（TODO1 #4）：本视图的滚动同样写锚点，切回 word/page
      // 时由 editor.vue 的挂载逻辑恢复。
      const tabId = currentTabId()
      if (tabId != null) syncScrollAnchor(host.value!, tabId)
    }, { passive: true })
  }

  // The engine emits a low-level `json-change` on every document mutation;
  // the derived snapshot (markdown / cursor / history / TOC / blocks) is
  // computed in `handleEngineChange`, mirroring `editor.vue`'s handler. This
  // is what connects edits in this view to the save pipeline.
  muya.on('json-change', handleEngineChange)

  // Saving / exporting / printing flushes pending rAF-batched edits through
  // this bus event before the store's markdown is read (editor.ts).
  bus.on('flush-active-editor', handleFlushActiveEditor)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)

  // 视图间锚点放在跨会话 scrollTop 之后：从另一个视图切进来时，「停在同一个
  // 文档区域」优先于「上次离开这个视图时的位置」。
  restoreViewAnchor()

  // 全局只读锁（工具栏的锁图标）对本视图同样生效：拦下所有 beforeinput。
  const domNode = muya.domNode
  const readOnlyGuard = (e: Event) => {
    if (editorStore.readOnly)
      e.preventDefault()
  }
  domNode.addEventListener('beforeinput', readOnlyGuard)
  ;(domNode as HTMLElement & { __readOnlyGuard?: (e: Event) => void }).__readOnlyGuard = readOnlyGuard
})

watch(() => props.markdown, (value) => {
  if (muya && isSameContent(muya.getMarkdown(), value)) return
  setContent()
})

onBeforeUnmount(() => {
  const key = scrollKey()
  if (key && host.value) localStorage.setItem(key, String(host.value.scrollTop))

  bus.off('flush-active-editor', handleFlushActiveEditor)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)

  // Detach the read-only guard.
  const domNode = muya?.domNode as (HTMLElement & { __readOnlyGuard?: (e: Event) => void }) | undefined
  if (domNode?.__readOnlyGuard) {
    domNode.removeEventListener('beforeinput', domNode.__readOnlyGuard)
    delete domNode.__readOnlyGuard
  }

  // Flush any edit still queued in the engine's rAF batch: this view is
  // destroyed on every view switch (`v-if`), and `destroy()` would drop the
  // batch silently. `flush()` publishes through `handleEngineChange` first.
  muya?.flush()

  muya?.destroy()
  muya = null
})
</script>

<style scoped>
.columns-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Mirrors `.editor-component` in `editor.vue` — the Columns view is the same
   engine with the same styles (§4.4 #3), so the scroll container and the page
   padding must match the Page view. Keep both blocks in sync. */
.editor-host {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  cursor: default;
  overflow-anchor: none !important;
}

.editor-host :deep(.mu-container) {
  padding-top: 20px;
  padding-bottom: 100vh;
  zoom: var(--editor-zoom, 1);
}

.diagnostics {
  flex: none;
  max-height: 30%;
  overflow: auto;
  padding: 6px 12px;
  border-bottom: 1px solid var(--editorColor10);
  font-size: 12px;
}

.diagnostic {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  color: var(--editorColor80);
}

.diagnostic.warning {
  color: var(--warningColor, #d9822b);
}

.diagnostic .line {
  flex: none;
  min-width: 3em;
  color: var(--editorColor50);
  font-variant-numeric: tabular-nums;
}
</style>
