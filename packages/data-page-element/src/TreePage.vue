<script setup lang="ts">
// 树表页壳：部门/菜单这类层级数据，不分页，行内可「新增下级」。
//
// 与 CrudPage 共用同一份 schema 形状，只是把数据按 `tree` 声明组织成树再交给表格。
import { computed, onMounted } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import type { CrudPageSchema, DataTransport, Row } from '@addzero/data-page'
import { resolveTransport } from './transport'
import { useFormDialog } from '@addzero/data-page'
import { useTree } from '@addzero/data-page'
import { useReferences } from '@addzero/data-page'
import { defaultActions, resolveActions, type Notifier } from '@addzero/data-page'
import { elementNotifier } from './notifier'
import CrudColumn from './CrudColumn.vue'
import CrudFormDialog from './CrudFormDialog.vue'
import HelpHint from './HelpHint.vue'

const props = defineProps<{
  /** `schema.tree` 必填：树表的数据来源与层级规则。 */
  schema: CrudPageSchema
  /** 传输实现；缺省用宿主 provide 的那一个。 */
  transport?: DataTransport | undefined
  can?: ((permission?: string) => boolean) | undefined
  notifier?: Notifier | undefined
  dictLabel?: ((type: string, value: unknown) => string | undefined) | undefined
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()

const http = resolveTransport(props.transport)
const can = (permission?: string): boolean => props.can ? props.can(permission) : true
const notifier = props.notifier ?? elementNotifier

const treeSchema = props.schema.tree
if (!treeSchema) throw new Error(`${props.schema.key}: TreePage requires schema.tree`)

const tree = useTree<Row>(http, treeSchema)
const form = useFormDialog(http, props.schema, { onSaved: () => tree.load() })

const refs = useReferences(http, props.schema)

onMounted(() => {
  void tree.load()
  void refs.load()
})

/** 表格吃扁平行 + `children` 字段：直接投影，保留层级。 */
const tableRows = computed(() => toTableRows(tree.nodes))

function toTableRows(nodes: typeof tree.nodes): Row[] {
  return nodes.map((node) => ({
    ...node.raw,
    children: node.children.length ? toTableRows(node.children) : undefined,
  }))
}

/** 默认操作：编辑 + 新增下级（父级 id 预填）。 */
const actions = computed(() => resolveActions(http, defaultActions(props.schema.actions), {
  openCreate: (source) => {
    // 树表的「新增下级」：按 schema 的 parentProp 预填父级，不让用户手填 id。
    const parentProp = treeSchema.parentProp
    const parentId = source?.[treeSchema.idProp]
    if (parentProp && parentId !== undefined) form.openCreate({ [parentProp]: parentId })
    else form.openCreate()
  },
  openEdit: (row) => form.openEdit(row),
  reload: () => tree.load(),
  can,
  notifier,
  endpoint: props.schema.endpoint,
  rowKey: props.schema.rowKey ?? 'id',
}))

/** 操作列宽度按动作数量推算：`width="auto"` 在固定列上会被算成 0/内容宽，
 *  快速重排时容易抖动，显式宽度与 CrudPage 保持一致。 */
const actionsWidth = computed(() => Math.max(96, actions.value.length * 56 + 24))

const canAdd = computed(() => can(props.schema.permissions?.add))
const entity = computed(() => props.schema.entity ?? '记录')
/** 子节点字段名必须在 schema 里声明，否则「children」会被误读成业务字段。 */
const childrenProp = computed(() => treeSchema?.childrenProp ?? 'children')
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="crud-head">
        <h1>{{ schema.title }}<HelpHint :text="schema.description" :label="schema.title" /></h1>
      </div>
      <div class="page-actions">
        <el-button v-if="canAdd" type="primary" :icon="Plus" @click="form.openCreate()">新增{{ entity }}</el-button>
      </div>
    </header>

    <el-alert v-if="tree.error" type="error" :title="tree.error" :closable="false" show-icon />

    <section class="panel">
      <el-table
        v-loading="tree.loading"
        :data="tableRows"
        :row-key="schema.rowKey ?? 'id'"
        default-expand-all
        :tree-props="{ children: childrenProp }"
      >
        <CrudColumn
          v-for="column in schema.columns"
          :key="column.prop"
          :column="column"
          :dict="dictLabel"
        >
          <template v-for="name in [column.slot ?? column.prop]" #[name]="slotProps">
            <slot :name="name" v-bind="slotProps" />
          </template>
        </CrudColumn>
        <el-table-column
          v-if="actions.length"
          label="操作"
          fixed="right"
          :width="actionsWidth"
          class-name="crud-actions"
        >
          <template #default="{ row }">
            <template v-for="action in actions" :key="action.schema.key">
              <el-button
                v-if="action.visible(row)"
                link
                :type="action.schema.variant === 'danger' ? 'danger' : action.schema.variant === 'warning' ? 'warning' : 'primary'"
                :disabled="action.disabled(row)"
                @click="action.run(row)"
              >
                {{ action.schema.label }}
              </el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="`没有${entity}`" :image-size="64" />
        </template>
      </el-table>
    </section>

    <CrudFormDialog
      v-if="schema.fields?.length"
      :schema="schema"
      :state="form"
      :options-of="refs.optionsOf"
      @saved="tree.load"
    />
  </div>
</template>

<style scoped>
.page { min-width: 0; }
.crud-head { display: flex; align-items: center; gap: 6px; }
.crud-head h1 { display: inline-flex; align-items: center; gap: 4px; }
</style>
