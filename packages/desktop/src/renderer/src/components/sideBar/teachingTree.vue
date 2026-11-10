<template>
  <div class="teaching-tree">
    <div class="teaching-tree-title">
      {{ isStudent ? t('teaching.myCourses') : t('teaching.workspace') }}
    </div>

    <div
      v-if="!loggedIn"
      class="teaching-tree-hint"
    >
      {{ t('teaching.loginRequired') }}
    </div>
    <div
      v-else-if="loading"
      class="teaching-tree-hint"
    >
      …
    </div>
    <div
      v-else-if="error"
      class="teaching-tree-hint error"
      :title="error"
    >
      {{ error }}
    </div>

    <template v-else-if="isStudent">
      <div
        v-if="studentGroups.length === 0"
        class="teaching-tree-hint"
      >
        {{ t('teaching.emptyCourse') }}
      </div>
      <div
        v-for="group in studentGroups"
        :key="group.courseId"
        class="course-node"
      >
        <div
          class="course-row"
          @click="toggleGroup(group.courseId)"
        >
          <span class="chevron">{{ expanded[group.courseId] ? '▾' : '▸' }}</span>
          <span class="course-name">{{ group.name }}</span>
        </div>
        <div v-if="expanded[group.courseId]">
          <div class="group-row">
            {{ t('teaching.readingGroup') }}
          </div>
          <div
            v-if="group.reading.length === 0"
            class="group-row loading"
          >
            {{ t('teaching.emptyMaterial') }}
          </div>
          <div
            v-for="release in group.reading"
            :key="release.releaseId"
            class="material-row"
            :class="{ active: openedRelease?.releaseId === release.releaseId }"
            :title="release.materialName"
            @click="openStudent(release)"
          >
            {{ release.materialName }}
          </div>
          <div class="group-row">
            {{ t('teaching.assignGroup') }}
          </div>
          <div
            v-if="group.assignable.length === 0"
            class="group-row loading"
          >
            {{ t('teaching.emptyMaterial') }}
          </div>
          <div
            v-for="release in group.assignable"
            :key="release.releaseId"
            class="material-row"
            :class="{ active: openedRelease?.releaseId === release.releaseId }"
            :title="release.materialName"
            @click="openStudent(release)"
          >
            {{ release.materialName }}
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div
        v-if="courses.length === 0"
        class="teaching-tree-hint"
      >
        {{ t('teaching.emptyCourse') }}
      </div>
      <div
        v-for="course in courses"
        :key="course.id"
        class="course-node"
      >
        <div
          class="course-row"
          @click="toggleCourse(course.id)"
        >
          <span class="chevron">{{ expanded[course.id] ? '▾' : '▸' }}</span>
          <span class="course-name">{{ course.name }}</span>
        </div>
        <div v-if="expanded[course.id]">
          <div class="group-row">
            {{ t('teaching.doc') }}
          </div>
          <div
            v-if="!materials[course.id]"
            class="group-row loading"
          >
            …
          </div>
          <div
            v-else-if="(materials[course.id] || []).length === 0"
            class="group-row loading"
          >
            {{ t('teaching.emptyMaterial') }}
          </div>
          <template v-else>
            <div
              v-for="material in materials[course.id] || []"
              :key="material.id"
              class="material-row"
              :title="material.name"
              @click="openPublish(course.id, material)"
            >
              {{ material.name }}
            </div>
          </template>
          <div class="group-row muted">
            {{ t('teaching.code') }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 教学 tab 的独立树（D10 / ADR-22），按学生/教师分流两套数据源：
 *
 * - 教师：课程 → 讲义（simple-list），点击预填发布对话框；
 * - 学生：我的课程 → 讲义（资料查阅）/ 作业与实验（student/releases），
 *   点击拉服务端派生的学生版 md，作为只读文档开进同一套编辑器壳。
 *
 * 与常规「文件」tab 的 openFolder 根完全隔离，不混根；coursework 本地副本
 * 不出现在任何树里（E3/E4 才接管）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { StudentRelease } from '@shared/types/auth'
import { t } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import { useTeachingStore } from '@/store/teaching'

interface SimpleItem {
  id: number
  name: string
}

interface StudentGroup {
  courseId: number
  name: string
  reading: StudentRelease[]
  assignable: StudentRelease[]
}

const auth = useAuthStore()
const teachingStore = useTeachingStore()
const { state, isStudent } = storeToRefs(auth)
const { openedRelease } = storeToRefs(teachingStore)
const loggedIn = computed(() => state.value.loggedIn)

const courses = ref<SimpleItem[]>([])
const materials = reactive<Record<number, SimpleItem[] | undefined>>({})
const releases = ref<StudentRelease[]>([])
const expanded = reactive<Record<number, boolean>>({})
const loading = ref(false)
const error = ref('')

const studentGroups = computed<StudentGroup[]>(() => {
  const groups = new Map<number, StudentGroup>()
  for (const release of releases.value) {
    let group = groups.get(release.courseId)
    if (!group) {
      group = {
        courseId: release.courseId,
        name: release.courseName,
        reading: [],
        assignable: []
      }
      groups.set(release.courseId, group)
    }
    if (release.purpose === 1) group.reading.push(release)
    else group.assignable.push(release)
  }
  return [...groups.values()]
})

const loadTeacher = async (): Promise<void> => {
  const res = await window.auth.request<SimpleItem[]>({
    url: '/teaching/course/simple-list'
  })
  if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`)
  courses.value = res.data ?? []
}

const loadStudent = async (): Promise<void> => {
  const res = await window.auth.request<StudentRelease[]>({
    url: '/teaching/student/releases'
  })
  if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`)
  releases.value = res.data ?? []
}

const loadAll = async (): Promise<void> => {
  loading.value = true
  error.value = ''
  try {
    if (isStudent.value) await loadStudent()
    else await loadTeacher()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

const toggleCourse = async (courseId: number): Promise<void> => {
  expanded[courseId] = !expanded[courseId]
  if (!expanded[courseId] || materials[courseId] !== undefined) return
  const res = await window.auth.request<SimpleItem[]>({
    url: '/teaching/material/simple-list',
    params: { courseId }
  })
  materials[courseId] = res.ok ? res.data ?? [] : []
}

const toggleGroup = (courseId: number): void => {
  expanded[courseId] = !expanded[courseId]
}

const openPublish = (courseId: number, material: SimpleItem): void => {
  teachingStore.openPublish({
    materialId: material.id,
    materialName: material.name,
    courseId
  })
}

const openStudent = async (release: StudentRelease): Promise<void> => {
  error.value = await teachingStore.openStudentRelease(release)
}

watch([loggedIn, isStudent], ([value]) => {
  if (value) void loadAll()
  else {
    courses.value = []
    releases.value = []
    error.value = ''
  }
})

onMounted(() => {
  if (loggedIn.value) void loadAll()
})
</script>

<style scoped>
.teaching-tree {
  font-size: 12px;
  color: var(--editorColor, #333);
  user-select: none;
}

.teaching-tree-title {
  padding: 4px 10px 8px;
  color: var(--editorColor50, #888);
  font-size: 11px;
}

.teaching-tree-hint {
  padding: 6px 10px;
  color: var(--editorColor50, #888);
}

.teaching-tree-hint.error {
  color: #a32d2d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-row,
.group-row,
.material-row {
  display: flex;
  align-items: center;
  height: 26px;
  padding-right: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.course-row {
  padding-left: 10px;
  cursor: pointer;
}

.course-row:hover,
.material-row:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.chevron {
  width: 14px;
  flex: none;
  color: var(--editorColor50, #888);
}

.group-row {
  padding-left: 28px;
  color: var(--editorColor50, #888);
}

.group-row.loading,
.group-row.muted {
  padding-left: 40px;
}

.material-row {
  padding-left: 42px;
  cursor: pointer;
}

.material-row.active {
  background: #faeeda;
  color: #854f0b;
  border-radius: 4px;
}
</style>
