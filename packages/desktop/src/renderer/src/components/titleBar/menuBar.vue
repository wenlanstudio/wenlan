<template>
  <div
    ref="rootEl"
    class="menu-bar title-no-drag"
  >
    <div
      v-for="(menu, index) of menus"
      :key="menu.id || index"
      class="menu-bar-root title-no-drag"
      :class="{ 'is-open': openIndex === index }"
      @click.stop="toggle(index)"
      @mouseenter="handleEnter(index)"
    >
      {{ menu.label }}
      <menu-dropdown
        v-if="openIndex === index"
        class="menu-bar-panel"
        :items="menu.submenu"
        @execute="run"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MenuStructureItem } from '@shared/types/menu'
import MenuDropdown from './menuDropdown.vue'

// The bar replaces the old hamburger button, so it can take real horizontal
// room; the title bar uses this width to keep the centered filename clear.
const emit = defineEmits<{
  resize: [width: number]
}>()

const menus = ref<MenuStructureItem[]>([])
const openIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

const load = async (): Promise<void> => {
  try {
    // Read from the live window menu rather than a cached template: which
    // entries are checked or enabled changes as the document and layout do.
    menus.value = await window.electron.windowControl.getMenuStructure()
  } catch {
    menus.value = []
  }
}

const close = (): void => {
  openIndex.value = -1
}

const toggle = async (index: number): Promise<void> => {
  if (openIndex.value === index) {
    close()
    return
  }
  await load()
  openIndex.value = index
}

// Once one menu is open the whole bar stays hot, so sliding sideways across
// the remaining menus opens them — same as every other flat menu bar.
const handleEnter = (index: number): void => {
  if (openIndex.value === -1) return
  openIndex.value = index
}

const run = (item: MenuStructureItem): void => {
  close()
  if (!item.id) return
  window.electron.windowControl.executeMenuItem(item.id)
}

const onDocumentClick = (): void => close()

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') close()
}

onMounted(async () => {
  await load()

  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('blur', close)

  await nextTick()
  const el = rootEl.value
  if (!el) return
  emit('resize', el.offsetWidth)
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => emit('resize', el.offsetWidth))
  observer.observe(el)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('blur', close)
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  height: 100%;
  user-select: none;
}

.menu-bar-root {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 10px;
  color: var(--editorColor80, var(--editorColor));
  font-size: 13px;
  white-space: nowrap;
  cursor: default;
}

.menu-bar-root:hover,
.menu-bar-root.is-open {
  background: var(--editorColor10);
  color: var(--editorColor);
}

.menu-bar-panel {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
}
</style>
