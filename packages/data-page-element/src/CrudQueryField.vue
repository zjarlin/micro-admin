<script setup lang="ts">
// 单个查询控件：schema 的一条 `QuerySchema` → 输入框 / 下拉框（或活模板）。
//
// 单独成组件而不是写死在查询栏里：设计器画布要按元素矩形逐个渲染同一个控件，
// 「画布上看到的输入框」与「运行页上的输入框」必须是同一份实现，否则就是两套视觉。
import { Search } from '@element-plus/icons-vue'
import type { FieldOption, QuerySchema } from '@zjarlin/data-page'
import { vibeScopeData } from '@zjarlin/data-page'
import VibeElement from './VibeElement.vue'
import { useVibeHost, vibeHandlers, type VibeHandler } from './vibe'

const props = defineProps<{
  query: QuerySchema
  /** 当前过滤值（`v-model` 语义由父级持有）。 */
  value?: string | undefined
  filters?: Record<string, string> | undefined
  dict?: ((type: string) => FieldOption[]) | undefined
}>()

const emit = defineEmits<{
  /** 值变化：输入即写回，下拉选中即查询。 */
  (event: 'change', value: string): void
  (event: 'search'): void
}>()

const host = useVibeHost()

function optionsOf(): FieldOption[] {
  if (props.query.options?.length) return props.query.options
  if (props.query.dict && props.dict) return props.dict(props.query.dict)
  return []
}

function dataOf(): Record<string, unknown> {
  return vibeScopeData(props.query.vibe, {
    value: props.value,
    filters: props.filters ?? {},
    label: props.query.placeholder ?? props.query.prop,
    options: optionsOf(),
  })
}

function handlersOf(): Record<string, VibeHandler> {
  return vibeHandlers(props.query.vibe, host, {}, {
    change: (payload) => {
      emit('change', payload === null || payload === undefined ? '' : String(payload))
      emit('search')
    },
  })
}

const widthStyle = () => (props.query.width ? { width: `${props.query.width}px` } : undefined)
</script>

<template>
  <div v-if="query.vibe?.code" class="crud-query__vibe" :style="widthStyle()">
    <VibeElement :vibe="query.vibe" :data="dataOf()" :handlers="handlersOf()" />
  </div>
  <el-select
    v-else-if="query.control === 'select'"
    :model-value="value ?? ''"
    :placeholder="query.placeholder ?? '全部'"
    :style="widthStyle()"
    clearable
    @update:model-value="emit('change', $event ?? ''); emit('search')"
  >
    <el-option v-for="option in optionsOf()" :key="String(option.value)" :label="option.label" :value="option.value" />
  </el-select>
  <el-input
    v-else
    :model-value="value ?? ''"
    :placeholder="query.placeholder ?? '搜索'"
    :prefix-icon="Search"
    :style="widthStyle()"
    clearable
    @update:model-value="emit('change', $event)"
    @keyup.enter="emit('search')"
    @clear="emit('change', ''); emit('search')"
  />
</template>

<style scoped>
/* 活模板控件按列宽排布，不撑破查询栏。 */
.crud-query__vibe { min-width: 0; }
</style>
