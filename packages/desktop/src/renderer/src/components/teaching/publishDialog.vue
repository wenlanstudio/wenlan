<template>
  <el-dialog
    :model-value="publishVisible"
    width="520px"
    append-to-body
    :title="t('teaching.publishTitle')"
    :close-on-click-modal="false"
    @update:model-value="onVisibleChange"
    @open="onOpen"
  >
    <div v-if="blockReason">
      {{ blockReason }}
    </div>
    <div
      v-else
      class="publish-form"
    >
      <div class="form-row">
        <span class="form-label">{{ t('teaching.material') }}</span>
        <el-radio-group v-model="form.mode">
          <el-radio label="existing">
            {{ t('teaching.existingMaterial') }}
          </el-radio>
          <el-radio label="new">
            {{ t('teaching.newMaterial') }}
          </el-radio>
        </el-radio-group>
      </div>

      <div class="form-row">
        <span class="form-label">{{ t('teaching.course') }}</span>
        <el-select
          v-model="form.courseId"
          :placeholder="t('teaching.course')"
          @change="onCourseChange"
        >
          <el-option
            v-for="item in courses"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </div>

      <div
        v-if="form.mode === 'new'"
        class="form-row"
      >
        <span class="form-label">{{ t('teaching.materialName') }}</span>
        <el-input v-model="form.name" />
      </div>
      <div
        v-else
        class="form-row"
      >
        <span class="form-label">{{ t('teaching.material') }}</span>
        <el-select
          v-model="form.materialId"
          :placeholder="t('teaching.material')"
          @change="onMaterialChange"
        >
          <el-option
            v-for="item in materials"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </div>

      <div class="form-row">
        <span class="form-label">{{ t('teaching.clazz') }}</span>
        <el-select
          v-model="form.classIds"
          multiple
          :placeholder="t('teaching.clazz')"
        >
          <el-option
            v-for="item in classes"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </div>

      <div class="form-row">
        <span class="form-label">{{ t('teaching.purposeLabel') }}</span>
        <el-select v-model="form.purpose">
          <el-option
            v-for="purpose in purposes"
            :key="purpose.value"
            :label="t(purpose.key)"
            :value="purpose.value"
          />
        </el-select>
      </div>

      <div class="form-row version-row">
        <span class="form-label">{{ t('teaching.version') }}</span>
        <div class="version-options">
          <el-radio-group v-model="form.versionMode">
            <el-radio label="auto">
              {{ t('teaching.autoVersion') }}
            </el-radio>
            <el-radio label="new">
              {{ t('teaching.forceNewVersion') }}
            </el-radio>
            <el-radio
              label="reuse"
              :disabled="!reusableMeta"
            >
              {{ t('teaching.reuseVersion') }}
            </el-radio>
          </el-radio-group>
          <div class="version-hint">
            {{ resolvedMode === 'reuse' ? t('teaching.reuseHint') : t('teaching.newVersionHint') }}
          </div>
        </div>
      </div>

      <div
        v-if="step"
        class="publish-step"
      >
        {{ step }}
      </div>
      <div
        v-if="error"
        class="publish-error"
      >
        {{ error }}
      </div>
      <div
        v-if="success"
        class="publish-success"
      >
        {{ success }}
      </div>
    </div>

    <template #footer>
      <el-button @click="teachingStore.closePublish()">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :disabled="!canSubmit || publishing"
        :loading="publishing"
        @click="publish"
      >
        {{ t('teaching.publishButton') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 发布对话框（E5 步骤 1，纯文本最小闭环）。
 *
 * 设计约束见 e5-implementation-checklist.md §3 步骤 1：
 * - 所有 admin-api 请求经 window.auth.request（token 只活 main）；
 * - 版本不是发布时生成的，发布只是挑一个已有 versionId 锚定；
 * - 服务端 update-content 不比对内容：客户端用内容指纹复用 versionId，
 *   避免每次点发布都制造新版本；
 * - 一次 release/create 一个班，多班循环但共用同一个 versionId。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import { useEditorStore } from '@/store/editor'
import {
  hashContent,
  useTeachingStore,
  type ReleaseRef,
  type SavedPublishMeta
} from '@/store/teaching'

interface SimpleItem {
  id: number
  name: string
}

interface VersionItem {
  id: number
  versionNo: number
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

const auth = useAuthStore()
const editorStore = useEditorStore()
const teachingStore = useTeachingStore()
const { state } = storeToRefs(auth)
const { currentFile } = storeToRefs(editorStore)
const { publishVisible, prefill } = storeToRefs(teachingStore)

const purposes = [
  { value: 1, key: 'teaching.purpose1' },
  { value: 2, key: 'teaching.purpose2' },
  { value: 3, key: 'teaching.purpose3' },
  { value: 4, key: 'teaching.purpose4' },
  { value: 5, key: 'teaching.purpose5' }
]

const form = reactive({
  mode: 'existing' as 'existing' | 'new',
  materialId: null as number | null,
  name: '',
  courseId: null as number | null,
  classIds: [] as number[],
  purpose: 1,
  versionMode: 'auto' as 'auto' | 'new' | 'reuse'
})

const courses = ref<SimpleItem[]>([])
const classes = ref<SimpleItem[]>([])
const materials = ref<SimpleItem[]>([])
const publishing = ref(false)
const step = ref('')
const error = ref('')
const success = ref('')

const pathname = computed(() => currentFile.value?.pathname ?? '')
const content = computed(() => currentFile.value?.markdown ?? '')
const contentHash = computed(() => hashContent(content.value))
const meta = computed<SavedPublishMeta | null>(() =>
  pathname.value ? teachingStore.metaFor(pathname.value) : null
)
// 本地元数据只对它记录的那份讲义有效：换选了别的讲义，就不能拿它的 versionId 去发布。
const reusableMeta = computed<SavedPublishMeta | null>(() =>
  form.mode === 'existing' && meta.value && meta.value.materialId === form.materialId
    ? meta.value
    : null
)
const contentUnchanged = computed(
  () => !!reusableMeta.value && reusableMeta.value.contentHash === contentHash.value
)

const resolvedMode = computed<'new' | 'reuse'>(() => {
  if (form.mode === 'new') return 'new'
  if (form.versionMode === 'new') return 'new'
  if (form.versionMode === 'reuse' && reusableMeta.value) return 'reuse'
  return contentUnchanged.value ? 'reuse' : 'new'
})

const blockReason = computed(() => {
  if (!state.value.loggedIn) return t('teaching.notLoggedIn')
  if (!currentFile.value) return t('teaching.noDocument')
  const saved = (currentFile.value as { isSaved?: boolean }).isSaved
  if (saved === false) return t('teaching.unsaved')
  return ''
})

const canSubmit = computed(() => {
  if (blockReason.value || publishing.value) return false
  if (!form.courseId || form.classIds.length === 0) return false
  if (form.mode === 'new') return !!form.name.trim()
  return !!form.materialId
})

const request = async <T,>(
  url: string,
  options: { method?: Method; data?: unknown; params?: Record<string, string | number> } = {}
): Promise<T> => {
  const res = await window.auth.request<T>({
    url,
    method: options.method ?? 'GET',
    data: options.data,
    params: options.params
  })
  if (!res.ok) throw new Error(res.error ?? `HTTP ${res.status}`)
  return res.data
}

const loadCourses = async (): Promise<void> => {
  courses.value = await request<SimpleItem[]>('/teaching/course/simple-list')
}

const loadClasses = async (courseId: number | null): Promise<void> => {
  classes.value = await request<SimpleItem[]>('/teaching/class/simple-list', {
    params: courseId ? { courseId } : {}
  })
}

const loadMaterials = async (courseId: number | null): Promise<void> => {
  materials.value = await request<SimpleItem[]>('/teaching/material/simple-list', {
    params: courseId ? { courseId } : {}
  })
}

const onCourseChange = (): void => {
  void loadClasses(form.courseId)
  void loadMaterials(form.courseId)
}

const onMaterialChange = (): void => {
  // 版本下拉未做成显式选择：auto 模式从本地元数据复用，避免多余请求。
}

const resetForm = (): void => {
  form.mode = 'existing'
  form.materialId = prefill.value.materialId ?? meta.value?.materialId ?? null
  form.name = prefill.value.materialName ?? ''
  form.courseId = prefill.value.courseId ?? meta.value?.courseId ?? null
  form.classIds = meta.value?.classIds ? [...meta.value.classIds] : []
  form.purpose = meta.value?.purpose ?? 1
  form.versionMode = 'auto'
  step.value = ''
  error.value = ''
  success.value = ''
}

const onOpen = (): void => {
  resetForm()
  if (!state.value.loggedIn) return
  void loadCourses().catch((e: Error) => {
    error.value = e.message
  })
  void loadClasses(form.courseId).catch((e: Error) => {
    error.value = e.message
  })
  void loadMaterials(form.courseId).catch((e: Error) => {
    error.value = e.message
  })
  if (pathname.value) teachingStore.restoreLast(pathname.value)
}

const onVisibleChange = (value: boolean): void => {
  if (!value) teachingStore.closePublish()
}

/** 发布失败但版本已创建时，记住 versionId 供下次复用（版本不可变、无害）。 */
const rememberFailedVersion = (versionId: number, versionNo: number): void => {
  if (!pathname.value || !form.courseId) return
  teachingStore.remember(pathname.value, {
    materialId: form.materialId ?? 0,
    versionId,
    versionNo,
    releaseCount: 0,
    contentHash: contentHash.value,
    purpose: form.purpose,
    courseId: form.courseId,
    classIds: [...form.classIds]
  })
}

const publish = async (): Promise<void> => {
  if (!canSubmit.value || publishing.value) return
  publishing.value = true
  error.value = ''
  success.value = ''

  let createdVersionId: number | null = null
  let createdVersionNo = 0

  try {
    let materialId = form.materialId
    let versionId: number
    let versionNo: number

    if (form.mode === 'new') {
      step.value = t('teaching.stepSaving')
      materialId = await request<number>('/teaching/material/create', {
        method: 'POST',
        data: { courseId: form.courseId, name: form.name.trim(), content: content.value }
      })
      // 讲义已在服务端落地：立刻切到「更新已有讲义」，后面任何一步失败，
      // 重试都落在这份讲义上，而不是再建一份同名讲义。
      form.mode = 'existing'
      form.materialId = materialId
      void loadMaterials(form.courseId).catch(() => undefined)
      const detail = await request<{ currentVersionId: number; currentVersionNo: number }>(
        '/teaching/material/get',
        { params: { id: materialId as number } }
      )
      versionId = detail.currentVersionId
      versionNo = detail.currentVersionNo
      createdVersionId = versionId
      createdVersionNo = versionNo
    } else if (resolvedMode.value === 'reuse' && reusableMeta.value) {
      versionId = reusableMeta.value.versionId
      versionNo = reusableMeta.value.versionNo
    } else {
      step.value = t('teaching.stepVersion')
      versionId = await request<number>('/teaching/material/update-content', {
        method: 'PUT',
        data: { id: form.materialId, content: content.value }
      })
      createdVersionId = versionId
      // update-content 只返回 versionId；版本号从倒序版本列表取首条。
      const versions = await request<VersionItem[]>('/teaching/material/version/list', {
        params: { materialId: form.materialId as number }
      })
      versionNo = versions[0]?.versionNo ?? (meta.value?.versionNo ?? 0) + 1
      createdVersionNo = versionNo
    }

    const createdReleases: ReleaseRef[] = []
    for (const classId of form.classIds) {
      step.value = t('teaching.stepRelease')
      const releaseId = await request<number>('/teaching/release/create', {
        method: 'POST',
        data: {
          materialId,
          materialVersionId: versionId,
          classId,
          purpose: form.purpose
        }
      })
      createdReleases.push({
        releaseId,
        classId,
        className: classes.value.find((item) => item.id === classId)?.name ?? `#${classId}`
      })
    }

    // 同一版本再发给别的班：「N 个班」按这一版累计（去重）；换了新版本就从本次重新计。
    const last = meta.value
    const sameVersion = last && last.materialId === materialId && last.versionId === versionId
    const prior = sameVersion ? last.classIds : []
    const classIds = [...new Set([...prior, ...form.classIds])]
    // 发布物按班去重：本次新建的排前面（开班默认取第一条 = 最新版本）。
    const priorReleases = sameVersion ? last.releases ?? [] : []
    const releases: ReleaseRef[] = [
      ...createdReleases,
      ...priorReleases.filter((item) => !createdReleases.some((c) => c.classId === item.classId))
    ]
    teachingStore.remember(pathname.value, {
      materialId: materialId as number,
      versionId,
      versionNo,
      releaseCount: classIds.length,
      contentHash: contentHash.value,
      purpose: form.purpose,
      courseId: form.courseId as number,
      classIds,
      releases
    })
    step.value = ''
    success.value = t('teaching.success')
  } catch (e) {
    step.value = ''
    error.value = `${t('teaching.errorPrefix')}：${(e as Error).message}`
    if (createdVersionId) rememberFailedVersion(createdVersionId, createdVersionNo)
  } finally {
    publishing.value = false
  }
}

watch(pathname, (value) => {
  if (value) teachingStore.restoreLast(value)
})

// 登出即收起：未登录时不留任何教学界面（N1）。
watch(
  () => state.value.loggedIn,
  (loggedIn) => {
    if (!loggedIn) teachingStore.closePublish()
  }
)

onMounted(() => {
  if (pathname.value) teachingStore.restoreLast(pathname.value)
})
</script>

<style scoped>
.publish-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.form-label {
  width: 74px;
  flex: none;
  font-size: 12px;
  color: var(--editorColor60, #666);
}

.form-row :deep(.el-select) {
  flex: 1;
}

.version-row {
  align-items: flex-start;
}

.version-options {
  flex: 1;
}

.version-hint,
.publish-step,
.publish-error,
.publish-success {
  font-size: 12px;
  color: var(--editorColor60, #666);
}

.publish-step {
  color: #185fa5;
}

.publish-error {
  color: #a32d2d;
  word-break: break-all;
}

.publish-success {
  color: #0f6e56;
}
</style>
