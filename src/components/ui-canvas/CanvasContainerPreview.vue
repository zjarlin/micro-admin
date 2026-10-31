<!-- 画布容器预览：把「表格 / 查询栏 / 表单 / 页头 / 左树 / 分页」这些容器
     渲染成运行期的同一个壳（CrudTable / CrudFilterBar / CrudFormField / CrudTreePanel）。
     容器里的子元素不再单独画框，而是**真的落在壳里**——所以画布上的表格
     有真表头、真状态标签、真操作列，查询栏有真输入框。
     子元素仍然可选中、可改属性（走左栏结构树与属性弹窗），只是不再重复画一遍。

     为什么页头/工具条/卡片不套壳：这些容器里的「标题文本 + 按钮」本身就是图纸元素，
     再套一层运行期页头会出现两个标题。它们走逐元素渲染（真文本 + 真按钮）。 -->
<script setup lang="ts">
import { computed } from 'vue'
import type {
  ActionSchema, ColumnSchema, CrudPageSchema, FieldSchema, QuerySchema, Row,
} from '@zjarlin/data-page'
import { effectiveProps, type UiElement, type UiElementFragment } from '@/shared/ui-canvas'
import CrudTable from '@zjarlin/data-page-element/CrudTable.vue'
import CrudFilterBar from '@zjarlin/data-page-element/CrudFilterBar.vue'
import CrudFormField from '@zjarlin/data-page-element/CrudFormField.vue'
import CrudTreePanel from '@zjarlin/data-page-element/CrudTreePanel.vue'

const props = defineProps<{
  /** 容器元素本身。 */
  element: UiElement
  /** 该容器直属子元素。 */
  children: UiElement[]
  /** 直属子元素的编译片段（按 elementId 取）。 */
  fragments: UiElementFragment[]
  entity?: string | undefined
  sampleRows: Row[]
}>()

const role = computed(() => props.element.role)

function fragmentOf(id: string): UiElementFragment | undefined {
  return props.fragments.find((item) => item.elementId === id)
}

/**
 * 取某类片段的 schema。
 *
 * 必须按 `kind` 过滤：列、查询、字段、动作都带 `schema`，只按「有没有 schema」取
 * 会把列当成按钮渲染（操作列里出现一串列名就是这么来的）。
 */
function schemasOfKind<T>(kind: UiElementFragment['kind']): T[] {
  return props.children
    .map((child) => fragmentOf(child.id))
    .filter((fragment): fragment is UiElementFragment => Boolean(fragment))
    .filter((fragment) => fragment.kind === kind)
    .map((fragment) => fragment.schema)
    .filter((schema): schema is NonNullable<typeof schema> => Boolean(schema)) as T[]
}

/** 容器内子元素的顺序沿用图纸几何（编译器已经按同一顺序排过 schema）。 */
const columns = computed<ColumnSchema[]>(() => schemasOfKind<ColumnSchema>('column'))
const queries = computed<QuerySchema[]>(() => schemasOfKind<QuerySchema>('query'))
const fields = computed<FieldSchema[]>(() => schemasOfKind<FieldSchema>('field'))
const actions = computed<ActionSchema[]>(() => schemasOfKind<ActionSchema>('action'))


/** 表格壳用的 schema：只填壳会读到的字段，不伪造接口。 */
/** 表格壳用的 schema：只填壳会读到的字段，不伪造接口（`endpoint` 空串即「预览」）。 */
const tableSchema = computed<CrudPageSchema>(() => ({
  key: 'canvas.preview',
  title: '',
  endpoint: '',
  columns: columns.value,
  ...(props.entity ? { entity: props.entity } : {}),
}))

/** 行操作列的宽度与运行页同算法，按钮数量决定宽度。 */
const actionsWidth = computed(() => Math.max(96, actions.value.length * 56 + 24))

/** 表单控件的预览模型：用字段默认值，不提交任何东西。 */
const fieldModel = computed<Record<string, unknown>>(() => {
  const model: Record<string, unknown> = {}
  for (const field of fields.value) model[field.prop] = field.default ?? null
  return model
})

/** 表单标签宽度按容器宽度收敛（窄容器不把控件挤没）。 */
const labelWidth = computed(() => (props.element.rect.width < 420 ? '64px' : '96px'))

/**
 * 左树预览节点：画布不取数，但空树看不出结构。
 *
 * 用图纸的 `treeEndpointOf` 与实体名合成两级示例树，让设计师看清真实树面板的
 * 缩进、搜索框、选中态与宽度——「所见即所得」对空数据也要成立。
 */
/** `CrudTreePanel` 要的是 `TreeNode`（`raw` + `children`），不是裸行。 */
type PreviewNode = { raw: Record<string, unknown>; children: PreviewNode[] }
const makeNode = (name: string, children: PreviewNode[] = []): PreviewNode => ({
  raw: { id: name, name, parentId: null },
  children,
})

const treeNodes = computed<PreviewNode[]>(() => {
  const rootName = String(effectiveProps(props.element).label ?? '') || '组织'
  return [
    makeNode(`${rootName} A`, [makeNode(`${rootName} A-1`), makeNode(`${rootName} A-2`)]),
    makeNode(`${rootName} B`),
  ]
})

const treeSchema = computed(() => {
  const scope = effectiveProps(props.element)
  return {
    endpoint: String(scope.treeEndpointOf ?? ''),
    idProp: 'id',
    labelProp: 'name',
    param: String(scope.treeParam ?? 'id'),
    allLabel: '全部',
    searchable: true,
  }
})

</script>

<template>
  <!-- 查询栏：真输入框 / 真下拉 + 真查询按钮。 -->
  <div v-if="role === 'filter'" class="cc-filter">
    <CrudFilterBar :query="queries" :filters="{}" @search="() => {}" @reset="() => {}" />
  </div>

  <!-- 列表：真表头 + 真单元格（状态标签、时间格式、外键解析全部走 CellValue）。 -->
  <div v-else-if="role === 'table'" class="cc-table">
    <CrudTable
      :schema="tableSchema"
      :rows="sampleRows"
      :has-actions="actions.length > 0"
      :actions-width="actionsWidth"
      :entity="entity ?? '记录'"
    >
      <template #actions>
        <span class="cc-row-actions">
          <el-button
            v-for="action in actions"
            :key="action.key"
            link
            :type="action.variant === 'danger' ? 'danger' : 'primary'"
            size="small"
          >{{ action.label }}</el-button>
        </span>
      </template>
    </CrudTable>
  </div>

  <!-- 表单：真控件 + 真必填星号（与校验同源）。 -->
  <div v-else-if="role === 'form'" class="cc-form">
    <el-form :label-width="labelWidth" @submit.prevent>
      <el-row :gutter="12">
        <el-col v-for="field in fields" :key="field.prop" :span="field.span ?? 24">
          <CrudFormField :field="field" :model="fieldModel" :editing="false" />
        </el-col>
      </el-row>
      <p v-if="!fields.length" class="cc-hint">空表单：把「表单字段」拖进来</p>
    </el-form>
  </div>

  <!-- 左树：运行期同一个树面板（画布上不给数据，只呈现结构与交互样式）。 -->
  <div v-else-if="role === 'tree'" class="cc-tree">
    <CrudTreePanel
      :schema="treeSchema"
      :nodes="treeNodes"
      :loading="false"
      :selected-id="''"
      :keyword="''"
      :expanded-keys="[]"
      @select="() => {}"
      @keyword="() => {}"
    />
  </div>

  <!-- 分页条：运行期同款分页（真实分页件的样式，不是画出来的假控件）。 -->
  <div v-else-if="role === 'footer'" class="cc-footer">
    <el-pagination :total="0" :page-size="10" layout="total, prev, pager, next" />
  </div>

  <!-- 其它容器：只有结构，内容由子元素承担。 -->
  <div v-else class="cc-plain" />
</template>

<style scoped>
.cc-header, .cc-filter, .cc-table, .cc-form, .cc-tree, .cc-footer, .cc-plain {
  position: absolute; inset: 0; overflow: hidden;
}
/* 表格与运行期一致：宽度不够时自己横向滚动，而不是把列裁掉。 */
.cc-table { overflow: auto; }
/* 壳内部自带内边距与卡片底色，这里只在缩放很小时补一点留白。 */
.cc-header :deep(.page-head) { margin: 0; height: 100%; align-items: center; }
.cc-header :deep(.crud-head h1) { font-size: 18px; margin: 0; }
.cc-form :deep(.el-form-item) { margin-bottom: 8px; }
.cc-form { padding: 2px; }
.cc-tree :deep(.panel) { border: 0; box-shadow: none; padding: 0; background: transparent; }
.cc-plain {
  display: flex; align-items: flex-start; justify-content: flex-start;
  padding: 2px 4px; color: var(--muted); font-size: 11px;
}
.cc-row-actions { display: inline-flex; gap: 8px; }
.cc-hint { margin: 4px; color: var(--muted); font-size: 11px; }
</style>
