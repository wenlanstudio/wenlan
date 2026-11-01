<template>
  <div class="view-switcher">
    <!-- 从右往左：主视图（六叶 + 表图本）最右固定，页宽滑块最左。
         滑块职责由 store.sliderDuty 给出——分屏时一律收起（宽度控制被
         分割条吸收，视图模型 §3）。 -->
    <div
      v-if="sliderDuty === 'flow-width'"
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

    <!-- 二组六叶（视图模型 §1/§2）：编辑组 { 文 全文, 栏 分栏, 页 逻辑页 } │
         展示组 { 纸 物理纸, 览 页览, 示 放映 }。配置选择式：点选/点消至多两叶
         （1=全屏 2=分屏，选满点不动、不可选空）。column 只对真有分栏标记的
         文档显示（§4.4 #5）。 -->
    <div class="leaves">
      <button
        v-for="leaf in visibleLeaves"
        :key="leaf"
        class="leaf-btn"
        :class="{ active: leafSelection.includes(leaf), groupStart: leaf === 'paper' }"
        :title="LEAF_META[leaf].title"
        @click="toggleLeaf(leaf)"
      >
        {{ LEAF_META[leaf].label }}
      </button>
    </div>

    <!-- 顶级正交视图：表 / 图 / 本（不进文示树） -->
    <div class="main-views">
      <button
        v-for="tv in TOP_VIEWS"
        :key="tv"
        class="main-view-btn"
        :class="{ active: topView === tv }"
        :title="TOP_VIEW_META[tv].title"
        @click="toggleTopView(tv)"
      >
        {{ TOP_VIEW_META[tv].icon }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  useEditorViewStore,
  TOP_VIEWS,
  LEAVES,
  type Leaf
} from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { t } from '@/i18n'

const editorViewStore = useEditorViewStore()
const preferencesStore = usePreferencesStore()
const { leafSelection, topView, hasColumns, sliderDuty } = storeToRefs(editorViewStore)
const { toggleLeaf, toggleTopView } = editorViewStore
const { editorLineWidth } = storeToRefs(preferencesStore)

// 叶的短名与提示。label 是单字 CJK 刻度（与主视图图标同族，刻意不翻译）；
// title 中文提示——与 deck 工具条同策略（该用户群中文工作语言）。
// 刻度「文 栏 页│纸 览 示」：页 = 逻辑纸（缝叠加投影）、纸 = 物理纸（纸卡
// 推挤流），共享同一测量基座（视图模型 §5）。
const LEAF_META: Record<Leaf, { label: string; title: string }> = {
  flow: { label: '文', title: '全文（连续流编辑）' },
  column: { label: '栏', title: '分栏（空间离散，需 begin 标记）' },
  page: { label: '页', title: '逻辑页——连续流 + 分页缝提示（Word 草稿视图）' },
  paper: { label: '纸', title: '纸面——真纸卡排版（Word 页面视图，卡内可编辑）' },
  slide: { label: '览', title: '页览——全部真实页排开看（溢出的逻辑页带「N页」徽章）' },
  present: { label: '示', title: '放映（一次一页）' }
}

const TOP_VIEW_META: Record<string, { icon: string; title: string }> = {
  table: { icon: '表', title: 'Tables' },
  figure: { icon: '图', title: 'Figure' },
  code: { icon: '本', title: 'Markdown Source' }
}

const visibleLeaves = computed<Leaf[]>(() =>
  LEAVES.filter((leaf) => leaf !== 'column' || hasColumns.value)
)

// TODO1 #5 — the slider is shared by all views; the active view's duty decides
// whether it renders and what it adjusts. `slide-zoom` (slide 列表缩放) 接线时
// 在 store.sliderDuty 里改语义即可。
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

.leaves {
  display: flex;
  align-items: center;
  gap: 1px;
}

/* 编辑组与展示组之间一道分隔，提示二组两根正交轴（视图模型 §1） */
.leaf-btn.groupStart {
  border-left: 1px solid var(--editorColor10);
  padding-left: 7px;
  margin-left: 3px;
}

.leaf-btn {
  height: 20px;
  min-width: 20px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
  white-space: nowrap;
}

.leaf-btn:hover {
  color: var(--editorColor80);
  background: var(--editorColor04);
}

.leaf-btn.active {
  color: var(--editorBgColor);
  background: var(--editorColor50);
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
  .leaves {
    display: none;
  }
}

@media (max-width: 640px) {
  .width-slider-group {
    display: none;
  }
}
</style>
