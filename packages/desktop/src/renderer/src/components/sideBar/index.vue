<template>
  <div
    v-show="showSideBar && !hidden"
    ref="sideBar"
    class="side-bar"
    :style="[{ paddingTop: topInset }, { width: `${finalSideBarWidth}px` }]"
  >
    <div class="side-bar-tabs">
      <div
        v-for="entry of sideBarTabs"
        :key="entry.id"
        class="tab"
        :class="{ active: entry.id === sidebarTab }"
        @click="handleTabClick(entry.id)"
      >
        {{ entry.label() }}
      </div>
    </div>
    <div class="side-bar-content mt-scroll-area">
      <tree
        v-if="sidebarTab === 'files'"
        :project-tree="projectTree"
      />
      <toc v-else-if="sidebarTab === 'toc'" />
    </div>
    <div
      ref="dragBar"
      class="drag-bar"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useLayoutStore, type SidebarTab } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { useProjectStore } from '@/store/project'
import { shouldShowInAppTitleBar } from '@/components/titleBar/visibility'
import { t } from '@/i18n'
import { isMac } from '@/util'

import Tree from './tree.vue'
import Toc from './toc.vue'
import { storeToRefs } from 'pinia'

/** 沉浸式放映时由 app.vue 传入：只隐藏显示层，不改 showSideBar 用户偏好。 */
const props = defineProps<{ hidden?: boolean }>()

const layoutStore = useLayoutStore()
const preferencesStore = usePreferencesStore()
const projectStore = useProjectStore()

const sideBar = ref<HTMLDivElement | null>(null)
const dragBar = ref<HTMLDivElement | null>(null)

const sideBarViewWidth = ref(280)

const { sidebarTab, showSideBar, sideBarWidth } = storeToRefs(layoutStore)

const { projectTree } = storeToRefs(projectStore)
const { titleBarStyle } = storeToRefs(preferencesStore)

// The in-app title bar is `position: fixed` across the *whole window width*, so
// it overlays this column's top too — inset everything below it, here, instead
// of leaving every panel to invent its own clearance.
const topInset = computed<string>(() =>
  shouldShowInAppTitleBar(titleBarStyle.value, isMac) ? 'var(--titleBarHeight)' : '0px'
)

// Typora-style sidebar: the two content tabs are drawn on the panel itself,
// there is no icon strip left to switch panels or open the settings window.
const sideBarTabs: { id: SidebarTab; label: () => string }[] = [
  { id: 'files', label: () => t('sideBar.tabs.files') },
  { id: 'toc', label: () => t('sideBar.tabs.outline') }
]

const finalSideBarWidth = computed<number>(() => {
  if (!showSideBar.value || props.hidden) return 0
  return sideBarViewWidth.value < 220 ? 220 : sideBarViewWidth.value
})

onMounted(() => {
  nextTick(() => {
    const dragBarEl = dragBar.value
    if (!dragBarEl) return
    let startX = 0
    let currentSideBarWidth = +sideBarWidth.value
    let startWidth = currentSideBarWidth

    sideBarViewWidth.value = currentSideBarWidth

    const mouseUpHandler = (): void => {
      document.removeEventListener('mousemove', mouseMoveHandler, false)
      document.removeEventListener('mouseup', mouseUpHandler, false)
      layoutStore.CHANGE_SIDE_BAR_WIDTH(currentSideBarWidth < 220 ? 220 : currentSideBarWidth)
    }

    const mouseMoveHandler = (event: MouseEvent): void => {
      const offset = event.clientX - startX
      currentSideBarWidth = startWidth + offset
      sideBarViewWidth.value = currentSideBarWidth
    }

    const mouseDownHandler = (event: MouseEvent): void => {
      startX = event.clientX
      startWidth = +sideBarWidth.value
      document.addEventListener('mousemove', mouseMoveHandler, false)
      document.addEventListener('mouseup', mouseUpHandler, false)
    }

    dragBarEl.addEventListener('mousedown', mouseDownHandler, false)
  })
})

const handleTabClick = (id: SidebarTab): void => {
  layoutStore.SET_LAYOUT({ sidebarTab: id })
}
</script>

<style scoped>
.side-bar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  flex-grow: 0;
  width: 280px;
  /* 高度跟着 `.workspace` 走（= 视口 − 状态栏），不要用 100vh：100vh 会多出
     状态栏那 26px，把底部状态栏的左段（☰ / 代码执行）压在侧栏下面。 */
  height: 100%;
  min-height: 0;
  min-width: 220px;
  /* `height: 100%` 加上 title-bar inset 仍不能超出视口。 */
  box-sizing: border-box;
  position: relative;
  color: var(--sideBarColor);
  user-select: none;
  background: var(--sideBarBgColor);
  border-right: 1px solid var(--itemBgColor);
}

.side-bar-tabs {
  display: flex;
  justify-content: center;
  gap: 32px;
  padding: 10px 12px 0;
  flex-shrink: 0;
}

.side-bar-tabs .tab {
  font-size: 13px;
  color: var(--sideBarColor);
  opacity: 0.6;
  cursor: pointer;
  padding-bottom: 6px;
  border-bottom: 2px solid transparent;
}

.side-bar-tabs .tab:hover {
  opacity: 0.9;
}

.side-bar-tabs .tab.active {
  opacity: 1;
  font-weight: 600;
  color: var(--editorColor);
  border-bottom-color: var(--editorColor);
}

.side-bar-content {
  flex: 1;
  overflow: hidden;
}

.drag-bar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  width: 3px;
  cursor: col-resize;
}

.drag-bar:hover {
  border-right: 2px solid var(--iconColor);
}
</style>
