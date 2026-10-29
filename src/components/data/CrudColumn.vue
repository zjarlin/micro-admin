<script setup lang="ts">
// 列渲染：把 schema 的一列翻成 el-table-column，单元格语义交给 CellValue。
import type { ColumnSchema, Row } from '@/shared/data/schema'
import CellValue from './CellValue.vue'
import HelpHint from './HelpHint.vue'

const props = defineProps<{
  column: ColumnSchema
  dict?: ((type: string, value: unknown) => string | undefined) | undefined
  /** 外键列解析：本列存 id、展示名。 */
  resolve?: ((column: ColumnSchema, row: Row) => string | undefined) | undefined
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()
</script>

<template>
  <el-table-column
    :prop="column.prop"
    :label="column.label"
    :width="column.width"
    :min-width="column.minWidth"
    :fixed="column.fixed"
    :align="column.align"
    :show-overflow-tooltip="column.showOverflowTooltip ?? true"
  >
    <template #header>
      <span class="crud-column__head">
        {{ column.label }}<HelpHint :text="column.help" :label="column.label" />
      </span>
    </template>
    <template #default="{ row }">
      <CellValue :column="column" :row="row" :dict="dict" :resolved="resolve?.(props.column, row)">
        <template v-for="name in [column.slot ?? column.prop]" #[name]="slotProps">
          <slot :name="name" v-bind="slotProps" />
        </template>
      </CellValue>
    </template>
  </el-table-column>
</template>

<style scoped>
.crud-column__head { display: inline-flex; align-items: center; }
</style>
