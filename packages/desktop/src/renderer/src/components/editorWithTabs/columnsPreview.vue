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
    <!-- The Page editor, rendered read-only, with the marker groups laid out
         as real columns. Same component engine and same styles as `page`, so
         fonts, theme, line width and table width cannot drift apart. -->
    <div
      ref="host"
      class="editor-host"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Muya, analyzeColumns, applyEditorColumns, revertEditorColumns } from '@muyajs/core'
import type { ColumnDiagnostic } from '@muyajs/core'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { addCommonStyle } from '@/util/theme'
import { readViewAnchor, scrollViewToAnchor, syncScrollAnchor } from '@/util/viewScrollSync'

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
// go through `muya.domNode`. The top-level blocks live in `.mu-container`
// (the engine's scrollPage), not directly under `.mu-editor`.
const editorEl = (): HTMLElement | null =>
  muya?.domNode?.querySelector<HTMLElement>('.mu-container') ?? null

const makeReadOnly = (el: HTMLElement): void => {
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('spellcheck', 'false')
}

const applyColumns = (): void => {
  const el = editorEl()
  if (el) applyEditorColumns(el)
}

// 视图间滚动同步（TODO1 #3）：把锚点（内容块索引）恢复到与 word/page 相同
// 的文档区域。markdown 变化后也调用——page 视图的编辑会持续更新锚点，
// 这里跟随，两个视图始终停在同一个地方。
const restoreViewAnchor = (): void => {
  const el = host.value
  const id = (editorStore.currentFile as { id?: string } | null)?.id
  if (!el || id == null) return
  const anchor = readViewAnchor(id)
  if (anchor !== null) scrollViewToAnchor(el, anchor)
}

const render = (): void => {
  warnings.value = analyzeColumns(props.markdown).diagnostics
  applyColumns()
}

const setContent = (): void => {
  if (!muya) return
  muya.setContent(props.markdown)
  // `setContent` rebuilds the block tree synchronously, but give Vue a tick so
  // any pending DOM work from the engine settles before we regroup.
  void Promise.resolve().then(() => {
    render()
    // Follow the anchor the Page view keeps updating, so an edit there keeps
    // both views on the same region of the document (TODO1 #3).
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
    // Read-only view: no quick-insert hint, no quick-insert trigger.
    hideQuickInsertHint: true,
    hideLinkPopup: true,
    focusMode: false,
  })

  // The engine builds the document tree in `init()`, exactly like `editor.vue`
  // does — without it the view stays empty.
  muya.init({ focus: false })

  // `getContainer` swapped the mount node, so re-point the ref at the live one
  // (scroll container + the node we make read-only).
  host.value = muya.domNode as HTMLDivElement
  makeReadOnly(host.value)

  render()

  const key = scrollKey()
  if (key) {
    const saved = Number(localStorage.getItem(key) ?? 0)
    if (saved > 0) host.value.scrollTop = saved
    host.value.addEventListener('scroll', () => {
      localStorage.setItem(key, String(host.value?.scrollTop ?? 0))
      // 视图间滚动同步（TODO1 #3）：本视图的滚动同样写锚点，切回 word/page
      // 时由 editor.vue 的挂载逻辑恢复。
      const id = (editorStore.currentFile as { id?: string } | null)?.id
      if (id != null) syncScrollAnchor(host.value!, id)
    }, { passive: true })
  }

  // 视图间锚点放在跨会话 scrollTop 之后：从另一个视图切进来时，「停在同一个
  // 文档区域」优先于「上次离开这个视图时的位置」。
  restoreViewAnchor()
})

watch(() => props.markdown, setContent)

onBeforeUnmount(() => {
  const key = scrollKey()
  if (key && host.value) localStorage.setItem(key, String(host.value.scrollTop))

  const el = editorEl()
  if (el) revertEditorColumns(el)

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
