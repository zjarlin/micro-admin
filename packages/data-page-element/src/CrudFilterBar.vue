<script setup lang="ts">
// 查询栏：schema.query → 输入/下拉 + 查询/重置。
//
// 解释性文字不进正文；条件说明统一走字段的 `help`（问号浮层）。
// 配了 `vibe.code` 的条件走活元素，默认行为是「写回过滤值并立即查询」。
import { Search } from '@element-plus/icons-vue'
import type { QuerySchema } from '@zjarlin/data-page'
import type { FieldOption } from '@zjarlin/data-page'
import { vibeScopeData } from '@zjarlin/data-page'
import VibeElement from './VibeElement.vue'
import { useVibeHost, vibeHandlers, type VibeHandler } from './vibe'

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

const host = useVibeHost()

function optionsOf(item: QuerySchema, dict?: (type: string) => FieldOption[]): FieldOption[] {
  if (item.options?.length) return item.options
  if (item.dict && dict) return dict(item.dict)
  return []
}

/** 自定义查询控件的取值：`value` / `options` / `filters` 都能直接用。 */
function dataOf(item: QuerySchema): Record<string, unknown> {
  return vibeScopeData(item.vibe, {
    value: props.filters[item.prop],
    filters: props.filters,
    label: item.placeholder ?? item.prop,
    options: optionsOf(item, props.dict),
  })
}

function handlersOf(item: QuerySchema): Record<string, VibeHandler> {
  return vibeHandlers(item.vibe, host, {}, {
    change: (payload) => {
      props.filters[item.prop] = payload === null || payload === undefined ? '' : String(payload)
      emit('search')
    },
  })
}
</script>

<template>
  <div class="filter-bar">
    <template v-for="item in query" :key="item.prop">
      <div
        v-if="item.vibe?.code"
        class="filter-vibe"
        :style="item.width ? { width: `${item.width}px` } : undefined"
      >
        <VibeElement :vibe="item.vibe" :data="dataOf(item)" :handlers="handlersOf(item)" />
      </div>
      <el-select
        v-else-if="item.control === 'select'"
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

<style scoped>
.filter-vibe { min-width: 0; }
</style>
