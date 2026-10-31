<script setup lang="ts">
// 表格主体：`schema.columns` → el-table + 行操作列。
//
// 三种调用方共用同一份像素与交互：
// - `CrudPage` / `TreePage`：真实数据 + 已解析动作；
// - 设计器画布：示例行（把图纸渲染成「上线后的样子」），动作列由插槽给出静态按钮。
// 因此画布上看到的表头、列宽、状态标签、操作列，与上线后完全一致。
import type { ColumnSchema, CrudPageSchema, Row } from '@zjarlin/data-page'
import CrudColumn from './CrudColumn.vue'

defineProps<{
  schema: CrudPageSchema
  rows: Row[]
  loading?: boolean
  rowKey?: string
  dict?: ((type: string, value: unknown) => string | undefined) | undefined
  resolve?: ((column: ColumnSchema, row: Row) => string | undefined) | undefined
  /** 有行操作时才出操作列；宽度由调用方按动作数量推算。 */
  hasActions?: boolean
  actionsWidth?: number
  entity?: string | undefined
  emptyImageSize?: number
}>()

// 列插槽带 `value`，操作列插槽只带 `row`，所以 `value` 声明为可选。
defineSlots<Record<string, (props: { row: Row; value?: unknown }) => unknown>>()

/** 列声明的具名插槽名，用于把宿主插槽原样透传给单元格。 */
function slotNamesOf(column: ColumnSchema): string[] {
  return [column.slot ?? column.prop]
}
</script>

<template>
  <el-table
    v-loading="loading ?? false"
    :data="rows"
    :row-key="rowKey ?? schema.rowKey ?? 'id'"
  >
    <CrudColumn
      v-for="column in schema.columns"
      :key="column.prop"
      :column="column"
      :dict="dict"
      :resolve="resolve"
    >
      <template v-for="name in slotNamesOf(column)" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </CrudColumn>
    <el-table-column
      v-if="hasActions"
      label="操作"
      fixed="right"
      :width="actionsWidth ?? 120"
      class-name="crud-actions"
    >
      <template #default="{ row }">
        <slot name="actions" :row="row" />
      </template>
    </el-table-column>
    <template #empty>
      <el-empty :description="`没有匹配的${entity ?? schema.entity ?? '记录'}`" :image-size="emptyImageSize ?? 64" />
    </template>
  </el-table>
</template>
