<template>
  <div
    ref="container"
    class="teaching-reader mt-scroll-area"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { markRaw } from 'vue'
import { Muya } from '@muyajs/core'
import '@muyajs/core'
import { buildMuyaViewOptions } from '@/util/muyaViewOptions'

/**
 * 讲义只读阅读（edu-client E2）：本地 muya 渲染学生版 md，挂只读锁。
 *
 * 与编辑器同引擎（复用 buildMuyaViewOptions 的字体/尺寸/渲染旗标），但
 * 强制 readOnly——学生不改教师的作品（N3）。多视图叶（栏/页/览/映）在 E2
 * 下一阶段复用 view-model 管线接入，本组件先落地「文视图只读」这条主链路。
 */
const props = defineProps<{ markdown: string }>()

const container = ref<HTMLDivElement | null>(null)
let muya: Muya | null = null

onMounted(() => {
  const el = container.value
  if (!el) {
    return
  }
  const options = buildMuyaViewOptions()
  options.readOnly = true
  muya = markRaw(new Muya(el, options))
  muya.init({ focus: false })
  muya.setContent(props.markdown)
})

watch(
  () => props.markdown,
  (md) => {
    muya?.setContent(md)
  }
)

onBeforeUnmount(() => {
  muya?.destroy()
  muya = null
})
</script>

<style scoped>
.teaching-reader {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 24px 32px;
  box-sizing: border-box;
}
</style>
