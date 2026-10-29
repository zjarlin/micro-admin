<script setup lang="ts">
// 小问号提示：解释性文字统一收敛到这里，不摊在界面上占视觉层级。
// 可键盘到达（button + Enter/Space），浮层限制宽度并完整换行。
import { computed, ref } from 'vue'

const props = defineProps<{
  text?: string | undefined
  label?: string | undefined
}>()

const open = ref(false)
const shown = computed(() => Boolean(props.text?.trim()))
const ariaLabel = computed(() => props.label ? `查看${props.label}说明` : '查看说明')
</script>

<template>
  <el-tooltip
    v-if="shown"
    v-model:visible="open"
    :content="text"
    placement="top"
    :show-after="120"
    popper-class="help-hint-popper"
  >
    <button
      type="button"
      class="help-hint"
      :aria-label="ariaLabel"
      @blur="open = false"
      @keydown.esc="open = false"
    >
      ?
    </button>
  </el-tooltip>
</template>

<style scoped>
.help-hint {
  display: inline-grid; place-items: center;
  width: 14px; height: 14px; margin-left: 4px; padding: 0;
  border: 1px solid currentColor; border-radius: 50%;
  background: transparent; color: var(--muted); font-size: 9px; line-height: 1;
  cursor: help; opacity: .65; transition: opacity .15s, color .15s;
}
.help-hint:hover, .help-hint:focus-visible { opacity: 1; color: #6366f1; outline: none; }
</style>

<style>
.help-hint-popper { max-width: 320px !important; line-height: 1.6 !important; white-space: normal !important; }
</style>
