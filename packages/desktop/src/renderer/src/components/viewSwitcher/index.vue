<template>
  <div class="view-switcher">
    <!-- 从右往左：主视图（可见叶 + 表图本）最右固定，页宽滑块最左。
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

    <!-- 刻度「文 栏│页 览 示」（视图模型 §1）：可见五叶 = 文 / 栏 / 页 /
         览 / 示；分隔线落在展示组首叶 page 前。配置选择式：点选/点消至多两叶
         （1=全屏 2=分屏，选满点不动、不可选空）。column 只对真有分栏标记的
         文档显示（§4.4 #5）。 -->
    <div class="leaves">
      <!-- 「本」（Markdown 源码，topView 'code'）在「文」左边：与文同属
           编辑组（2026-11-08 重排，b.1）——点击切源码视图（叶选择挂起），
           与叶按钮同款样式；active 与 topView 挂钩而非 leafSelection。 -->
      <button
        class="leaf-btn"
        :class="{ active: topView === 'code' }"
        title="本——Markdown 源码（编辑组）"
        @click="toggleTopView('code')"
      >
        本
      </button>
      <button
        v-for="leaf in visibleLeaves"
        :key="leaf"
        class="leaf-btn"
        :class="{ active: leafSelection.includes(leaf), groupStart: leaf === 'column' }"
        :title="LEAF_META[leaf].title"
        @click="onLeafClick(leaf)"
      >
        {{ LEAF_META[leaf].label }}
      </button>
    </div>

    <!-- 顶级正交视图：图 / 表 / [码]（不进文示树）。「本」已并入左侧编辑
         组（2026-11-08 重排）。「码」是底部代码执行工具窗口的开关；只在
         「文」**独占**时可点，分屏时同样禁用（判据在 store.isCodeRunSurface）。 -->
    <div class="main-views">
      <button
        v-for="tv in topViewsBeforeCode"
        :key="tv"
        class="main-view-btn"
        :class="{ active: topView === tv }"
        :title="TOP_VIEW_META[tv].title"
        @click="toggleTopView(tv)"
      >
        {{ TOP_VIEW_META[tv].icon }}
      </button>
      <button
        class="main-view-btn code-run-btn"
        :class="{ active: codeRunEnabled && panel.open, running: panel.running > 0 }"
        :disabled="!codeRunEnabled"
        :title="codeRunTitle"
        @click="panel.toggle()"
      >
        码
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
  visibleLeafList,
  type Leaf
} from '@/store/editorView'
import { usePreferencesStore } from '@/store/preferences'
import { useExecPanelStore } from '@/store/execPanel'
import { t } from '@/i18n'

const editorViewStore = useEditorViewStore()
const preferencesStore = usePreferencesStore()
const panel = useExecPanelStore()
const { leafSelection, topView, hasColumns, sliderDuty, isCodeRunSurface, presentImmersive } =
  storeToRefs(editorViewStore)
const { toggleLeaf, toggleTopView, enterPresentImmersive, exitPresentImmersive } =
  editorViewStore
const { editorLineWidth } = storeToRefs(preferencesStore)

/** 「示」是一键全屏放映，不参与「配置选择式」：点一下进全屏，再点一下退出。
 *  其余可见叶仍走 toggleLeaf 的选中/取消模型（store 语义保持不动）。 */
const onLeafClick = (leaf: Leaf): void => {
  if (leaf === 'present') {
    if (presentImmersive.value) exitPresentImmersive()
    else enterPresentImmersive()
    return
  }
  toggleLeaf(leaf)
}

/** 「本」已并入左侧编辑组（2026-11-08 重排）——主视图组只剩图/表，码是
 *  独立按钮。往后往 TOP_VIEWS 增删视图不必改模板。 */
const topViewsBeforeCode = TOP_VIEWS.filter((v) => v !== 'code')

const codeRunEnabled = computed<boolean>(() => isCodeRunSurface.value)
/** 计数与运行中状态不占按钮面积，收进 hover 提示；运行中另有角标脉冲。 */
const codeRunTitle = computed<string>(() => {
  if (!codeRunEnabled.value) return `${t('execPanel.title')}（仅「文」独占视图可展开）`
  const counts = panel.total > 0 ? ` ${panel.runnable}/${panel.total}` : ''
  const running = panel.running > 0 ? ` · ${t('execPanel.running')}` : ''
  return `${t('execPanel.title')}${counts}${running}`
})

// 叶的短名与提示。label 是单字 CJK 刻度（与主视图图标同族，刻意不翻译）；
// title 中文提示——与 deck 工具条同策略（该用户群中文工作语言）。
const LEAF_META: Record<Leaf, { label: string; title: string }> = {
  flow: { label: '文', title: '全文（连续流编辑）' },
  column: { label: '栏', title: '分栏（空间离散，需 begin 标记；只读）' },
  page: { label: '页', title: '页——A4 真分页预览（切行/续表真渲染，只读）' },
  slide: { label: '览', title: '页览——全部真实页排开看（溢出的逻辑页带「N页」徽章）' },
  present: { label: '示', title: '全屏放映（一次一页，Esc 退出）' }
}

const TOP_VIEW_META: Record<string, { icon: string; title: string }> = {
  table: { icon: '表', title: 'Tables' },
  figure: { icon: '图', title: 'Figure' },
  code: { icon: '本', title: 'Markdown Source' }
}

const visibleLeaves = computed<Leaf[]>(() => visibleLeafList(hasColumns.value))

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

/* 编辑组与展示组之间一道分隔，提示二组两根正交轴（视图模型 §1）。
   groupStart 落在 column（UI 名「栏」）前，即展示组首叶（编辑组 = 本/文）。 */
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

/* 非「文」视图：按钮常驻但不可点，也不吃 hover。 */
.main-view-btn:disabled {
  opacity: 0.38;
  cursor: default;
}

.main-view-btn:disabled:hover {
  color: var(--editorColor40);
  background: transparent;
}

.code-run-btn {
  position: relative;
}

/* 运行中：右上角主题色脉冲点（原状态栏 running-dot 移到按钮上）。 */
.code-run-btn.running::after {
  content: '';
  position: absolute;
  top: 1px;
  right: 1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--themeColor);
  animation: code-run-pulse 1.2s ease-in-out infinite;
}

@keyframes code-run-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.3;
  }
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
