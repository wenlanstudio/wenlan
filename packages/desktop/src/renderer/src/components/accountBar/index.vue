<template>
  <div class="account-bar">
    <login-dialog v-model="showLogin" />

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
          <el-dropdown-item command="teaching">
            {{ t('account.openTeaching') }}
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
import LoginDialog from './loginDialog.vue'

const auth = useAuthStore()
const { state } = storeToRefs(auth)

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
  if (command === 'teaching') {
    void window.auth.openTeaching()
  } else if (command === 'logout') {
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
