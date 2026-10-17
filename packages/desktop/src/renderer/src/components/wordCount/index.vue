<template>
  <div class="word-count">
    <el-tooltip
      v-if="wordCount"
      popper-class="word-count-tooltip"
      placement="top-end"
    >
      <template #content>
        <div class="title-section">
          {{ selectionWordCount ? t('menu.counter.documentSelection') : t('menu.counter.document') }}
        </div>
        <div class="title-item">
          <span class="front">{{ t('menu.counter.words') }}:</span><span class="text">{{ formatCountPair('word') }}</span>
        </div>
        <div class="title-item">
          <span class="front">{{ t('menu.counter.characters') }}:</span><span class="text">{{ formatCountPair('character') }}</span>
        </div>
        <div class="title-item">
          <span class="front">{{ t('menu.counter.paragraphs') }}:</span><span class="text">{{ formatCountPair('paragraph') }}</span>
        </div>
        <div class="title-item">
          <span class="front">{{ t('menu.counter.allCharacters') }}:</span><span class="text">{{ formatCountPair('all') }}</span>
        </div>
      </template>
      <div
        class="word-count-badge"
        @click.stop="handleWordClick"
      >
        <span class="text-center-vertical">{{ wordCountText }}</span>
      </div>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileWordCount } from '@shared/types/files'

const props = defineProps<{
  wordCount?: FileWordCount | null
  selectionWordCount?: FileWordCount | null
}>()

const { t } = useI18n()

// Clicking cycles which metric the badge shows: W → P → C → A.
const ITEMS = ['word', 'paragraph', 'character', 'all'] as const
const SHORT_LABEL = {
  word: 'W',
  character: 'C',
  paragraph: 'P',
  all: 'A'
}

const show = ref<(typeof ITEMS)[number]>('word')

const wordCountText = computed(() => {
  if (!props.wordCount) return ''

  const value = props.wordCount[show.value]
  const selectionValue = props.selectionWordCount?.[show.value]
  return selectionValue == null
    ? `${SHORT_LABEL[show.value]} ${value}`
    : `${SHORT_LABEL[show.value]} ${value} / ${selectionValue}`
})

const formatCountPair = (key: keyof FileWordCount): number | string => {
  const value = props.wordCount?.[key] ?? 0
  const selectionValue = props.selectionWordCount?.[key]
  return selectionValue == null ? value : `${value} / ${selectionValue}`
}

const handleWordClick = (): void => {
  const index = ITEMS.indexOf(show.value)
  show.value = ITEMS[(index + 1) % ITEMS.length]!
}
</script>

<style scoped>
.word-count {
  display: flex;
  align-items: center;
}

.word-count-badge {
  cursor: pointer;
  font-size: 14px;
  color: var(--editorColor30);
  line-height: 24px;
  padding: 0 5px;
  box-sizing: border-box;
  transition: all 0.25s ease-in-out;

  & > .text-center-vertical {
    padding: 2px 5px;
    border-radius: 3px;
  }

  &:hover > span {
    background: var(--sideBarBgColor);
    color: var(--sideBarTitleColor);
  }
}

.text-center-vertical {
  display: inline-block;
  vertical-align: middle;
  line-height: normal;
}
</style>

<style>
/* The tooltip content is teleported to <body>, so it cannot be scoped. */
.title-section {
  font-weight: 600;
  margin: 2px 0 4px;
}

.title-item {
  height: 28px;
  line-height: 28px;

  & .front {
    opacity: 0.7;
  }

  & .text {
    margin-left: 10px;
  }
}
</style>
