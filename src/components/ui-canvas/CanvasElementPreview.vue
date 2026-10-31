<!-- 画布元素预览：把图纸上的一个元素渲染成「上线后那一个组件」。
     这里不复制任何视觉：按钮用 el-button 同一套 variant 映射，查询控件复用
     `CrudQueryField`、表单控件复用 `CrudFormField`、单元格复用 `CellValue`、
     自定义模板复用 `VibeElement`。因此画布即运行预览（所见即所得），
     改图纸的几何/属性 = 改上线页面的同一份数据。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { Download, Plus, TrendCharts } from '@element-plus/icons-vue'
import type { ActionSchema, ColumnSchema, FieldSchema, QuerySchema, Row } from '@zjarlin/data-page'
import { effectiveProps, specOf, vibeSchemaOf } from '@/shared/ui-canvas'
import type { UiElement, UiElementFragment } from '@/shared/ui-canvas'
import CrudQueryField from '@zjarlin/data-page-element/CrudQueryField.vue'
import CrudFormField from '@zjarlin/data-page-element/CrudFormField.vue'
import CellValue from '@zjarlin/data-page-element/CellValue.vue'
import HelpHint from '@zjarlin/data-page-element/HelpHint.vue'
import VibeElement from '@zjarlin/data-page-element/VibeElement.vue'

const props = defineProps<{
  element: UiElement
  /** 编译器为这个元素产出的片段（没有表示编译跳过或它是容器）。 */
  fragment?: UiElementFragment | undefined
  /** 示例行：列预览用同一份取值，多列之间数值一致。 */
  sampleRow: Row
  /** 画布是否显示容器名（区域线开关）。 */
  showRegionLabels: boolean
  /** 页面实体名：页面级「新增××」按钮文案与运行页一致。 */
  entity?: string | undefined
}>()

const spec = computed(() => specOf(props.element.role))
const propsOf = computed(() => effectiveProps(props.element))
const isContainer = computed(() => spec.value.layer === 'container')

/** 自定义模板优先：与运行期同一份转换、同一个渲染器。 */
const vibe = computed(() => vibeSchemaOf(props.element))

const label = computed(() => String(propsOf.value.label ?? props.element.text ?? spec.value.label))

/**
 * 片段按「编译器给的 kind」分派，不靠猜 schema 形状。
 *
 * 早先按 `'param' in schema` 之类判类型，遇到可选字段（`param` 只在显式声明时才有）
 * 就会认错，查询控件因此被当成文本渲染。kind 是编译器的显式契约，唯一可靠。
 */
const fragmentKind = computed(() => props.fragment?.kind ?? null)

const column = computed<ColumnSchema | null>(() => {
  const schema = props.fragment?.schema
  return fragmentKind.value === 'column' && schema ? (schema as ColumnSchema) : null
})

const query = computed<QuerySchema | null>(() => {
  const schema = props.fragment?.schema
  return fragmentKind.value === 'query' && schema ? (schema as QuerySchema) : null
})

const fieldOf = computed<FieldSchema | null>(() => {
  const schema = props.fragment?.schema
  return fragmentKind.value === 'field' && schema ? (schema as FieldSchema) : null
})

/** 动作按钮：片段里是编译出的 ActionSchema；编译跳过时按元素属性兜底显示。 */
const action = computed<ActionSchema | null>(() => {
  const schema = props.fragment?.schema
  return fragmentKind.value === 'action' && schema ? (schema as ActionSchema) : null
})

const buttonType = computed(() => {
  const variant = action.value?.variant ?? propsOf.value.variant
  return variant && variant !== 'default' ? variant : undefined
})

const buttonText = computed(() => action.value?.label ?? label.value)

/** 页面级「新增 / 导出」按钮用运行页同款图标与样式。 */
const pageIntent = computed<'create' | 'export' | null>(() => {
  return fragmentKind.value === 'create' || fragmentKind.value === 'export' ? fragmentKind.value : null
})

/** 表单控件的模型：只用于预览，不参与任何提交。 */
const fieldModel = computed<Record<string, unknown>>(() => {
  const model = fieldOf.value
  if (!model) return {}
  const seed = model.default ?? null
  return { [model.prop]: seed }
})

const reason = computed(() => (props.fragment?.kind === 'unsupported' ? props.fragment.reason : undefined))

const textStyle = computed(() => {
  const height = props.element.rect.height
  const header = props.element.role === 'text' && height >= 28
  return {
    fontSize: `${Math.max(12, Math.min(header ? 20 : 13, Math.round(height * 0.55)))}px`,
    fontWeight: header ? '600' : '400',
  }
})

</script>

<template>
  <!-- 容器：只画结构，不抢画面。开「区域线」时才显示名称。 -->
  <div v-if="isContainer" class="el-frame" :class="{ 'is-page': element.role === 'page', 'has-label': showRegionLabels }">
    <span v-if="showRegionLabels" class="el-frame__label" :style="{ color: spec.tint }">{{ spec.label }}</span>
  </div>

  <!-- 自定义模板：运行时同一个 VibeElement。 -->
  <div v-else-if="vibe?.code" class="el-block">
    <VibeElement
      :vibe="vibe"
      :data="{ value: propsOf.value ?? '示例值', label, text: label, row: sampleRow }"
      :handlers="{}"
    />
  </div>

  <!-- 列表的一列：表头 + 真实单元格渲染。 -->
  <div v-else-if="column" class="el-column">
    <div class="el-column__head">
      <span class="el-column__label">{{ column.label }}<HelpHint :text="column.help" :label="column.label" /></span>
    </div>
    <div class="el-column__cell">
      <CellValue :column="column" :row="sampleRow" />
    </div>
  </div>

  <!-- 查询控件 / 表单控件：运行期同一组件。 -->
  <div v-else-if="query" class="el-control">
    <CrudQueryField :query="query" :value="''" :filters="{}" @change="() => {}" @search="() => {}" />
  </div>
  <div v-else-if="fieldOf" class="el-field">
    <el-form label-width="76px" @submit.prevent>
      <CrudFormField :field="fieldOf" :model="fieldModel" :editing="false" />
    </el-form>
  </div>

  <!-- 按钮：页面级意图（新增/导出）与普通动作按钮都是真按钮。 -->
  <div v-else-if="element.role === 'action'" class="el-action">
    <el-button
      v-if="pageIntent === 'create'"
      type="primary"
      :icon="Plus"
      size="small"
    >新增{{ entity ?? '记录' }}</el-button>
    <el-button v-else-if="pageIntent === 'export'" :icon="Download" size="small">导出</el-button>
    <el-button v-else :type="buttonType" size="small">{{ buttonText }}</el-button>
    <el-tooltip v-if="reason" :content="reason" placement="top">
      <span class="el-warn">!</span>
    </el-tooltip>
  </div>

  <!-- 文本 / 指标 / 详情：按真机字号与层级渲染。 -->
  <div v-else-if="element.role === 'text'" class="el-text" :style="textStyle">{{ label }}</div>
  <div v-else-if="element.role === 'stat'" class="el-stat">
    <span class="el-stat__label">{{ label }}</span>
    <strong>{{ propsOf.value ?? '0' }}</strong>
  </div>
  <div v-else-if="element.role === 'detail'" class="el-detail">
    <span class="el-detail__label">{{ label }}</span>
    <span>{{ propsOf.value ?? '-' }}</span>
  </div>
  <div v-else-if="element.role === 'chart'" class="el-chart">
    <el-icon :size="20"><TrendCharts /></el-icon>
    <span>{{ label }}</span>
  </div>

  <div v-else class="el-text" :style="textStyle">{{ label }}</div>
</template>

<style scoped>
.el-frame {
  position: absolute; inset: 0; border: 1px dashed rgba(100, 116, 139, .35);
  border-radius: 4px; background: rgba(148, 163, 184, .045);
}
.el-frame.is-page { background: transparent; border-style: none; }
.el-frame.has-label::before { content: ''; }
.el-frame__label {
  position: absolute; left: 4px; top: 2px; font-size: 10px; line-height: 1;
  opacity: .85; background: rgba(255, 255, 255, .78); padding: 1px 3px; border-radius: 3px;
}
.el-block, .el-control, .el-field, .el-text, .el-stat, .el-detail, .el-chart { position: absolute; inset: 0; }
.el-control { display: flex; align-items: center; }
.el-control :deep(.el-input), .el-control :deep(.el-select) { width: 100%; }
.el-field :deep(.el-form-item) { margin-bottom: 0; }
.el-action { position: absolute; inset: 0; display: flex; align-items: center; }
.el-action :deep(.el-button) { width: 100%; margin: 0; }
.el-warn {
  position: absolute; right: -6px; top: -6px; width: 14px; height: 14px; border-radius: 50%;
  background: #f59e0b; color: #fff; font-size: 10px; display: grid; place-items: center;
}
.el-column { position: absolute; inset: 0; display: flex; flex-direction: column; background: #fff; outline: 1px solid rgba(148, 163, 184, .28); }
.el-column__head {
  display: flex; align-items: center; height: 32px; padding: 0 10px; flex: 0 0 auto;
  background: var(--el-fill-color-light, #f5f7fa); color: var(--el-text-color-primary, #303133);
  font-size: 13px; font-weight: 600; border-bottom: 1px solid rgba(148, 163, 184, .28);
}
.el-column__label { display: inline-flex; align-items: center; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.el-column__cell { padding: 6px 10px; font-size: 13px; color: var(--el-text-color-regular, #606266); flex: 1 1 auto; overflow: hidden; }
.el-text { display: flex; align-items: center; color: var(--el-text-color-primary, #303133); overflow: hidden; white-space: nowrap; }
.el-stat { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 8px 10px; background: #fff; border: 1px solid rgba(148, 163, 184, .3); border-radius: 6px; }
.el-stat__label { font-size: 11px; color: var(--el-text-color-secondary, #909399); }
.el-stat strong { font-size: 20px; color: var(--el-text-color-primary, #303133); }
.el-detail { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--el-text-color-regular, #606266); }
.el-detail__label { color: var(--el-text-color-secondary, #909399); }
.el-chart { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--el-text-color-secondary, #909399); background: #fff; border: 1px dashed rgba(148, 163, 184, .45); border-radius: 6px; }
</style>
