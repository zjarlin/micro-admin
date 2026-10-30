<script setup lang="ts">
// 泛化列表页壳：schema → 查询栏 + 表格 + 分页 + 行操作 +（可选）左树 + 表单弹窗。
//
// 一份 schema 同时覆盖两种页面形态：
// - 没有 `schema.tree`：普通「筛选 + 分页表 + 弹窗增删改」；
// - 有 `schema.tree`：左树右表，选中节点写入列表查询参数。
//
// 页面只提供数据来源（http / 权限 / 字典），不重复写表格与弹窗。
import { computed, onMounted } from 'vue'
import { Download, Plus } from '@element-plus/icons-vue'
import type { CrudPageSchema, DataTransport, FieldOption, Row } from '@addzero/data-page'
import { resolveTransport } from './transport'
import { defaultActions, resolveActions, type Notifier } from '@addzero/data-page'
import { usePage } from '@addzero/data-page'
import { useFormDialog } from '@addzero/data-page'
import { useTree } from '@addzero/data-page'
import { useReferences } from '@addzero/data-page'
import { elementNotifier } from './notifier'
import CrudColumn from './CrudColumn.vue'
import CrudFilterBar from './CrudFilterBar.vue'
import CrudFormDialog from './CrudFormDialog.vue'
import CrudTreePanel from './CrudTreePanel.vue'
import HelpHint from './HelpHint.vue'

const props = defineProps<{
  schema: CrudPageSchema
  /** 权限判定；缺省视为全部允许（纯展示页）。 */
  can?: ((permission?: string) => boolean) | undefined
  /** 通知实现，缺省用 Element Plus。 */
  notifier?: Notifier | undefined
  /** 传输实现；缺省用宿主 provide 的那一个。 */
  transport?: DataTransport | undefined
  /** 字典解析：`dict` 语义的列与查询条件使用。 */
  dictLabel?: ((type: string, value: unknown) => string | undefined) | undefined
  dictOptions?: ((type: string) => FieldOption[]) | undefined
}>()

const emit = defineEmits<{
  (event: 'detail', row: Row): void
}>()

defineSlots<Record<string, (props: { row: Row; value: unknown }) => unknown>>()

const http = resolveTransport(props.transport)
const can = (permission?: string): boolean => props.can ? props.can(permission) : true
const notifier = props.notifier ?? elementNotifier

const page = usePage<Row>(http, props.schema)

const form = useFormDialog(http, props.schema, {
  onSaved: () => page.load(),
})

// 左树选中值由 `usePage` 的初始 filters 统一维护，这里只负责写入并触发查询。
const tree = props.schema.tree
  ? useTree<Row>(http, props.schema.tree, (row) => {
      const param = props.schema.tree?.param
      if (!param) return
      page.setFilter(param, row ? String(row[props.schema.tree?.idProp ?? 'id'] ?? '') : '')
    })
  : null

// 外键列与下拉选项来自其它资源端点，一次取数、多处复用。
const refs = useReferences(http, props.schema)

onMounted(() => {
  void page.load()
  void tree?.load()
  void refs.load()
})

const actions = computed(() => resolveActions(http, defaultActions(props.schema.actions), {
  openCreate: (seed) => form.openCreate(seed),
  openEdit: (row) => form.openEdit(row),
  openDetail: (row) => emit('detail', row),
  reload: () => page.load(),
  can,
  notifier,
  endpoint: props.schema.endpoint,
  rowKey: props.schema.rowKey ?? 'id',
}))

const canAdd = computed(() => {
  if (!props.schema.fields?.length) return false
  const permission = props.schema.permissions?.add
  return can(permission)
})

const canExport = computed(() => {
  if (!props.schema.exportable) return false
  return can(props.schema.permissions?.export)
})

const entity = computed(() => props.schema.entity ?? '记录')

/** 操作列宽度按动作数量推算，避免 `width="auto"` 把按钮挤成多行。 */
const actionsWidth = computed(() => Math.max(96, actions.value.length * 56 + 24))
const rowKey = computed(() => props.schema.rowKey ?? 'id')

/** 导出 CSV：列定义即表头，避免每页手写一份。 */
function exportCsv(): void {
  const columns = props.schema.columns
  const header = columns.map((column) => column.label).join(',')
  const body = page.rows
    .map((row) => columns.map((column) => {
      const value = row[column.prop]
      const text = value === null || value === undefined ? '' : String(value)
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }).join(','))
    .join('\n')
  const blob = new Blob([`\uFEFF${header}\n${body}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${props.schema.key}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

function disabledOf(action: ReturnType<typeof resolveActions>[number], row: Row): boolean {
  return action.disabled(row)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="crud-head">
        <h1>{{ schema.title }}<HelpHint :text="schema.description" :label="schema.title" /></h1>
      </div>
      <div class="page-actions">
        <el-button v-if="canExport" :icon="Download" @click="exportCsv">导出</el-button>
        <el-button v-if="canAdd" type="primary" :icon="Plus" @click="form.openCreate()">新增{{ entity }}</el-button>
      </div>
    </header>

    <el-alert v-if="page.error" type="error" :title="page.error" :closable="false" show-icon />

    <div class="crud-layout" :class="{ 'has-side': tree }">
      <CrudTreePanel
        v-if="tree && schema.tree"
        :schema="schema.tree"
        :nodes="tree.nodes"
        :loading="tree.loading"
        :selected-id="tree.selectedId"
        :keyword="tree.keyword"
        :expanded-keys="tree.expandedKeys"
        @select="tree.select"
        @keyword="tree.setKeyword"
      />

      <section class="panel">
        <CrudFilterBar
          v-if="schema.query?.length"
          :query="schema.query"
          :filters="page.filters"
          :loading="page.loading"
          :dict="dictOptions"
          @search="page.search"
          @reset="page.reset"
        >
          <span class="muted">共 {{ page.total }} 条</span>
        </CrudFilterBar>

        <el-table v-loading="page.loading" :data="page.rows" :row-key="rowKey">
          <CrudColumn
            v-for="column in schema.columns"
            :key="column.prop"
            :column="column"
            :dict="dictLabel"
            :resolve="refs.resolveOf"
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
                  :disabled="disabledOf(action, row)"
                  @click="action.run(row)"
                >
                  {{ action.schema.label }}
                </el-button>
              </template>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="`没有匹配的${entity}`" :image-size="64" />
          </template>
        </el-table>

        <div class="table-footer">
          <el-pagination
            v-model:current-page="page.currentPage"
            v-model:page-size="page.currentSize"
            :total="page.total"
            layout="total, sizes, prev, pager, next"
            :page-sizes="[10, 20, 50]"
          />
        </div>
      </section>
    </div>

    <CrudFormDialog
      v-if="schema.fields?.length"
      :schema="schema"
      :state="form"
      :options-of="refs.optionsOf"
      @saved="page.load"
    />
  </div>
</template>

<style scoped>
/* 关键：grid 子项默认 min-width:auto，表格的最小内容宽度会把卡片顶出内容区，
   于是在右栏打开/中栏变窄时表格「压到」右栏上。这里统一把 min-width 归零，
   让宽度由可用空间决定、由 el-table 自己的横向滚动承接。 */
.crud-layout { display: grid; gap: 16px; align-items: start; min-width: 0; }
.crud-layout > * { min-width: 0; }
.crud-layout.has-side { grid-template-columns: 240px minmax(0, 1fr); }
.crud-layout .panel { min-width: 0; overflow: hidden; }
.crud-head { display: flex; align-items: center; gap: 6px; }
/* 行操作换行、固定列底色与分隔线都在 table-shell.css 里统一定义，
   树表（TreePage）与普通列表页共用同一份，不要在组件里再写一遍。 */
.crud-head h1 { display: inline-flex; align-items: center; gap: 4px; }
@media (max-width: 900px) { .crud-layout.has-side { grid-template-columns: 1fr; } }
</style>
