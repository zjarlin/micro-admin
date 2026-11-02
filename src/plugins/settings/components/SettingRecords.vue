<script setup lang="ts">
// 记录列表字段：脱敏规则、按路径指令这类「一行一条记录」的配置。
// 列定义复用 SettingField，因此行内也能有文本/文本域/开关/下拉/数字。
import { Plus, Delete } from '@element-plus/icons-vue'
import type { SettingField } from '@/kernel'

const props = defineProps<{
  modelValue: Array<Record<string, unknown>>
  columns: SettingField[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Array<Record<string, unknown>>] }>()

function setCell(index: number, key: string, value: unknown): void {
  const rows = props.modelValue.map((row, position) => (position === index ? { ...row, [key]: value } : row))
  emit('update:modelValue', rows)
}

function remove(index: number): void {
  emit('update:modelValue', props.modelValue.filter((_, position) => position !== index))
}

function add(): void {
  const row: Record<string, unknown> = {}
  for (const column of props.columns) {
    row[column.key] = column.type === 'switch' ? true : column.type === 'number' ? (column.min ?? 0) : ''
  }
  emit('update:modelValue', [...props.modelValue, row])
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}
</script>

<template>
  <div class="setting-records">
    <div class="setting-records__scroll">
      <div class="setting-records__grid" :style="{ gridTemplateColumns: `repeat(${columns.length}, minmax(90px, 1fr)) 40px` }">
        <div v-for="column in columns" :key="`head-${column.key}`" class="setting-records__head">{{ column.label }}</div>
        <span></span>

        <template v-for="(row, index) in modelValue" :key="index">
          <div v-for="column in columns" :key="`${index}-${column.key}`" class="setting-records__cell">
            <el-switch
              v-if="column.type === 'switch'"
              :model-value="Boolean(row[column.key])"
              @update:model-value="(value: string | number | boolean) => setCell(index, column.key, Boolean(value))"
            />
            <el-input-number
              v-else-if="column.type === 'number'"
              :model-value="Number(row[column.key] ?? 0)"
              :min="column.min"
              :max="column.max"
              :step="column.step"
              controls-position="right"
              style="width: 100%"
              @update:model-value="(value: number | undefined) => setCell(index, column.key, value ?? 0)"
            />
            <el-select
              v-else-if="column.type === 'select'"
              :model-value="textOf(row[column.key])"
              style="width: 100%"
              @update:model-value="(value: string) => setCell(index, column.key, value)"
            >
              <el-option v-for="option in column.options ?? []" :key="String(option.value)" :label="option.label" :value="option.value" />
            </el-select>
            <el-input
              v-else-if="column.type === 'textarea'"
              type="textarea"
              :rows="2"
              :model-value="textOf(row[column.key])"
              :placeholder="column.placeholder"
              @update:model-value="(value: string) => setCell(index, column.key, value)"
            />
            <el-input
              v-else
              :model-value="textOf(row[column.key])"
              :placeholder="column.placeholder"
              :class="{ 'is-mono': column.mono }"
              @update:model-value="(value: string) => setCell(index, column.key, value)"
            />
          </div>
          <el-button text type="danger" :icon="Delete" :aria-label="`删除第 ${index + 1} 条`" @click="remove(index)" />
        </template>
      </div>
    </div>
    <el-button text type="primary" :icon="Plus" class="setting-records__add" @click="add">添加一项</el-button>
  </div>
</template>

<style scoped>
.setting-records { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.setting-records__scroll { overflow-x: auto; }
.setting-records__grid { display: grid; gap: 6px; align-items: center; min-width: 420px; }
.setting-records__head { font-size: 11.5px; color: var(--muted); padding: 0 2px 2px; }
.setting-records__cell { min-width: 0; }
.setting-records__cell :deep(.el-input), .setting-records__cell :deep(.el-select) { width: 100%; }
.setting-records__add { align-self: flex-start; }
.is-mono :deep(input) { font-family: ui-monospace, monospace; font-size: 12px; }
</style>
