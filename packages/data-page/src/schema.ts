// 页面 schema：一份 JSON 描述整页的查询条件、列、表单、行操作与左树。
//
// 设计约束（决定它能被后端直接下发）：
// 1. 只允许 `string | number | boolean | 数组 | 对象`，不含函数、不含 class、不含 VNode。
// 2. 不依赖任何 UI 库类型：校验用自定义 `ValidationRule`，由 UI 适配层翻译。
// 3. 行操作也必须声明式（`kind` + 可选 `request`），否则后端下发后无法执行。
//
// 因此同一份 JSON 既能被本仓库的 Element Plus 壳渲染，也能被别的框架壳渲染。

/** 一行数据：字段名到值的映射。 */
export type Row = Record<string, unknown>

/** 单元格渲染语义。 */
export type CellKind =
  | 'text'
  | 'code'
  | 'status'
  | 'tagMap'
  | 'datetime'
  | 'dict'
  | 'link'
  | 'custom'

/** 标签样式：`type` 与 Element Plus 的 el-tag type 对齐，其它框架自行映射。 */
export type TagTone = 'primary' | 'success' | 'info' | 'warning' | 'danger'

export interface TagStyle {
  label: string
  tone?: TagTone
}

/** 选项/取值来源：另一份资源的端点与字段名。 */
export interface OptionSource {
  /** 资源端点，例如 `/system/departments`。 */
  endpoint: string
  /** 作为 value 的字段，缺省 `id`。 */
  valueProp?: string
  /** 作为 label 的字段，缺省 `name`。 */
  labelProp?: string
}

/**
 * vibeelement 绑定：数据通道负责取值，事件通道负责动作。
 *
 * 与图纸元素上的绑定同构（`UiElementBinding`），但只保留运行期需要的字段：
 * 壳拿到它就能回答「值从哪来、点了做什么」，既不需要图纸，也不需要函数。
 */
export interface VibeBindingSchema {
  /** 语义通道：数据 `column.value` / `field.value`，事件 `click` / `change` / `submit` / `select`。 */
  channel: string
  kind: 'data' | 'event'
  /** 数据通道的取值键（宿主上下文里的键，缺省同 `channel`）。 */
  source?: string
  /** 事件动作：跳转 / 请求 / 重载 / 弹窗 / 对外派发。 */
  action?: 'navigate' | 'request' | 'reload' | 'dialog' | 'emit'
  /** 动作参数（`navigate` 用 `path`，`request` 用 `method` / `path` / `body`）。 */
  params?: Record<string, unknown>
  /** 触发条件：不成立时该绑定不生效（行级绑定用）。 */
  when?: Condition
}

/**
 * 元素级活模板（vibeelement）。
 *
 * `code` 是**模板片段**而不是脚本：只允许插值与已注册组件，发布前由编译器的
 * `inspectCode` 把关。没写 `code` 或没通过检查时，壳按角色默认样式渲染——
 * 所以「配了模板」与「没配模板」是同一个槽位的两种画法，不是两套页面。
 */
export interface VibeSchema {
  code: string
  bindings?: VibeBindingSchema[]
}

export interface ColumnSchema {
  /** 取值字段。 */
  prop: string
  label: string
  /** 固定宽度；与 `minWidth` 二选一。 */
  width?: number
  minWidth?: number
  fixed?: 'left' | 'right'
  align?: 'left' | 'center' | 'right'
  showOverflowTooltip?: boolean
  /** 渲染语义，缺省 `text`。 */
  cell?: CellKind
  /** `status` / `tagMap` 用：值到标签的映射。 */
  tagMap?: Record<string, TagStyle>
  /** `dict` 用：字典类型编码。 */
  dict?: string
  /** `custom` 用：宿主页面提供的具名插槽。 */
  slot?: string
  /** 列头说明，渲染成标签旁的小问号。 */
  help?: string
  /**
   * 跨资源取值：本列存的是 id，展示的却是另一份资源的字段。
   *
   * 这样「用户.部门」「任务.负责人」这类外键不需要在业务表里冗余一份名称，
   * 也就不会出现改名后两处不一致。
   */
  resolveFrom?: OptionSource & { keyProp?: string }
  /** 自定义单元格模板：给了就替换默认单元格渲染（表头仍按 `label` 出）。 */
  vibe?: VibeSchema
}

/** 表单控件。 */
export type FieldControl =
  | 'input'
  | 'password'
  | 'textarea'
  | 'number'
  | 'select'
  | 'radio'
  | 'switch'
  | 'treeSelect'
  | 'date'

export interface FieldOption {
  label: string
  value: string | number | boolean
  disabled?: boolean
}

/**
 * 校验规则：只描述「要什么」，不描述「怎么提示」。
 *
 * UI 适配层负责翻译成具体表单库的规则对象；`message` 缺省时由适配层按 `label` 生成。
 */
export type ValidationRule =
  | { kind: 'required' }
  | { kind: 'email' }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'minLength'; value: number }
  | { kind: 'maxLength'; value: number }
  | { kind: 'range'; min?: number; max?: number }

export interface FieldSchema {
  prop: string
  label: string
  control: FieldControl
  /**
   * 必填声明：**唯一真源**。
   *
   * UI 适配层必须同时用它生成「标签上的红色 *」和表单校验规则，
   * 不允许只做提交后报错——那是缺陷。
   */
  required?: boolean
  rules?: ValidationRule[]
  /** 静态选项。 */
  options?: FieldOption[]
  /** 动态选项来源：字典类型编码，由宿主注入的字典服务解析。 */
  dict?: string
  /** 动态选项来源：另一份资源（下拉框选项由该端点生成）。 */
  optionsFrom?: OptionSource
  /** 新建时的初始值。 */
  default?: string | number | boolean | null
  /** 编辑时禁止修改（如用户名）。 */
  disabledOnEdit?: boolean
  /** 栅格宽度（24 栅格制），缺省整行。 */
  span?: 12 | 24
  placeholder?: string
  /** 字段说明，渲染成标签旁的小问号。 */
  help?: string
  /** 多行文本行数。 */
  rows?: number
  /** `treeSelect` 的数据来源接口。 */
  treeEndpoint?: string
  /** 自定义控件模板：给了就替换默认控件；标签与必填星号仍由 `required` / `rules` 决定。 */
  vibe?: VibeSchema
}

export interface QuerySchema {
  /** 前端绑定字段。 */
  prop: string
  /** 提交时的参数名，缺省同 `prop`。 */
  param?: string
  control: 'input' | 'select'
  placeholder?: string
  options?: FieldOption[]
  /** 字典类型编码，与 `options` 二选一。 */
  dict?: string
  /** 控件宽度（像素）。 */
  width?: number
  /**
   * 匹配方式，缺省按控件推断：`select` → `eq`，`input` → `like`。
   *
   * 后端拿着同一份声明就能生成查询条件，前后端不需要各写一遍筛选逻辑。
   */
  match?: 'eq' | 'like' | 'in'
  /** `like` 参与匹配的字段，缺省 `[prop]`。 */
  props?: string[]
  /** 自定义查询控件模板：给了就替换默认输入/下拉。 */
  vibe?: VibeSchema
}

/** 声明式条件：用于行操作的可见/禁用判断，可被 JSON 表达。 */
export interface Condition {
  prop: string
  op: 'eq' | 'ne' | 'in' | 'nin' | 'truthy' | 'falsy'
  value?: unknown
}

/** 行操作语义：`kind` 决定前端走哪条内置分支。 */
export type ActionKind = 'create' | 'edit' | 'delete' | 'toggle' | 'detail' | 'request'

export interface ActionSchema {
  key: string
  label: string
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  kind: ActionKind
  /** 权限码，缺省沿用页面的 `permissions.edit` / `.remove`。 */
  permission?: string
  /** 二次确认文案，支持 `{prop}` 占位。 */
  confirm?: string
  /** `request` / `toggle` 用：请求模板，`{id}` 等占位取行字段。 */
  request?: {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    path: string
    /** 静态请求体；支持 `{prop}` 占位。 */
    body?: Record<string, unknown>
  }
  /** 行级禁用条件。 */
  disabledWhen?: Condition
  /** 行级可见条件。 */
  visibleWhen?: Condition
  /** 自定义按钮模板：模板里的 `@click="onClick"` 等价于点击默认按钮。 */
  vibe?: VibeSchema
}

/** 左树（或左列）绑定。 */
export interface TreeSchema {
  /** 树数据接口。 */
  endpoint: string
  idProp: string
  labelProp: string
  /** 给了它就是扁平表，客户端建树；不给表示服务端已返回嵌套 `children`。 */
  parentProp?: string
  /** 嵌套子节点字段名，缺省 `children`。 */
  childrenProp?: string
  /** 选中节点后写入列表查询的参数名。 */
  param: string
  /**
   * 选中节点过滤列表时使用的行字段，缺省同 `param`。
   *
   * 例如部门树的参数是 `deptId`，而列表行上的字段也叫 `deptId`，就无需重复声明。
   */
  filterProp?: string
  /**
   * 选中父节点时是否连带子节点数据，缺省 `true`。
   *
   * 组织架构类筛选几乎总是「含下级」，因此默认开启；需要精确匹配时显式关掉。
   */
  includeDescendants?: boolean
  /** 根节点文案，点击等于「全部」。 */
  allLabel?: string
  searchable?: boolean
  /** 额外的节点副标题字段。 */
  captionProp?: string
}

/** 页面级 schema：后端下发这一份即可渲染整页。 */
export interface CrudPageSchema {
  /** 页面标识，用于路由与手写回退配置的键。 */
  key: string
  title: string
  /** 页面说明，渲染成标题旁的小问号，不占正文。 */
  description?: string
  /** 实体名，用于「新增{entity}」「没有匹配的{entity}」等文案。 */
  entity?: string
  /**
   * 页面形态，决定壳用哪一个：
   * - `table`（缺省）：查询 + 分页表 + 弹窗；有 `tree` 时是「左树右表」；
   * - `tree-table`：表格本身按层级展开（部门、菜单），不分页、无左树。
   *
   * 有了它，通用路由拿到 schema 就知道渲染什么，不需要为每个页面声明模式。
   */
  layout?: 'table' | 'tree-table'
  /** 列表接口。 */
  endpoint: string
  rowKey?: string
  /** 权限码集合。`view` 决定这条菜单/路由是否可见，缺省视为公开。 */
  permissions?: {
    view?: string
    add?: string
    edit?: string
    remove?: string
    export?: string
    /** 保存页面配置本身的权限（设计器用）。 */
    config?: string
  }
  /**
   * 导航声明：有它，宿主就把这个页面挂进侧栏并注册路由。
   *
   * 这就是「后端加一页，前端自动出现」的开关——前端不再为每个页面写 routes.ts。
   */
  menu?: {
    /** 侧栏文案，缺省用 `title`。 */
    title?: string
    /** 分组名，缺省「通用页面」。 */
    group?: string
    /** Element Plus 图标组件名；其它框架自行映射。 */
    icon?: string
    /** 同组排序，缺省 100。 */
    order?: number
    /** 路由地址，缺省 `/p/{key}`。 */
    path?: string
    /** 注册路由但不进侧栏（详情页、嵌入式页面）。 */
    hidden?: boolean
  }
  query?: QuerySchema[]
  columns: ColumnSchema[]
  /** 有它才启用新增/编辑弹窗。 */
  fields?: FieldSchema[]
  actions?: ActionSchema[]
  pageSize?: number
  exportable?: boolean
  /** 附加请求参数：固定值或取自上下文。 */
  params?: Record<string, unknown>
  tree?: TreeSchema
  /**
   * 唯一字段：新增/修改时服务端据此返回 409，前端不需要另写校验。
   */
  uniqueProps?: string[]
  /**
   * 服务端自动填写的时间字段。
   *
   * 表单里不出现、但列表要展示的创建/更新时间，由后端按这份声明补齐，
   * 避免每个页面各自写一遍 `new Date()`。
   */
  timestamps?: { created?: string; updated?: string }
  /**
   * 命中该条件的行禁止删除（如内置管理员）。
   *
   * 前端据此禁用按钮，服务端据此拒绝请求——同一份声明，不出现「界面能点、后端才报错」。
   */
  undeletableWhen?: Condition
}

/** 判断条件是否成立；条件不成立或字段缺失都返回 `false`。 */
export function matchCondition(row: Row, condition: Condition | undefined): boolean {
  if (!condition) return true
  const actual = row[condition.prop]
  switch (condition.op) {
    case 'eq':
      return actual === condition.value
    case 'ne':
      return actual !== condition.value
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual)
    case 'nin':
      return !Array.isArray(condition.value) || !condition.value.includes(actual)
    case 'truthy':
      return Boolean(actual)
    case 'falsy':
      return !actual
    default:
      return false
  }
}

/** 把 `{prop}` 占位替换成行上的值。 */
export function interpolate(template: string, row: Row): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(row[key] ?? ''))
}
