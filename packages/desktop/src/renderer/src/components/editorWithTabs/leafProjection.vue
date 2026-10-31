<template>
  <div class="leaf-projection">
    <div
      ref="host"
      class="leaf-projection-host"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * leafProjection — (page, column) 分屏右 pane 的分栏投影（视图模型 v2 §1/§2）。
 *
 * 同一份 markdown 的**只读第二 muya 实例**，挂 column 透镜（columnsLayout:
 * 'columns'）——编辑发生在左 pane 的活引擎上，这里只展示"分栏长什么样"。
 *
 * 与 editor.vue 的差异是刻意的最小化：
 * - `readOnly: true`（三层锁死：contenteditable / 事件分发 / 状态提交）；
 * - 不注册任何 UI 插件、不接 json-change（不进保存/TOC/历史管线）、不接
 *   file-changed（换 tab 时整个分屏随 tab 切换重建）；
 * - markdown 变化 250ms 防抖 `setContent`（每次都是全量块树重建，不能跟
 *   打字同频；左 pane 的活引擎才是实时面）。
 *
 * 已知妥协：Muya.use 是进程级静态注册——若本组件挂载前 editor.vue 已注册过
 * UI 插件，投影实例也会实例化它们（readOnly 下多数浮层无从触发，风险可接受）。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { Muya, type IMuyaOptions } from '@muyajs/core'
import { usePreferencesStore } from '@/store/preferences'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'
import { getMuyaLocale } from '@/util/muyaLocale'

const props = defineProps<{
  markdown: string
}>()

const preferencesStore = usePreferencesStore()
const { language } = storeToRefs(preferencesStore)

const host = ref<HTMLDivElement | null>(null)
const muya = shallowRef<Muya | null>(null)

const PROJECTION_DEBOUNCE_MS = 250
let applyTimer = 0

const applyMarkdown = (): void => {
  if (muya.value) muya.value.setContent(props.markdown ?? '')
}

watch(
  () => props.markdown,
  () => {
    window.clearTimeout(applyTimer)
    applyTimer = window.setTimeout(applyMarkdown, PROJECTION_DEBOUNCE_MS)
  }
)

onMounted(() => {
  if (!host.value) return
  const options: Partial<IMuyaOptions> = {
    ...buildMuyaViewOptions(),
    markdown: props.markdown,
    locale: getMuyaLocale(language.value),
    readOnly: true,
    focusMode: false,
    columnsLayout: 'columns'
  }
  const instance = new Muya(host.value, options)
  instance.init()
  muya.value = instance
})

onBeforeUnmount(() => {
  window.clearTimeout(applyTimer)
  muya.value?.destroy()
  muya.value = null
})
</script>

<style scoped>
.leaf-projection {
  height: 100%;
  overflow: auto;
  background: var(--editorBgColor);
}

.leaf-projection-host {
  min-height: 100%;
}
</style>
