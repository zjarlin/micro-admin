// 2D 图纸模型：UI 设计师画的那一份「图纸」，就是页面的唯一真源。
//
// 设计约束（决定它能否被后端直接编译成页面）：
// 1. 只含 `string | number | boolean | 数组 | 对象`，没有函数、没有 class、没有 VNode；
// 2. 不依赖任何 UI 库类型，元素语义（role）与 `CrudPageSchema` 的槽位一一对应；
// 3. 几何（rect）决定版式（谁在外面、谁在上面、谁和谁同一行），语义（props）决定行为。
//
// 因此同一份图纸能同时：编译成后端下发的页面 schema、编译成 vibeelement 骨架、
// 渲染成线框缩略图。三处共用这一份类型，不出现第二套描述。

import type {
  ActionKind,
  CellKind,
  Condition,
  FieldControl,
  FieldOption,
  TagStyle,
} from '@zjarlin/data-page/schema'

/** 图纸矩形（像素，左上角原点），与组态画布同一套坐标习惯。 */
export interface UiRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 元素语义角色。
 *
 * 分三层：
 * - 容器层（container）：决定页面骨架与区域划分，靠几何包含关系装配；
 * - 叶层（leaf）：真正产出 schema 片段（列、字段、查询条件、动作）；
 * - 装饰层（band）：标题、分组带这类不改行为、只影响观感与文案的元素。
 */
export type UiRole =
  // 容器层
  | 'page'
  | 'header'
  | 'toolbar'
  | 'filter'
  | 'table'
  | 'form'
  | 'tree'
  | 'footer'
  | 'tabs'
  | 'card'
  // 叶层
  | 'column'
  | 'field'
  | 'query'
  | 'action'
  // 装饰 / 富内容层
  | 'text'
  | 'chart'
  | 'stat'
  | 'detail'

/** 元素可配置的属性：每一项都是「配到极致」的落点，且都能被编译器读走。 */
export interface UiElementProps {
  // ---- 通用 ----
  /** 标签（列头、表单标签、按钮文字之外的说明）。 */
  label?: string
  /** 字段名：列取数的 key、表单提交的 key、查询参数名。 */
  prop?: string
  /** 说明文字，渲染成标签旁的小问号。 */
  help?: string
  // ---- 列 / 字段共用 ----
  /** 单元格渲染语义。 */
  cell?: CellKind
  /** 表单控件形态。 */
  control?: FieldControl
  /** 列宽或控件宽（像素），缺省按图纸几何推导。 */
  width?: number
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  fixed?: 'left' | 'right'
  /** 字典类型编码。 */
  dict?: string
  /** 静态选项。 */
  options?: FieldOption[]
  /** 值 → 标签映射（状态列）。 */
  tagMap?: Record<string, TagStyle>
  /** 外键列：存 id、显示另一资源的字段。 */
  resolveFrom?: { endpoint: string; keyProp?: string; labelProp?: string }
  // ---- 表单字段 ----
  /** 必填：同时生成标签星号与校验规则（唯一真源）。 */
  required?: boolean
  /** 校验规则（声明式）。 */
  rules?: Array<
    | { kind: 'required' }
    | { kind: 'email' }
    | { kind: 'pattern'; pattern: string }
    | { kind: 'minLength'; value: number }
    | { kind: 'maxLength'; value: number }
    | { kind: 'range'; min?: number; max?: number }
  >
  /** 编辑时禁止修改。 */
  disabledOnEdit?: boolean
  /** 新建默认值。 */
  default?: string | number | boolean | null
  /** 栅格宽度（24 栅格制）；缺省按图纸几何推导。 */
  span?: 12 | 24
  rows?: number
  /** 树选择数据来源。 */
  treeEndpoint?: string
  // ---- 查询条件 ----
  match?: 'eq' | 'like' | 'in'
  /** `like` 参与匹配的字段，缺省 `[prop]`。 */
  props?: string[]
  placeholder?: string
  /** 提交时的参数名，缺省同 `prop`。 */
  param?: string
  // ---- 动作 ----
  kind?: ActionKind
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  permission?: string
  /** 二次确认文案，支持 `{prop}` 占位。 */
  confirm?: string
  request?: {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    body?: Record<string, unknown>
  }
  /** 跳转类动作的目标路由。 */
  route?: string
  /** 行级可见 / 禁用条件。 */
  visibleWhen?: Condition
  disabledWhen?: Condition
  // ---- 容器 ----
  /** 列表接口（`table` 容器用）。 */
  endpoint?: string
  rowKey?: string
  pageSize?: number
  /** 页面形态覆盖：`tree-table` 表示表格本身按层级展开。 */
  layout?: 'table' | 'tree-table'
  /** 是否允许导出（`toolbar` / `footer` 用）。 */
  exportable?: boolean
  /** 左树：树接口。 */
  treeEndpointOf?: string
  /** 左树：选中节点写入列表查询的参数名。 */
  treeParam?: string
  /** 左树：行上被过滤的字段，缺省同 `treeParam`。 */
  treeFilterProp?: string
  /** 左树：选中父节点是否连带子节点，缺省 `true`。 */
  treeIncludeDescendants?: boolean
  /** 装饰层文案（`text` / `stat` / `detail` 用）。 */
  value?: string | number | boolean | null
  /**
   * vibeelement 模板片段：只允许插值与已注册组件，禁 `<script>` / `v-html` / 内联表达式。
   *
   * 它随图纸一起存进后端、下发给别的壳，因此必须是「可安全下发的字符串」，
   * 由 `inspectCode` 在保存与下发两处把关。
   */
  code?: string
}

/** 绑定通道：数据（取数/取值）与事件（触发动作）分开声明，互不混写。 */
export type UiBindingKind = 'data' | 'event'

/**
 * 元素绑定。
 *
 * 数据绑定描述「这块内容的值从哪来」，事件绑定描述「交互发生时做什么」——
 * 两者都是声明式的，因此可以被服务端原样下发、被 vibeelement 直接执行，
 * 不需要把函数塞进 JSON。
 */
export interface UiElementBinding {
  kind: UiBindingKind
  /** 语义通道：`table.rows` / `form.values` / `query.options` / `click` / `change` / `submit`。 */
  channel: string
  /** 数据通道的端点；事件通道的变量名（可空）。 */
  source?: string
  /** 字段映射：目标字段 → 源路径（如 `label` → `name`）。 */
  map?: Record<string, string>
  /** 事件动作：跳转 / 请求 / 重载 / 弹窗 / 对外派发。 */
  action?: 'navigate' | 'request' | 'reload' | 'dialog' | 'emit'
  /** 动作参数（`navigate` 用 `path`，`request` 用 `method`/`path`/`body`）。 */
  params?: Record<string, unknown>
  /** 触发条件。 */
  when?: Condition
}

/** 图纸上的一个元素实例。 */
export interface UiElement {
  id: string
  role: UiRole
  rect: UiRect
  zIndex: number
  /** 直接展示的文案：按钮字、标题、分组名。 */
  text: string
  props: UiElementProps
  bindings: UiElementBinding[]
  locked: boolean
  visible: boolean
}

/** 发布参数：元素没写 endpoint / 权限时的兜底，避免每个元素重复声明。 */
export interface UiDrawingMeta {
  /** 页面 key，发布后即 `/ui/pages/{key}` 的路由标识。 */
  key: string
  title: string
  description?: string
  entity?: string
  endpoint?: string
  layout?: 'table' | 'tree-table'
  pageSize?: number
  exportable?: boolean
  rowKey?: string
  permissions?: {
    view?: string
    add?: string
    edit?: string
    remove?: string
    export?: string
    config?: string
  }
  menu?: {
    title?: string
    group?: string
    icon?: string
    order?: number
    path?: string
    hidden?: boolean
  }
  uniqueProps?: string[]
  undeletableWhen?: Condition
}

/** 画布设置。 */
export interface UiCanvasSettings {
  width: number
  height: number
  grid: number
  background: string
  showGrid: boolean
}

/** 一份图纸文档：设计师交付的就是它，它编译出的就是上线页面。 */
export interface UiDrawing {
  version: number
  meta: UiDrawingMeta
  canvas: UiCanvasSettings
  elements: UiElement[]
}

/** 编译诊断级别。 */
export type UiDiagnosticLevel = 'error' | 'warn' | 'info'

/** 编译诊断：问题 + 可选的「要问模型什么」。 */
export interface UiDiagnostic {
  level: UiDiagnosticLevel
  /** 稳定错误码，便于前端按码给修复入口、也便于回归。 */
  code: string
  elementId?: string
  message: string
  /** 这一条对应要补的字段；有它就会被汇总进 `questions`。 */
  ask?: UiQuestion
}

/** 追问模型的最小单元：只发缺的字段，不发整份图纸。 */
export interface UiQuestion {
  /** 稳定 id，回填时按它对上。 */
  id: string
  elementId?: string
  /** 要补的字段名（`UiElementProps` 的键，或 `element` 表示需要新增元素）。 */
  field: string
  /** 人话描述，直接作为模型提示。 */
  prompt: string
  kind: 'text' | 'number' | 'boolean' | 'choice'
  choices?: string[]
  /** 期望回填到的元素角色（需要新增元素时用）。 */
  role?: UiRole
}

/** 编译产物：可直接 `PUT /ui/pages/{key}` 上线的页面 schema。 */
export interface UiCompiledPage {
  key: string
  /** 后端下发的页面 schema（`CrudPageSchema` 同构）。 */
  schema: Record<string, unknown>
  diagnostics: UiDiagnostic[]
  questions: UiQuestion[]
  analysis: UiDrawingAnalysis
}

/** 装配分析：编译器「看懂」了图纸什么，全部回显给设计器，避免黑箱。 */
export interface UiDrawingAnalysis {
  regions: UiRegion[]
  title: string
  endpoint: string
  columns: string[]
  fields: string[]
  queries: string[]
  actions: string[]
  hasTree: boolean
  /** 图纸里放不下、需要页面形态扩展的角色（图表 / 指标卡 / 页签 / 详情）。 */
  unsupported: Array<{ elementId: string; role: UiRole; reason: string }>
}

/** 区域：图纸上被识别出的版块（页头 / 查询 / 表格 / 表单 / 左树…）。 */
export interface UiRegion {
  id: string
  role: UiRole
  rect: UiRect
  elementIds: string[]
  /** 直属叶层元素 id，按几何顺序排列。 */
  childIds: string[]
}
