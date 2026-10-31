<script setup lang="ts">
// 查询栏：schema.query → 一组查询控件 + 查询/重置。
//
// 每个控件都是 `CrudQueryField`（设计器画布也用它逐个渲染），
// 这里只负责把它们排成一行并给出按钮，不重复控件实现。
import type { FieldOption, QuerySchema } from '@zjarlin/data-page'
import CrudQueryField from './CrudQueryField.vue'

const props = defineProps<{
  query: QuerySchema[]
  filters: Record<string, string>
  loading?: boolean
  dict?: ((type: string) => FieldOption[]) | undefined
}>()

const emit = defineEmits<{
  (event: 'search'): void
  (event: 'reset'): void
}>()

function setValue(item: QuerySchema, value: string): void {
  props.filters[item.prop] = value
}
</script>

<template>
  <div class="filter-bar">
    <CrudQueryField
      v-for="item in query"
      :key="item.prop"
      :query="item"
      :value="filters[item.prop]"
      :filters="filters"
      :dict="dict"
      @change="setValue(item, $event)"
      @search="emit('search')"
    />
    <el-button type="primary" :loading="loading" @click="emit('search')">查询</el-button>
    <el-button @click="emit('reset')">重置</el-button>
    <slot />
  </div>
</template>
