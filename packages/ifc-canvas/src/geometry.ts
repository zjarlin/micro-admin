// 绘图指令集 → IFC 世界坐标下的 2D 轮廓。
//
// 输入是场景图里已经求值过的部件（绝对像素、y 向下），输出毫米、y 向上、
// 原点在画布左下角的多边形/折线。只覆盖内置 9 种 shape；`path` 没有顶点数据，
// 交给上层标记为「缺数据」，不猜。

import type { PartLike, Point2, RectLike } from './types.ts'

export interface OutlineOptions {
  /** 像素 → 毫米比例：1000 表示 1px = 1mm。 */
  scale: number
  /** 画布高度（像素），用于把 y 向下翻成世界坐标。 */
  canvasHeight: number
  /** 原点策略：左下角或画布中心。 */
  origin?: 'bottom-left' | 'center' | undefined
  /**
   * 轮廓落在哪个平面：
   * - `facade`（默认）：返回 `[x, z]`，x 是画面横向、z 是离画面底部的高度；
   * - `plan`：返回 `[x, y]`，y 是进深（画面 y 翻转）。
   * 两种模式都只返回二维，第三维由拉伸方向决定。
   */
  plane?: 'facade' | 'plan' | undefined
}

export interface Outline {
  points: Point2[]
  closed: boolean
}

/** 画面矩形 → IFC 毫米矩形（仅用于统计/属性，不做几何）。 */
export function rectToMm(rect: RectLike, options: OutlineOptions): RectLike {
  const flippedY = options.canvasHeight - rect.y - rect.height
  const offsetX = options.origin === 'center' ? -options.canvasHeight / 2 : 0
  return {
    x: round((rect.x + offsetX) * options.scale),
    y: round(flippedY * options.scale),
    width: round(rect.width * options.scale),
    height: round(rect.height * options.scale),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function toWorld(point: Point2, options: OutlineOptions): Point2 {
  const offsetX = options.origin === 'center' ? -options.canvasHeight / 2 : 0
  // 两种平面都是「画面 y 翻转成向上」，区别只在第三维怎么用，所以这里共用一套换算。
  return [round((point[0] + offsetX) * options.scale), round((options.canvasHeight - point[1]) * options.scale)]
}

/** 圆角矩形：每个角用 4 段折线近似，足够 BIM 表达。 */
function roundedRectPoints(rect: RectLike, radius: number, segments = 4): Point2[] {
  const r = Math.max(0, Math.min(radius, Math.min(rect.width, rect.height) / 2))
  if (r <= 0) {
    return [
      [rect.x, rect.y],
      [rect.x + rect.width, rect.y],
      [rect.x + rect.width, rect.y + rect.height],
      [rect.x, rect.y + rect.height],
    ]
  }
  const corners = [
    { cx: rect.x + rect.width - r, cy: rect.y + r, start: -Math.PI / 2 },
    { cx: rect.x + rect.width - r, cy: rect.y + rect.height - r, start: 0 },
    { cx: rect.x + r, cy: rect.y + rect.height - r, start: Math.PI / 2 },
    { cx: rect.x + r, cy: rect.y + r, start: Math.PI },
  ]
  const points: Point2[] = []
  for (const corner of corners) {
    for (let i = 0; i <= segments; i += 1) {
      const angle = corner.start + (Math.PI / 2) * (i / segments)
      points.push([corner.cx + r * Math.cos(angle), corner.cy + r * Math.sin(angle)])
    }
  }
  return points
}

function ellipsePoints(rect: RectLike, segments = 28): Point2[] {
  const rx = rect.width / 2
  const ry = rect.height / 2
  const cx = rect.x + rx
  const cy = rect.y + ry
  const points: Point2[] = []
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)])
  }
  return points
}

/** 填充条：按当前比例从底部裁出的实心块（导出按满量程处理）。 */
function fillBarPoints(rect: RectLike, ratio: number, radius: number): Point2[] {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  const height = Math.max(rect.height, 0) * clamped
  return roundedRectPoints({ x: rect.x, y: rect.y + (rect.height - height), width: rect.width, height }, radius)
}

/**
 * 部件 → 世界坐标轮廓。
 *
 * - 闭合图形返回 `closed: true`，可用于拉伸成实体；
 * - `line` / `polyline` 是开放折线，只进注释图层；
 * - `path` / `text` 返回 null（前者缺顶点，后者按贴面处理）。
 */
export function outlineOf(
  part: PartLike,
  options: OutlineOptions,
  ratio = part.ratio ?? 1,
): Outline | null {
  const rect = part.rect
  let base: Point2[] = []
  let closed = true
  switch (part.shape) {
    case 'rect':
      base = roundedRectPoints(rect, 0)
      break
    case 'roundRect':
      base = roundedRectPoints(rect, part.cornerRadius ?? 0)
      break
    case 'ellipse':
      base = ellipsePoints(rect)
      break
    case 'polygon':
      base = (part.points ?? []).slice()
      break
    case 'polyline':
      base = (part.points ?? []).slice()
      closed = false
      break
    case 'line': {
      const points = part.points ?? []
      base = points.slice(0, 2)
      closed = false
      break
    }
    case 'fillBar':
      base = fillBarPoints(rect, ratio, part.cornerRadius ?? 0)
      break
    case 'path':
    case 'text':
    default:
      return null
  }
  if (base.length < 2) return null
  return { points: base.map((point) => toWorld(point, options)), closed }
}

/** 轮廓的外接盒（毫米），用于算拉伸厚度和轴测投影。 */
export function boundsOf(points: Point2[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** 是否近似圆（长宽比接近 1 且顶点多），用于决定圆柱 vs 拉伸。 */
export function looksCircular(points: Point2[]): boolean {
  if (points.length < 8) return false
  const box = boundsOf(points)
  if (box.width <= 0 || box.height <= 0) return false
  const ratio = box.width / box.height
  return ratio > 0.85 && ratio < 1.18
}

/** 闭合多边形 → IFC 需要的逆时针顺序（右手定则决定实体朝向）。 */
export function ensureCounterClockwise(points: Point2[]): Point2[] {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    if (!current || !next) continue
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area >= 0 ? points : points.slice().reverse()
}
