// schema → 数据校验：服务端与前端共用同一份声明，避免「界面放行、后端才报错」。
//
// 只做数据层判断，不涉及任何 UI 库；消息文案与表单标签同源。
import type { FieldSchema, Row, ValidationRule } from './schema.ts'
import { isRequired } from './rules.ts'

/** 单个字段的校验结果；`null` 表示通过。 */
export interface FieldIssue {
  prop: string
  message: string
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function checkRule(field: FieldSchema, rule: ValidationRule, value: unknown): string | null {
  const text = typeof value === 'string' ? value : String(value ?? '')
  switch (rule.kind) {
    case 'required':
      return isEmpty(value) ? `请输入${field.label}` : null
    case 'email':
      return text === '' || EMAIL.test(text) ? null : '邮箱格式不正确'
    case 'pattern':
      return text === '' || new RegExp(rule.pattern).test(text) ? null : `${field.label}格式不正确`
    case 'minLength':
      return text.length >= rule.value ? null : `${field.label}至少 ${rule.value} 个字符`
    case 'maxLength':
      return text.length <= rule.value ? null : `${field.label}最多 ${rule.value} 个字符`
    case 'range': {
      const number = Number(value)
      if (Number.isNaN(number)) return `${field.label}必须是数字`
      if (rule.min !== undefined && number < rule.min) return `${field.label}不能小于 ${rule.min}`
      if (rule.max !== undefined && number > rule.max) return `${field.label}不能大于 ${rule.max}`
      return null
    }
    default:
      return null
  }
}

/**
 * 按 schema 校验一行数据。
 *
 * 必填判定复用 `isRequired`，所以标签上的星号、前端表单校验、服务端拒绝三处同源。
 */
export function validateRow(fields: FieldSchema[], row: Row): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const field of fields) {
    const value = row[field.prop]
    if (isRequired(field) && isEmpty(value)) {
      issues.push({ prop: field.prop, message: `请输入${field.label}` })
      continue
    }
    if (isEmpty(value)) continue
    for (const rule of field.rules ?? []) {
      const message = checkRule(field, rule, value)
      if (message) {
        issues.push({ prop: field.prop, message })
        break
      }
    }
  }
  return issues
}
