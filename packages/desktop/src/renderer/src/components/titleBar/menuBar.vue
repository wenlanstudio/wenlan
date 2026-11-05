<template>
  <div
    class="menu-bar title-no-drag"
    @mouseenter="handleBarEnter"
    @mouseleave="handleBarLeave"
  >
    <!-- Hibernate state: only the burger stays in the title bar. Hovering the
         bar — no click needed — reveals the flat entries beside it, the way the
         JetBrains new UI does it. Clicking the burger opens the first menu,
         which is what the hamburger used to do with the old popup menu.
         Pressing Alt alone does the same reveal + open (#8, Word convention:
         Alt lands on 「文件」). -->
    <div
      class="menu-bar-burger"
      :class="{ 'is-open': openIndex !== -1 }"
      @click.stop="handleBurgerClick"
    >
      <svg
        width="14"
        height="12"
        viewBox="0 0 14 12"
      >
        <rect
          y="0"
          width="14"
          height="1.6"
          rx="0.8"
        />
        <rect
          y="5.2"
          width="14"
          height="1.6"
          rx="0.8"
        />
        <rect
          y="10.4"
          width="14"
          height="1.6"
          rx="0.8"
        />
      </svg>
    </div>
    <Transition name="menu-bar-fade">
      <div
        v-show="expanded"
        class="menu-bar-roots"
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
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MenuStructureItem } from '@shared/types/menu'
import MenuDropdown from './menuDropdown.vue'

const menus = ref<MenuStructureItem[]>([])
const openIndex = ref(-1)
const hovered = ref(false)
// Alt 唤出（#8）：单独按 Alt 展开菜单栏并打开首个菜单（「文件」）。
// 与悬停揭示互不干扰，Esc / 再按 Alt / 点外面收起。
const altRevealed = ref(false)
// Alt 组合键判别：Alt 按下后若夹进任何其它键，就不是「单独 Alt」——
// 在 keyup 时不再触发（Chromium 菜单栏同款语义，Alt+X 加速键不受扰）。
let altArmed = false

// The entries are hidden until the pointer arrives, and stay visible while a
// dropdown is open so hiding the bar can never pull it out from under the
// menu the user is reading.
const expanded = computed(() => hovered.value || openIndex.value !== -1 || altRevealed.value)

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

// Alt 唤出与收起（#8）：已开 → 收；未开 → 展示菜单栏并打开首个菜单。
const handleAltToggle = async (): Promise<void> => {
  if (openIndex.value !== -1) {
    close()
    altRevealed.value = false
    return
  }
  altRevealed.value = true
  await load()
  if (!menus.value.length) return
  openIndex.value = 0
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

const handleBarEnter = (): void => {
  hovered.value = true
}

const handleBarLeave = (): void => {
  hovered.value = false
}

const handleBurgerClick = async (): Promise<void> => {
  if (openIndex.value !== -1) {
    close()
    return
  }
  await load()
  if (!menus.value.length) return
  openIndex.value = 0
}

const run = (item: MenuStructureItem): void => {
  close()
  if (!item.id) return
  window.electron.windowControl.executeMenuItem(item.id)
}

const onDocumentClick = (): void => {
  close()
  altRevealed.value = false
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    close()
    altRevealed.value = false
    return
  }
  if (event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (!event.repeat) altArmed = true
    return
  }
  // 夹进其它键：Alt 组合键（加速键），不算单独 Alt。
  altArmed = false
}

const onKeyup = (event: KeyboardEvent): void => {
  if (event.key === 'Alt' && altArmed) {
    altArmed = false
    void handleAltToggle()
  }
}

onMounted(async () => {
  await load()

  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('keyup', onKeyup)
  window.addEventListener('blur', close)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('keyup', onKeyup)
  window.removeEventListener('blur', close)
})
</script>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  height: 100%;
  user-select: none;
}

.menu-bar-burger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 100%;
  color: var(--editorColor80, var(--editorColor));
  cursor: default;
}

.menu-bar-burger svg {
  fill: currentColor;
}

.menu-bar-burger:hover,
.menu-bar-burger.is-open {
  background: var(--editorColor10);
  color: var(--editorColor);
}

.menu-bar-roots {
  display: flex;
  align-items: center;
  height: 100%;
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

.menu-bar-fade-enter-active,
.menu-bar-fade-leave-active {
  transition: opacity 0.15s ease-in-out;
}

.menu-bar-fade-enter-from,
.menu-bar-fade-leave-to {
  opacity: 0;
}
</style>
