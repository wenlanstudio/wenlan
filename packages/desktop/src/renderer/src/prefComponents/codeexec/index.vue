<template>
  <div class="pref-codeexec">
    <h4>{{ t('codeExec.title') }}</h4>

    <compound :notes="t('codeExec.notes')">
      <template #head>
        <h6 class="title">
          {{ t('codeExec.runtime.title') }}
        </h6>
      </template>
      <template #children>
        <text-box
          :description="t('codeExec.runtime.jdkHome')"
          :notes="t('codeExec.runtime.jdkHomeNotes')"
          :input="form.java.JAVA_HOME"
          :placeholder="t('codeExec.runtime.jdkHomePlaceholder')"
          :on-change="(v) => setField('java', 'JAVA_HOME', v)"
        />
        <text-box
          :description="t('codeExec.runtime.pythonPath')"
          :notes="t('codeExec.runtime.pythonPathNotes')"
          :input="form.python.PYTHON_PATH"
          :placeholder="t('codeExec.runtime.pythonPathPlaceholder')"
          :on-change="(v) => setField('python', 'PYTHON_PATH', v)"
        />
      </template>
    </compound>

    <compound :notes="t('codeExec.detected.notes')">
      <template #head>
        <h6 class="title">
          {{ t('codeExec.detected.title') }}
        </h6>
      </template>
      <template #children>
        <dl class="detected-list">
          <div class="detected-row">
            <dt>{{ t('codeExec.detected.hadoopHome') }}</dt>
            <dd :class="{ unset: !detected.hadoopHome }">
              {{ detected.hadoopHome || t('codeExec.detected.unset') }}
            </dd>
          </div>
          <div class="detected-row">
            <dt>{{ t('codeExec.detected.dotPath') }}</dt>
            <dd :class="{ unset: !detected.dotPath }">
              {{ detected.dotPath || t('codeExec.detected.unset') }}
            </dd>
          </div>
          <div class="detected-row">
            <dt>{{ t('codeExec.detected.plantumlServer') }}</dt>
            <dd>{{ detected.plantumlServer }}</dd>
          </div>
        </dl>
      </template>
    </compound>

    <div class="config-path notes">
      {{ t('codeExec.configPath') }}: {{ configPath }}
    </div>

    <div class="actions">
      <el-button
        type="primary"
        :loading="saving"
        @click="save"
      >
        {{ t('codeExec.save') }}
      </el-button>
      <span
        v-if="saveOk"
        class="save-ok"
      >{{ t('codeExec.saveOk') }}</span>
      <span
        v-if="saveError"
        class="save-error"
      >{{ saveError }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Compound from '../common/compound/index.vue'
import TextBox from '../common/textBox/index.vue'
import type { Md2rDetectedEnv } from '@shared/types/mdcode2run'

const { t } = useI18n()

/** 面板编辑的起点 = 落盘原文（saved），不含自动探测打底，避免保存时把探测结果固化。 */
const form = reactive<{
  java: { JAVA_HOME: string }
  python: { PYTHON_PATH: string }
}>({
  java: { JAVA_HOME: '' },
  python: { PYTHON_PATH: '' }
})

const detected = reactive<Md2rDetectedEnv>({
  hadoopHome: '',
  dotPath: '',
  plantumlServer: ''
})

const configPath = ref('')
const saving = ref(false)
const saveOk = ref(false)
const saveError = ref('')

const setField = (
  family: 'java' | 'python',
  key: string,
  value: string
): void => {
  saveOk.value = false
  saveError.value = ''
  ;(form[family] as Record<string, string>)[key] = value
}

onMounted(async () => {
  try {
    const res = await window.mdcode2run.getEngineConfig()
    configPath.value = res.path
    const s = res.saved
    form.java.JAVA_HOME = asString(s.java?.JAVA_HOME)
    form.python.PYTHON_PATH = asString(s.python?.PYTHON_PATH)
    const d = res.detected
    if (d) {
      detected.hadoopHome = asString(d.hadoopHome)
      detected.dotPath = asString(d.dotPath)
      detected.plantumlServer = asString(d.plantumlServer)
    }
  } catch {
    saveError.value = t('codeExec.loadFailed')
  }
})

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

const save = async (): Promise<void> => {
  saving.value = true
  saveOk.value = false
  saveError.value = ''
  try {
    const patch: Record<string, Record<string, unknown>> = {}
    // 只写有值的字段；空串走不了「清空」语义（saveEngineProfile 按族 merge），
    // 空值字段直接不写，保留文件里的旧值。
    if (form.java.JAVA_HOME) patch.java = { JAVA_HOME: form.java.JAVA_HOME }
    if (form.python.PYTHON_PATH) patch.python = { PYTHON_PATH: form.python.PYTHON_PATH }
    const res = await window.mdcode2run.setEngineConfig(patch)
    if (res.ok) {
      saveOk.value = true
    } else {
      saveError.value = res.error ?? t('codeExec.saveFailed')
    }
  } catch {
    saveError.value = t('codeExec.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.pref-codeexec {
  max-width: 640px;
}

.detected-list {
  margin: 0;
}

.detected-row {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}

.detected-row dt {
  flex: 0 0 120px;
  color: var(--secondaryTextColor, #888);
}

.detected-row dd {
  margin: 0;
  flex: 1;
  word-break: break-all;
}

.detected-row dd.unset {
  color: var(--secondaryTextColor, #888);
  font-style: italic;
}

.config-path {
  margin: 20px 0 8px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.save-ok {
  color: var(--successColor, #67c23a);
  font-size: 13px;
}

.save-error {
  color: var(--errorColor, #f56c6c);
  font-size: 13px;
}
</style>
