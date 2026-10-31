<template>
  <div class="editor-container">
    <side-bar v-if="init" />

    <div class="editor-middle">
      <title-bar
        :project="projectTree"
        :filename="filename"
        :active="windowActive"
        :is-saved="isSaved"
      />

      <div
        v-if="!init"
        class="editor-placeholder"
      />
      <recent v-if="!hasCurrentFile && init" />
      <editor-with-tabs
        v-if="hasCurrentFile && init"
        :markdown="markdown"
        :cursor="cursor"
        :muya-index-cursor="muyaIndexCursor"
        :text-direction="textDirection"
        :platform="platform"
      />
      <command-palette />
      <about-dialog />
      <export-setting-dialog />
      <rename />
      <import-modal />

      <div
        class="sidebar-toggle"
        :title="t('sideBar.toggle')"
        @click="toggleSideBar"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
        >
          <rect
            x="3"
            y="4.5"
            width="18"
            height="15"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          />
          <line
            x1="9.5"
            y1="4.5"
            x2="9.5"
            y2="19.5"
            stroke="currentColor"
            stroke-width="1.6"
          />
        </svg>
      </div>

      <!-- Right-corner dock: 从右往左不断细化（字数统计 → 读写锁 → 主视图 WPED → 子视图），
           右侧三组固定不动，随模式增减的只有左侧的子视图/光标位置 -->
      <div class="right-corner-dock">
        <div
          v-if="showCursorPosition"
          class="cursor-position"
          :title="t('view.cursorPosition')"
        >
          {{ cursorPositionText }}
        </div>
        <ViewSwitcher />
        <div class="dock-divider" />
        <button
          class="read-only-btn"
          :class="{ locked: readOnly }"
          :title="readOnly ? t('view.readOnlyLocked') : t('view.readOnlyUnlocked')"
          @click="toggleReadOnly"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <template v-if="readOnly">
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
              />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </template>
            <template v-else>
              <rect
                x="3"
                y="11"
                width="18"
                height="11"
                rx="2"
              />
              <path d="M7 11V7a5 5 0 0 1 10 0" />
            </template>
          </svg>
        </button>
        <WordCount
          :word-count="wordCount"
          :selection-word-count="selectionWordCount"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, ref } from 'vue'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle, setEditorWidth, type AddStylesOptions } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import AboutDialog from '@/components/about/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import Rename from '@/components/rename/index.vue'
import ImportModal from '@/components/import/index.vue'
import WordCount from '@/components/wordCount/index.vue'
import ViewSwitcher from '@/components/viewSwitcher/index.vue'
import bus from '@/bus'
import { t } from '@/i18n'
import { DEFAULT_STYLE } from '@/config'
import { listenForScrollbarReveal } from '@/util/scrollbarReveal'
import { useLayoutStore } from '@/store/layout'
import { useListenForMainStore } from '@/store/listenForMain'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { useCommandCenterStore } from '@/store/commandCenter'
import { useProjectStore } from '@/store/project'
import { useAutoUpdatesStore } from '@/store/autoUpdates'
import { useNotificationStore } from '@/store/notification'
import { useEditorViewStore } from '@/store/editorView'

const mainStore = useMainStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const autoUpdateStore = useAutoUpdatesStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()
const editorViewStore = useEditorViewStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)

const { windowActive, platform, init } = storeToRefs(mainStore)
const { theme, customCss, textDirection, zoom, editorLineWidth } = storeToRefs(preferencesStore)
const { projectTree } = storeToRefs(projectStore)
const { currentFile, selectionWordCount, readOnly } = storeToRefs(editorStore)
const { isEditorVisible } = storeToRefs(editorViewStore)

const filename = computed(() => currentFile.value?.filename)
const isSaved = computed(() => currentFile.value?.isSaved)
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
const wordCount = computed(() => currentFile.value?.wordCount)
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

// Cursor position indicator (line:column) — shown in Document & Code modes.
const cursorPosition = ref<{ line: number; ch: number } | null>(null)
const showCursorPosition = computed(() => {
  if (!hasCurrentFile.value) return false
  return editorViewStore.isEditorVisible
})
const cursorPositionText = computed(() => {
  const pos = cursorPosition.value
  return pos ? `${pos.line}:${pos.ch}` : ''
})

bus.on('cursor-position', (payload: unknown) => {
  const p = payload as { line: number; ch: number } | undefined
  if (p && typeof p.line === 'number' && typeof p.ch === 'number') {
    cursorPosition.value = p
  }
})

// Toggle global read-only lock.
const toggleReadOnly = (): void => {
  editorStore.TOGGLE_READ_ONLY()
}

// The only sidebar switch left: the small button in the content's bottom-left
// corner. Routed through the same bus entry as the View menu so the native
// menu checkbox stays in sync.
const toggleSideBar = (): void => {
  bus.emit('view:toggle-layout-entry', 'showSideBar')
}

// Watchers
watch(theme, (value, oldValue) => {
  if (value !== oldValue) {
    addThemeStyle(value)
  }
})

watch(customCss, (value, oldValue) => {
  if (value !== oldValue) {
    addCustomStyle({
      customCss: value
    })
  }
})

watch(zoom, (zoomValue) => {
  bus.emit('mt::window-zoom', zoomValue)
})

// The page width is a window-wide style shared by every view (document/page,
// document/columns and code/source all center their column on it — TODO1 #5),
// so it is applied from the always-mounted root. Doing it in the page component
// left a window restored straight into Columns or source view without it.
watch(
  editorLineWidth,
  (value) => {
    setEditorWidth(value)
  },
  { immediate: true }
)

const setupDragDropHandler = (): void => {
  window.addEventListener(
    'dragover',
    (e: DragEvent) => {
      if (!e.dataTransfer || !e.dataTransfer.types.length) return

      if (e.dataTransfer.types.indexOf('Files') >= 0) {
        if (
          e.dataTransfer.items.length === 1 &&
          e.dataTransfer.items[0]!.type.indexOf('image') > -1
        ) {
          // Do nothing
        } else {
          e.preventDefault()
          if (timer.value) {
            clearTimeout(timer.value)
          }
          timer.value = setTimeout(() => {
            bus.emit('importDialog', false)
          }, 300)
          bus.emit('importDialog', true)
        }
        e.dataTransfer.dropEffect = 'copy'
      } else if (e.dataTransfer.types.indexOf('text/uri-list') >= 0) {
        // A web-link / web-image drag (e.g. an <img> dragged from a browser).
        // The muya editor's own dragover/drop handlers accept these and insert
        // an image block, so leave the drop enabled — forcing dropEffect='none'
        // here would clobber the editor's 'copy' and suppress the drop event.
      } else {
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'none'
      }
    },
    false
  )
}
onMounted(async () => {
  if (window.marktext?.initialState) {
    preferencesStore.SET_USER_PREFERENCE(window.marktext.initialState)
  }

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  listenForMainStore.LISTEN_FOR_EDIT()
  preferencesStore.LISTEN_FOR_VIEW()
  listenForMainStore.LISTEN_FOR_SHOW_DIALOG()
  listenForMainStore.LISTEN_FOR_PANDOC_EXPORT()
  listenForMainStore.LISTEN_FOR_PARAGRAPH_INLINE_STYLE()
  projectStore.LISTEN_FOR_UPDATE_PROJECT()
  projectStore.LISTEN_FOR_LOAD_PROJECT()
  projectStore.LISTEN_FOR_SIDEBAR_CONTEXT_MENU()
  autoUpdateStore.LISTEN_FOR_UPDATE()
  preferencesStore.ASK_FOR_USER_PREFERENCE()
  preferencesStore.LISTEN_TOGGLE_VIEW()
  editorStore.LISTEN_SCREEN_SHOT()
  editorStore.LISTEN_FOR_CLOSE()
  editorStore.LISTEN_FOR_SAVE_AS()
  editorStore.LISTEN_FOR_MOVE_TO()
  editorStore.LISTEN_FOR_SAVE()
  editorStore.LISTEN_FOR_SET_PATHNAME()
  editorStore.LISTEN_FOR_BOOTSTRAP_WINDOW()
  editorStore.LISTEN_FOR_SAVE_CLOSE()
  editorStore.LISTEN_FOR_RENAME()
  editorStore.LISTEN_FOR_SET_LINE_ENDING()
  editorStore.LISTEN_FOR_SET_ENCODING()
  editorStore.LISTEN_FOR_SET_FINAL_NEWLINE()
  editorStore.LISTEN_FOR_NEW_TAB()
  editorStore.LISTEN_FOR_CLOSE_TAB()
  editorStore.LISTEN_FOR_TAB_CYCLE()
  editorStore.LISTEN_FOR_SWITCH_TABS()
  editorStore.LISTEN_FOR_PRINT_SERVICE_CLEARUP()
  editorStore.LISTEN_FOR_EXPORT_SUCCESS()
  editorStore.LISTEN_FOR_FILE_CHANGE()
  editorStore.LISTEN_WINDOW_ZOOM()
  editorStore.LISTEN_FOR_RELOAD_IMAGES()
  editorStore.LISTEN_FOR_CONTEXT_MENU()
  editorStore.LISTEN_FOR_STATE_REPLACE()

  // module: notification
  notificationStore.listenForNotification()

  setupDragDropHandler()
  listenForScrollbarReveal()

  nextTick(() => {
    // `initialState` from bootstrap carries nullable URL params (string|null);
    // `addStyles` requires non-null `theme` / `codeFontFamily` strings.
    // Coalesce against DEFAULT_STYLE for every nullable field.
    const init = window.marktext?.initialState
    const style: AddStylesOptions = {
      theme: init?.theme ?? DEFAULT_STYLE.theme,
      codeFontFamily: init?.codeFontFamily ?? DEFAULT_STYLE.codeFontFamily,
      codeFontSize: init?.codeFontSize ?? DEFAULT_STYLE.codeFontSize,
      hideScrollbar: init?.hideScrollbar ?? DEFAULT_STYLE.hideScrollbar
    }
    addStyles(style)
  })
})
</script>

<style scoped>
.editor-placeholder,
.editor-container {
  display: flex;
  flex-direction: row;
  position: absolute;
  width: 100vw;
  height: 100vh;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.editor-container .hide {
  z-index: -1;
  opacity: 0;
  position: absolute;
  left: -10000px;
}
.editor-placeholder {
  background: var(--editorBgColor);
}
.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 100vh;
  position: relative;
  & > .editor {
    flex: 1;
  }
}

.sidebar-toggle {
  position: absolute;
  left: 6px;
  bottom: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--iconColor);
  opacity: 0.4;
  cursor: pointer;
  border-radius: 4px;
  z-index: 100;

  &:hover {
    opacity: 1;
    background: var(--itemBgColor);
  }
}

/* Right-corner dock groups the view switcher and word count. */
.right-corner-dock {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cursor-position {
  font-size: 11px;
  color: var(--editorColor40);
  font-variant-numeric: tabular-nums;
  user-select: none;
  line-height: 24px;
}

.dock-divider {
  width: 1px;
  height: 14px;
  background: var(--editorColor10);
}

.read-only-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.read-only-btn:hover {
  color: var(--editorColor80);
  background: var(--editorColor04);
}

.read-only-btn.locked {
  color: var(--editorColor);
  background: var(--editorColor10);
}
</style>
