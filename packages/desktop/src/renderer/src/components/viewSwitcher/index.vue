<template>
  <div class="view-switcher">
    <!-- 从右往左不断细化：主视图（文·示·表·图·本）最右固定，子视图在其左，
         页宽滑块（视图职责为调整页面宽度的视图共享）最左 -->
    <!-- Shared dock slider — shown in every view whose duty is page width
         (document/page, document/columns, code/source, table/all;
         figure/gallery joins when shipped) -->
    <div
      v-if="showWidthSlider"
      class="width-slider-group"
      :title="t('view.pageWidth')"
    >
      <input
        v-model.number="sliderValue"
        type="range"
        min="400"
        max="1200"
        step="10"
        class="width-slider"
        @change="handleSliderChange"
      >
      <span class="width-label">{{ sliderValue }}</span>
    </div>

    <!-- Sub-view toggle -->
    <div
      v-if="visibleSubViews.length > 1"
      class="sub-views"
    >
      <button
        v-for="sv in visibleSubViews"
        :key="sv.key"
        class="sub-view-btn"
        :class="{ active: subView === sv.key }"
        @click="setSubView(sv.key)"
      >
        {{ sv.label }}
      </button>
    </div>

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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorViewStore, MAIN_VIEWS, MAIN_VIEW_META, type MainView } from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { t } from '@/i18n'

const editorViewStore = useEditorViewStore()
const preferencesStore = usePreferencesStore()
const { mainView, subView, availableSubViews, hasColumns, sliderDuty } = storeToRefs(editorViewStore)
const { setMainView, setSubView } = editorViewStore
const { editorLineWidth } = storeToRefs(preferencesStore)

// §4.4 #5 — Columns only shows for a document that actually has a `begin`
// marker (and therefore only when a file is open).
const visibleSubViews = computed(() =>
  availableSubViews.value.filter((sv) => sv.key !== 'columns' || hasColumns.value)
)

const handleMainViewClick = (mv: MainView) => {
  if (mainView.value === mv) return
  setMainView(mv)
}

// TODO1 #5 — the slider is shared by all views; the active view's duty decides
// whether it renders and what it adjusts. `slide-zoom` (ppt/slide) gets its
// control here when that view ships.
const showWidthSlider = computed(() => sliderDuty.value === 'page-width')

const DEFAULT_WIDTH = 750

const parsePx = (value: string): number => {
  const m = value.trim().match(/^(\d+)px$/)
  return m ? Number(m[1]) : DEFAULT_WIDTH
}

const sliderValue = ref<number>(parsePx(editorLineWidth.value))

// Keep slider in sync when editorLineWidth changes from outside (e.g. preferences dialog).
watch(editorLineWidth, (val) => {
  sliderValue.value = parsePx(val)
})

const handleSliderChange = () => {
  const px = `${sliderValue.value}px`
  if (editorLineWidth.value !== px) {
    preferencesStore.SET_SINGLE_PREFERENCE({ type: 'editorLineWidth', value: px })
  }
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
  padding-left: 4px;
  border-left: 1px solid var(--editorColor10);
  margin-left: 2px;
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
  /* The icons are CJK glyphs: 12px at weight 500. Heavier weights close up the
     small strokes at this size and the character reads as a blob. */
  font-size: 12px;
  font-weight: 500;
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

/* Page width slider */
.width-slider-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 6px;
  border-right: 1px solid var(--editorColor10);
  margin-right: 2px;
}

.width-slider {
  width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--editorColor10);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.width-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--editorColor50);
  cursor: pointer;
  transition: background 0.2s ease;
}

.width-slider::-webkit-slider-thumb:hover {
  background: var(--editorColor80);
}

.width-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--editorColor50);
  cursor: pointer;
  border: none;
  transition: background 0.2s ease;
}

.width-slider::-moz-range-thumb:hover {
  background: var(--editorColor80);
}

.width-label {
  font-size: 10px;
  color: var(--editorColor40);
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Collapse on narrow screens */
@media (max-width: 560px) {
  .sub-views {
    display: none;
  }
}

@media (max-width: 640px) {
  .width-slider-group {
    display: none;
  }
}
</style>
