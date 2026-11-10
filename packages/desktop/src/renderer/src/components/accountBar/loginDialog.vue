<template>
  <el-dialog
    :model-value="modelValue"
    width="400px"
    append-to-body
    :show-header="false"
    :close-on-click-modal="false"
    class="wenlan-login"
    @update:model-value="emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <div class="login-card">
      <header class="login-hero">
        <button
          type="button"
          class="login-close"
          :aria-label="t('common.cancel')"
          @click="emit('update:modelValue', false)"
        >
          <el-icon><Close /></el-icon>
        </button>
        <!-- 品牌「文」字：与 build/icons/md.svg、titleBar/menuBar.vue 汉堡图标
             同一条篆书 path、同一个 translate(225 25) 校准。配色取文档图标
             （米黄底 #FDFAF3 + 墨篆 #1A1A1C），不用反色版（墨底米字）。
             切勿给 path 加描边：小尺寸会把交叉处负空间填死。 -->
        <div class="brand-mark">
          <svg
            viewBox="0 0 1024 1024"
            width="48"
            height="48"
            aria-hidden="true"
          >
            <rect
              width="1024"
              height="1024"
              rx="204"
              ry="204"
              fill="#FDFAF3"
            />
            <g
              transform="translate(225 25) scale(1)"
              fill="#1A1A1C"
              fill-rule="evenodd"
            >
              <path d="M276.0,0.0 L267.0,6.0 L263.0,14.0 L264.0,123.0 L263.0,138.0 L259.0,149.0 L252.0,156.0 L246.0,159.0 L205.0,171.0 L161.0,191.0 L109.0,225.0 L84.0,246.0 L43.0,289.0 L15.0,326.0 L0.0,355.0 L1.0,366.0 L8.0,375.0 L20.0,377.0 L26.0,374.0 L33.0,365.0 L41.0,349.0 L66.0,314.0 L101.0,277.0 L109.0,271.0 L114.0,271.0 L135.0,287.0 L219.0,342.0 L256.0,371.0 L270.0,385.0 L238.0,437.0 L197.0,512.0 L162.0,584.0 L136.0,649.0 L113.0,723.0 L96.0,799.0 L85.0,879.0 L82.0,942.0 L86.0,952.0 L94.0,959.0 L100.0,961.0 L111.0,959.0 L120.0,949.0 L123.0,935.0 L126.0,878.0 L137.0,795.0 L148.0,741.0 L166.0,675.0 L190.0,607.0 L224.0,531.0 L270.0,446.0 L290.0,415.0 L295.0,411.0 L328.0,447.0 L364.0,499.0 L395.0,555.0 L418.0,609.0 L444.0,686.0 L463.0,763.0 L478.0,862.0 L483.0,944.0 L488.0,954.0 L493.0,958.0 L502.0,961.0 L509.0,960.0 L519.0,952.0 L523.0,942.0 L520.0,875.0 L511.0,806.0 L503.0,761.0 L491.0,709.0 L476.0,657.0 L451.0,587.0 L431.0,542.0 L398.0,481.0 L371.0,441.0 L344.0,407.0 L316.0,377.0 L318.0,371.0 L330.0,355.0 L370.0,309.0 L405.0,277.0 L433.0,257.0 L435.0,253.0 L433.0,243.0 L427.0,237.0 L416.0,234.0 L404.0,238.0 L389.0,248.0 L344.0,289.0 L316.0,320.0 L291.0,352.0 L289.0,352.0 L260.0,327.0 L231.0,306.0 L186.0,277.0 L157.0,261.0 L150.0,254.0 L149.0,248.0 L152.0,242.0 L161.0,233.0 L179.0,221.0 L213.0,205.0 L253.0,193.0 L285.0,189.0 L307.0,189.0 L342.0,193.0 L372.0,200.0 L403.0,211.0 L433.0,226.0 L456.0,241.0 L482.0,262.0 L527.0,309.0 L549.0,340.0 L570.0,381.0 L576.0,387.0 L584.0,390.0 L593.0,387.0 L599.0,380.0 L601.0,367.0 L595.0,350.0 L583.0,328.0 L553.0,285.0 L510.0,239.0 L473.0,210.0 L425.0,183.0 L388.0,169.0 L347.0,159.0 L298.0,154.0 L298.0,17.0 L296.0,10.0 L291.0,4.0 L283.0,0.0 Z" />
            </g>
          </svg>
        </div>
        <div class="brand-text">
          <h1 class="brand-title">
            文览
          </h1>
          <p class="brand-sub">
            一文多览 · 登录以同步讲义
          </p>
        </div>
      </header>

      <div class="login-body">
        <el-form
          label-position="top"
          @submit.prevent
        >
          <el-form-item :label="t('account.school')">
            <el-select
              v-model="tenantId"
              :placeholder="t('account.tenantRequired')"
              filterable
              popper-class="wenlan-login-popper"
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
              :prefix-icon="User"
              autocomplete="username"
            />
          </el-form-item>
          <el-form-item :label="t('account.password')">
            <el-input
              v-model="password"
              type="password"
              :prefix-icon="Lock"
              show-password
              autocomplete="current-password"
              @keyup.enter="submit"
            />
          </el-form-item>
        </el-form>

        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          show-icon
          class="login-alert"
        />

        <div class="login-actions">
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
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Close, Lock, User } from '@element-plus/icons-vue'
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
/* 品牌登录卡固定浅色：不跟编辑器深色主题走，保证米黄底 + 墨篆「文」的
   配色一致。在卡片上重设 Element Plus 局部变量，让输入框/button/表单标签
   在深色主题下也保持浅底深字；下拉面板 teleport 到 body，另用全局块兜底。 */
.login-card {
  --el-bg-color: #ffffff;
  --el-bg-color-overlay: #ffffff;
  --el-fill-color-blank: #ffffff;
  --el-fill-color-light: #f6f4ee;
  --el-text-color-primary: #1a1a1c;
  --el-text-color-regular: #4a463e;
  --el-text-color-placeholder: #9a9489;
  --el-border-color: #e2ddd1;
  --el-border-color-light: #eae5da;
  --el-color-primary: #1a1a1c;
  --el-color-primary-light-3: #3d3d42;
  --el-color-primary-light-5: #5c5c61;
  --el-color-primary-light-7: #8b8b90;
  --el-color-primary-light-8: #b5b5b9;
  --el-color-primary-light-9: #efeeea;
  --el-color-primary-dark-2: #101012;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: #ffffff;
  color: #1a1a1c;
}

.login-hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 24px;
  background: linear-gradient(135deg, #ffffff 0%, #f7f3e8 100%);
  border-bottom: 1px solid rgba(26, 26, 28, 0.06);
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 10px;
  overflow: hidden;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(26, 26, 28, 0.12), 0 0 0 1px rgba(26, 26, 28, 0.06);
}

.brand-mark :deep(svg) {
  display: block;
}

.brand-text {
  min-width: 0;
}

.brand-title {
  margin: 0;
  color: #1a1a1c;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 3px;
}

.brand-sub {
  margin: 4px 0 0;
  color: #6b6459;
  font-size: 12px;
  letter-spacing: 1px;
}

.login-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(26, 26, 28, 0.06);
  color: #6b6459;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.login-close:hover {
  background: rgba(26, 26, 28, 0.12);
  color: #1a1a1c;
}

.login-body {
  padding: 20px 24px 22px;
  background: #ffffff;
}

.login-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.login-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.login-actions :deep(.el-button) {
  flex: 1;
}

:deep(.el-dialog) {
  padding: 0;
  border: none; /* 压掉 index.css 的 1px var(--floatBorderColor) 灰描边 */
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(26, 26, 28, 0.18);
}

:deep(.el-dialog__body) {
  padding: 0;
}

/* —— 输入面板：钉死预览数值，压过 assets/styles/index.css 的全局硬覆盖 ——
   该文件给 `input.el-input__inner` 刷主题底色（--inputBgColor，浅色主题
   #f3f3f3），并让 `.el-button--primary` 走 --buttonPrimaryBgColor（=主题色，
   当前是绿）而非 --el-color-primary；另外 focus 环用 --themeColor、
   form-item 间距/label 字号取 Element Plus 默认值。上面重设 --el-* 变量对
   这些规则一律无效，必须用更高优先级 + !important 逐条压掉。目标态 =
   login-dialog-preview.html：38px 控件 / 8px 圆角 / 13px 标签 / 纯白底 /
   墨黑主按钮 / 16px 项间距。 */
.login-body :deep(.el-form-item) {
  margin-bottom: 16px;
}

.login-body :deep(.el-form-item__label) {
  padding: 0;
  margin-bottom: 6px;
  color: #4a463e;
  font-size: 13px;
  line-height: 1.4;
}

.login-body :deep(.el-input__wrapper),
.login-body :deep(.el-select__wrapper) {
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid #e2ddd1;
  border-radius: 8px;
  background: #ffffff !important;
  box-shadow: none !important;
}

.login-body :deep(.el-input__wrapper.is-focus),
.login-body :deep(.el-input.is-focus .el-input__wrapper),
.login-body :deep(.el-select__wrapper.is-focused) {
  border-color: #1a1a1c;
  box-shadow: 0 0 0 3px rgba(26, 26, 28, 0.08) !important;
}

.login-body :deep(input.el-input__inner) {
  height: 36px;
  border: none !important;
  background: transparent !important;
  color: #1a1a1c;
  font-size: 14px;
}

.login-body :deep(.el-input__prefix),
.login-body :deep(.el-select__placeholder) {
  color: #9a9489;
  font-size: 14px;
}

.login-actions :deep(.el-button) {
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 14px;
}

.login-actions :deep(.el-button:not(.el-button--primary)),
.login-actions :deep(.el-button:not(.el-button--primary):hover),
.login-actions :deep(.el-button:not(.el-button--primary):focus) {
  color: #1a1a1c !important;
  background: #ffffff !important;
  border: 1px solid #e2ddd1 !important;
  box-shadow: none !important;
}

.login-actions :deep(.el-button:not(.el-button--primary):hover) {
  background: #f6f4ee !important;
}

.login-actions :deep(.el-button--primary),
.login-actions :deep(.el-button--primary:focus),
.login-actions :deep(.el-button--primary:hover),
.login-actions :deep(.el-button--primary:active) {
  color: #ffffff !important;
  background: #1a1a1c !important;
  border: 1px solid #1a1a1c !important;
  box-shadow: none !important;
}

.login-actions :deep(.el-button--primary:hover) {
  background: #3d3d42 !important;
  border-color: #3d3d42 !important;
}

.login-actions :deep(.el-button--primary:active) {
  background: #101012 !important;
  border-color: #101012 !important;
}
</style>

<style>
/* select 下拉面板被 teleport 到 body，拿不到 .login-card 上的局部变量。 */
.wenlan-login-popper.el-popper {
  --el-bg-color-overlay: #ffffff;
  --el-text-color-regular: #4a463e;
  --el-text-color-primary: #1a1a1c;
  --el-border-color-light: #eae5da;
  --el-fill-color-light: #f6f4ee;
  --el-color-primary: #1a1a1c;
  background: #ffffff;
  color: #1a1a1c;
}
</style>
