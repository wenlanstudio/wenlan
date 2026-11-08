<template>
  <div class="account-setting">
    <h4>{{ t('account.account') }}</h4>

    <section
      v-if="!state.loggedIn"
      class="logged-out"
    >
      <p class="notes">
        {{ t('account.notLoggedIn') }}
      </p>
      <el-button
        type="primary"
        @click="showLogin = true"
      >
        {{ t('account.login') }}
      </el-button>
    </section>

    <section
      v-else
      class="account-panel"
    >
      <div class="profile">
        <span
          v-if="avatarUrl"
          class="avatar-img"
          :style="{ backgroundImage: `url(${avatarUrl})` }"
        />
        <span
          v-else
          class="avatar"
        >{{ avatarText }}</span>
        <div class="profile-meta">
          <div class="nickname">
            {{ displayName }}
          </div>
          <div class="detail">
            {{ state.user?.username }} · {{ schoolName }}
          </div>
        </div>
      </div>

      <el-divider />

      <h6>{{ t('account.changePassword') }}</h6>
      <el-form
        label-position="top"
        class="password-form"
      >
        <el-form-item :label="t('account.oldPassword')">
          <el-input
            v-model="oldPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('account.newPassword')">
          <el-input
            v-model="newPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('account.confirmPassword')">
          <el-input
            v-model="confirmPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <div
          v-if="passwordError"
          class="auth-error"
        >
          {{ passwordError }}
        </div>
        <div
          v-if="passwordOk"
          class="auth-ok"
        >
          {{ t('account.passwordChanged') }}
        </div>
        <el-button
          :loading="changing"
          @click="changePassword"
        >
          {{ t('account.changePassword') }}
        </el-button>
      </el-form>

      <el-divider />

      <el-button @click="logout">
        {{ t('account.logout') }}
      </el-button>
    </section>

    <login-dialog v-model="showLogin" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import type { TenantInfo } from '@shared/types/auth'
import LoginDialog from '@/components/accountBar/loginDialog.vue'

const auth = useAuthStore()
const { state } = storeToRefs(auth)

const showLogin = ref(false)
const tenants = ref<TenantInfo[]>([])
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changing = ref(false)
const passwordError = ref('')
const passwordOk = ref(false)

onMounted(() => {
  void auth.init()
  auth.listen()
  void loadTenants()
})

async function loadTenants(): Promise<void> {
  try {
    tenants.value = await window.auth.listTenants()
  } catch {
    tenants.value = []
  }
}

const displayName = computed(() => state.value.user?.nickname || state.value.user?.username || '')

const avatarUrl = computed(() => state.value.user?.avatar || '')

const avatarText = computed(() => {
  const name = state.value.user?.nickname || state.value.user?.username || '?'
  return name.slice(0, 1).toUpperCase()
})

const schoolName = computed(() => {
  const tid = state.value.tenantId
  const hit = tenants.value.find((x) => x.id === tid)
  return hit ? hit.name : (tid != null ? String(tid) : '')
})

async function changePassword(): Promise<void> {
  passwordError.value = ''
  passwordOk.value = false
  if (!oldPassword.value || !newPassword.value) {
    passwordError.value = t('account.fillRequired')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = t('account.passwordMismatch')
    return
  }
  changing.value = true
  try {
    const res = await window.auth.request<boolean>({
      url: '/system/user/profile/update-password',
      method: 'PUT',
      data: { oldPassword: oldPassword.value, newPassword: newPassword.value }
    })
    if (res.ok) {
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      passwordOk.value = true
    } else {
      passwordError.value = res.error ?? t('account.loginFailed')
    }
  } finally {
    changing.value = false
  }
}

function logout(): void {
  void window.auth.logout()
}
</script>

<style scoped>
.account-setting {
  max-width: 520px;
}

.logged-out {
  margin-top: 12px;
}

.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
}

.avatar,
.avatar-img {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--themeColor, #409eff);
  color: #fff;
  font-size: 20px;
}

.avatar-img {
  background-size: cover;
  background-position: center;
}

.nickname {
  font-size: 16px;
  font-weight: 600;
  color: var(--editorColor);
}

.detail {
  margin-top: 4px;
  font-size: 13px;
  color: var(--editorColor50, #888);
}

.password-form {
  max-width: 360px;
}

.auth-error {
  margin: -8px 0 12px;
  color: var(--errorColor, #f56c6c);
  font-size: 12px;
}

.auth-ok {
  margin: -8px 0 12px;
  color: var(--successColor, #67c23a);
  font-size: 12px;
}
</style>
