<template>
  <div
    class="editor-with-tabs"
    :style="{
      'max-width': `calc(100vw - ${effectiveSideBarWidth}px)`,
      '--editor-zoom': zoom
    }"
  >
    <div class="container">
      <!-- Word 页面视图（现有 WYSIWYG） -->
      <editor
        v-if="mainView === 'word' && subView === 'page'"
        :markdown="markdown"
        :cursor="cursor"
        :text-direction="textDirection"
        :platform="platform"
      />
      <!-- Word 分栏视图（同一份文档的另一种排版：分栏组由引擎自己排布） -->
      <columns-preview
        v-else-if="mainView === 'word' && subView === 'columns'"
        :markdown="markdown"
      />
      <!-- PPT 视图 -->
      <div
        v-else-if="mainView === 'ppt'"
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
            {{ t('view.pptView') }}
          </div>
          <div class="placeholder-hint">
            {{ t('view.comingSoon') }}
          </div>
        </div>
      </div>
      <!-- Excel 视图 -->
      <div
        v-else-if="mainView === 'excel'"
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
              <path d="M3 9h18M9 3v18" />
            </svg>
          </div>
          <div class="placeholder-title">
            {{ t('view.excelView') }}
          </div>
          <div class="placeholder-hint">
            {{ t('view.comingSoon') }}
          </div>
        </div>
      </div>
      <!-- Dev 源码视图 -->
      <source-code
        v-else-if="mainView === 'dev' && subView === 'source'"
        :markdown="markdown"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
      />
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorViewStore } from '@/store/editorView'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import Editor from './editor.vue'
import ColumnsPreview from './columnsPreview.vue'
import SourceCode from './sourceCode.vue'
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
