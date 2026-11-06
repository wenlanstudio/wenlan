<template>
  <!-- Muya 构造时会把这个 host 替换成 contenteditable 的 .mu-editor 根，
       因此这里不放任何子节点或响应式绑定（见 muya.ts getContainer）。 -->
  <div
    ref="host"
    class="mu-paper-block-editor"
  />
</template>

<script setup lang="ts">
/**
 * 页叶稳定编辑层（sync-design D6 / M2）：一个只装「完整规范块」的可写 Muya
 * 小实例。与文视图共用同一个引擎、同一套 contenteditable / IME / 行内渲染，
 * 所以用户看到的是排版后的文字而不是 Markdown 源码；Markdown 只在提交时由
 * `getMarkdown()` 取回，写回链路完全复用 M2 的事务与 undo。
 *
 * 这里刻意不订阅 json-change：小实例里的每一次击键都是草稿，不进文档事务流。
 */
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { storeToRefs } from 'pinia'
import { Muya, type IMuyaOptions } from '@muyajs/core'
import { usePreferencesStore } from '@/store/preferences'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'

const props = defineProps<{
  /** 完整规范块的 markdown，作为草稿初值。 */
  markdown: string
}>()

const preferencesStore = usePreferencesStore()
const { language } = storeToRefs(preferencesStore)

const host = ref<HTMLDivElement | null>(null)
const engine = shallowRef<Muya | null>(null)

onMounted(() => {
  if (!host.value) return
  const options: Partial<IMuyaOptions> = {
    ...buildMuyaViewOptions(),
    markdown: props.markdown,
    locale: getMuyaLocale(language.value),
    readOnly: false,
    focusMode: false,
    columnsLayout: 'flat',
    // 浮层里不需要快速插入提示；拼写红线在编辑中会干扰排版观感。
    hideQuickInsertHint: true,
    spellcheckEnabled: false
  }
  const instance = markRaw(new Muya(host.value, options))
  instance.init({ focus: true })
  engine.value = instance
})

/** 提交前调用：先把 rAF 里尚未落盘的自源 op 冲进 jsonState 再序列化。 */
const getMarkdown = (): string | null => {
  const instance = engine.value
  if (!instance) return null
  instance.flush()
  return instance.getMarkdown()
}

const focus = (): void => engine.value?.domNode?.focus()

defineExpose({ getMarkdown, focus })

onBeforeUnmount(() => {
  engine.value?.destroy()
  engine.value = null
})
</script>

<style scoped>
.mu-paper-block-editor {
  min-height: 1.6em;
}

/* Muya 会替换 host；这些节点是动态创建的，需 :deep() 才能命中。 */
.mu-paper-block-editor,
.mu-paper-block-editor :deep(.mu-editor) {
  background: transparent;
  outline: none;
}

.mu-paper-block-editor :deep(.mu-container) {
  max-width: none;
  min-height: auto;
  margin: 0;
  padding: 0;
  background: transparent;
}
</style>
