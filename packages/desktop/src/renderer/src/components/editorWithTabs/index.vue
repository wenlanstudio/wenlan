<template>
  <div
    class="editor-with-tabs"
    :style="{
      'max-width': `calc(100vw - ${effectiveSideBarWidth}px)`,
      '--editor-zoom': zoom
    }"
  >
    <!-- 分栏诊断：进入 column 透镜时提示 5s 后消失，详情留在 console -->
    <columns-diagnostics
      v-if="wysiwygLens === 'column'"
      :markdown="markdown"
    />
    <div
      class="container"
      :class="{ split: showSplit }"
    >
      <div class="edit-pane">
        <!-- 透镜宿主：WYSIWYG 引擎在 document/page、document/column 与
             table/all 之间常驻，切换视图只翻转 `data-lens` 而不重绘
             （TODO1 #21、#26）。 -->
        <div
          v-if="wysiwygLens !== null"
          class="lens-host"
          :data-lens="wysiwygLens"
        >
          <editor
            :markdown="markdown"
            :cursor="cursor"
            :text-direction="textDirection"
            :platform="platform"
            :lens="wysiwygLens"
          />
        </div>
        <!-- 示 = md2slides 成片放映（全屏独占形态，本地服务 + iframe） -->
        <slides-present
          v-else-if="mainView === 'present'"
          :markdown="markdown"
        />
        <!-- Figure 视图 -->
        <div
          v-else-if="mainView === 'figure'"
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
        <!-- Code 源码视图 -->
        <source-code
          v-else-if="mainView === 'code' && subView === 'source'"
          :markdown="markdown"
          :muya-index-cursor="muyaIndexCursor"
          :text-direction="textDirection"
        />
      </div>
      <!-- 投影面（形态模型 §2）：左侧编辑形态、右侧只读投影，合法对 = 离散度
           严格递增。P2 只有 present 成片投影；column/slide 投影为 P3/P4。 -->
      <div
        v-if="showSplit && activePreview === 'present'"
        class="preview-pane"
      >
        <slides-present
          variant="panel"
          :markdown="markdown"
        />
      </div>
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
import { t } from '@/i18n'
import Editor from './editor.vue'
import ColumnsDiagnostics from './columnsDiagnostics.vue'
import SourceCode from './sourceCode.vue'
import SlidesPresent from './slidesPresent.vue'
import TabNotifications from './notifications.vue'

defineProps<{
  markdown: string
  // `cursor` originates as `IFileState.cursor` which is `unknown`
  // (see src/shared/types/files.ts); align here instead of forcing every
  // caller to widen.
  cursor: unknown
  muyaIndexCursor?: unknown
  textDirection: string
  platform: string
}>()

const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const { zoom } = storeToRefs(usePreferencesStore())
const { mainView, subView, activePreview } = storeToRefs(useEditorViewStore())

// Which lens the live WYSIWYG engine renders under, or `null` when this
// (main, sub) pair is not an engine surface at all. All lens views share one
// `v-if`, so switching among them only flips the attribute instead of
// remounting the engine and dropping its undo stack (TODO1 #21).
// document/slide 是分片编辑形态（P4）——透镜未实现，落占位分支，不算引擎面。
const wysiwygLens = computed<string | null>(() => {
  if (mainView.value === 'document' && subView.value === 'page') return 'page'
  if (mainView.value === 'document' && subView.value === 'column') return 'column'
  if (mainView.value === 'document' && subView.value === 'slide') return 'slide'
  if (mainView.value === 'table' && subView.value === 'all') return 'table'
  return null
})

// 分屏只在编辑面是活的引擎透镜时呈现（占位视图旁不挂投影面）。
const showSplit = computed(
  () => activePreview.value !== null && wysiwygLens.value !== null
)
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

    /* 分屏壳（形态模型 §2）：左编辑右投影。非 split 时保持原 block 流，
       透镜分支的布局假设（.editor-wrapper height:100% 等）零改动。 */
    &.split {
      display: flex;
    }
  }
}

.edit-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.preview-pane {
  flex: 0 0 45%;
  min-width: 300px;
  max-width: 70%;
  position: relative;
  overflow: hidden;
  border-left: 1px solid var(--editorColor10);
  background: #1a1a1a;
}

/* Pure CSS hook: `data-lens` is what the lens rules in editor.vue key off.
   `display: contents` keeps the host out of the layout, so the engine's own
   sizing (`.editor-wrapper { height: 100% }`) is untouched. */
.lens-host {
  display: contents;
}

.view-placeholder {
  flex: 1;
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
