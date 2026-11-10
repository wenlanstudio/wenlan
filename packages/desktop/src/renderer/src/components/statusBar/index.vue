<template>
  <div class="status-bar">
    <!-- 教育版叠加指示：发布成功后显示锚定的版本与发布班数，可点开重新发布。
         未登录不显示（N1）：本地元数据还在，但登出的实例表面不留教学概念。 -->
    <button
      v-if="lastPublish && authState.loggedIn && !isStudent && !isWindowFullScreen && !presentExclusive"
      class="status-teaching"
      :title="t('teaching.publish')"
      @click="teachingStore.openPublish()"
    >
      v{{ lastPublish.versionNo }} {{ t('teaching.statusPublished') }} · {{ lastPublish.releaseCount }} {{ t('teaching.statusClass') }}
    </button>
    <!-- 教师端课堂入口（叠加态，不占新面板）：未开课时列出可开班的发布物，
         开课后显示页号与在线人数，并提供结束课堂 / 跟随锁。 -->
    <el-dropdown
      v-if="canTeach && !isWindowFullScreen && !presentExclusive"
      class="classroom-entry"
      trigger="click"
      @command="onClassroomCommand"
    >
      <button
        class="status-teaching classroom"
        :class="{ live: classroomActive }"
        :title="classroom.error || t('teaching.classroomHint')"
      >
        <template v-if="classroomActive">
          ● {{ t('teaching.classroomLive') }} {{ classroom.className }} · {{ t('teaching.classroomPage', { page: classroom.page ?? 1 }) }}
          <template v-if="classroom.online">
            · {{ classroom.online }}
          </template>
        </template>
        <template v-else>
          {{ t('teaching.classroomStart') }} ▾
        </template>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <template v-if="classroomActive">
            <el-dropdown-item command="quiz">
              {{ t('teaching.quizMenu') }}
            </el-dropdown-item>
            <el-dropdown-item command="lock">
              {{ classroom.followLocked ? t('teaching.classroomUnlock') : t('teaching.classroomLock') }}
            </el-dropdown-item>
            <el-dropdown-item
              command="end"
              divided
            >
              {{ t('teaching.classroomEnd') }}
            </el-dropdown-item>
          </template>
          <template v-else-if="releases.length">
            <el-dropdown-item
              v-for="rel in releases"
              :key="rel.releaseId"
              :command="`start:${rel.releaseId}`"
            >
              {{ rel.className }}
            </el-dropdown-item>
          </template>
          <el-dropdown-item
            v-else
            disabled
          >
            {{ t('teaching.classroomNoRelease') }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <!-- 学生端：只读投影的来源与课堂跟随状态。不提供发布动作；课堂进行中时可点
         进入放映跟随（「映」叶全屏，Esc 退回），不在课堂里则只是一条静态指示。 -->
    <button
      v-else-if="isStudent && openedRelease && authState.loggedIn && !isWindowFullScreen && !presentExclusive"
      class="status-teaching readonly"
      :class="{ followable: classroom.connected }"
      :title="classroom.error || (openedRelease.slotCount ? `${t('teaching.quizSlotWaiting')} · ${openedRelease.slotCount}` : t('teaching.readOnlyProjection'))"
      @click="followClassroom"
    >
      {{ openedRelease.materialName }} · {{ t('teaching.readOnlyProjection') }} · {{ t('teaching.synced') }}
      <template v-if="classroom.connected">
        · {{ t('teaching.classroomFollowing') }} · {{ t('teaching.classroomPage', { page: classroom.page ?? 1 }) }}
      </template>
      <template v-else>
        · {{ t('teaching.classroomWaiting') }}
      </template>
    </button>
    <!-- 学生端课堂题入口：只读讲义里的题目卡是引用块、点不了，
         独立浮层承载作答与揭晓结果；不抢占上面的放映跟随入口。 -->
    <button
      v-if="studentQuizAvailable && !isWindowFullScreen && !presentExclusive"
      class="status-teaching quiz-entry"
      @click="teachingStore.openStudentQuiz()"
    >
      ● {{ studentQuizResultReady ? t('teaching.studentQuizResultEntry') : t('teaching.studentQuizEntry') }}
    </button>
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
        :title="isStudent ? t('teaching.readOnlyProjection') : readOnly ? t('view.readOnlyLocked') : t('view.readOnlyUnlocked')"
        :disabled="isStudent"
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
import { ElMessage } from 'element-plus'
import { t } from '@/i18n'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { useEditorViewStore } from '@/store/editorView'
import { useTeachingStore } from '@/store/teaching'
import { useAuthStore } from '@/store/auth'
import ViewSwitcher from '@/components/viewSwitcher/index.vue'
import WordCount from '@/components/wordCount/index.vue'

/**
 * 底部状态栏（JetBrains 式）：窗口最底一行，挂在 .main-col（侧栏右侧那一列），
 * 天然只占侧栏右侧的宽度，不横贯全宽。从不参与编辑区布局竞争。
 *
 * 左段原侧栏开关（status-btn）已移除，入口挪进菜单栏汉堡 / View 菜单；右段放
 * 「文档级指示器」：光标位置、视图切换（表/图/码/本）、读写锁、字数——从右往左
 * 逐级细化，右侧三组位置固定。状态栏本身不随工具窗口开合移动。
 */

const editorStore = useEditorStore()
const editorViewStore = useEditorViewStore()
const teachingStore = useTeachingStore()
const { lastPublish, openedRelease, classroom, race, studentQuiz } = storeToRefs(teachingStore)
const { state: authState, isStudent } = storeToRefs(useAuthStore())

const { currentFile, selectionWordCount, readOnly } = storeToRefs(editorStore)
const { isWindowFullScreen, leafSelection, presentExclusive } = storeToRefs(editorViewStore)

const wordCount = computed(() => currentFile.value?.wordCount)

// —— 教师端课堂入口 ——
// 能开班的发布物挂在当前文档的本地元数据上（发布时记下 releaseId + 班名）。
// 这里只读不写：开班由 store 走 main 的 ws 通道，状态栏不持有连接。
const releases = computed(() => {
  const path = currentFile.value?.pathname
  return path ? teachingStore.releasesFor(path) : []
})
const classroomActive = computed(
  () => classroom.value.role === 'host' && classroom.value.sessionId != null
)
// 未登录或学生态不出现课堂入口（N1：通用实例表面零教学概念）。
const canTeach = computed(() => authState.value.loggedIn && !isStudent.value)
// 学生端课堂题入口：发题中可作答，揭晓/作废后可看结果。
const studentQuizAvailable = computed(
  () =>
    isStudent.value &&
    (!!classroom.value.question || !!race.value.reveal || studentQuiz.value.voided)
)
const studentQuizResultReady = computed(
  () => !!race.value.reveal || studentQuiz.value.voided
)

const onClassroomCommand = (command: string): void => {
  if (command === 'end') {
    void teachingStore.endClassroom()
    return
  }
  if (command === 'lock') {
    teachingStore.setFollowLocked(!classroom.value.followLocked)
    return
  }
  if (command === 'quiz') {
    const error = teachingStore.openQuizConsole()
    if (error) ElMessage.warning(error)
    return
  }
  if (!command.startsWith('start:')) return
  const releaseId = Number(command.slice('start:'.length))
  const target = releases.value.find((item) => item.releaseId === releaseId)
  if (!target) return
  void teachingStore.startClassroom(target).then((error) => {
    if (error) ElMessage.error(`${t('teaching.errorPrefix')}：${error}`)
  })
}

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

const toggleReadOnly = (): void => {
  // 学生端只读投影由教学树打开讲义时置位，不允许在界面上解锁。
  if (isStudent.value) return
  editorStore.TOGGLE_READ_ONLY()
}

/** 学生端：课堂进行中时进入「映」叶全屏跟随（Esc 退回）。
 *  不在课堂里（没进行中的会话）就什么都不做——读讲义不被打断。 */
const followClassroom = (): void => {
  if (!isStudent.value || !classroom.value.connected) return
  editorViewStore.enterPresentImmersive()
}
</script>

<style scoped>
.status-bar {
  flex: none;
  height: var(--statusBarHeight);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 6px;
  border-top: 1px solid var(--editorColor10);
  background: var(--editorBgColor);
  color: var(--editorColor60);
  font-size: 11px;
  user-select: none;
}

.status-teaching {
  margin-right: auto;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #854f0b;
  cursor: pointer;
  font-size: 11px;
}

.status-teaching:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.status-teaching.readonly {
  cursor: default;
}

.status-teaching.readonly:hover {
  background: transparent;
}

/* 课堂进行中：指示变成「进入放映跟随」的入口，恢复可点态。 */
.status-teaching.readonly.followable {
  cursor: pointer;
}

.status-teaching.readonly.followable:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

/* 教师端课堂入口：el-dropdown 会包一层 div，压平以免状态栏多出一行高度。 */
.classroom-entry {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}

.status-teaching.classroom {
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0 6px;
  cursor: pointer;
}

.status-teaching.classroom.live {
  color: var(--editorColor);
  font-weight: 600;
}

.status-teaching.classroom:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.read-only-btn:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 6px;
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
