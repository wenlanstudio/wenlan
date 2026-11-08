<template>
  <div
    class="editor-with-tabs"
    :style="{
      'max-width': `calc(100vw - ${sideBarOffset}px)`,
      '--editor-zoom': zoom
    }"
  >
    <!-- 分栏诊断：进入 column 透镜时提示 5s 后消失，详情留在 console -->
    <columns-diagnostics
      v-if="editorLens === 'column'"
      :markdown="markdown"
    />
    <div
      class="container"
      :class="{
        split: isSplit,
        'paper-fullscreen': isPaperFullscreen,
        'present-fullscreen': isPresentFullscreen
      }"
      :style="isSplit && !isPresentFullscreen ? { '--split-ratio': `${rightRatio}` } : undefined"
    >
      <!-- 左 pane 只在有内容时渲染：单选列/放时它若仍占位（height:100%），
           会把全屏 deck-pane 顶出容器折叠区（2026-11-01 真机：白屏无内容）。 -->
      <div
        v-if="hasLeftPane"
        class="pane pane-left"
      >
        <!-- 分屏左叶也可能落展示支：(列,放) 的左叶是 slide 列表——deck-pane
             照 panel 形态挂（2026-11-01 真机：只见放不见列）。key 按叶分实例。 -->
        <deck-pane
          v-if="isSplit && (leftLeaf === 'slide' || leftLeaf === 'present')"
          :key="`left-${leftLeaf}`"
          :leaf="leftLeaf"
          mode="panel"
          :markdown="markdown"
        />
        <!-- 透镜宿主：WYSIWYG 引擎在 flow/column/page/table 透镜间常驻，
             切换只翻转 `data-lens` 而不重绘（TODO1 #21、#26）。分屏时活引擎占
             左 pane。页叶是只读投影（A″），不进活引擎。 -->
        <div
          v-else-if="editorLens"
          class="lens-host"
          :data-lens="editorLens"
        >
          <editor
            :markdown="markdown"
            :cursor="cursor"
            :text-direction="textDirection"
            :platform="platform"
            :lens="editorLens"
          />
        </div>
        <!-- 本（源码）：CodeMirror 独立渲染，非透镜 -->
        <source-code
          v-else-if="topView === 'code'"
          :markdown="markdown"
          :muya-index-cursor="muyaIndexCursor"
          :text-direction="textDirection"
        />
        <!-- 图视图占位（figure 未实现） -->
        <div
          v-else-if="topView === 'figure'"
          class="view-placeholder"
        >
          <div class="placeholder-inner">
            <div class="placeholder-icon">
              <svg
                viewBox="0 0 24 24"
                width="48"
                height="48"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
              >
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="2"
                />
                <circle
                  cx="8.5"
                  cy="8.5"
                  r="1.5"
                />
                <path d="M21 15l-5-5L5 21" />
              </svg>
            </div>
            <div class="placeholder-title">
              {{ t('view.figureView') }}
            </div>
            <div class="placeholder-hint">
              {{ t('view.comingSoon') }}
            </div>
          </div>
        </div>
      </div>
      <!-- 分割条：分屏时的比例手柄（视图模型 §3）。宽度控制被它吸收——
           页宽滑块此时收起（store.sliderDuty）。 -->
      <div
        v-if="isSplit && !isPresentFullscreen"
        class="divider"
        title="拖动调整两侧比例"
        @pointerdown="startDrag"
      />
      <!-- 右 pane：映支叶（slide 列表 / present 放映）、页叶真分片投影
           （paperProjection，A″ 只读）或栏投影（column 只读第二实例——右
           pane 一律只读，编辑面不变量 §2）。key 按 leaf 分实例——同一
           iframe 实例的 view 恒定（deck 侧 player/列表布局二选一），
           slide 与 present 各持一份；投影实例的 columnsLayout 建构期定死。 -->
      <div
        v-if="isSplit"
        class="pane pane-right"
      >
        <deck-pane
          v-if="rightLeaf === 'slide' || rightLeaf === 'present'"
          :key="rightLeaf"
          :leaf="rightLeaf"
          mode="panel"
          :markdown="markdown"
        />
        <paper-projection
          v-else-if="rightLeaf === 'page'"
          :key="`page-${rightLeaf}`"
          :markdown="markdown"
        />
        <leaf-projection
          v-else-if="rightLeaf === 'column'"
          :key="`proj-${rightLeaf}`"
          :lens="rightLeaf"
          :markdown="markdown"
        />
      </div>
      <!-- 全屏映支叶（slide 列表 / present 放映单选时占满编辑区） -->
      <deck-pane
        v-if="!isSplit && topView === null && (activeLeaf === 'slide' || activeLeaf === 'present')"
        :key="activeLeaf"
        :leaf="activeLeaf"
        mode="view"
        :markdown="markdown"
      />
      <!-- 全屏页叶（A″）：只读真分片预览占满编辑区；活引擎留在收起的
           pane-left 里供养 bus 服务（isPaperFullscreen）。 -->
      <paper-projection
        v-if="isPaperFullscreen"
        :markdown="markdown"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorViewStore } from '@/store/editorView'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { t } from '@/i18n'
import { reviseMarkdown } from '@/util/docAnchor'
import Editor from './editor.vue'
import ColumnsDiagnostics from './columnsDiagnostics.vue'
import SourceCode from './sourceCode.vue'
import DeckPane from './deckPane.vue'
import LeafProjection from './leafProjection.vue'
import PaperProjection from './paperProjection.vue'
import TabNotifications from './notifications.vue'

const props = defineProps<{
  markdown: string
  // `cursor` originates as `IFileState.cursor` which is `unknown`
  // (see src/shared/types/files.ts); align here instead of forcing every
  // caller to widen.
  cursor: unknown
  muyaIndexCursor?: unknown
  textDirection: string
  platform: string
}>()

// 一文多览锚服务（§6.1）：markdown 每逢内容变化推进 mdRev——所有锚写读
// 共用这个版本号，消费侧据此丢弃过期锚（防抖窗口内允许旧态）。immediate
// 必须开：初始 markdown 不经变化，漏记会让 matchesCurrentMarkdown 恒 false
// ——只读投影的跟随/恢复回调第一行就早退（M1 首版跟随全死的根因之一）。
watch(
  () => props.markdown,
  (md) => {
    reviseMarkdown(md)
  },
  { immediate: true }
)

const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const { zoom } = storeToRefs(usePreferencesStore())
const editorViewStore = useEditorViewStore()
const { topView, isSplit, leftLeaf, rightLeaf, activeLeaf, editorLens, rightRatio } =
  storeToRefs(editorViewStore)
// 全屏/独占形态的判据收口在 store（底部执行面板挪到 app.vue 全宽层后，
// 两处要用同一条判据，别再在这里复制一遍）。
const { isPaperFullscreen, isPresentFullscreen, presentImmersive } =
  storeToRefs(editorViewStore)
// 沉浸式放映时侧栏被显示层收起，宽度补偿要跟着归零，否则放映区右侧留白。
const sideBarOffset = computed<number>(() =>
  presentImmersive.value ? 0 : effectiveSideBarWidth.value
)
// Actions 不经 storeToRefs（它只包 state/getter）。
const { setRightRatio } = editorViewStore

// 左 pane 是否有内容（分屏左叶 / 透镜 / 源码 / 图占位）。单选映支叶时为
// false——pane-left 不渲染，deck-pane 独占容器。
const hasLeftPane = computed(
  () => isSplit.value || editorLens.value !== null || topView.value !== null
)

// 全屏页叶（A″）：可见面 = 真分片投影；活引擎留在 pane-left 里作隐藏服务
// 后端（bus 导出/TOC 依赖 editor.vue 挂载），pane-left 由 .paper-fullscreen
// 收起（display:none——导出走序列化不需要布局）。
// isPaperFullscreen / isPresentFullscreen / isDeckFullscreen 的判据在
// store/editorView（app.vue 也要用），此处仅解构。

// 分屏左 pane 的引擎透镜由 store.editorLens 给出：orderedLeaves 首个
// flow/column/page 叶（LEAVES 序保证左细右粗、文左映右；page M0 暂照
// flow 渲染）。

// —— 分割条拖拽（视图模型 §3）——
const startDrag = (ev: PointerEvent): void => {
  ev.preventDefault()
  const target = ev.currentTarget as HTMLElement
  const container = target.parentElement
  if (!container) return
  target.setPointerCapture(ev.pointerId)
  target.classList.add('dragging')

  const onMove = (move: PointerEvent): void => {
    const rect = container.getBoundingClientRect()
    const ratio = (rect.right - move.clientX) / rect.width
    setRightRatio(ratio)
  }
  const onUp = (): void => {
    target.classList.remove('dragging')
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
}
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;

  overflow: hidden;
  background: var(--editorBgColor);
  & > .container {
    flex: 1;
    overflow: hidden;

    /* 分屏壳（视图模型 §2）：左细右粗、文左映右。非 split 时保持原 block
       流，透镜分支的布局假设（.editor-wrapper height:100% 等）零改动。 */
    &.split {
      display: flex;
    }

    /* 全屏页叶（A″）：pane-left 是隐藏服务后端（bus 导出/TOC 依赖活引擎
       组件挂载），收起不占位——导出走序列化，不需要布局。 */
    &.paper-fullscreen {
      & > .pane-left {
        display: none;
      }
    }

    /* 映面板独占：pane-left 收起不卸载（muya 保活，退出独占零重建）；
       映 pane 占满整窗。 */
    &.present-fullscreen {
      & > .pane-left {
        display: none;
      }

      & > .pane-right {
        flex: 1 1 100%;
        max-width: 100%;
        border-left: none;
      }
    }
  }
}

.pane {
  position: relative;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.pane-left {
  flex: 1;
}

.pane-right {
  flex: 0 0 calc(var(--split-ratio, 0.45) * 100%);
  min-width: 260px;
  max-width: 80%;
  border-left: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
}

.divider {
  flex: none;
  width: 5px;
  margin: 0 -2px;
  z-index: 5;
  cursor: col-resize;
  background: transparent;
  position: relative;
}

.divider::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--editorColor10);
  transition: background 0.15s ease;
}

.divider:hover::after,
.divider.dragging::after {
  background: var(--editorColor50);
  width: 3px;
  left: 1px;
}

/* Pure CSS hook: `data-lens` is what the lens rules in editor.vue key off.
   `display: contents` keeps the host out of the layout, so the engine's own
   sizing (`.editor-wrapper { height: 100% }`) is untouched. */
.lens-host {
  display: contents;
}

.view-placeholder {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  color: var(--editorColor50);
}

.placeholder-inner {
  text-align: center;
  padding: 40px;
}

.placeholder-icon {
  margin-bottom: 16px;
  opacity: 0.5;
}

.placeholder-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--editorColor);
}

.placeholder-hint {
  font-size: 14px;
  opacity: 0.7;
}
</style>
