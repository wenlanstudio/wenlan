<template>
  <div class="about-dialog">
    <el-dialog
      v-model="showAboutDialog"
      :show-close="false"
      :modal="true"
      custom-class="ag-dialog-table"
      width="400px"
    >
      <img
        class="logo"
        :src="WenlanIcon"
      >
      <el-row>
        <el-col :span="24">
          <h3 class="title">
            {{ name }}
          </h3>
        </el-col>
        <el-col :span="24">
          <div class="text">
            文览 · 一文多览
          </div>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ store.appVersion }}
          </div>
        </el-col>
        <el-col :span="24">
          <div
            class="text"
            style="min-height: auto"
          >
            {{ copyright }}
          </div>
        </el-col>
        <el-col :span="24">
          <div class="text">
            {{ copyrightContributors }}
          </div>
        </el-col>
        <el-col :span="24">
          <div class="acknowledgements">
            <div class="acknowledgements-title">
              特别鸣谢
            </div>
            <div
              v-for="line in acknowledgements"
              :key="line"
              class="acknowledgements-line"
            >
              {{ line }}
            </div>
          </div>
        </el-col>
      </el-row>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/store'
import bus from '../../bus'
import WenlanIcon from '../../assets/images/icon.png'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const name = '文览'
const copyright = t('about.copyright', { year: new Date().getFullYear() })
const copyrightContributors = t('about.copyrightContributors')
const acknowledgements = [
  '信阳师范大学计算机与信息技术学院',
  '数据科学与大数据技术专业2023级本科3-6班同学',
  '数据科学与大数据技术专业2024级本科全班同学',
  '软件专业2024级本科全班同学'
]
const showAboutDialog = ref(false)

const store = useMainStore()

const showDialog = () => {
  showAboutDialog.value = true
  bus.emit('editor-blur')
}

onMounted(() => {
  bus.on('aboutDialog', showDialog)
})

onBeforeUnmount(() => {
  bus.off('aboutDialog', showDialog)
})
</script>

<style>
.about-dialog el-row,
.about-dialog el-col {
  display: block;
}

.about-dialog img.logo {
  width: 80px;
  height: 80px;
  display: inherit;
  margin: 0 auto;
}

.about-dialog .title,
.about-dialog .text {
  min-height: 32px;
  text-align: center;
}

.about-dialog .title {
  color: var(--floatFontColor);
}

.about-dialog .text {
  color: var(--floatFontColor);
}

.about-dialog .acknowledgements {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--floatBorderColor, rgba(128, 128, 128, 0.3));
  color: var(--floatFontColor);
  text-align: center;
}

.about-dialog .acknowledgements-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.about-dialog .acknowledgements-line {
  font-size: 12px;
  line-height: 1.7;
  word-break: break-word;
}
</style>
