// 输入/输出契约：本包不认识业务类型，只认识「已求值的场景图」。
//
// 调用方（micro-admin 服务端、别的项目、CLI）负责把画面文档求值成 `SceneLike`，
// 这里只做「图元 → 3D 规格 → IFC 实体 / 轴测图」的纯函数转换，没有任何 DOM、
// 存储或框架依赖，因此可以整体搬到独立仓库发布。

/** 绝对像素矩形（左上角原点，y 向下），与服务端场景图同构。 */
export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export type Point2 = [number, number]

/** 已求值的单个部件；坐标是画面绝对像素。 */
export interface PartLike {
  id: string
  shape: string
  rect: RectLike
  /** polygon / polyline / line 的绝对像素顶点。 */
  points?: Point2[] | undefined
  path?: string | null | undefined
  cornerRadius?: number | undefined
  text?: string | null | undefined
  fill?: string | undefined
  /** fillBar 的当前比例（0..1）。 */
  ratio?: number | undefined
  visible?: boolean | undefined
}

/** 已求值的图元实例。 */
export interface WidgetLike {
  id: string
  symbolKey: string
  name?: string | undefined
  rect: RectLike
  rotationDegrees?: number | undefined
  zIndex?: number | undefined
  parts: PartLike[]
}

/** 已求值的场景图。 */
export interface SceneLike {
  width: number
  height: number
  background?: string | undefined
  widgets: WidgetLike[]
}

/** 图元库里的定义（只用到 3D 映射需要的字段）。 */
export interface SymbolLike {
  key: string
  name?: string | undefined
  category?: string | undefined
  palette?: Record<string, string> | undefined
}

// ---------------- 3D 规格 ----------------

/** 零件在 BIM 里的角色，决定用哪种 IFC 实体承载。 */
export type PartRole = 'structure' | 'panel' | 'instrument' | 'machine' | 'vessel' | 'pipe' | 'label'

/** 几何生成方式。 */
export type ExtrusionForm =
  /** 轮廓沿 +Z 拉伸（默认）。 */
  | 'extrude'
  /** 外接圆 → 圆柱（泵、电机等回转体）。 */
  | 'cylinder'
  /** 壳体外轮廓 + 液位内柱（储罐）。 */
  | 'shell'
  /** 沿主轴扫掠成圆管（管道）。 */
  | 'pipe'
  /** 贴面文字，不做实体，只进属性集。 */
  | 'decal'
  /** 数据不足或无实体意义，跳过。 */
  | 'skip'

export type ExtrusionMaterial =
  | 'concrete'
  | 'steel'
  | 'stainless'
  | 'glass'
  | 'plastic'
  | 'paint'
  | 'liquid'
  | 'none'

/** 厚度策略：按零件较小边比例，或固定毫米。 */
export type DepthRule = { mode: 'ratio'; ratio: number } | { mode: 'absolute'; mm: number }

export interface Part3DSpec {
  role: PartRole
  form: ExtrusionForm
  depthRule: DepthRule
  /** 底面离地高度（毫米）。 */
  elevation: number
  material: ExtrusionMaterial
  textMode: 'decal' | 'skip'
}

/** 需要追问 AI 的字段。 */
export type MissingField = 'role' | 'form' | 'depth' | 'elevation' | 'material'

export type DecisionSource = 'rule' | 'heuristic' | 'override' | 'ai' | 'default'

/** 单个零件的最终决策（毫米）。 */
export interface PartDecision extends Part3DSpec {
  depth: number
  source: DecisionSource
}

export interface PlanItem {
  widgetId: string
  widgetName: string
  symbolKey: string
  partId: string
  shape: string
  /** 图元分类（symbol.category），用于兜底实体类型。 */
  symbolCategory: string
  /** 画面绝对像素几何，写 IFC 时复用，不再二次求值。 */
  rect: RectLike
  /** 世界坐标（毫米）轮廓；`null` 表示无法出几何（path 等）。 */
  outline: Point2[] | null
  closed: boolean
  /** 文字内容（贴面零件写进属性集，不做实体）。 */
  text: string | null
  /** 画面里的填充色（16 进制），轴测图用它上色，让 3D 也能认出是哪一页。 */
  fill: string | null
  /** 规则命中情况；`null` 表示数据不足，需要 `missing` 补齐。 */
  decision: PartDecision | null
  missing: MissingField[]
  /** 决策缓存键：同一图元/部件/形状/配色重复出现时直接复用。 */
  cacheKey: string
  /** 给 AI 的提示（只在 `missing` 非空时出现）。 */
  hint: string
}

export interface ScenePlanSettings {
  /** 长度单位；IFC 里统一米/毫米都支持，默认毫米。 */
  unit: 'mm' | 'm'
  /** 画面像素 → 毫米的换算：1000 表示 1px = 1mm。 */
  pixelsPerMeter: number
  /** 世界坐标原点的画面对应位置。 */
  origin: 'bottom-left' | 'center'
  /** 向上轴，本包只支持 +Z。 */
  up: '+Z'
  /**
   * 画面落到三维的方式：
   * - `facade`（默认）：画面立成一堵墙，画面 y 变成世界 Z（高度），图元朝墙内拉伸。
   *   这是「复刻现有页面」的口径，缩略图与预览一眼能认出是哪一页。
   * - `plan`：画面当成平面图铺在地面上，图元沿 +Z 向上拉伸（设备高度用规则表里的 elevation）。
   */
  projection: 'facade' | 'plan'
}

export interface ExtrusionPlan {
  screenName: string
  settings: ScenePlanSettings
  /** 画面外接尺寸（毫米），由画布像素与换算比例直接得出。 */
  canvas: { widthMm: number; heightMm: number }
  items: PlanItem[]
  /** 汇总的缺参字段（去重），空数组表示可以直接导出。 */
  missing: MissingField[]
  stats: {
    widgets: number
    parts: number
    solids: number
    decals: number
    skipped: number
  }
  /** 需要 AI 补齐时的最小请求体；`null` 表示不需要模型调用。 */
  aiRequest: AiExtrusionRequest | null
}

/** 交给 Responses API 的最小载荷：只发缺失字段，不发整份画面。 */
export interface AiExtrusionRequest {
  kind: 'ifc-extrusion'
  instruction: string
  items: Array<{
    key: string
    symbol: string
    part: string
    shape: string
    widthMm: number
    heightMm: number
    missing: MissingField[]
  }>
}

/** AI 返回的决策（按 `key` 对齐），服务端合并回画面后再导出。 */
export interface AiExtrusionDecision {
  key: string
  role?: PartRole | undefined
  form?: ExtrusionForm | undefined
  depth?: number | undefined
  elevation?: number | undefined
  material?: ExtrusionMaterial | undefined
}

export interface IfcMeta {
  /** 文件名与 IFC 项目名。 */
  name: string
  /** 组织名，写进 IFCOWNERHISTORY / IFCPROJECT。 */
  organization?: string
  /** 作者/导出者标识，写进 FILE_NAME。 */
  author?: string
  /** 覆盖时间戳，便于测试/固定输出。 */
  timestamp?: string
  /** 画面文档版本号，写进属性集。 */
  documentVersion?: number | undefined
  /** 画面 id / 工程 id，写进属性集便于回链。 */
  screenId?: number | undefined
  projectId?: number | undefined
}

export interface IfcFile {
  filename: string
  content: string
  /** 统计信息，接口直接透出给前端展示。 */
  stats: {
    bytes: number
    entities: number
    elements: number
    solids: number
  }
  warnings: string[]
}
