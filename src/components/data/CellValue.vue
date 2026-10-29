<script setup lang="ts">
// 单元格渲染：把 schema 的 `cell` 语义翻成具体元素。
//
// 缺省 `text`；`custom` 交回宿主页面的具名插槽，保证特殊单元格仍有逃生舱。
import { computed } from 'vue'
import { formatDateTime } from '@/shared/format'
import type { ColumnSchema, Row } from '@/shared/data/schema'

const props = defineProps<{
  column: ColumnSchema
  row: Row
  /** 字典解析：`dict` 语义用，宿主注入。 */
  dict?: ((type: string, value: unknown) => string | undefined) | undefined
  /** 已解析的展示值（外键列由 `resolveFrom` 解析后传入），优先于原始值。 */
  resolved?: string | undefined
}>()

const raw = computed(() => props.row[props.column.prop])

const text = computed(() => {
  if (props.resolved !== undefined && props.resolved !== '') return props.resolved
  const value = raw.value
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
})

const tag = computed(() => {
  const map = props.column.tagMap
  if (!map) return null
  return map[String(raw.value ?? '')] ?? null
})

const dictLabel = computed(() => {
  if (props.column.cell !== 'dict' || !props.column.dict) return null
  return props.dict?.(props.column.dict, raw.value) ?? null
})

const datetime = computed(() => {
  const value = raw.value
  if (value === null || value === undefined || value === '') return '-'
  return formatDateTime(value as string | number | Date)
})
</script>

<template>
  <slot v-if="column.cell === 'custom'" :name="column.slot ?? column.prop" :row="row" :value="raw" />
  <code v-else-if="column.cell === 'code'" class="mono">{{ text }}</code>
  <el-tag v-else-if="column.cell === 'status' || column.cell === 'tagMap'" :type="tag?.tone ?? 'info'" size="small">
    {{ tag?.label ?? text }}
  </el-tag>
  <span v-else-if="column.cell === 'datetime'">{{ datetime }}</span>
  <span v-else-if="column.cell === 'dict'">{{ dictLabel ?? text }}</span>
  <span v-else-if="column.cell === 'link'" class="cell-link">{{ text }}</span>
  <span v-else>{{ text }}</span>
</template>

<style scoped>
.cell-link { color: #4f46e5; }
</style>
