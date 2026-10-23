<template>
  <div
    v-if="visible"
    class="columns-diagnostics"
    role="status"
  >
    <div
      v-for="(w, i) in diagnostics"
      :key="`${w.rule}-${w.line}-${i}`"
      class="diagnostic"
      :class="w.level"
    >
      <span class="line">L{{ w.line }}</span>
      <span class="msg">{{ w.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { analyzeColumns, type ColumnDiagnostic } from '@muyajs/core'

const props = defineProps<{
  markdown: string
}>()

// The banner is transient; the console is what keeps the record.
const VISIBLE_MS = 5000

const diagnostics = ref<ColumnDiagnostic[]>([])
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const clearTimer = (): void => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

// Being mounted IS entering the Columns view: the parent renders this only
// while that lens is active, so mount is exactly the moment to report. It does
// not re-report on later edits — a banner re-arming on every keystroke would
// be noise, and the console entry for the switch already names the problems.
onMounted(() => {
  diagnostics.value = props.markdown ? analyzeColumns(props.markdown).diagnostics : []
  if (diagnostics.value.length === 0) return

  console.warn(`[columns] ${diagnostics.value.length} diagnostic(s) in this document:`)
  for (const d of diagnostics.value) {
    console.warn(`  L${d.line} [${d.level}] ${d.rule}: ${d.message}`)
  }

  visible.value = true
  timer = setTimeout(() => {
    visible.value = false
    timer = null
  }, VISIBLE_MS)
})

onBeforeUnmount(clearTimer)
</script>

<style scoped>
/* Overlays the top of the editor area instead of pushing it down — the engine
   keeps its full height, so switching the lens never reflows the document. */
.columns-diagnostics {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  max-height: 30%;
  overflow: auto;
  padding: 6px 12px;
  border-bottom: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
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

.diagnostic.error {
  color: var(--errorColor, #d93636);
}

.diagnostic .line {
  flex: none;
  min-width: 3em;
  color: var(--editorColor50);
  font-variant-numeric: tabular-nums;
}
</style>
