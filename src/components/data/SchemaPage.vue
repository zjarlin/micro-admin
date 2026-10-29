<script setup lang="ts">
// 按 key 从后端取 schema 再渲染：页面文件里只剩「key + 权限 + 字典」。
//
// 这是「原型图画好、代码即可上线」的落点：新页面不需要新建 .vue，
// 在服务端登记一份 schema 就出现在后台里。
import { onMounted, ref, shallowRef } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { createSchemaClient } from '@/shared/data/schema-client'
import type { CrudPageSchema, FieldOption, Row } from '@/shared/data/schema'
import CrudPage from './CrudPage.vue'
import TreePage from './TreePage.vue'

const props = defineProps<{
  /** 后端 schema 的 key。 */
  pageKey: string
  /** 形态：普通列表页，或树表页。 */
  mode?: 'crud' | 'tree'
  can?: ((permission?: string) => boolean) | undefined
  dictLabel?: ((type: string, value: unknown) => string | undefined) | undefined
  dictOptions?: ((type: string) => FieldOption[]) | undefined
  /** schema 接口前缀，缺省 `/ui/pages`。 */
  basePath?: string
}>()

const emit = defineEmits<{
  (event: 'detail', row: Row): void
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()

const http = useService<HttpClient>('http')
const schema = shallowRef<CrudPageSchema | null>(null)
const version = ref<number | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

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
      v-else-if="schema && mode === 'tree'"
      :schema="schema"
      :can="can"
      :dict-label="dictLabel"
      @detail="emit('detail', $event)"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </TreePage>
    <CrudPage
      v-else-if="schema"
      :schema="schema"
      :can="can"
      :dict-label="dictLabel"
      :dict-options="dictOptions"
      @detail="emit('detail', $event)"
    >
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps" />
      </template>
    </CrudPage>
  </div>
</template>
