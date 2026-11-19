<template>
  <div class="account-bar">
    <login-dialog v-model="showLogin" />

    <!-- geek 模式：菜单栏隐藏，设置入口落到侧栏右下角齿轮（ZCode 式）。 -->
    <button
      v-if="isGeek"
      class="gear-entry"
      :title="t('preferences.general.window.interfaceMode.geekGear')"
      @click="openPreferences"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle
          cx="12"
          cy="12"
          r="3"
        />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>

    <button
      v-if="!auth.state.loggedIn"
      class="account-entry"
      @click="showLogin = true"
    >
      <span class="entry-icon">{{ loginIcon }}</span>
      <span class="entry-label">{{ t('account.login') }}</span>
    </button>

    <el-dropdown
      v-else
      trigger="click"
      @command="onCommand"
    >
      <div class="account-user">
        <span
          v-if="avatarUrl"
          class="avatar-img"
          :style="{ backgroundImage: `url(${avatarUrl})` }"
        />
        <span
          v-else
          class="avatar"
        >{{ avatarText }}</span>
        <span class="nickname">{{ displayName }}</span>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-if="!auth.isStudent"
            command="publish"
          >
            {{ t('teaching.publish') }}
          </el-dropdown-item>
          <el-dropdown-item command="teaching-tab">
            {{ t('teaching.tab') }}
          </el-dropdown-item>
          <el-dropdown-item
            command="logout"
            divided
          >
            {{ t('account.logout') }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { t } from '@/i18n'
import { useAuthStore } from '@/store/auth'
import { useTeachingStore } from '@/store/teaching'
import { useLayoutStore } from '@/store/layout'
import { usePreferencesStore } from '@/store/preferences'
import LoginDialog from './loginDialog.vue'

const auth = useAuthStore()
const { state } = storeToRefs(auth)
const { interfaceMode } = storeToRefs(usePreferencesStore())

const isGeek = computed(() => interfaceMode.value === 'geek')

const openPreferences = (): void => {
  window.electron.ipcRenderer.send('mt::open-setting-window')
}

const showLogin = ref(false)

onMounted(() => {
  void auth.init()
  auth.listen()
})

const loginIcon = computed(() => '◆')

const displayName = computed(() => state.value.user?.nickname || state.value.user?.username || '')

const avatarUrl = computed(() => state.value.user?.avatar || '')

const avatarText = computed(() => {
  const name = state.value.user?.nickname || state.value.user?.username || '?'
  return name.slice(0, 1).toUpperCase()
})

function onCommand(command: string): void {
  if (command === 'logout') {
    void window.auth.logout()
  } else if (command === 'publish') {
    if (auth.isStudent) return
    useTeachingStore().openPublish()
  } else if (command === 'teaching-tab') {
    useLayoutStore().SET_LAYOUT({ sidebarTab: 'teaching', showSideBar: true })
  }
}
</script>

<style scoped>
.account-bar {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-top: 1px solid var(--sideBarBorderColor, #e4e4e4);
}

.account-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--editorColor, #333);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.account-entry:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.gear-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--editorColor50, #888);
  cursor: pointer;
}

.gear-entry:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
  color: var(--editorColor, #333);
}

.entry-icon {
  color: var(--editorColor50, #888);
}

.account-user {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
}

.account-user:hover {
  background: var(--sideBarItemHoverBg, rgba(0, 0, 0, 0.05));
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--themeColor, #409eff);
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
}

.avatar-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.nickname {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--editorColor, #333);
  font-size: 13px;
}
</style>
