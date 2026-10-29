// 新增/编辑弹窗状态机：schema.fields → 表单模型、校验规则、标题、保存请求。
//
// 这里只做数据；渲染由 UI 适配层的表单壳负责。
import { computed, reactive, ref } from 'vue'
import type { HttpClient } from '../http.ts'
import type { CrudPageSchema, Row } from './schema.ts'
import { emptyForm, pickForm, rulesOf, type NormalizedRule } from './rules.ts'

export interface FormDialogState {
  readonly visible: boolean
  readonly editing: Row | null
  readonly title: string
  readonly model: Record<string, unknown>
  readonly rules: Record<string, NormalizedRule[]>
  readonly saving: boolean
  readonly error: string | null
  openCreate(seed?: Row): void
  openEdit(row: Row): void
  close(): void
  save(valid: boolean): Promise<boolean>
}

export interface FormDialogOptions {
  /** 保存成功后回调（通常是刷新列表）。 */
  onSaved?: () => void | Promise<void>
}

export function useFormDialog(
  http: HttpClient,
  schema: CrudPageSchema,
  options: FormDialogOptions = {},
): FormDialogState {
  const fields = schema.fields ?? []
  const rowKey = schema.rowKey ?? 'id'
  const visible = ref(false)
  const editing = ref<Row | null>(null)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const model = reactive<Record<string, unknown>>(emptyForm(fields))

  const rules = computed<Record<string, NormalizedRule[]>>(() => {
    const map: Record<string, NormalizedRule[]> = {}
    for (const field of fields) {
      const list = rulesOf(field)
      if (list.length) map[field.prop] = list
    }
    return map
  })

  const title = computed(() => {
    const entity = schema.entity ?? '记录'
    return editing.value ? `编辑${entity}` : `新增${entity}`
  })

  function reset(source: Record<string, unknown>): void {
    for (const key of Object.keys(model)) delete model[key]
    Object.assign(model, source)
  }

  function openCreate(seed?: Row): void {
    editing.value = null
    error.value = null
    reset({ ...emptyForm(fields), ...(seed ?? {}) })
    visible.value = true
  }

  function openEdit(row: Row): void {
    editing.value = row
    error.value = null
    reset(pickForm(fields, row))
    visible.value = true
  }

  function close(): void {
    visible.value = false
    saving.value = false
    error.value = null
  }

  async function save(valid: boolean): Promise<boolean> {
    if (!valid) return false
    if (!fields.length) return false
    saving.value = true
    error.value = null
    try {
      const isEdit = editing.value !== null
      const id = isEdit ? editing.value?.[rowKey] : undefined
      const path = isEdit ? `${schema.endpoint}/${String(id)}` : schema.endpoint
      const payload: Record<string, unknown> = { ...model }
      if (schema.params) Object.assign(payload, schema.params)
      await http.request<Row>(path, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      close()
      await options.onSaved?.()
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    get visible() { return visible.value },
    get editing() { return editing.value },
    get title() { return title.value },
    model,
    get rules() { return rules.value },
    get saving() { return saving.value },
    get error() { return error.value },
    openCreate,
    openEdit,
    close,
    save,
  }
}
