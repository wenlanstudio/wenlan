<template>
  <div class="menu-dropdown">
    <template
      v-for="(item, index) of items"
      :key="item.id || index"
    >
      <div
        v-if="item.type === 'separator'"
        class="menu-dropdown-separator"
      />
      <div
        v-else
        class="menu-dropdown-item"
        :class="{ 'is-disabled': !item.enabled }"
        @click.stop="handleClick(item, index)"
        @mouseenter="openedIndex = item.submenu.length ? index : -1"
      >
        <span class="menu-dropdown-state">{{ item.checked ? '✓' : '' }}</span>
        <span class="menu-dropdown-label">{{ item.label }}</span>
        <span class="menu-dropdown-accelerator">{{ item.accelerator }}</span>
        <span
          v-if="item.submenu.length"
          class="menu-dropdown-arrow"
        >›</span>
        <menu-dropdown
          v-if="item.submenu.length && openedIndex === index"
          class="menu-dropdown-flyout"
          :items="item.submenu"
          @execute="(menuItem) => emit('execute', menuItem)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { MenuStructureItem } from '@shared/types/menu'

// NOTE: referenced recursively by file name above (Vue allows a SFC to refer
// to itself implicitly), which is why there is no self-import here.
defineProps<{
  items: MenuStructureItem[]
}>()

const emit = defineEmits<{
  execute: [item: MenuStructureItem]
}>()

const openedIndex = ref(-1)

const handleClick = (item: MenuStructureItem, index: number): void => {
  openedIndex.value = -1
  // Parents only open their flyout; actually running an entry that still owns
  // a submenu would skip the choice the user came here to make.
  if (!item.enabled || item.submenu.length) {
    openedIndex.value = index
    return
  }
  emit('execute', item)
}
</script>

<style scoped>
.menu-dropdown {
  min-width: 190px;
  padding: 4px 0;
  background: var(--floatBgColor, var(--sideBarBgColor));
  border: 1px solid var(--editorColor10);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
  color: var(--editorColor);
  user-select: none;
}

.menu-dropdown-item {
  position: relative;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 12px 0 6px;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  gap: 6px;
}

.menu-dropdown-item:hover {
  background: var(--themeColor);
  color: #fff;
}

.menu-dropdown-item.is-disabled {
  color: var(--editorColor30);
  cursor: default;
}

.menu-dropdown-item.is-disabled:hover {
  background: transparent;
  color: var(--editorColor30);
}

/* Reserved column so labels line up whether or not the row can be checked. */
.menu-dropdown-state {
  flex: none;
  width: 14px;
  text-align: center;
  font-size: 11px;
}

.menu-dropdown-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-dropdown-accelerator {
  flex: none;
  margin-left: 18px;
  opacity: 0.6;
  font-size: 12px;
}

.menu-dropdown-arrow {
  flex: none;
  margin-left: 4px;
  opacity: 0.7;
}

.menu-dropdown-separator {
  height: 1px;
  margin: 4px 0;
  background: var(--editorColor10);
}

.menu-dropdown-flyout {
  position: absolute;
  top: -5px;
  left: 100%;
}
</style>
