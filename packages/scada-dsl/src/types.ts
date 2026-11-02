// 组态指令集的结构定义。
//
// 这里只声明「指令集需要碰到的字段」，与宿主（micro-admin 的组态文档）保持
// 结构兼容，因此不需要互相 import；换一个组态实现时也能继续用这套指令。
// 字段命名与 `ScadaDocument` 一致（camelCase），避免中间再转一层。

export interface DslRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DslCanvas {
  width: number
  height: number
  grid: number
  background: string
  showGrid: boolean
}

export interface DslBinding {
  slot: string
  tagId: number
  tagLabel?: string
  precision?: number | null
  unit?: string | null
}

export interface DslWidget {
  id: string
  symbolKey: string
  name: string
  rect: DslRect
  rotation: 'none' | 'deg90' | 'deg180' | 'deg270'
  zIndex: number
  props: Record<string, unknown>
  bindings: DslBinding[]
  locked: boolean
  visible: boolean
}

/** 指令要改的文档形状（结构化兼容宿主的组态文档）。 */
export interface DslDocument {
  version: number
  canvas: DslCanvas
  widgets: DslWidget[]
}

/** 图元定义里指令集需要读的部分（尺寸、槽位、属性）。 */
export interface DslSymbol {
  key: string
  name: string
  defaultWidth: number
  defaultHeight: number
  keepAspect?: boolean
  props?: Array<{ key: string; default: unknown }>
  bindingSlots?: Array<{ key: string; label: string }>
}

/** 可绑定的通道变量（Tag）。 */
export interface DslTag {
  tagId: number
  name: string
  unit?: string | null
}

export type DslSeverity = 'error' | 'warn'

/** 单条指令的解析/执行问题，带行号，便于在编辑器里定位。 */
export interface DslIssue {
  line: number
  severity: DslSeverity
  message: string
  /** 出错的原始行，回显给用户/模型。 */
  source: string
}

/** 解析后的指令：`op` 是动词，`args` 是已切分的词，`options` 是 `k=v`。 */
export interface DslCommand {
  line: number
  source: string
  op: string
  args: string[]
  options: Record<string, string>
}

export interface DslParseResult {
  commands: DslCommand[]
  issues: DslIssue[]
}

export interface DslApplyOptions {
  document: DslDocument
  symbols: DslSymbol[]
  tags?: DslTag[]
  /** 当前选中的图元 id（指令里用 `@selection` 引用）。 */
  selection?: string[]
}

export interface DslApplyResult {
  document: DslDocument
  /** 成功执行的行摘要，按执行顺序。 */
  applied: string[]
  issues: DslIssue[]
}

/** 指令集里的一条指令说明（同时用于提示词与帮助面板）。 */
export interface DslOpSpec {
  /** 指令名，例如 `align`。 */
  name: string
  group: 'draw' | 'layout' | 'canvas'
  usage: string
  summary: string
  example: string
}
