<template>
  <div class="pref-codeexec">
    <h4>{{ t('codeExec.title') }}</h4>

    <compound :notes="t('codeExec.notes')">
      <template #head>
        <h6 class="title">
          {{ t('codeExec.language.title') }}
        </h6>
      </template>
      <template #children>
        <text-box
          :description="t('codeExec.language.javaHome')"
          :notes="t('codeExec.language.javaHomeNotes')"
          :input="form.java.JAVA_HOME"
          :placeholder="t('codeExec.language.javaHomePlaceholder')"
          :on-change="(v) => setField('java', 'JAVA_HOME', v)"
        />
        <text-box
          :description="t('codeExec.language.classPath')"
          :notes="t('codeExec.language.classPathNotes')"
          :input="form.java.CLASS_PATH"
          :placeholder="t('codeExec.language.classPathPlaceholder')"
          :on-change="(v) => setField('java', 'CLASS_PATH', v)"
        />
        <text-box
          :description="t('codeExec.language.pythonPath')"
          :notes="t('codeExec.language.pythonPathNotes')"
          :input="form.python.PYTHON_PATH"
          :placeholder="t('codeExec.language.pythonPathPlaceholder')"
          :on-change="(v) => setField('python', 'PYTHON_PATH', v)"
        />
      </template>
    </compound>

    <compound :notes="t('codeExec.mr.notes')">
      <template #head>
        <h6 class="title">
          {{ t('codeExec.mr.title') }}
        </h6>
      </template>
      <template #children>
        <text-box
          :description="t('codeExec.mr.jdkHome')"
          :input="form.mr.jdkHome"
          :placeholder="t('codeExec.mr.jdkHomePlaceholder')"
          :on-change="(v) => setField('mr', 'jdkHome', v)"
        />
        <text-box
          :description="t('codeExec.mr.hadoopHome')"
          :notes="t('codeExec.mr.hadoopHomeNotes')"
          :input="form.mr.hadoopHome"
          :placeholder="t('codeExec.mr.hadoopHomePlaceholder')"
          :on-change="(v) => setField('mr', 'hadoopHome', v)"
        />
        <text-box
          :description="t('codeExec.mr.winutilsHome')"
          :notes="t('codeExec.mr.winutilsHomeNotes')"
          :input="form.mr.winutilsHome"
          :placeholder="t('codeExec.mr.winutilsHomePlaceholder')"
          :on-change="(v) => setField('mr', 'winutilsHome', v)"
        />
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

const { t } = useI18n()

/** 面板编辑的起点 = 落盘原文（saved），不含自动探测打底，避免保存时把探测结果固化。 */
const form = reactive<{
  java: { JAVA_HOME: string; CLASS_PATH: string }
  python: { PYTHON_PATH: string }
  mr: { jdkHome: string; hadoopHome: string; winutilsHome: string }
}>({
  java: { JAVA_HOME: '', CLASS_PATH: '' },
  python: { PYTHON_PATH: '' },
  mr: { jdkHome: '', hadoopHome: '', winutilsHome: '' }
})

const configPath = ref('')
const saving = ref(false)
const saveOk = ref(false)
const saveError = ref('')

const setField = (
  family: 'java' | 'python' | 'mr',
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
    form.java.CLASS_PATH = asString(s.java?.CLASS_PATH)
    form.python.PYTHON_PATH = asString(s.python?.PYTHON_PATH)
    form.mr.jdkHome = asString(s.mr?.jdkHome)
    form.mr.hadoopHome = asString(s.mr?.hadoopHome)
    form.mr.winutilsHome = asString(s.mr?.winutilsHome)
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
    if (form.java.JAVA_HOME) patch.java = { ...(patch.java ?? {}), JAVA_HOME: form.java.JAVA_HOME }
    if (form.java.CLASS_PATH) patch.java = { ...(patch.java ?? {}), CLASS_PATH: form.java.CLASS_PATH }
    if (form.python.PYTHON_PATH) patch.python = { PYTHON_PATH: form.python.PYTHON_PATH }
    if (form.mr.jdkHome) patch.mr = { ...(patch.mr ?? {}), jdkHome: form.mr.jdkHome }
    if (form.mr.hadoopHome) patch.mr = { ...(patch.mr ?? {}), hadoopHome: form.mr.hadoopHome }
    if (form.mr.winutilsHome) patch.mr = { ...(patch.mr ?? {}), winutilsHome: form.mr.winutilsHome }
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
