// schema → 校验规则：把后端下发的 `ValidationRule` 翻译成具体表单库的规则对象。
//
// UI 无关部分（必填判断、消息文案、默认值）都在这里，适配层只做字段名映射。
import type { FieldSchema, ValidationRule } from './schema.ts'

/** 与 Element Plus `FormItemRule` 兼容的最小形状；其它框架自行转换。 */
export interface NormalizedRule {
  required?: boolean
  type?: 'email' | 'number' | 'string'
  pattern?: RegExp
  min?: number
  max?: number
  message: string
  trigger: string | string[]
}

/** 必填字段的判定：只有 `required` 与「`rules` 里含 required」两种来源。 */
export function isRequired(field: FieldSchema): boolean {
  return Boolean(field.required) || (field.rules ?? []).some((rule) => rule.kind === 'required')
}

function messageOf(rule: ValidationRule, field: FieldSchema): string {
  switch (rule.kind) {
    case 'required':
      return `请输入${field.label}`
    case 'email':
      return '邮箱格式不正确'
    case 'pattern':
      return `${field.label}格式不正确`
    case 'minLength':
      return `${field.label}至少 ${rule.value} 个字符`
    case 'maxLength':
      return `${field.label}最多 ${rule.value} 个字符`
    case 'range':
      return `${field.label}超出允许范围`
    default:
      return `${field.label}不合法`
  }
}

/**
 * 生成字段规则。
 *
 * `required` 声明与 `rules` 里的 required 合并去重，避免标签上出现两次星号或校验两次。
 */
export function rulesOf(field: FieldSchema): NormalizedRule[] {
  const rules: NormalizedRule[] = []
  if (isRequired(field) && !(field.rules ?? []).some((rule) => rule.kind === 'required')) {
    rules.push({ required: true, message: `请输入${field.label}`, trigger: ['blur', 'change'] })
  }
  for (const rule of field.rules ?? []) {
    switch (rule.kind) {
      case 'required':
        rules.push({ required: true, message: messageOf(rule, field), trigger: ['blur', 'change'] })
        break
      case 'email':
        rules.push({ type: 'email', message: messageOf(rule, field), trigger: 'blur' })
        break
      case 'pattern':
        rules.push({ pattern: new RegExp(rule.pattern), message: messageOf(rule, field), trigger: 'blur' })
        break
      case 'minLength':
        rules.push({ min: rule.value, message: messageOf(rule, field), trigger: 'blur' })
        break
      case 'maxLength':
        rules.push({ max: rule.value, message: messageOf(rule, field), trigger: 'blur' })
        break
      case 'range':
        rules.push({
          type: 'number',
          ...(rule.min !== undefined ? { min: rule.min } : {}),
          ...(rule.max !== undefined ? { max: rule.max } : {}),
          message: messageOf(rule, field),
          trigger: 'blur',
        })
        break
      default:
        break
    }
  }
  return rules
}

/** 新建表单的初始值：`default` 优先，其次布尔用 `false`、数字用 `null`、其余空串。 */
export function emptyForm(fields: FieldSchema[]): Record<string, unknown> {
  const model: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) model[field.prop] = field.default
    else if (field.control === 'switch') model[field.prop] = false
    else if (field.control === 'number') model[field.prop] = null
    else model[field.prop] = ''
  }
  return model
}

/** 把行数据投影到表单字段，避免把整行的无关字段一起提交。 */
export function pickForm(fields: FieldSchema[], row: Record<string, unknown>): Record<string, unknown> {
  const model = emptyForm(fields)
  for (const field of fields) {
    if (row[field.prop] !== undefined) model[field.prop] = row[field.prop]
  }
  return model
}
