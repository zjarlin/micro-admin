// vibeelement：既能实时预览、又能绑数据与事件的「活元素」。
//
// 与普通图元的区别只有两条，但正是它们让「vibecoding」成立：
// 1. **实时**：元素带 `code`（模板片段）与 `bindings`（数据/事件通道），改一处即时重渲染；
// 2. **可绑**：数据（值从哪来）与事件（点了做什么）都是声明式的，因此能原样存进 JSON、
//    由服务端下发、在任意壳里执行——不需要把函数序列化。
//
// 本文件只定义「契约 + 校验 + 骨架生成」，不依赖 Vue / DOM：
// 真正的编译渲染在 `@zjarlin/data-page-element` 的 VibeElement.vue 里，
// 这样同一份 vibeelement 也能被将来别的框架壳复用。

import { vibeHandlerName } from '@zjarlin/data-page/vibe'
import type { VibeSchema } from '@zjarlin/data-page/schema'
import type { UiElement, UiElementProps } from './types.ts'
import { effectiveProps, specOf } from './roles.ts'

/** 通道方向：数据通道读，事件通道写。 */
export interface VibeChannelSpec {
  channel: string
  kind: 'data' | 'event'
  label: string
  /** 数据通道：期望的源形状。 */
  shape?: string
  /** 事件通道：可用的动作。 */
  actions?: ReadonlyArray<VibeAction>
  description: string
}

export type VibeAction = 'navigate' | 'request' | 'reload' | 'dialog' | 'emit'

/** 全局通道表：角色 `channels` 只能引用这里的通道。 */
export const VIBE_CHANNELS: Record<string, VibeChannelSpec> = {
  'table.rows': { channel: 'table.rows', kind: 'data', label: '行数据', shape: 'Row[]', description: '列表数据源，来自页面 endpoint。' },
  'column.value': { channel: 'column.value', kind: 'data', label: '单元格值', shape: 'unknown', description: '该列取的行字段；默认取 prop。' },
  'form.values': { channel: 'form.values', kind: 'data', label: '表单值', shape: 'Row', description: '整个表单的当前值对象。' },
  'field.value': { channel: 'field.value', kind: 'data', label: '字段值', shape: 'unknown', description: '单个字段的当前值。' },
  'query.value': { channel: 'query.value', kind: 'data', label: '查询值', shape: 'unknown', description: '查询控件的当前值。' },
  'header.title': { channel: 'header.title', kind: 'data', label: '页面标题', shape: 'string', description: '页头文案。' },
  'text.value': { channel: 'text.value', kind: 'data', label: '文本值', shape: 'string', description: '纯文案内容。' },
  'stat.value': { channel: 'stat.value', kind: 'data', label: '指标值', shape: 'number', description: '指标卡数值来源。' },
  'detail.value': { channel: 'detail.value', kind: 'data', label: '详情值', shape: 'unknown', description: '详情项取值。' },
  'chart.series': { channel: 'chart.series', kind: 'data', label: '图表序列', shape: 'unknown[]', description: '图表数据序列。' },
  'tree.nodes': { channel: 'tree.nodes', kind: 'data', label: '树节点', shape: 'Row[]', description: '左树节点数据。' },
  click: { channel: 'click', kind: 'event', label: '点击', actions: ['navigate', 'request', 'dialog', 'emit'], description: '点击元素时触发。' },
  change: { channel: 'change', kind: 'event', label: '值改变', actions: ['request', 'emit'], description: '控件值变化时触发。' },
  submit: { channel: 'submit', kind: 'event', label: '提交', actions: ['request', 'dialog', 'emit'], description: '表单提交时触发。' },
  select: { channel: 'select', kind: 'event', label: '选中', actions: ['reload', 'request', 'emit'], description: '树/列表选中时触发。' },
}

/** 该角色允许的通道定义。 */
export function channelsOf(element: UiElement): VibeChannelSpec[] {
  return specOf(element.role).channels
    .map((channel) => VIBE_CHANNELS[channel])
    .filter((spec): spec is VibeChannelSpec => Boolean(spec))
}

/** 绑定校验结果。 */
export interface VibeBindingIssue {
  bindingIndex: number
  channel: string
  level: 'error' | 'warn'
  message: string
}

/**
 * 校验元素的绑定。
 *
 * 规则都很硬：通道必须在角色允许范围内、方向必须一致、事件必须给动作、
 * 请求动作必须有路径。任何一条不满足，元素在运行期都不会「看起来正常但什么都不做」——
 * 这正是 vibecoding 最容易踩的坑。
 */
export function validateBindings(element: UiElement): VibeBindingIssue[] {
  const issues: VibeBindingIssue[] = []
  const allowed = new Set(specOf(element.role).channels)
  element.bindings.forEach((binding, index) => {
    const spec = VIBE_CHANNELS[binding.channel]
    if (!spec) {
      issues.push({ bindingIndex: index, channel: binding.channel, level: 'error', message: `未知通道 ${binding.channel}` })
      return
    }
    if (!allowed.has(binding.channel)) {
      issues.push({
        bindingIndex: index, channel: binding.channel, level: 'error',
        message: `${specOf(element.role).label}不支持通道 ${binding.channel}（可用：${[...allowed].join('、')}）`,
      })
    }
    if (spec.kind === 'data' && !binding.source) {
      issues.push({ bindingIndex: index, channel: binding.channel, level: 'warn', message: `数据通道 ${binding.channel} 没有声明数据源，将退回默认取值` })
    }
    if (spec.kind === 'event') {
      if (!binding.action) {
        issues.push({ bindingIndex: index, channel: binding.channel, level: 'error', message: `事件通道 ${binding.channel} 没有动作` })
      } else if (spec.actions && !spec.actions.includes(binding.action)) {
        issues.push({
          bindingIndex: index, channel: binding.channel, level: 'error',
          message: `事件 ${binding.channel} 不支持动作 ${binding.action}`,
        })
      }
      if (binding.action === 'request' && !binding.params?.path) {
        issues.push({ bindingIndex: index, channel: binding.channel, level: 'error', message: 'request 动作缺少 params.path' })
      }
    }
  })
  return issues
}

/**
 * 代码片段的安全检查。
 *
 * vibeelement 的 `code` 是**模板**而不是任意脚本：只允许插值表达式与已注册组件，
 * 禁止 `<script>`、`v-html`、`@click="任意 JS"` 这类可执行任意代码的写法。
 * 面板有这一层，模板就能安全地存进后端、下发给别人。
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  { pattern: /<script/i, message: '模板里不允许出现 <script>' },
  { pattern: /\bv-html\b/, message: '不允许 v-html（会执行注入内容）' },
  { pattern: /\bnew\s+Function\b/, message: '不允许 new Function' },
  { pattern: /\beval\s*\(/, message: '不允许 eval(' },
  { pattern: /\bimport\s*\(/, message: '不允许动态 import' },
  { pattern: /\brequire\s*\(/, message: '不允许 require(' },
  { pattern: /\bdocument\b/, message: '不允许直接访问 document' },
  { pattern: /\bwindow\b/, message: '不允许直接访问 window' },
]

/** 代码片段检查结果。 */
export interface VibeCodeIssue {
  level: 'error' | 'warn'
  message: string
}

/** 检查模板片段是否可安全下发。 */
export function inspectCode(code: string): VibeCodeIssue[] {
  const issues: VibeCodeIssue[] = []
  if (!code.trim()) return issues
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(code)) issues.push({ level: 'error', message: rule.message })
  }
  if (code.includes('@click="') && !/@click="[a-zA-Z_$][\w$]*"/.test(code)) {
    issues.push({ level: 'error', message: '@click 只能指向已注册的事件通道方法名，不能内联表达式' })
  }
  if (code.length > 4000) issues.push({ level: 'warn', message: '模板超过 4000 字符，建议拆成多个元素' })
  return issues
}

/** 元素运行时形状：账号密码等敏感值不参与绑定。 */
export interface VibeElementModel {
  id: string
  role: string
  label: string
  code: string
  props: UiElementProps
  /** 数据通道 → 已解析的值。 */
  data: Record<string, unknown>
  /** 事件通道 → 已注册的动作处理器名（由宿主提供）。 */
  handlers: Record<string, string>
}

/**
 * 把元素 + 运行时值装成模型。
 *
 * 这一步是「绑数据与事件」的落点：`data` 由宿主按通道解析（取行、取表单、取接口），
 * `handlers` 由宿主按动作注册（跳转、请求、重载），模板里只出现这两个名字，
 * 因此模板不需要、也无法直接接触到 http / router / store。
 */
export function modelOf(
  element: UiElement,
  values: { data?: Record<string, unknown>; handlers?: Record<string, string> } = {},
): VibeElementModel {
  const props = effectiveProps(element)
  const data: Record<string, unknown> = {}
  for (const binding of element.bindings) {
    if (binding.kind !== 'data') continue
    if (binding.source && values.data && binding.source in values.data) {
      data[binding.channel] = values.data[binding.source]
    } else if (binding.channel in (values.data ?? {})) {
      data[binding.channel] = values.data?.[binding.channel]
    }
  }
  return {
    id: element.id,
    role: element.role,
    label: String(props.label ?? element.text ?? element.id),
    code: String((props as { code?: string }).code ?? ''),
    props,
    data,
    handlers: values.handlers ?? {},
  }
}

/** 生成默认模板：给新元素一个能跑起来的起点，而不是空白。 */
export function defaultCodeOf(element: UiElement): string {
  const props = effectiveProps(element)
  const label = String(props.label ?? element.text ?? specOf(element.role).label)
  switch (element.role) {
    case 'action':
      return `<el-button type="primary" @click="onClick">{{ label }}</el-button>`
    case 'stat':
      return `<div class="vibe-stat"><span class="vibe-stat__label">${label}</span><strong>{{ value }}</strong></div>`
    case 'text':
      return `<p class="vibe-text">{{ text }}</p>`
    case 'chart':
      return `<div class="vibe-chart" data-series="series">${label}</div>`
    case 'detail':
      return `<div class="vibe-detail"><span>${label}</span><span>{{ value }}</span></div>`
    case 'column':
      return `{{ value }}`
    case 'field':
    case 'query':
      return `<el-input v-model="value" placeholder="${String(props.placeholder ?? label)}" />`
    default:
      return `<div class="${'vibe-' + element.role}">${label}</div>`
  }
}

/** 绑定 → 通道方法名：模板里只看得到 `onClick` / `onChange` 这类名字。 */
export function handlerNamesOf(element: UiElement): Record<string, string> {
  const handlers: Record<string, string> = {}
  for (const binding of element.bindings) {
    if (binding.kind !== 'event') continue
    // 推导放在 `@zjarlin/data-page/vibe`：图纸包与 UI 壳必须给出同一个名字。
    handlers[binding.channel] = vibeHandlerName(binding.channel)
  }
  return handlers
}

/**
 * 元素 → 可直接下发的 `vibe` 片段。
 *
 * 设计器预览与编译器发布共用这一处转换，所以「预览里跑的模板」与
 * 「上线后下发的模板」永远是同一份；没声明动作的事件通道在这里被丢弃
 * （留着只会让模板里的方法点了没反应）。
 */
export function vibeSchemaOf(element: UiElement): VibeSchema | null {
  const code = String((effectiveProps(element) as { code?: string }).code ?? '').trim()
  if (!code) return null
  const bindings: NonNullable<VibeSchema['bindings']> = []
  for (const binding of element.bindings) {
    if (binding.kind === 'event' && !binding.action) continue
    bindings.push({
      channel: binding.channel,
      kind: binding.kind,
      ...(binding.source ? { source: binding.source } : {}),
      ...(binding.action ? { action: binding.action } : {}),
      ...(binding.params ? { params: binding.params } : {}),
      ...(binding.when ? { when: binding.when } : {}),
    })
  }
  return bindings.length ? { code, bindings } : { code }
}

/** 校验一份图纸里所有元素的 vibeelement 部分（供设计器保存前调用）。 */
export function validateDrawingVibe(elements: UiElement[]): Array<{ elementId: string; issues: Array<VibeBindingIssue | VibeCodeIssue> }> {
  const out: Array<{ elementId: string; issues: Array<VibeBindingIssue | VibeCodeIssue> }> = []
  for (const element of elements) {
    const issues: Array<VibeBindingIssue | VibeCodeIssue> = [
      ...validateBindings(element),
      ...inspectCode(String((effectiveProps(element) as { code?: string }).code ?? '')),
    ]
    if (issues.length) out.push({ elementId: element.id, issues })
  }
  return out
}
