<script setup lang="ts">
// 查询栏：schema.query → 输入/下拉 + 查询/重置。
//
// 解释性文字不进正文；条件说明统一走字段的 `help`（问号浮层）。
import { Search } from '@element-plus/icons-vue'
import type { QuerySchema } from '@addzero/data-page'
import type { FieldOption } from '@addzero/data-page'

defineProps<{
  query: QuerySchema[]
  filters: Record<string, string>
  loading?: boolean
  dict?: ((type: string) => FieldOption[]) | undefined
}>()

const emit = defineEmits<{
  (event: 'search'): void
  (event: 'reset'): void
}>()

function optionsOf(item: QuerySchema, dict?: (type: string) => FieldOption[]): FieldOption[] {
  if (item.options?.length) return item.options
  if (item.dict && dict) return dict(item.dict)
  return []
}
</script>

<template>
  <div class="filter-bar">
    <template v-for="item in query" :key="item.prop">
      <el-select
        v-if="item.control === 'select'"
        v-model="filters[item.prop]"
        :placeholder="item.placeholder ?? '全部'"
        :style="item.width ? { width: `${item.width}px` } : undefined"
        clearable
        @change="emit('search')"
      >
        <el-option v-for="option in optionsOf(item, dict)" :key="String(option.value)" :label="option.label" :value="option.value" />
      </el-select>
      <el-input
        v-else
        v-model="filters[item.prop]"
        :placeholder="item.placeholder ?? '搜索'"
        :prefix-icon="Search"
        :style="item.width ? { width: `${item.width}px` } : undefined"
        clearable
        @keyup.enter="emit('search')"
        @clear="emit('search')"
      />
    </template>
    <el-button type="primary" :loading="loading" @click="emit('search')">查询</el-button>
    <el-button @click="emit('reset')">重置</el-button>
    <slot />
  </div>
</template>
