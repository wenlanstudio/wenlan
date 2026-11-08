<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('account.login')"
    width="380px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <el-form
      label-position="top"
      @submit.prevent
    >
      <el-form-item :label="t('account.school')">
        <el-select
          v-model="tenantId"
          :placeholder="t('account.tenantRequired')"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in tenants"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('account.username')">
        <el-input
          v-model="username"
          autocomplete="username"
        />
      </el-form-item>
      <el-form-item :label="t('account.password')">
        <el-input
          v-model="password"
          type="password"
          show-password
          autocomplete="current-password"
          @keyup.enter="submit"
        />
      </el-form-item>
    </el-form>
    <div
      v-if="error"
      class="auth-error"
    >
      {{ error }}
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="loading"
        @click="submit"
      >
        {{ t('account.login') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { t } from '@/i18n'
import type { TenantInfo } from '@shared/types/auth'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const tenants = ref<TenantInfo[]>([])
const tenantId = ref<number | null>(null)
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function onOpen(): Promise<void> {
  error.value = ''
  password.value = ''
  try {
    tenants.value = await window.auth.listTenants()
  } catch {
    tenants.value = []
  }
}

async function submit(): Promise<void> {
  error.value = ''
  if (tenantId.value == null) {
    error.value = t('account.tenantRequired')
    return
  }
  if (!username.value || !password.value) {
    error.value = t('account.fillRequired')
    return
  }
  loading.value = true
  try {
    const res = await window.auth.login({
      tenantId: tenantId.value,
      username: username.value,
      password: password.value
    })
    if (res.ok) {
      username.value = ''
      password.value = ''
      emit('update:modelValue', false)
    } else {
      error.value = res.error
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-error {
  margin-top: -8px;
  color: var(--errorColor, #f56c6c);
  font-size: 12px;
}
</style>
