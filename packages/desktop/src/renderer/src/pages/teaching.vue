<template>
  <div class="teaching-client">
    <header class="teaching-header">
      <div class="teaching-title">
        {{ t('teaching.title') }}
      </div>
      <div class="teaching-account">
        <template v-if="state.loggedIn">
          <span class="user-name">{{ displayName }}</span>
          <el-button
            link
            @click="logout"
          >
            {{ t('account.logout') }}
          </el-button>
        </template>
        <template v-else>
          <span class="user-name">{{ t('account.notLoggedIn') }}</span>
        </template>
      </div>
    </header>

    <div class="teaching-body">
      <aside class="teaching-sidebar">
        <div class="course-list-title">
          {{ t('teaching.myCourses') }}
        </div>
        <div
          v-if="listError"
          class="list-error"
        >
          {{ listError }}
        </div>
        <div
          v-else-if="groups.length === 0"
          class="list-empty"
        >
          {{ t('teaching.empty') }}
        </div>
        <div
          v-for="group in groups"
          :key="group.courseId"
          class="course-group"
        >
          <div class="course-name">
            {{ group.courseName }}
          </div>
          <div
            v-for="item in group.items"
            :key="item.releaseId"
            class="release-item"
            :class="{ active: selected?.releaseId === item.releaseId }"
            @click="openRelease(item)"
          >
            <div class="release-title">
              {{ item.materialName }}
            </div>
            <div class="release-meta">
              <span class="release-class">{{ item.className }}</span>
              <span class="release-purpose">{{ purposeLabel(item.purpose) }}</span>
            </div>
          </div>
        </div>
      </aside>

      <main class="teaching-main">
        <div
          v-if="!selected"
          class="reader-placeholder"
        >
          {{ t('teaching.empty') }}
        </div>
        <div
          v-else-if="loading"
          class="reader-placeholder"
        >
          {{ t('teaching.loading') }}
        </div>
        <div
          v-else-if="readError"
          class="reader-placeholder"
        >
          {{ readError }}
        </div>
        <reader
          v-else
          :markdown="markdown"
        />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import type { StudentMarkdown, StudentRelease } from '@shared/types/auth'
import Reader from '@/components/teaching/reader.vue'

const auth = useAuthStore()
const { state } = storeToRefs(auth)

const releases = ref<StudentRelease[]>([])
const listError = ref('')
const selected = ref<StudentRelease | null>(null)
const markdown = ref('')
const loading = ref(false)
const readError = ref('')

onMounted(() => {
  void auth.init()
  auth.listen()
  void loadList()
})

const displayName = computed(() => state.value.user?.nickname || state.value.user?.username || '')

interface ReleaseGroup {
  courseId: number
  courseName: string
  items: StudentRelease[]
}

const groups = computed<ReleaseGroup[]>(() => {
  const map = new Map<number, ReleaseGroup>()
  for (const item of releases.value) {
    let group = map.get(item.courseId)
    if (!group) {
      group = { courseId: item.courseId, courseName: item.courseName || String(item.courseId), items: [] }
      map.set(item.courseId, group)
    }
    group.items.push(item)
  }
  return Array.from(map.values())
})

const PURPOSE_KEYS = ['resource', 'practice', 'homework', 'quiz', 'exam'] as const

function purposeLabel(purpose: number): string {
  const key = PURPOSE_KEYS[purpose - 1] ?? PURPOSE_KEYS[0]
  return t(`teaching.purpose.${key}`)
}

async function loadList(): Promise<void> {
  listError.value = ''
  const res = await window.auth.request<StudentRelease[]>({
    url: '/teaching/student/releases'
  })
  if (res.ok) {
    releases.value = res.data ?? []
  } else {
    listError.value = res.error ?? t('teaching.loadFailed')
  }
}

async function openRelease(item: StudentRelease): Promise<void> {
  selected.value = item
  loading.value = true
  readError.value = ''
  markdown.value = ''
  const res = await window.auth.request<StudentMarkdown>({
    url: '/teaching/student/release/markdown',
    params: { releaseId: item.releaseId }
  })
  if (res.ok) {
    markdown.value = res.data.md ?? ''
  } else {
    readError.value = res.error ?? t('teaching.loadFailed')
  }
  loading.value = false
}

function logout(): void {
  void window.auth.logout()
}
</script>

<style scoped>
.teaching-client {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: var(--editorBgColor, #fff);
}

.teaching-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--sideBarBorderColor, #e4e4e4);
  -webkit-app-region: drag;
}

.teaching-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--editorColor, #333);
}

.teaching-account {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.user-name {
  font-size: 13px;
  color: var(--editorColor, #333);
}

.teaching-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.teaching-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-right: 1px solid var(--sideBarBorderColor, #e4e4e4);
  overflow-y: auto;
  background: var(--sideBarBgColor, #fafafa);
}

.course-list-title {
  padding: 12px 16px 8px;
  font-size: 12px;
  color: var(--editorColor50, #888);
}

.list-error,
.list-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--editorColor50, #888);
}

.list-error {
  color: var(--errorColor, #f56c6c);
}

.course-group {
  padding: 4px 0;
}

.course-name {
  padding: 8px 16px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--editorColor50, #888);
}

.release-item {
  padding: 8px 16px;
  cursor: pointer;
}

.release-item:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.release-item.active {
  background: var(--sideBarItemActiveBg, rgba(64, 158, 255, 0.1));
}

.release-title {
  font-size: 13px;
  color: var(--editorColor, #333);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.release-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--editorColor50, #888);
}

.teaching-main {
  flex: 1;
  min-width: 0;
  display: flex;
}

.reader-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editorColor50, #888);
  font-size: 13px;
}
</style>
