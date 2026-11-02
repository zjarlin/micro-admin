<script setup lang="ts">
// JSON 对象字段：网关私有开关这类「结构不定」的配置。
// 失焦/输入时就校验，错误留在字段下方；解析失败不覆盖已保存值。
import { ref, watch } from 'vue'
import { canonical } from '@/shared/values'

const props = defineProps<{ modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function format(value: unknown): string {
  if (value === undefined || value === null) return '{}'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '{}'
  }
}

const text = ref(format(props.modelValue))
const error = ref('')

/** 外部值（重新读取 / 恢复默认）换了才覆盖输入框，避免打断正在编辑的文本。 */
watch(
  () => props.modelValue,
  (value) => {
    let current: unknown
    try {
      current = JSON.parse(text.value)
    } catch {
      current = undefined
    }
    if (canonical(current) === canonical(value)) return
    text.value = format(value)
    error.value = ''
  },
)

function update(raw: string): void {
  text.value = raw
  if (!raw.trim()) {
    error.value = ''
    emit('update:modelValue', {})
    return
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      error.value = '需要一个 JSON 对象，例如 {"enable_thinking": false}'
      return
    }
    error.value = ''
    emit('update:modelValue', parsed)
  } catch (issue) {
    error.value = issue instanceof Error ? `JSON 解析失败：${issue.message}` : 'JSON 解析失败'
  }
}
</script>

<template>
  <div class="setting-json">
    <el-input :model-value="text" type="textarea" :rows="3" class="is-mono" @update:model-value="update" />
    <p v-if="error" class="setting-json__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.setting-json { width: 100%; }
.setting-json__error { margin: 6px 0 0; font-size: 11.5px; color: var(--el-color-danger); }
.is-mono :deep(textarea) { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
