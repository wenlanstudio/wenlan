<template>
  <div
    class="editor-with-tabs"
    :style="{
      'max-width': `calc(100vw - ${effectiveSideBarWidth}px)`,
      '--editor-zoom': zoom
    }"
  >
    <!-- 分栏诊断：进入 columns 透镜时提示 5s 后消失，详情留在 console -->
    <columns-diagnostics
      v-if="wysiwygLens === 'columns'"
      :markdown="markdown"
    />
    <div class="container">
      <!-- 透镜宿主：WYSIWYG 引擎在 document/page、document/columns 与
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
      <!-- Slides 视图：present = md2slides 放映（本地服务 + iframe）；slide = Tier 0
           逻辑页编辑视图（未开发；裁决：物理分页归放映，编辑视图只做逻辑页） -->
      <slides-present
        v-else-if="mainView === 'slides' && subView === 'present'"
        :markdown="markdown"
      />
      <div
        v-else-if="mainView === 'slides'"
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
                x="2"
                y="3"
                width="20"
                height="14"
                rx="2"
              />
              <line
                x1="8"
                y1="21"
                x2="16"
                y2="21"
              />
              <line
                x1="12"
                y1="17"
                x2="12"
                y2="21"
              />
            </svg>
          </div>
          <div class="placeholder-title">
            {{ t('view.slidesView') }}
          </div>
          <div class="placeholder-hint">
            {{ t('view.comingSoon') }}
          </div>
        </div>
      </div>
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
const { mainView, subView } = storeToRefs(useEditorViewStore())

// Which lens the live WYSIWYG engine renders under, or `null` when this
// (main, sub) pair is not an engine surface at all. All lens views share one
// `v-if`, so switching among them only flips the attribute instead of
// remounting the engine and dropping its undo stack (TODO1 #21).
const wysiwygLens = computed<string | null>(() => {
  if (mainView.value === 'document' && subView.value === 'page') return 'page'
  if (mainView.value === 'document' && subView.value === 'columns') return 'columns'
  if (mainView.value === 'table' && subView.value === 'all') return 'table'
  return null
})
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
  }
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
