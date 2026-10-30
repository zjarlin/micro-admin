<script setup lang="ts">
// 表单控件：schema 的一个 `FieldSchema` → 具体输入控件。
//
// 必填星号由 el-form-item 依据 rules 自动生成，与校验规则同源，不另写标记。
import type { FieldOption, FieldSchema } from '@zjarlin/data-page'
import type { NormalizedRule } from '@zjarlin/data-page'
import { vibeScopeData } from '@zjarlin/data-page'
import HelpHint from './HelpHint.vue'
import VibeElement from './VibeElement.vue'
import { useVibeHost, vibeHandlers, type VibeHandler } from './vibe'

const props = defineProps<{
  field: FieldSchema
  model: Record<string, unknown>
  editing: boolean
  /** 来自 `rulesOf(field)`：星号与校验同源。 */
  rules?: NormalizedRule[] | undefined
  options?: FieldOption[] | undefined
}>()

const host = useVibeHost()

/** 自定义控件的取值：`value` / `options` / `model` 都能直接用。 */
function dataOf(): Record<string, unknown> {
  return vibeScopeData(props.field.vibe, {
    value: props.model[props.field.prop],
    model: props.model,
    label: props.field.label,
    options: props.options ?? props.field.options ?? [],
    editing: props.editing,
  })
}

/** 控件默认行为：把值写回表单模型（等价于 v-model）。 */
function handlersOf(): Record<string, VibeHandler> {
  return vibeHandlers(props.field.vibe, host, props.model, {
    change: (payload) => {
      props.model[props.field.prop] = payload
    },
  })
}
</script>

<template>
  <el-form-item
    :label="field.label"
    :prop="field.prop"
    :rules="rules"
  >
    <template v-if="field.help" #label>
      <span class="crud-field__label">{{ field.label }}<HelpHint :text="field.help" :label="field.label" /></span>
    </template>

    <div v-if="field.vibe?.code" class="crud-field__vibe">
      <VibeElement :vibe="field.vibe" :data="dataOf()" :handlers="handlersOf()" />
    </div>

    <el-select
      v-else-if="field.control === 'select' || field.control === 'treeSelect'"
      v-model="model[field.prop]"
      :placeholder="field.placeholder ?? `请选择${field.label}`"
      :disabled="editing && field.disabledOnEdit"
      clearable
      style="width: 100%"
    >
      <el-option v-for="option in options ?? field.options ?? []" :key="String(option.value)" :label="option.label" :value="option.value" :disabled="option.disabled" />
    </el-select>

    <el-radio-group v-else-if="field.control === 'radio'" v-model="model[field.prop]" :disabled="editing && field.disabledOnEdit">
      <el-radio v-for="option in options ?? field.options ?? []" :key="String(option.value)" :value="option.value">{{ option.label }}</el-radio>
    </el-radio-group>

    <el-switch v-else-if="field.control === 'switch'" v-model="model[field.prop]" :disabled="editing && field.disabledOnEdit" />

    <el-input-number
      v-else-if="field.control === 'number'"
      v-model="model[field.prop] as number | null"
      :disabled="editing && field.disabledOnEdit"
      controls-position="right"
      style="width: 100%"
    />

    <el-date-picker
      v-else-if="field.control === 'date'"
      v-model="model[field.prop] as string"
      type="datetime"
      value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
      :disabled="editing && field.disabledOnEdit"
      style="width: 100%"
    />

    <el-input
      v-else
      v-model="model[field.prop] as string"
      :type="field.control === 'textarea' ? 'textarea' : field.control === 'password' ? 'password' : 'text'"
      :rows="field.rows ?? 3"
      :show-password="field.control === 'password'"
      :placeholder="field.placeholder ?? `请输入${field.label}`"
      :disabled="editing && field.disabledOnEdit"
    />
  </el-form-item>
</template>

<style scoped>
.crud-field__label { display: inline-flex; align-items: center; }
/* 自定义控件占满表单项，宽度与内置控件一致。 */
.crud-field__vibe { width: 100%; min-width: 0; }
</style>
