<template>
  <div class="view-switcher">
    <!-- Main view buttons -->
    <div class="main-views">
      <button
        v-for="mv in MAIN_VIEWS"
        :key="mv"
        class="main-view-btn"
        :class="{ active: mainView === mv }"
        :title="MAIN_VIEW_META[mv].label"
        @click="handleMainViewClick(mv)"
      >
        {{ MAIN_VIEW_META[mv].icon }}
      </button>
    </div>

    <!-- Sub-view toggle (shown when current main view has multiple sub-views) -->
    <div
      v-if="availableSubViews.length > 1"
      class="sub-views"
    >
      <button
        v-for="sv in availableSubViews"
        :key="sv.key"
        class="sub-view-btn"
        :class="{ active: subView === sv.key }"
        @click="setSubView(sv.key)"
      >
        {{ sv.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useEditorViewStore, MAIN_VIEWS, MAIN_VIEW_META, type MainView } from '@/store/editorView'

const editorViewStore = useEditorViewStore()
const { mainView, subView, availableSubViews } = storeToRefs(editorViewStore)
const { setMainView, setSubView } = editorViewStore

const handleMainViewClick = (mv: MainView) => {
  if (mainView.value === mv) return
  setMainView(mv)
}
</script>

<style scoped>
.view-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  user-select: none;
}

.main-views {
  display: flex;
  align-items: center;
  gap: 2px;
}

.main-view-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
  line-height: 1;
}

.main-view-btn:hover {
  color: var(--editorColor80);
  background: var(--editorColor04);
}

.main-view-btn.active {
  color: var(--editorBgColor);
  background: var(--editorColor50);
}

.sub-views {
  display: flex;
  align-items: center;
  gap: 1px;
  padding-left: 4px;
  border-left: 1px solid var(--editorColor10);
  margin-left: 2px;
}

.sub-view-btn {
  height: 20px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
  white-space: nowrap;
}

.sub-view-btn:hover {
  color: var(--editorColor80);
  background: var(--editorColor04);
}

.sub-view-btn.active {
  color: var(--editorColor);
  background: var(--editorColor10);
}

/* Collapse sub-views on very narrow screens */
@media (max-width: 480px) {
  .sub-views {
    display: none;
  }
}
</style>
