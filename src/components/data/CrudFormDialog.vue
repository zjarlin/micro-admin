<script setup lang="ts">
// 新增/编辑弹窗：schema.fields → 栅格表单 + 校验 + 保存。
//
// 校验规则来自 `rulesOf(field)`，与标签上的星号同源；
// 保存失败留在弹窗并显示服务端文案，不静默关闭。
import { computed, ref, watch } from 'vue'
import type { FormInstance } from 'element-plus'
import type { CrudPageSchema, FieldOption, FieldSchema } from '@/shared/data/schema'
import { rulesOf, type NormalizedRule } from '@/shared/data/rules'
import type { FormDialogState } from '@/shared/data/useFormDialog'
import CrudFormField from './CrudFormField.vue'

const props = defineProps<{
  schema: CrudPageSchema
  state: FormDialogState
  /** 动态选项解析（另一份资源、字典等）；按字段声明解析，缺省用字段自带的静态选项。 */
  optionsOf?: ((field: FieldSchema) => FieldOption[] | undefined) | undefined
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'saved'): void
}>()

const formRef = ref<FormInstance>()

/** 逐字段生成规则；空白数组不下发，避免 el-form-item 误判为「有校验」。 */
const rulesOfField = (field: string): NormalizedRule[] | undefined => {
  const target = props.schema.fields?.find((item) => item.prop === field)
  if (!target) return undefined
  const list = rulesOf(target)
  return list.length ? list : undefined
}

const width = computed(() => {
  const rows = props.schema.fields?.length ?? 0
  return rows > 8 ? '720px' : '560px'
})

const visible = computed({
  get: () => props.state.visible,
  set: (value: boolean) => {
    if (!value) props.state.close()
    emit('update:visible', value)
  },
})

watch(visible, (open) => {
  if (open) formRef.value?.clearValidate()
})

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  const saved = await props.state.save(Boolean(valid))
  if (saved) emit('saved')
}
</script>

<template>
  <el-dialog v-model="visible" :title="state.title" :width="width" destroy-on-close append-to-body>
    <el-form ref="formRef" :model="state.model" label-width="96px" :scroll-to-error="true">
      <el-row :gutter="16">
        <el-col v-for="field in schema.fields ?? []" :key="field.prop" :span="field.span ?? 24">
          <CrudFormField
            :field="field"
            :model="state.model"
            :editing="state.editing !== null"
            :rules="rulesOfField(field.prop)"
            :options="optionsOf?.(field)"
          />
        </el-col>
      </el-row>
    </el-form>
    <el-alert v-if="state.error" type="error" :title="state.error" :closable="false" show-icon class="crud-form__error" />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="state.saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.crud-form__error { margin-top: 8px; }
</style>
