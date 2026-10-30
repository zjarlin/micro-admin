// 组态（SCADA 画面）类型：与 Rust crate `az-scada-canvas` 的结构一一对应。
//
// 后端既用这个结构校验/渲染，也把它原样存进 SQLite；前端编辑器只在本地
// 做几何与求值，最终仍然把同一份 JSON 交回后端校验。字段命名统一 camelCase，
// 与 serde 的 `rename_all = "camelCase"` 对齐，改结构时两边必须同步。

/** 图元旋转：只允许 90 度整数倍，保证命中测试与渲染一致。 */
export type ScadaRotation = 'none' | 'deg90' | 'deg180' | 'deg270'

export const SCADA_ROTATION_DEGREES: Record<ScadaRotation, number> = {
  none: 0,
  deg90: 90,
  deg180: 180,
  deg270: 270,
}

/** 画面坐标点（像素，左上角原点）。 */
export interface ScadaPoint {
  x: number
  y: number
}

/** 画面矩形（像素）。 */
export interface ScadaRect {
  x: number
  y: number
  width: number
  height: number
}

/** 画布设置。 */
export interface ScadaCanvasSettings {
  width: number
  height: number
  /** 栅格间距（像素）；0 表示不吸附。 */
  grid: number
  background: string
  showGrid: boolean
}

/** 状态色阈值：`value >= limit` 时使用给定颜色，按 limit 降序匹配第一条。 */
export interface ScadaStateThreshold {
  limit: number
  color: string
  text?: string
}

/** 图元槽位到通道变量（Tag）的绑定。 */
export interface ScadaWidgetBinding {
  slot: string
  tagId: number
  /** 变量展示名快照：变量被删或离线时仍能看到引用来源。 */
  tagLabel?: string
  thresholds?: ScadaStateThreshold[]
  textMap?: Record<string, string>
  precision?: number | null
  unit?: string | null
}

/** 画面上的一个图元实例。 */
export interface ScadaWidget {
  id: string
  symbolKey: string
  name: string
  rect: ScadaRect
  rotation: ScadaRotation
  zIndex: number
  props: Record<string, unknown>
  bindings: ScadaWidgetBinding[]
  locked: boolean
  visible: boolean
  groupId?: string | null
}

/** 组态画面文档。 */
export interface ScadaDocument {
  version: number
  canvas: ScadaCanvasSettings
  widgets: ScadaWidget[]
}

/** 图元分类：编辑器左侧面板按它分组。 */
export type ScadaSymbolCategory =
  | 'basic'
  | 'pipe'
  | 'machine'
  | 'vessel'
  | 'instrument'
  | 'control'
  | 'custom'

/** 图形部件类型。 */
export type ScadaShapeKind =
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon'
  | 'path'
  | 'text'
  | 'fillBar'

/** 属性类型：决定属性面板用哪种输入控件。 */
export type ScadaPropKind = 'text' | 'number' | 'boolean' | 'color' | 'choice'

/** 绑定槽位样式：决定变量值如何影响外观。 */
export type ScadaBindingSlotStyle =
  | 'valueText'
  | 'fillRatio'
  | 'stateColor'
  | 'visibility'
  | 'textMap'
  | 'needle'

export interface ScadaPropSpec {
  key: string
  label: string
  kind: ScadaPropKind
  default: unknown
  choices?: string[]
  group: string
  min?: number
  max?: number
  unit?: string
}

export interface ScadaBindingSlotSpec {
  key: string
  label: string
  style: ScadaBindingSlotStyle
  min: number
  max: number
  precision: number
  unit?: string
}

export interface ScadaSymbolPart {
  id: string
  shape: ScadaShapeKind
  /** 归一化矩形（0..1），相对图元包围盒。 */
  frame: ScadaRect
  fill: string
  stroke?: string | null
  strokeWidth: number
  text?: string | null
  textProp?: string | null
  textSlot?: string | null
  fontSize: number
  fontSizeProp?: string | null
  bold: boolean
  points?: Array<[number, number]>
  path?: string | null
  bindingSlot?: string | null
  cornerRadius: number
}

export interface ScadaSymbolPort {
  id: string
  label: string
  position: [number, number]
  angle: number
  kind: string
}

export interface ScadaSymbolDefinition {
  key: string
  name: string
  category: ScadaSymbolCategory
  defaultWidth: number
  defaultHeight: number
  keepAspect: boolean
  description?: string | null
  palette: Record<string, string>
  props: ScadaPropSpec[]
  bindingSlots: ScadaBindingSlotSpec[]
  parts: ScadaSymbolPart[]
  ports: ScadaSymbolPort[]
  version: number
}

// ---------------- HTTP 契约 ----------------

export interface ScadaScreenSummary {
  id: number
  projectId: number
  name: string
  description: string | null
  documentVersion: number
  widgetCount: number
  /** 是否已经有 3D 拉伸决策（导出过 IFC 或 AI 补过参数）。 */
  threeD?: boolean
  sortIndex: number
  createdAt: number
  updatedAt: number
}

export interface ScadaScreenDetail {
  id: number
  projectId: number
  name: string
  description: string | null
  /** 文档 JSON 原文，前端用 `parseScadaDocument` 解析。 */
  documentJson: string
  documentVersion: number
  previewSvg: string | null
  /** 3D 拉伸决策（`<widgetId>/<partId>` → 字段覆盖），null 表示全部走规则表。 */
  extrusionJson?: string | null
  sortIndex: number
  createdAt: number
  updatedAt: number
}

export interface ScadaSymbolLibraryResponse {
  version: number
  symbols: ScadaSymbolDefinition[]
  /** 安装包外部图元文件来源；为空表示只用了内置图元。 */
  externalSource: string | null
}

/** 通道变量（Tag）候选条目：组态绑定的可选清单。 */
export interface ScadaTagOption {
  tagId: number
  name: string
  /** 展示路径：`工程 / 站点 / 机箱 / 网关 / 模块 / 变量`。 */
  path: string
  assetNodeId: number
  assetNodeName: string
  channelType: string | null
  channelNo: number | null
  physicalName: string | null
  accessMode: string
  dataTypeName: string
  registerTypeName: string
  registerAddress: number
  enabled: boolean
  currentValueText: string | null
  /** 当前质量码：`GOOD` / `BAD` / `UNCERTAIN`，未采集过为空。 */
  qualityCode: string | null
  /** 当前质量文本（中文可读），未采集过为空。 */
  qualityText: string | null
}

export interface ScadaTagCatalog {
  projectId: number
  items: ScadaTagOption[]
  total: number
  writable: number
}

export interface ScadaValidateResult {
  valid: boolean
  issues: string[]
  missingTagIds: number[]
  referencedTagIds: number[]
  widgetCount: number
}

export interface ScadaPreviewValue {
  tagId: number
  raw?: number | null
  text?: string | null
  quality?: string | null
}

export interface ScadaPreviewRequest {
  projectId: number
  documentJson?: string
  screenId?: number
  values?: ScadaPreviewValue[]
  showGrid?: boolean
  includeWidgetIds?: boolean
}

export interface ScadaPreviewResult {
  svg: string
  issues: string[]
  missingTagIds: number[]
}

/** 可写判定：W / RW / WO 都能下发，与后端 `list_scada_tags` 保持一致。 */
export function isWritableAccessMode(accessMode: string | null | undefined): boolean {
  const mode = (accessMode ?? '').trim().toUpperCase()
  return mode === 'W' || mode === 'RW' || mode === 'WO'
}

/** 空白画布：与 crate `ScadaDocument::default()` 同构。 */
export function createEmptyScadaDocument(): ScadaDocument {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, grid: 10, background: '#0f172a', showGrid: true },
    widgets: [],
  }
}

/** 解析文档 JSON：字段缺失时按默认值补齐，避免老文档把编辑器打挂。 */
export function parseScadaDocument(raw: string | null | undefined): ScadaDocument {
  const fallback = createEmptyScadaDocument()
  if (!raw || !raw.trim()) {
    return fallback
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object') {
    return fallback
  }
  const canvas = parsed.canvas ?? {}
  return {
    version: Number(parsed.version ?? 1) || 1,
    canvas: {
      width: Number(canvas.width ?? fallback.canvas.width) || fallback.canvas.width,
      height: Number(canvas.height ?? fallback.canvas.height) || fallback.canvas.height,
      grid: Number.isFinite(Number(canvas.grid)) ? Number(canvas.grid) : fallback.canvas.grid,
      background: typeof canvas.background === 'string' ? canvas.background : fallback.canvas.background,
      showGrid: canvas.showGrid !== false,
    },
    widgets: Array.isArray(parsed.widgets)
      ? parsed.widgets.map((widget: any, index: number) => normalizeScadaWidget(widget, index))
      : [],
  }
}

function normalizeScadaWidget(raw: any, index: number): ScadaWidget {
  const rect = raw?.rect ?? {}
  return {
    id: String(raw?.id ?? `widget-${index + 1}`),
    symbolKey: String(raw?.symbolKey ?? ''),
    name: String(raw?.name ?? ''),
    rect: {
      x: Number(rect.x ?? 0) || 0,
      y: Number(rect.y ?? 0) || 0,
      width: Number(rect.width ?? 0) || 0,
      height: Number(rect.height ?? 0) || 0,
    },
    rotation: (['none', 'deg90', 'deg180', 'deg270'] as const).includes(raw?.rotation)
      ? (raw.rotation as ScadaRotation)
      : 'none',
    zIndex: Number(raw?.zIndex ?? 0) || 0,
    props: (raw?.props && typeof raw.props === 'object' ? raw.props : {}) as Record<string, unknown>,
    bindings: Array.isArray(raw?.bindings)
      ? raw.bindings.map((binding: any) => ({
          slot: String(binding?.slot ?? ''),
          tagId: Number(binding?.tagId ?? 0) || 0,
          tagLabel: binding?.tagLabel ?? undefined,
          thresholds: Array.isArray(binding?.thresholds)
            ? binding.thresholds.map((item: any) => ({
                limit: Number(item?.limit ?? 0) || 0,
                color: String(item?.color ?? '#64748b'),
                text: item?.text ?? undefined,
              }))
            : [],
          textMap: (binding?.textMap && typeof binding.textMap === 'object'
            ? binding.textMap
            : {}) as Record<string, string>,
          precision: binding?.precision ?? null,
          unit: binding?.unit ?? null,
        }))
      : [],
    locked: Boolean(raw?.locked),
    visible: raw?.visible !== false,
    groupId: raw?.groupId ?? null,
  }
}

/** 变量采集状态：与后端 `CollectorStatusResponse` 一一对应。 */
export interface ScadaCollectorStatus {
  enabled: boolean
  intervalMs: number
  lastCycleAt: number | null
  lastCycleCostMs: number | null
  boardCount: number
  tagCount: number
  boards: ScadaCollectorBoardStatus[]
}

/** 报警语音播报的设置与运行状态：与后端 `AlarmVoiceStatusResponse` 一一对应。 */
export interface ScadaAlarmVoiceStatus {
  enabled: boolean
  /** 告警未消失时是否反复播报。 */
  repeat: boolean
  repeatIntervalMs: number
  rate: number
  volume: number
  /** 当前平台是否有可用的离线语音后端（Windows/macOS 为 true）。 */
  supported: boolean
  /** 后端语音就绪情况：`ready` / `unavailable` / `unsupported`。 */
  backend: string
  spokenCount: number
  suppressedCount: number
  lastMessage: string | null
}

/** 单块板卡的采集结果。 */
export interface ScadaCollectorBoardStatus {
  assetNodeId: number
  boardName: string
  projectId: number
  tagCount: number
  /** `GOOD` / `BAD` / `SKIPPED`（串口被占用等让路）/ `IDLE`（采集关闭）。 */
  qualityCode: string
  message: string
  updatedAt: number | null
}
