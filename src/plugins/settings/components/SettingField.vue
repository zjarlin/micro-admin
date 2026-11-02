<script setup lang="ts">
// 单个设置字段的控件渲染器。
//
// 标签、星号、校验在系统设置页统一生成（同一个 `required` 声明），
// 这里只负责「什么类型画什么控件」，不持表单状态，也不写后端。
import { computed } from 'vue'
import type { SettingField, SettingValues } from '@/kernel'
import SettingJson from './SettingJson.vue'
import SettingRecords from './SettingRecords.vue'
import SettingTags from './SettingTags.vue'

const props = defineProps<{
  field: SettingField
  values: SettingValues
  modelValue: unknown
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const text = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
const numeric = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : undefined))
const bool = computed(() => Boolean(props.modelValue))
const tags = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.filter((item): item is string => typeof item === 'string') : []))
const records = computed(() =>
  Array.isArray(props.modelValue)
    ? props.modelValue.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [],
)

const placeholder = computed(() =>
  typeof props.field.placeholder === 'function' ? props.field.placeholder(props.values) : (props.field.placeholder ?? ''),
)

const disabled = computed(() =>
  typeof props.field.disabled === 'function' ? props.field.disabled(props.values) : Boolean(props.field.disabled),
)

function update(value: unknown): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <el-input
    v-if="field.type === 'text'"
    :model-value="text"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="{ 'is-mono': field.mono }"
    clearable
    @update:model-value="update"
  />

  <el-input
    v-else-if="field.type === 'secret'"
    :model-value="text"
    type="password"
    show-password
    :placeholder="placeholder"
    :disabled="disabled"
    autocomplete="new-password"
    @update:model-value="update"
  />

  <el-input
    v-else-if="field.type === 'textarea'"
    :model-value="text"
    type="textarea"
    :rows="field.rows ?? 3"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="{ 'is-mono': field.mono }"
    @update:model-value="update"
  />

  <el-input-number
    v-else-if="field.type === 'number'"
    :model-value="numeric"
    :min="field.min"
    :max="field.max"
    :step="field.step"
    :precision="field.precision"
    :disabled="disabled"
    controls-position="right"
    style="width: 100%"
    @update:model-value="(value: number | undefined) => update(value ?? field.min ?? 0)"
  />

  <el-switch
    v-else-if="field.type === 'switch'"
    :model-value="bool"
    :disabled="disabled"
    @update:model-value="(value: string | number | boolean) => update(Boolean(value))"
  />

  <el-select
    v-else-if="field.type === 'select'"
    :model-value="text"
    :placeholder="placeholder || '请选择'"
    :disabled="disabled"
    style="width: 100%"
    @update:model-value="update"
  >
    <el-option v-for="option in field.options ?? []" :key="String(option.value)" :label="option.label" :value="option.value" />
  </el-select>

  <div v-else-if="field.type === 'color'" class="setting-color">
    <el-color-picker :model-value="text" :disabled="disabled" @update:model-value="(value: string | null) => value && update(value)" />
    <el-input :model-value="text" :disabled="disabled" class="is-mono" @update:model-value="update" />
  </div>

  <SettingTags v-else-if="field.type === 'tags'" :model-value="tags" :placeholder="placeholder" @update:model-value="update" />

  <SettingRecords
    v-else-if="field.type === 'records'"
    :model-value="records"
    :columns="field.columns ?? []"
    @update:model-value="update"
  />

  <SettingJson v-else-if="field.type === 'json'" :model-value="modelValue" @update:model-value="update" />
</template>

<style scoped>
.setting-color { display: flex; align-items: center; gap: 8px; width: 100%; }
.setting-color :deep(.el-color-picker__trigger) { width: 26px; height: 26px; padding: 2px; }
.is-mono :deep(input), .is-mono :deep(textarea) { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
