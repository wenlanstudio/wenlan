<template>
  <div class="status-bar">
    <div class="status-left">
      <!-- 窗口级开关（JetBrains 状态栏最左的做法）：侧栏。
           底部工具窗口的开关已挪到右下角视图按钮组里的「码」。 -->
      <button
        class="status-btn"
        :title="t('sideBar.toggle')"
        @click="toggleSideBar"
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
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
      </button>
    </div>

    <!-- 文档级指示器：放映/全屏时整组隐藏；「映」激活时只留换叶入口。 -->
    <div
      v-if="!isWindowFullScreen && !presentExclusive"
      class="status-right"
    >
      <div
        v-if="showCursorPosition && !presentActive"
        class="cursor-position"
        :title="t('view.cursorPosition')"
      >
        {{ cursorPositionText }}
      </div>
      <ViewSwitcher />
      <div
        v-if="!presentActive"
        class="dock-divider"
      />
      <button
        v-if="!presentActive"
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
        v-if="!presentActive"
        :word-count="wordCount"
        :selection-word-count="selectionWordCount"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import ViewSwitcher from '@/components/viewSwitcher/index.vue'
import WordCount from '@/components/wordCount/index.vue'

/**
 * 底部状态栏（JetBrains 式）：窗口最底一行，横跨全宽，从不参与编辑区布局竞争。
 *
 * 左段只放侧栏开关；右段放「文档级指示器」：光标位置、视图切换（含底部代码
 * 执行工具窗口的「码」开关）、读写锁、字数——从右往左逐级细化，右侧三组位置
 * 固定。状态栏本身不随工具窗口开合移动。
 */

const editorStore = useEditorStore()
const editorViewStore = useEditorViewStore()

const { currentFile, selectionWordCount, readOnly } = storeToRefs(editorStore)
const { isWindowFullScreen, leafSelection, presentExclusive } = storeToRefs(editorViewStore)

const wordCount = computed(() => currentFile.value?.wordCount)

// 光标位置（line:column）——编辑视图可见时才显示
const cursorPosition = ref<{ line: number; ch: number } | null>(null)
const showCursorPosition = computed(
  () => currentFile.value?.markdown !== undefined && editorViewStore.isEditorVisible
)
const cursorPositionText = computed(() => {
  const pos = cursorPosition.value
  return pos ? `${pos.line}:${pos.ch}` : ''
})

const onCursorPosition = (payload: unknown): void => {
  const p = payload as { line: number; ch: number } | undefined
  if (p && typeof p.line === 'number' && typeof p.ch === 'number') {
    cursorPosition.value = p
  }
}

bus.on('cursor-position', onCursorPosition)
onBeforeUnmount(() => bus.off('cursor-position', onCursorPosition))

// 放映/全屏下只保留换叶入口：编辑姿态控件（光标/读写锁/字数）隐藏
const presentActive = computed(() => leafSelection.value.includes('present'))

// 侧栏开关走 View 菜单同一条入口，原生菜单的勾选态才能同步
const toggleSideBar = (): void => {
  bus.emit('view:toggle-layout-entry', 'showSideBar')
}

const toggleReadOnly = (): void => {
  editorStore.TOGGLE_READ_ONLY()
}
</script>

<style scoped>
.status-bar {
  flex: none;
  height: var(--statusBarHeight);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px;
  border-top: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  color: var(--editorColor60);
  font-size: 11px;
  user-select: none;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-btn {
  height: 20px;
  min-width: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--iconColor);
  font-size: 11px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.status-btn:hover {
  color: var(--editorColor);
  background: var(--itemBgColor);
}

.cursor-position {
  color: var(--editorColor40);
  font-variant-numeric: tabular-nums;
}

.dock-divider {
  width: 1px;
  height: 14px;
  background: var(--editorColor10);
}

.read-only-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--editorColor40);
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease;
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
