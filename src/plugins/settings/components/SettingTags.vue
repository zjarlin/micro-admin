<script setup lang="ts">
// 字符串列表字段：路径白名单这类「多值但每条很短」的配置。
// 回车添加、点 x 删除，空串与重复项直接忽略——校验只在这一处做。
import { ref } from 'vue'

const props = defineProps<{ modelValue: string[]; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const draft = ref('')

function add(): void {
  const value = draft.value.trim()
  if (!value) return
  if (!props.modelValue.includes(value)) emit('update:modelValue', [...props.modelValue, value])
  draft.value = ''
}

function remove(value: string): void {
  emit('update:modelValue', props.modelValue.filter((item) => item !== value))
}
</script>

<template>
  <div class="setting-tags">
    <el-tag v-for="item in modelValue" :key="item" closable @close="remove(item)">{{ item }}</el-tag>
    <el-input
      v-model="draft"
      class="setting-tags__input"
      size="small"
      :placeholder="placeholder ?? '输入后回车添加'"
      @keyup.enter="add"
    />
  </div>
</template>

<style scoped>
.setting-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; }
.setting-tags__input { width: 180px; }
</style>
