// DXF 与 DWG 共用的几何原语。
//
// 两条解析链（文本 DXF / 二进制 DWG）最终都要产出同一份 `CadEntity[]`，
// 折线化、块变换、包围盒这些规则必须只有一份实现：否则同一条圆弧在两种
// 输入格式下会差半度，画面上就是两个位置。这里只放纯函数，不依赖任何解析器。
import type { CadEntity, CadPoint } from './types.ts'

/** 展开块引用时的保护：深度与总次数，防止病态图纸把进程拖死。 */
export const MAX_BLOCK_DEPTH = 8
export const MAX_INSERT_EXPANSIONS = 5000
/** 圆弧折线的每圈分段数：每 30 度一段，够画出弯头又不会把实体数翻几十倍。 */
export const ARC_SEGMENTS = 12
/** 折线中一段 bulge 弧的最大分段。 */
const BULGE_SEGMENTS = 6

/** 块引用变换：先缩放、再旋转、再平移。 */
export interface Transform {
  dx: number
  dy: number
  scaleX: number
  scaleY: number
  /** 旋转角（度）。 */
  rotation: number
}

export const IDENTITY: Transform = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 }

export const DEG_PER_RAD = 180 / Math.PI
export const RAD_PER_DEG = Math.PI / 180

function rotatePoint(point: CadPoint, degrees: number): CadPoint {
  if (!degrees) return point
  const rad = degrees * RAD_PER_DEG
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

export function applyTransform(point: CadPoint, transform: Transform): CadPoint {
  const scaled = { x: point.x * transform.scaleX, y: point.y * transform.scaleY }
  const rotated = rotatePoint(scaled, transform.rotation)
  return { x: rotated.x + transform.dx, y: rotated.y + transform.dy }
}

/**
 * 折线顶点 + bulge：bulge 是「该段圆弧的凸度」，`tan(圆心角/4)`；
 * 正负决定弧朝哪一侧。按段折线化，才能把圆角管道/圆头画成弧。
 */
export function bulgePoints(from: CadPoint, to: CadPoint, bulge: number): CadPoint[] {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-6) return []
  const dx = to.x - from.x
  const dy = to.y - from.y
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-9) return []
  const theta = 4 * Math.atan(bulge)
  const radius = Math.abs(chord / (2 * Math.sin(theta / 2)))
  // 圆心在中点沿法线偏移：偏移量 = radius * cos(theta/2)，方向由 bulge 符号决定。
  const offset = radius * Math.cos(theta / 2) * Math.sign(bulge)
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const nx = -dy / chord
  const ny = dx / chord
  const cx = mx + nx * offset
  const cy = my + ny * offset
  const startAngle = Math.atan2(from.y - cy, from.x - cx)
  const points: CadPoint[] = []
  const steps = Math.max(3, Math.min(BULGE_SEGMENTS, Math.ceil(Math.abs(theta) / (Math.PI / 8)) * 2))
  for (let step = 1; step < steps; step += 1) {
    const angle = startAngle + (theta * step) / steps
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  }
  return points
}

/**
 * 折线顶点（每点带自己的 bulge）→ 点列。
 *
 * **bulge 属于「从该顶点出发的那一段」**，不是结束于该顶点的那一段。DXF 里组码 42 跟在
 * 10/20 之后，libredwg 里是 `vertices[i].bulge`，两处含义一致；早期 DXF 实现把它用在
 * 「上一顶点 → 本顶点」上，整整差一段（没有 bulge 的图纸看不出来，一带圆角就错位）。
 */
export function expandPolyline(vertices: Array<{ point: CadPoint; bulge: number }>): CadPoint[] {
  const first = vertices[0]
  if (!first) return []
  const points: CadPoint[] = [first.point]
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const from = vertices[index] as { point: CadPoint; bulge: number }
    const to = vertices[index + 1] as { point: CadPoint; bulge: number }
    points.push(...bulgePoints(from.point, to.point, from.bulge), to.point)
  }
  return points
}

/**
 * 圆弧折线化。
 *
 * **角度单位由调用方决定**：DXF 的组码 50/51 是度，libredwg 的 `startAngle` 是弧度。
 * 这里统一收「度」，弧度调用方自己乘 `DEG_PER_RAD`——把单位换算放在哪条链自己手里，
 * 比在这个函数里猜备选方案可靠。
 */
export function arcPoints(center: CadPoint, radius: number, startDeg: number, endDeg: number, segments = ARC_SEGMENTS): CadPoint[] {
  let sweep = endDeg - startDeg
  if (sweep <= 0) sweep += 360
  const steps = Math.max(4, Math.ceil((Math.abs(sweep) / 360) * segments))
  const points: CadPoint[] = []
  for (let step = 0; step <= steps; step += 1) {
    const angle = (startDeg + (sweep * step) / steps) * RAD_PER_DEG
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  }
  return points
}

/**
 * 椭圆折线化（参数角，弧度）：`major` 是「相对圆心的长轴端点」，`minor` 由 `ratio` 旋转 90° 得到。
 * `fullSweep` 为真时返回闭合点列（首尾相同），调用方按需当成圆处理。
 */
export function ellipsePoints(center: CadPoint, major: CadPoint, ratio: number, startRad: number, endRad: number, steps = 48): CadPoint[] {
  const minor = { x: -major.y * ratio, y: major.x * ratio }
  const sweep = endRad - startRad
  const points: CadPoint[] = []
  for (let step = 0; step <= steps; step += 1) {
    const angle = startRad + (sweep * step) / steps
    points.push({
      x: center.x + major.x * Math.cos(angle) + minor.x * Math.sin(angle),
      y: center.y + major.y * Math.cos(angle) + minor.y * Math.sin(angle),
    })
  }
  return points
}

/** 图纸包围盒：圆弧用采样点，圆用中心 ± 半径，文字按高度估。 */
export function extentsOf(entities: CadEntity[]): { min: CadPoint; max: CadPoint } | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const grow = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const entity of entities) {
    switch (entity.kind) {
      case 'line':
        grow(entity.a.x, entity.a.y)
        grow(entity.b.x, entity.b.y)
        break
      case 'polyline':
        for (const point of entity.points) grow(point.x, point.y)
        break
      case 'circle':
        grow(entity.center.x - entity.radius, entity.center.y - entity.radius)
        grow(entity.center.x + entity.radius, entity.center.y + entity.radius)
        break
      case 'ellipse': {
        const reach = Math.hypot(entity.major.x, entity.major.y)
        grow(entity.center.x - reach, entity.center.y - reach)
        grow(entity.center.x + reach, entity.center.y + reach)
        break
      }
      case 'text':
        grow(entity.at.x, entity.at.y)
        grow(entity.at.x + entity.text.length * entity.height * 0.6, entity.at.y + entity.height)
        break
      case 'point':
        grow(entity.at.x, entity.at.y)
        break
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/**
 * MTEXT / 标注里的控制码：`\P` 是换行，`\fArial|b0;` 这类是字体/格式前缀，`{}` 是分组。
 * 顺序有讲究：先处理 `\\`（转义的反斜杠），否则后面的规则会把转义字符当成控制码前缀吃掉。
 */
export function plainCadText(raw: string): string {
  return raw
    .replace(/\\\\/g, '\u0000')
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\u0000/g, '\\')
    .trim()
}
