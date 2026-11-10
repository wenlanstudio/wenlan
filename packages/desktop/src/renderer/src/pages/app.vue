<template>
  <div
    ref="containerEl"
    class="editor-container"
    :style="{
      '--workspaceHeight': `${workspaceHeight}px`,
      '--bottomPanelHeight': `${bottomPanelHeight}px`
    }"
  >
    <!-- 工作区（JetBrains 三段式）：左右侧栏 + 编辑器列。侧栏是贯穿到底的
         左侧竖条（.body-row 的子项，从 title-bar 下方一路到窗口底边），右侧
         .main-col 是 flex column，依次容纳编辑器列（.workspace）、底部工具
         窗口（exec-panel）、状态栏（status-bar）。这样 exec-panel 与 status-bar
         天然只占侧栏右侧的宽度，无需各自再写 margin 缩进。
         高度不在这里用 100vh 减常量重算，而是由 ResizeObserver 实测 .workspace
         与 .exec-panel 后写进 CSS 变量（见脚本），所有子区域统一消费同一个真值。 -->
    <div class="body-row">
      <side-bar
        v-if="init"
        :hidden="presentImmersive"
      />

      <div class="main-col">
        <div
          ref="workspaceEl"
          class="workspace"
        >
          <div class="editor-middle">
            <title-bar
              v-show="!presentImmersive"
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
            <publish-dialog />
            <quiz-console />
            <student-quiz />
          </div>
        </div>
        <!-- 底部工具窗口（JetBrains 式）：.main-col 的 flex:none 兄弟项而非浮层。
             它占多少高度，.workspace 就少多少高度；不是把等高的内容区盖住。
             组件常驻（不随视图切换卸载，引擎事件订阅/输出缓存不丢）；body 由
             execPanel 按 isCodeRunSurface + open 控制，只在「文」独占、面板
             展开时出现。 -->
        <exec-panel
          v-if="init && hasCurrentFile"
          :markdown="markdown"
        />
        <status-bar v-if="!presentImmersive" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMainStore } from '@/store'
import { storeToRefs } from 'pinia'
import { addStyles, addThemeStyle, addCustomStyle, setEditorWidth, type AddStylesOptions } from '@/util/theme'
import Recent from '@/components/recent/index.vue'
import EditorWithTabs from '@/components/editorWithTabs/index.vue'
import TitleBar from '@/components/titleBar/index.vue'
import SideBar from '@/components/sideBar/index.vue'
import StatusBar from '@/components/statusBar/index.vue'
import ExecPanel from '@/components/editorWithTabs/execPanel.vue'
import AboutDialog from '@/components/about/index.vue'
import CommandPalette from '@/components/commandPalette/index.vue'
import ExportSettingDialog from '@/components/exportSettings/index.vue'
import Rename from '@/components/rename/index.vue'
import ImportModal from '@/components/import/index.vue'
import PublishDialog from '@/components/teaching/publishDialog.vue'
import QuizConsole from '@/components/teaching/quizConsole.vue'
import StudentQuiz from '@/components/teaching/studentQuiz.vue'
import bus from '@/bus'
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
import { useExecPanelStore } from '@/store/execPanel'
import { useAuthStore } from '@/store/auth'

const mainStore = useMainStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const layoutStore = useLayoutStore()
const route = useRoute()
const projectStore = useProjectStore()
const listenForMainStore = useListenForMainStore()
const autoUpdateStore = useAutoUpdatesStore()
const commandCenterStore = useCommandCenterStore()
const notificationStore = useNotificationStore()
const editorViewStore = useEditorViewStore()
const execPanelStore = useExecPanelStore()

const timer = ref<ReturnType<typeof setTimeout> | null>(null)

// —— 布局高度的唯一真值（issue #2）——
// 旧代码在内容层按 100vh / 50vh / calc(100vh - 状态栏) 算高度：那是「整窗」，
// 不是「底部工具窗口以上的可用区」。面板一展开，内容层仍按整窗铺开，下半截只能
// 被面板盖住或被 overflow 裁掉，滚动留白、打字机居中位也跟着错位。
//
// 这里不重算常量，而是实测 .workspace 与 .exec-panel 的真实尺寸，写进两个 CSS
// 变量。面板开关 / 拖拽调高 / 双击最大化 / 窗口缩放 / 将来新增第三列都自动反映，
// 任何子区域只需要 var(--workspaceHeight) 或百分比高度即可，不再各自减一遍 chrome。
const containerEl = ref<HTMLElement | null>(null)
const workspaceEl = ref<HTMLElement | null>(null)
const workspaceHeight = ref(0)
const bottomPanelHeight = ref(0)
let layoutObserver: ResizeObserver | null = null

const measureLayout = (): void => {
  const container = containerEl.value
  const workspace = workspaceEl.value
  if (!container || !workspace) return
  const ws = Math.round(workspace.getBoundingClientRect().height)
  const panel = container.querySelector<HTMLElement>('.exec-panel')
  const ph = Math.round(panel ? panel.getBoundingClientRect().height : 0)
  // 值没变就不写回，避免 ResizeObserver → Vue patch → 再次观测的空转。
  if (workspaceHeight.value !== ws) workspaceHeight.value = ws
  if (bottomPanelHeight.value !== ph) bottomPanelHeight.value = ph
}

const { windowActive, platform, init } = storeToRefs(mainStore)
const { theme, customCss, textDirection, zoom, editorLineWidth } = storeToRefs(preferencesStore)
const { projectTree } = storeToRefs(projectStore)
const { currentFile } = storeToRefs(editorStore)
const { presentImmersive } = storeToRefs(editorViewStore)
// 初始化窗口全屏态（进入/离开全屏由主进程 IPC 同步）
editorViewStore.initWindowFullScreen()

const filename = computed(() => currentFile.value?.filename)
const isSaved = computed(() => currentFile.value?.isSaved)
// `markdown` is read by `<editor-with-tabs>` whose prop is `required: true`.
// In template space we render that subtree only when `hasCurrentFile` is set,
// but vue-tsc can't see through the v-if guard — coalesce to '' so the prop
// type is `string`. The `<editor-with-tabs>` mount is still gated.
const markdown = computed<string>(() => currentFile.value?.markdown ?? '')
const cursor = computed(() => currentFile.value?.cursor)
// `muyaIndexCursor` is loosely typed as `unknown` on the editor store; the
// downstream prop expects `Object | undefined`. Cast at the boundary.
const muyaIndexCursor = computed<Record<string, unknown> | undefined>(
  () => currentFile.value?.muyaIndexCursor as Record<string, unknown> | undefined
)

const hasCurrentFile = computed<boolean>(() => {
  return currentFile.value?.markdown !== undefined
})

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
// 沉浸式放映的窗口级 Esc 兜底：deckPane 未挂载（无文件）、或 iframe 还没
// 起来时，放映条与 deck 页面都接不到按键，否则会卡在原生全屏里出不来。
// deckPane 自己那条 Esc 与本条可能同时触发，exitPresentImmersive 是幂等的。
const onImmersiveKeydown = (ev: KeyboardEvent): void => {
  if (ev.key === 'Escape' && presentImmersive.value) {
    editorViewStore.exitPresentImmersive()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onImmersiveKeydown)
  if (window.marktext?.initialState) {
    preferencesStore.SET_USER_PREFERENCE(window.marktext.initialState)
  }

  mainStore.LISTEN_WIN_STATUS()
  await commandCenterStore.LISTEN_COMMAND_CENTER_BUS()
  layoutStore.LISTEN_FOR_LAYOUT()
  // 教学入口按登录态显隐（N1）：登录态在壳层就初始化，不等侧栏里的账号栏挂载。
  const authStore = useAuthStore()
  void authStore.init()
  authStore.listen()
  // 教育版实例复用本壳：默认落在「教学」tab。延后一拍设置，避免被 main 侧
  // 稍后送达的 buffered layout 事件覆盖；用户随后手动切 tab 仍会被正常持久化。
  window.setTimeout(() => {
    if (route.path === '/teaching' && layoutStore.sidebarTab !== 'teaching') {
      layoutStore.SET_LAYOUT({ sidebarTab: 'teaching', showSideBar: true })
    }
  }, 300)
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

onMounted(() => {
  nextTick(() => {
    measureLayout()
    layoutObserver = new ResizeObserver(measureLayout)
    if (workspaceEl.value) layoutObserver.observe(workspaceEl.value)
  })
})

// 面板 body 由 v-if 挂载/卸载，且高度来自 store 的内联 px：仅靠 workspace 的
// ResizeObserver 在「开关切换但高度恰好相同」的边角情况下可能漏一次。把三个真实
// 输入也挂上，保证 CSS 变量与 DOM 状态始终一致。
watch(
  () => [execPanelStore.open, execPanelStore.height, editorViewStore.isCodeRunSurface],
  () => nextTick(measureLayout)
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onImmersiveKeydown)
  layoutObserver?.disconnect()
  layoutObserver = null
})
</script>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
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

/* 主行 = 侧栏（贯穿到底）+ 右侧主列。侧栏是左侧竖条、从 title-bar 下方一路
   伸到窗口底边；右侧 .main-col 是 flex column，向下依次是编辑器列、底部工具
   窗口、状态栏。宽度交给 flex（不再用 calc(100vw - sidebarWidth) 硬算），谁
   都不按 100vh 自称满高。 */
.body-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

.main-col {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* 工作区 = 编辑器列。它占 .main-col 里「底部工具窗口 + 状态栏以上」的空间，
   flex:1 让底部变高它就等量变矮。 */
.workspace {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
}

/* 任何直接子列都不得用 min-height:auto 顶破这个收缩链。 */
.workspace > * {
  min-height: 0;
}

.editor-placeholder {
  flex: 1;
  background: var(--editorBgColor);
}

.editor-middle {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  & > .editor {
    flex: 1;
  }
}
</style>
