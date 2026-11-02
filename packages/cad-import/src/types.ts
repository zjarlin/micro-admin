// CAD 导入的公共类型。
//
// 分层与 `scada-dsl` 同构：几何（`dxf`）→ 图元归类（`symbolize`）→ 绘图指令（`commands`），
// 每一层都能单独用。指令层复用 `scada-dsl` 的语法，因此「CAD 转出来的画面」与
// 「AI 生成的画面」是同一份中间表示，模型只需要读摘要、写指令，不必读整份 DXF。

export interface CadPoint {
  x: number
  y: number
}

/** 图纸单位：来自 `$INSUNITS`，只用于换算提示，不参与缩放。 */
export type CadUnit = 'unitless' | 'mm' | 'cm' | 'm' | 'inch' | 'foot' | 'other'

/** DXF 图层（含开关状态，供筛选与摘要）。 */
export interface CadLayer {
  name: string
  /** 图层是否可见：关闭（color < 0）或冻结都算不可见。 */
  visible: boolean
  color: number | null
  frozen: boolean
}

/** 解析后的图纸实体：已展开 INSERT、已把 bulge 折成折线点。 */
export type CadEntity =
  | { kind: 'line'; layer: string; a: CadPoint; b: CadPoint }
  | { kind: 'polyline'; layer: string; closed: boolean; points: CadPoint[] }
  | { kind: 'circle'; layer: string; center: CadPoint; radius: number }
  | { kind: 'arc'; layer: string; center: CadPoint; radius: number; start: number; end: number }
  | { kind: 'ellipse'; layer: string; center: CadPoint; major: CadPoint; ratio: number; start: number; end: number }
  | { kind: 'text'; layer: string; at: CadPoint; height: number; text: string; rotation: number }
  | { kind: 'point'; layer: string; at: CadPoint }

export interface CadDrawing {
  /** `$ACADVER`，如 `AC1015`（R2000）。 */
  version: string
  units: CadUnit
  layers: CadLayer[]
  entities: CadEntity[]
  /** 图纸包围盒（世界坐标）。 */
  extents: { min: CadPoint; max: CadPoint } | null
  warnings: string[]
  stats: {
    /** 解析到的原始实体数（INSERT 展开前）。 */
    raw: number
    /** 展开后的实体数。 */
    expanded: number
    blocks: number
  }
}

/** 归类后的一格画面图元（已换算到画布坐标）。 */
export interface CadShape {
  /** 目标图元 key（必须是图元库里存在的 key）。 */
  symbolKey: string
  /** 稳定短 id，用于指令里的 `as`。 */
  id: string
  /** 画布坐标（左上原点，已缩放）。 */
  rect: { x: number; y: number; width: number; height: number }
  /** 旋转（仅 90 度倍数）。 */
  rotation: 'none' | 'deg90' | 'deg180' | 'deg270'
  /** 需要写到 props 的覆盖值（文本内容、字号等）。 */
  props: Record<string, string | number>
  /** 名称：优先取附近的标注文字，其次按类型编号。 */
  name: string
  /** 来源图层，便于「按图层筛选」与摘要。 */
  layer: string
  /** 原图纸上的实体数（合并后统计），用于摘要里给出「合并了 N 条」。 */
  merged: number
}

export interface CadSymbolizeOptions {
  /** 目标画布尺寸；缺省 1920x1080。 */
  canvas?: { width: number; height: number }
  /** 只保留这些图层（不传则保留全部可见图层）。 */
  layers?: string[]
  /** 丢弃小于该像素宽/高的图形（噪声：标注箭头、填充线头）。默认 6。 */
  minSize?: number
  /** 最多输出多少格图元（超出按面积取大者）。默认 240。 */
  maxShapes?: number
  /** 斜线吸附容差（度）：线段与水平/垂直的夹角小于它时按轴对齐。默认 12。 */
  snapAngle?: number
}

export interface CadSymbolizeResult {
  shapes: CadShape[]
  /** 画布尺寸（已按图纸比例调整过）。 */
  canvas: { width: number; height: number }
  /** 图纸 → 画布的缩放比（像素 / 图纸单位）。 */
  scale: number
  warnings: string[]
  stats: {
    entities: number
    used: number
    dropped: number
    merged: number
    byKind: Record<string, number>
  }
}
