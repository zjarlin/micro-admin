<script setup lang="ts">
// 列渲染：把 schema 的一列翻成 el-table-column，单元格语义交给 CellValue。
//
// 配了 `vibe.code` 的列走活元素（VibeElement），否则走内置单元格语义——
// 同一个槽位的两种画法，表头、宽度、固定列、排序全部共用。
import type { ColumnSchema, Row } from '@zjarlin/data-page'
import { vibeScopeData } from '@zjarlin/data-page'
import CellValue from './CellValue.vue'
import HelpHint from './HelpHint.vue'
import VibeElement from './VibeElement.vue'
import { useVibeHost, vibeHandlers, type VibeHandler } from './vibe'

const props = defineProps<{
  column: ColumnSchema
  dict?: ((type: string, value: unknown) => string | undefined) | undefined
  /** 外键列解析：本列存 id、展示名。 */
  resolve?: ((column: ColumnSchema, row: Row) => string | undefined) | undefined
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()

const host = useVibeHost()

/** 单元格模板作用域：`value` / `row` / `label` 直接用，通道值按绑定补。 */
function dataOf(row: Row): Row {
  const value = row[props.column.prop]
  return vibeScopeData(props.column.vibe, { value, row, label: props.column.label })
}

/** 单元格默认点击是「看详情」；元素声明了 click 动作则以动作为准。 */
function handlersOf(row: Row): Record<string, VibeHandler> {
  return vibeHandlers(props.column.vibe, host, row, {
    click: () => host?.openDetail?.(row),
  })
}
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
      <VibeElement
        v-if="column.vibe?.code"
        :vibe="column.vibe"
        :data="dataOf(row)"
        :handlers="handlersOf(row)"
      />
      <CellValue v-else :column="column" :row="row" :dict="dict" :resolved="resolve?.(props.column, row)">
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
