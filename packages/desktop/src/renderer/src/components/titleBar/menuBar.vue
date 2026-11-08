<template>
  <div
    class="menu-bar title-no-drag"
    @mouseenter="handleBarEnter"
    @mouseleave="handleBarLeave"
  >
    <!-- Hibernate state: only the burger stays in the title bar. Hovering the
         bar — no click needed — reveals the flat entries beside it, the way the
         JetBrains new UI does it. Clicking the burger toggles the side bar
         (same entry as the View menu). Pressing Alt alone reveals + opens the
         first menu (#8, Word convention: Alt lands on 「文件」). -->
    <div
      class="menu-bar-burger"
      :class="{ 'is-open': openIndex !== -1 }"
      :title="t('sideBar.toggle')"
      @click.stop="handleBurgerClick"
    >
      <!-- 品牌「文」字图标（#10 字形）：底色/字色随侧栏开关切换，作状态指示——
           展开=米黄底 #FDFAF3 + 墨篆「文」#1A1A1C；隐藏=黑底 #1A1A1C + 米黄篆
           #FDFAF3。与 build/icons/md.svg 同一条 path、同一个 translate(225 25)
           校准，两组配色正是文档图标（纸白底墨字）与其反色（墨底米字）。 -->
      <svg
        width="16"
        height="16"
        viewBox="0 0 1024 1024"
      >
        <rect
          width="1024"
          height="1024"
          rx="204"
          ry="204"
          :fill="showSideBar ? '#FDFAF3' : '#1A1A1C'"
        />
        <g
          transform="translate(225 25) scale(1)"
          :fill="showSideBar ? '#1A1A1C' : '#FDFAF3'"
          fill-rule="evenodd"
        >
          <path d="M276.0,0.0 L267.0,6.0 L263.0,14.0 L264.0,123.0 L263.0,138.0 L259.0,149.0 L252.0,156.0 L246.0,159.0 L205.0,171.0 L161.0,191.0 L109.0,225.0 L84.0,246.0 L43.0,289.0 L15.0,326.0 L0.0,355.0 L1.0,366.0 L8.0,375.0 L20.0,377.0 L26.0,374.0 L33.0,365.0 L41.0,349.0 L66.0,314.0 L101.0,277.0 L109.0,271.0 L114.0,271.0 L135.0,287.0 L219.0,342.0 L256.0,371.0 L270.0,385.0 L238.0,437.0 L197.0,512.0 L162.0,584.0 L136.0,649.0 L113.0,723.0 L96.0,799.0 L85.0,879.0 L82.0,942.0 L86.0,952.0 L94.0,959.0 L100.0,961.0 L111.0,959.0 L120.0,949.0 L123.0,935.0 L126.0,878.0 L137.0,795.0 L148.0,741.0 L166.0,675.0 L190.0,607.0 L224.0,531.0 L270.0,446.0 L290.0,415.0 L295.0,411.0 L328.0,447.0 L364.0,499.0 L395.0,555.0 L418.0,609.0 L444.0,686.0 L463.0,763.0 L478.0,862.0 L483.0,944.0 L488.0,954.0 L493.0,958.0 L502.0,961.0 L509.0,960.0 L519.0,952.0 L523.0,942.0 L520.0,875.0 L511.0,806.0 L503.0,761.0 L491.0,709.0 L476.0,657.0 L451.0,587.0 L431.0,542.0 L398.0,481.0 L371.0,441.0 L344.0,407.0 L316.0,377.0 L318.0,371.0 L330.0,355.0 L370.0,309.0 L405.0,277.0 L433.0,257.0 L435.0,253.0 L433.0,243.0 L427.0,237.0 L416.0,234.0 L404.0,238.0 L389.0,248.0 L344.0,289.0 L316.0,320.0 L291.0,352.0 L289.0,352.0 L260.0,327.0 L231.0,306.0 L186.0,277.0 L157.0,261.0 L150.0,254.0 L149.0,248.0 L152.0,242.0 L161.0,233.0 L179.0,221.0 L213.0,205.0 L253.0,193.0 L285.0,189.0 L307.0,189.0 L342.0,193.0 L372.0,200.0 L403.0,211.0 L433.0,226.0 L456.0,241.0 L482.0,262.0 L527.0,309.0 L549.0,340.0 L570.0,381.0 L576.0,387.0 L584.0,390.0 L593.0,387.0 L599.0,380.0 L601.0,367.0 L595.0,350.0 L583.0,328.0 L553.0,285.0 L510.0,239.0 L473.0,210.0 L425.0,183.0 L388.0,169.0 L347.0,159.0 L298.0,154.0 L298.0,17.0 L296.0,10.0 L291.0,4.0 L283.0,0.0 Z" />
        </g>
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
import { storeToRefs } from 'pinia'
import type { MenuStructureItem } from '@shared/types/menu'
import MenuDropdown from './menuDropdown.vue'
import bus from '@/bus'
import { t } from '@/i18n'
import { useLayoutStore } from '@/store/layout'

const menus = ref<MenuStructureItem[]>([])
const openIndex = ref(-1)
const hovered = ref(false)
// 侧栏开关状态：汉堡图标用它做底色/字色指示（展开=米黄底黑字，隐藏=黑底米黄字）。
const { showSideBar } = storeToRefs(useLayoutStore())
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

const handleBurgerClick = (): void => {
  // 汉堡按钮 = 侧边栏开关（走 View 菜单同一条入口，原生菜单勾选态才能同步）。
  bus.emit('view:toggle-layout-entry', 'showSideBar')
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
  display: block;
  /* 字形与底色都硬编码在 SVG 里（墨底米字），不要再让 currentColor 覆盖米黄。 */
}

.menu-bar-burger:hover,
.menu-bar-burger.is-open {
  background: var(--editorColor10);
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
