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
          <template
            v-for="pg in PURPOSE_GROUPS"
            :key="pg.purpose"
          >
            <div class="group-row">
              {{ t(pg.label) }}
            </div>
            <div
              v-if="itemsOf(group, pg.purpose).length === 0"
              class="group-row loading"
            >
              {{ t('teaching.emptyMaterial') }}
            </div>
            <div
              v-for="release in itemsOf(group, pg.purpose)"
              :key="release.releaseId"
              class="material-row"
              :class="{
                active:
                  openedRelease?.releaseId === release.releaseId ||
                  openedLab?.releaseId === release.releaseId
              }"
              :title="release.materialName"
              @click="openStudent(release)"
            >
              {{ release.materialName }}
            </div>
          </template>
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
  /** 词表 v2 用途桶：1 讲义 / 2 实验 / 6 实训 / 3 作业 / 5 考试（D13）。 */
  byPurpose: Record<number, StudentRelease[]>
}

/** 五组固定顺序 = 词表序（D13：讲义/实验/实训/作业/考试，目录与菜单同构 D14）。 */
const PURPOSE_GROUPS: Array<{ purpose: number; label: string }> = [
  { purpose: 1, label: 'teaching.groupLecture' },
  { purpose: 2, label: 'teaching.groupExperiment' },
  { purpose: 6, label: 'teaching.groupTraining' },
  { purpose: 3, label: 'teaching.groupHomework' },
  { purpose: 5, label: 'teaching.groupExam' }
]

const itemsOf = (group: StudentGroup, purpose: number): StudentRelease[] =>
  group.byPurpose[purpose] ?? []

const auth = useAuthStore()
const teachingStore = useTeachingStore()
const { state, isStudent } = storeToRefs(auth)
const { openedRelease, openedLab } = storeToRefs(teachingStore)
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
        byPurpose: {}
      }
      groups.set(release.courseId, group)
    }
    const bucket = group.byPurpose[release.purpose] ?? []
    bucket.push(release)
    group.byPurpose[release.purpose] = bucket
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
  // E4：实验类（purpose≥2）走副本落盘 + 教学面板链路（内部为讲义回退旧链）。
  error.value = await teachingStore.openLabRelease(release)
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
