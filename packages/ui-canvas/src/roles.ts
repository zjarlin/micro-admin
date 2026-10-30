// 元素角色表 L0：图纸上的一个元素「是什么」，以及它能配哪些属性。
//
// 这一层与 ifc-canvas 的 symbols3d 同构：内置角色逐条给默认语义，
// 元素自身 `props` 可覆盖，未覆盖的走这里，因此「配得极细」与「开箱可用」不冲突。
//
// 关键点：角色只描述**语义**，不描述像素。像素由几何推断（见 layout.ts），
// 因此同一份图纸换个画布尺寸仍然编译出同一份页面 schema。

import type { UiElement, UiElementProps, UiRole } from './types.ts'

/** 角色定义。 */
export interface UiRoleSpec {
  role: UiRole
  label: string
  /** 层级：容器承载叶层；叶层产出 schema 片段；装饰层只影响观感与文案。 */
  layer: 'container' | 'leaf' | 'band'
  /** 默认尺寸（新建元素时用）。 */
  defaultWidth: number
  defaultHeight: number
  /** 默认文案。 */
  defaultText: string
  /** 该角色默认写出的属性，元素 props 覆盖它。 */
  props: UiElementProps
  /** 允许配置的属性键（属性面板据此出控件，也是「配到极致」的白名单）。 */
  editable: ReadonlyArray<keyof UiElementProps>
  /** 允许挂的绑定通道。 */
  channels: ReadonlyArray<string>
  /** 色板，仅用于线框预览上色。 */
  tint: string
  /** 说明，属性面板显示。 */
  description: string
}

const LEAF_COMMON: ReadonlyArray<keyof UiElementProps> = [
  'label', 'prop', 'help', 'width', 'minWidth', 'align', 'fixed', 'permission',
]

export const ROLE_SPECS: Record<UiRole, UiRoleSpec> = {
  page: {
    role: 'page', label: '页面', layer: 'container', defaultWidth: 1440, defaultHeight: 900,
    defaultText: '', props: {}, editable: ['endpoint', 'layout', 'pageSize', 'exportable', 'rowKey'],
    channels: ['page.meta'], tint: '#e2e8f0', description: '整页外框：承载页头、查询、表格、表单。',
  },
  header: {
    role: 'header', label: '页头', layer: 'container', defaultWidth: 1200, defaultHeight: 56,
    defaultText: '页面标题', props: {}, editable: ['label', 'help'],
    channels: ['header.title'], tint: '#dbeafe', description: '标题区，同时决定页面标题与权限分组。',
  },
  toolbar: {
    role: 'toolbar', label: '工具条', layer: 'container', defaultWidth: 400, defaultHeight: 40,
    defaultText: '', props: { exportable: true }, editable: ['exportable', 'label'],
    channels: ['toolbar.actions'], tint: '#ede9fe', description: '新增/导出等页面级按钮的容器。',
  },
  filter: {
    role: 'filter', label: '查询栏', layer: 'container', defaultWidth: 900, defaultHeight: 56,
    defaultText: '', props: {}, editable: ['label'],
    channels: ['filter.fields'], tint: '#e0f2fe', description: '查询条件区，内部放 query 元素。',
  },
  table: {
    role: 'table', label: '列表', layer: 'container', defaultWidth: 1000, defaultHeight: 420,
    defaultText: '', props: { pageSize: 10 }, editable: ['endpoint', 'rowKey', 'pageSize', 'layout', 'label'],
    channels: ['table.rows', 'table.columns', 'table.actions'], tint: '#dcfce7',
    description: '数据表：内部按水平顺序排出列，右侧放行操作。',
  },
  form: {
    role: 'form', label: '表单', layer: 'container', defaultWidth: 480, defaultHeight: 320,
    defaultText: '', props: {}, editable: ['label', 'endpoint'],
    channels: ['form.values', 'form.fields', 'form.submit'], tint: '#fef3c7',
    description: '新增/编辑弹窗：内部元素按两栏排布。',
  },
  tree: {
    role: 'tree', label: '左树', layer: 'container', defaultWidth: 220, defaultHeight: 420,
    defaultText: '', props: { treeParam: 'deptId', treeIncludeDescendants: true },
    editable: ['treeEndpointOf', 'treeParam', 'treeFilterProp', 'treeIncludeDescendants', 'label'],
    channels: ['tree.nodes', 'tree.select'], tint: '#ccfbf1',
    description: '左树筛选：选中节点写入列表查询参数。',
  },
  footer: {
    role: 'footer', label: '页脚', layer: 'container', defaultWidth: 1000, defaultHeight: 36,
    defaultText: '', props: {}, editable: ['label'],
    channels: ['footer.summary'], tint: '#e2e8f0', description: '分页/统计条。',
  },
  tabs: {
    role: 'tabs', label: '页签', layer: 'container', defaultWidth: 600, defaultHeight: 40,
    defaultText: '', props: {}, editable: ['label'],
    channels: ['tabs.items'], tint: '#fae8ff', description: '页签容器（页面形态扩展点）。',
  },
  card: {
    role: 'card', label: '卡片', layer: 'container', defaultWidth: 320, defaultHeight: 200,
    defaultText: '卡片', props: {}, editable: ['label', 'help'],
    channels: ['card.body'], tint: '#f1f5f9', description: '卡片容器（看板/详情用）。',
  },
  column: {
    role: 'column', label: '列', layer: 'leaf', defaultWidth: 160, defaultHeight: 40,
    defaultText: '', props: { cell: 'text' }, editable: [...LEAF_COMMON, 'cell', 'dict', 'tagMap', 'resolveFrom', 'code'],
    channels: ['column.value', 'column.cell'], tint: '#bbf7d0',
    description: '列表的一列：宽度按几何推导，顺序按横坐标。',
  },
  field: {
    role: 'field', label: '表单字段', layer: 'leaf', defaultWidth: 220, defaultHeight: 56,
    defaultText: '', props: { control: 'input' }, editable: [
      ...LEAF_COMMON, 'control', 'required', 'rules', 'dict', 'options', 'default',
      'disabledOnEdit', 'span', 'rows', 'treeEndpoint',
    ],
    channels: ['field.value', 'field.change'], tint: '#fde68a',
    description: '表单控件：必填同时生成星号与校验规则。',
  },
  query: {
    role: 'query', label: '查询条件', layer: 'leaf', defaultWidth: 180, defaultHeight: 32,
    defaultText: '', props: { control: 'input' }, editable: [...LEAF_COMMON, 'control', 'match', 'props', 'dict', 'options', 'param'],
    channels: ['query.value', 'query.change'], tint: '#bae6fd',
    description: '查询控件：匹配方式决定后端条件生成。',
  },
  action: {
    role: 'action', label: '按钮', layer: 'leaf', defaultWidth: 96, defaultHeight: 32,
    defaultText: '按钮', props: { kind: 'request' }, editable: [
      'label', 'kind', 'variant', 'permission', 'confirm', 'request', 'route',
      'visibleWhen', 'disabledWhen', 'width',
    ],
    channels: ['click'], tint: '#ddd6fe',
    description: '动作按钮：声明式请求或跳转，行级可见/禁用条件可配。',
  },
  text: {
    role: 'text', label: '文本', layer: 'band', defaultWidth: 160, defaultHeight: 24,
    defaultText: '说明文字', props: {}, editable: ['label', 'help', 'value', 'code'],
    channels: ['text.value'], tint: '#f8fafc', description: '纯文案：标题补充、区域说明。',
  },
  chart: {
    role: 'chart', label: '图表', layer: 'band', defaultWidth: 360, defaultHeight: 220,
    defaultText: '图表', props: {}, editable: ['label', 'endpoint', 'code'],
    channels: ['chart.series'], tint: '#fbcfe8', description: '图表（页面形态扩展点，当前编译为诊断）。',
  },
  stat: {
    role: 'stat', label: '指标卡', layer: 'band', defaultWidth: 200, defaultHeight: 96,
    defaultText: '指标', props: {}, editable: ['label', 'prop', 'value', 'code'],
    channels: ['stat.value'], tint: '#a7f3d0', description: '指标卡（页面形态扩展点，当前编译为诊断）。',
  },
  detail: {
    role: 'detail', label: '详情项', layer: 'band', defaultWidth: 160, defaultHeight: 24,
    defaultText: '详情', props: {}, editable: ['label', 'prop', 'value', 'code'],
    channels: ['detail.value'], tint: '#cbd5e1', description: '详情描述项（页面形态扩展点，当前编译为诊断）。',
  },
}

/** 角色清单（新建面板按层分组）。 */
export const ROLE_LIST: UiRoleSpec[] = Object.values(ROLE_SPECS)

/** 按角色取定义；未知角色退回文本，保证旧图纸不炸。 */
export function specOf(role: UiRole): UiRoleSpec {
  return ROLE_SPECS[role] ?? ROLE_SPECS.text
}

/** 合并元素自身属性与角色默认值：元素 > 角色。 */
export function effectiveProps(element: UiElement): UiElementProps {
  return { ...specOf(element.role).props, ...element.props }
}

/** 该属性是否允许配置（属性面板据此过滤）。 */
export function canConfigure(role: UiRole, key: string): boolean {
  return specOf(role).editable.includes(key as keyof UiElementProps)
}
