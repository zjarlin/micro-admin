<script setup lang="ts">
// 按 key 从后端取 schema 再渲染：页面文件里只剩「key + 权限 + 字典」。
//
// 这是「原型图画好、代码即可上线」的落点：新页面不需要新建 .vue，
// 在服务端登记一份 schema 就出现在后台里。
import { computed, onMounted, ref, shallowRef } from 'vue'
import { createSchemaClient } from '@zjarlin/data-page'
import { resolveTransport } from './transport'
import type { CrudPageSchema, DataTransport, FieldOption, Row } from '@zjarlin/data-page'
import CrudPage from './CrudPage.vue'
import TreePage from './TreePage.vue'

const props = defineProps<{
  /** 后端 schema 的 key。 */
  pageKey: string
  /** 覆盖 schema 的 `layout`；不传就按后端下发的那一份渲染。 */
  mode?: 'crud' | 'tree'
  can?: ((permission?: string) => boolean) | undefined
  /** 传输实现；缺省用宿主 provide 的那一个。 */
  transport?: DataTransport | undefined
  dictLabel?: ((type: string, value: unknown) => string | undefined) | undefined
  dictOptions?: ((type: string) => FieldOption[]) | undefined
  /** schema 接口前缀，缺省 `/ui/pages`。 */
  basePath?: string
  /** 活元素的跳转实现（`navigate` 动作），缺省用 `location.assign`。 */
  navigate?: ((path: string) => void) | undefined
}>()

const emit = defineEmits<{
  (event: 'detail', row: Row): void
  (event: 'vibe', payload: { channel: string; payload: unknown; row: Row }): void
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()

const http = resolveTransport(props.transport)
const schema = shallowRef<CrudPageSchema | null>(null)
const version = ref<number | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

/** 形态优先级：显式 `mode` prop > schema.layout > 有 tree 即左树右表。 */
const resolvedMode = computed<'crud' | 'tree'>(() => {
  if (props.mode === 'tree') return 'tree'
  if (props.mode === 'crud') return 'crud'
  return schema.value?.layout === 'tree-table' ? 'tree' : 'crud'
})

const client = createSchemaClient(http, {
  ...(props.basePath ? { basePath: props.basePath } : {}),
})

onMounted(async () => {
  loading.value = true
  try {
    schema.value = await client.load(props.pageKey)
    version.value = client.versionOf(props.pageKey)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <el-skeleton v-if="loading" :rows="8" animated />
    <el-alert
      v-else-if="error"
      type="error"
      :closable="false"
      show-icon
      :title="`页面配置读取失败：${error}`"
      :description="`请确认后端已登记 schema「${pageKey}」（GET ${basePath ?? '/ui/pages'}/${pageKey}）`"
    />
    <TreePage
      v-else-if="schema && resolvedMode === 'tree'"
      :schema="schema"
      :transport="transport"
      :can="can"
      :dict-label="dictLabel"
      :navigate="navigate"
      @detail="emit('detail', $event)"
      @vibe="emit('vibe', $event)"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </TreePage>
    <CrudPage
      v-else-if="schema"
      :schema="schema"
      :transport="transport"
      :can="can"
      :dict-label="dictLabel"
      :dict-options="dictOptions"
      :navigate="navigate"
      @detail="emit('detail', $event)"
      @vibe="emit('vibe', $event)"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </CrudPage>
  </div>
</template>
