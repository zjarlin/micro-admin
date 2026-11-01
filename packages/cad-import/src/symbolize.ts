// 图纸实体 → 组态图元：把「线、圈、折线、字」归成图元库里真有的那几种形状。
//
// 这一步是整条链路的省 token 关键：DXF 里几千条 LINE 不可能丢给模型，
// 但归类完只剩「N 个矩形、M 条管道、K 个圆、T 条文字」，摘要几十行就够模型读懂。
//
// 三条取向（都是为了让组态画面「看起来像那张图」，而不是像矢量编辑器）：
// 1. **轴向优先**：夹角小于容差的斜线吸附成水平/垂直管道——组态里斜管道不好接变量；
// 2. **合并同类**：同图层、同轴、端点相接的多段线合成一条管道（CAD 里一条管常被切成几十段）；
// 3. **文字带位置**：文字不合并，因为它是标注；落在矩形内部的文字会写成该矩形的名称。
import type { CadEntity, CadPoint, CadShape, CadSymbolizeOptions, CadSymbolizeResult } from './types.ts'

const DEFAULT_CANVAS = { width: 1920, height: 1080 }
/** 画布四周留白（像素）：导入的画面还要放标题、补变量显示，不能顶到边。 */
const PADDING = 32
/** 管道的最小长宽比：长宽比小于它就算「块」而不是「管」。 */
const PIPE_ASPECT = 6

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boxOfPoints(points: CadPoint[]): Box {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * 稳健取景：图纸里常有几个「离主体几百倍远」的实体（画错的辅助线、块缩放炸掉的标注、
 * 从别的图复制进来的残留几何）。用全量包围盒取景会让主体缩成一个小点——实测一张
 * 3000 单位的图被一个 1e6 外的块拖到缩放比 0.000，几何全部低于最小尺寸被丢弃。
 *
 * 判定**按实体**做分位，不是按顶点：一条 25 段的圆角管道会产生几百个点，
 * 拿点做分位会把主体范围压到那条管道身上（第一版就是这么误剪了 138/141 个实体）。
 * 剪枝也很保守：只有全量比主体大 5 倍以上才生效，且会把「离主体 2 倍以内」的实体全捞回来，
 * 正常图纸走全量包围盒，行为与没有这层保护时完全一致。
 */
const OUTLIER_RATIO = 5
/** 主体范围向外扩张的倍数：够把紧挨着的真实图元捞回来，又不至于把散点重新放大。 */
const OUTLIER_MARGIN = 2

function percentileBox(boxes: Box[], low: number, high: number): Box {
  const pickMinX = boxes.map((box) => box.minX).sort((left, right) => left - right)
  const pickMaxX = boxes.map((box) => box.maxX).sort((left, right) => left - right)
  const pickMinY = boxes.map((box) => box.minY).sort((left, right) => left - right)
  const pickMaxY = boxes.map((box) => box.maxY).sort((left, right) => left - right)
  const at = (list: number[], ratio: number): number => {
    if (list.length === 0) return 0
    const index = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * ratio)))
    return list[index] as number
  }
  return { minX: at(pickMinX, low), minY: at(pickMinY, low), maxX: at(pickMaxX, high), maxY: at(pickMaxY, high) }
}

function unionBox(boxes: Box[]): Box {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  return { minX, minY, maxX, maxY }
}

function robustBounds(boxes: Box[], warnings: string[]): { box: Box; clipped: boolean } {
  if (boxes.length === 0) return { box: boxOfPoints([]), clipped: false }
  const full = unionBox(boxes)
  const core = percentileBox(boxes, 0.1, 0.9)
  const coreWidth = Math.max(width(core), 1)
  const coreHeight = Math.max(height(core), 1)
  const ratio = Math.max(width(full) / coreWidth, height(full) / coreHeight)
  if (!Number.isFinite(ratio) || ratio < OUTLIER_RATIO) return { box: full, clipped: false }
  // 把紧挨主体（2 倍以内）的实体捞回来：放宽后的框仍远小于全量，但不会误剪贴边图元。
  const slack: Box = {
    minX: core.minX - coreWidth * OUTLIER_MARGIN,
    minY: core.minY - coreHeight * OUTLIER_MARGIN,
    maxX: core.maxX + coreWidth * OUTLIER_MARGIN,
    maxY: core.maxY + coreHeight * OUTLIER_MARGIN,
  }
  const kept = boxes.filter((box) => !escapes(box, slack))
  const frame = unionBox(kept.length > 0 ? kept : [core])
  warnings.push(`有少量实体离图纸主体超过 ${Math.round(ratio)} 倍远，已按主体范围取景（这类离群图元不进画面）`)
  return { box: frame, clipped: true }
}

/**
 * 实体是否**越出**取景框。
 *
 * 注意不能用「与框不相交」来判断：块缩放炸掉的那种巨型线条（样本里 1.4M × 1.4M）
 * 会把整个主体包在里面，与框明明相交，却正是要被剪掉的那个。判据必须是「伸出去多远」。
 */
function escapes(box: Box, frame: Box): boolean {
  return box.minX < frame.minX || box.maxX > frame.maxX || box.minY < frame.minY || box.maxY > frame.maxY
}

function width(box: Box): number {
  return box.maxX - box.minX
}

function height(box: Box): number {
  return box.maxY - box.minY
}

/** 矩形度：闭合折线是不是「四条边都贴着包围盒」——用来把 4 点闭合折线认成矩形。 */
function isRectangle(points: CadPoint[], tolerance: number): boolean {
  if (points.length < 4) return false
  const box = boxOfPoints(points)
  const w = width(box)
  const h = height(box)
  if (w <= 0 || h <= 0) return false
  // 每个点都必须落在包围盒的某条边上（容差按图幅给），否则就是斜四边形。
  return points.every((point) => (
    Math.abs(point.x - box.minX) <= tolerance || Math.abs(point.x - box.maxX) <= tolerance ||
    Math.abs(point.y - box.minY) <= tolerance || Math.abs(point.y - box.maxY) <= tolerance
  ))
}

/** 把折线按「首尾相接」的轴向线段合并；返回轴向线段列表。 */
interface Run {
  layer: string
  axis: 'h' | 'v'
  from: CadPoint
  to: CadPoint
  segments: number
}

function angleOf(a: CadPoint, b: CadPoint): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function isAxisAligned(a: CadPoint, b: CadPoint, toleranceDeg: number): 'h' | 'v' | null {
  let angle = Math.abs(angleOf(a, b))
  if (angle > 90) angle = 180 - angle
  if (angle <= toleranceDeg) return 'h'
  if (angle >= 90 - toleranceDeg) return 'v'
  return null
}

/** 端点距离：合并判断用（图纸单位）。 */
function distance(a: CadPoint, b: CadPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * 合并轴向线段：同图层、同轴、端点相接（容差 = 线宽的 1.5 倍）就并成一条。
 * 用「先收集再贪心合并」而不是扫描时合并，是因为 CAD 里同一根管常被切成几十段，
 * 顺序还未必连续。
 */
function mergeRuns(segments: Array<{ layer: string; axis: 'h' | 'v'; from: CadPoint; to: CadPoint }>, tolerance: number): Run[] {
  const runs: Run[] = []
  const pending = segments.map((segment) => ({ ...segment }))
  // 长段优先合并：短的更容易被吸到长段上，避免管道被切成碎条。
  pending.sort((left, right) => distance(left.from, left.to) - distance(right.from, right.to))
  while (pending.length > 0) {
    const seed = pending.pop()
    if (!seed) break
    let run: Run = {
      layer: seed.layer,
      axis: seed.axis,
      from: { ...seed.from },
      to: { ...seed.to },
      segments: 1,
    }
    let merged = true
    while (merged) {
      merged = false
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]
        if (!candidate || candidate.layer !== run.layer || candidate.axis !== run.axis) continue
        const ends = [candidate.from, candidate.to]
        const runEnds = [run.from, run.to]
        let touched = false
        for (const end of ends) {
          for (const anchor of runEnds) {
            if (distance(end, anchor) <= tolerance) {
              touched = true
              break
            }
          }
          if (touched) break
        }
        if (!touched) continue
        // 合并后取两端最远的点，保持方向一致（from → to 按坐标升序）。
        const all = [run.from, run.to, candidate.from, candidate.to]
        if (run.axis === 'h') {
          const left = all.reduce((min, point) => (point.x < min.x ? point : min))
          const right = all.reduce((max, point) => (point.x > max.x ? point : max))
          run = { ...run, from: left, to: right, segments: run.segments + 1 }
        } else {
          const bottom = all.reduce((min, point) => (point.y < min.y ? point : min))
          const top = all.reduce((max, point) => (point.y > max.y ? point : max))
          run = { ...run, from: bottom, to: top, segments: run.segments + 1 }
        }
        pending.splice(index, 1)
        merged = true
      }
    }
    runs.push(run)
  }
  return runs
}

/**
 * 把矩形夹回画布：管道有 8~24px 的线宽，贴在画布边缘时会溢出半条线宽。
 * 只夹位置、不改尺寸（尺寸一旦被夹小，管道看着就断头了）。
 */
function clampRect(rect: CadShape['rect'], canvas: { width: number; height: number }): CadShape['rect'] {
  return {
    x: Math.max(0, Math.min(rect.x, canvas.width - rect.width)),
    y: Math.max(0, Math.min(rect.y, canvas.height - rect.height)),
    width: rect.width,
    height: rect.height,
  }
}

/** 文字是否落在某个矩形里（给矩形取名字用）。 */
function textInside(box: Box, point: CadPoint): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY
}

/** 单个实体的包围盒（圆/椭圆用外接方框，文字按「字数 × 字高 × 0.6」估宽）。 */
export function boxOfEntity(entity: CadEntity): Box {
  switch (entity.kind) {
    case 'line':
      return boxOfPoints([entity.a, entity.b])
    case 'polyline':
      return boxOfPoints(entity.points)
    case 'circle':
      return boxOfPoints([
        { x: entity.center.x - entity.radius, y: entity.center.y - entity.radius },
        { x: entity.center.x + entity.radius, y: entity.center.y + entity.radius },
      ])
    case 'ellipse': {
      const reach = Math.hypot(entity.major.x, entity.major.y)
      return boxOfPoints([
        { x: entity.center.x - reach, y: entity.center.y - reach },
        { x: entity.center.x + reach, y: entity.center.y + reach },
      ])
    }
    case 'text':
      return boxOfPoints([entity.at, { x: entity.at.x + entity.text.length * entity.height * 0.6, y: entity.at.y - entity.height }])
    case 'point':
      return boxOfPoints([entity.at])
    default:
      // 新增实体类型时不要静默返回 undefined：给一个退化框，取景照常工作。
      return boxOfPoints([])
  }
}

/**
 * 主入口：实体 → 画布图元。
 *
 * 坐标口径：DXF 的 y 轴向上、画布 y 轴向下，因此先翻转 y；再按包围盒等比缩放并留白。
 * 结果是「图在画布里的相对位置不变」，与用户期望的「把图纸摆进画面」一致。
 */
export function symbolize(entities: CadEntity[], options: CadSymbolizeOptions = {}): CadSymbolizeResult {
  const canvas = options.canvas ?? DEFAULT_CANVAS
  const minSize = options.minSize ?? 6
  const maxShapes = options.maxShapes ?? 240
  const snapAngle = options.snapAngle ?? 12
  const warnings: string[] = []

  const layerFilter = options.layers && options.layers.length > 0 ? new Set(options.layers) : null
  const usable = entities.filter((entity) => (layerFilter ? layerFilter.has(entity.layer) : true))

  // 每个实体自己的包围盒：取景与「是否在图内」都以实体为单位判断。
  const entityBoxes = new Map<CadEntity, Box>()
  for (const entity of usable) entityBoxes.set(entity, boxOfEntity(entity))

  if (entityBoxes.size === 0) {
    return {
      shapes: [],
      canvas,
      scale: 1,
      warnings: ['图纸里没有可用的实体'],
      stats: { entities: 0, used: 0, dropped: 0, merged: 0, byKind: {} },
    }
  }
  const framed = robustBounds([...entityBoxes.values()], warnings)
  const bounds = framed.box
  const drawingWidth = Math.max(width(bounds), 1)
  const drawingHeight = Math.max(height(bounds), 1)
  const inner = { width: Math.max(canvas.width - PADDING * 2, 1), height: Math.max(canvas.height - PADDING * 2, 1) }
  const scale = Math.min(inner.width / drawingWidth, inner.height / drawingHeight)
  // 居中偏移：缩完之后把图纸摆到画布中央，两边留白一致。
  const offsetX = PADDING + (inner.width - drawingWidth * scale) / 2
  const offsetY = PADDING + (inner.height - drawingHeight * scale) / 2

  /** 图纸坐标 → 画布坐标（y 翻转）。 */
  const toCanvas = (point: CadPoint): CadPoint => ({
    x: offsetX + (point.x - bounds.minX) * scale,
    y: offsetY + (bounds.maxY - point.y) * scale,
  })

  const shapes: CadShape[] = []
  const texts: Array<{ at: CadPoint; box: Box; text: string; height: number }> = []
  const segmentQueue: Array<{ layer: string; axis: 'h' | 'v'; from: CadPoint; to: CadPoint }> = []
  let mergedCount = 0
  const byKind: Record<string, number> = {}

  /** 线段落点：轴向的进合并队列，斜的按「最小包围盒」变成一个细长矩形（保留倾斜感）。 */
  const pushSegment = (layer: string, a: CadPoint, b: CadPoint): void => {
    const axis = isAxisAligned(a, b, snapAngle)
    if (axis) {
      segmentQueue.push({ layer, axis, from: a, to: b })
      return
    }
    const box = boxOfPoints([a, b])
    if (Math.min(width(box), height(box)) * scale < minSize) return
    shapes.push({
      symbolKey: 'basic.line',
      id: '',
      rect: {
        x: toCanvas({ x: box.minX, y: box.maxY }).x,
        y: toCanvas({ x: box.minX, y: box.maxY }).y,
        width: Math.max(width(box) * scale, minSize),
        height: Math.max(height(box) * scale, minSize),
      },
      rotation: 'none',
      props: {},
      name: '线段',
      layer,
      merged: 1,
    })
    byKind['line'] = (byKind['line'] ?? 0) + 1
  }

  /** 取景框外的实体直接跳过：它们只会被 clamp 到画布边缘，变成一堆假图元。 */
  let clipped = 0
  const inFrame = (entity: CadEntity): boolean => {
    if (!framed.clipped) return true
    const box = entityBoxes.get(entity)
    if (!box || !escapes(box, bounds)) return true
    clipped += 1
    return false
  }

  for (const entity of usable) {
    if (!inFrame(entity)) continue
    switch (entity.kind) {
      case 'line':
        pushSegment(entity.layer, entity.a, entity.b)
        break
      case 'polyline': {
        const box = boxOfPoints(entity.points)
        const w = width(box) * scale
        const h = height(box) * scale
        if (entity.closed && isRectangle(entity.points, Math.max(w, h) * 0.08)) {
          // 闭合且四边贴边 → 矩形/管道/设备框。
          if (Math.min(w, h) < minSize) break
          const long = Math.max(w, h)
          const short = Math.min(w, h)
          if (long / Math.max(short, 1) >= PIPE_ASPECT) {
            const horizontal = w >= h
            shapes.push({
              symbolKey: horizontal ? 'pipe.line-h' : 'pipe.line-v',
              id: '',
              rect: {
                x: toCanvas({ x: box.minX, y: box.maxY }).x,
                y: toCanvas({ x: box.minX, y: box.maxY }).y,
                width: Math.max(w, minSize),
                height: Math.max(h, minSize),
              },
              rotation: 'none',
              props: {},
              name: horizontal ? '管道' : '管道',
              layer: entity.layer,
              merged: entity.points.length,
            })
            byKind[horizontal ? 'pipe-h' : 'pipe-v'] = (byKind[horizontal ? 'pipe-h' : 'pipe-v'] ?? 0) + 1
            break
          }
          shapes.push({
            symbolKey: 'basic.rect',
            id: '',
            rect: {
              x: toCanvas({ x: box.minX, y: box.maxY }).x,
              y: toCanvas({ x: box.minX, y: box.maxY }).y,
              width: Math.max(w, minSize),
              height: Math.max(h, minSize),
            },
            rotation: 'none',
            // 圆角归零：图纸上的设备框都是直角，组态里再圆角会失真。
            props: { radius: 0 },
            name: '矩形',
            layer: entity.layer,
            merged: entity.points.length,
          })
          byKind.rect = (byKind.rect ?? 0) + 1
          break
        }
        if (entity.closed && entity.points.length === 3 && w >= minSize && h >= minSize) {
          shapes.push({
            symbolKey: 'basic.triangle',
            id: '',
            rect: {
              x: toCanvas({ x: box.minX, y: box.maxY }).x,
              y: toCanvas({ x: box.minX, y: box.maxY }).y,
              width: Math.max(w, minSize),
              height: Math.max(h, minSize),
            },
            rotation: 'none',
            props: {},
            name: '三角形',
            layer: entity.layer,
            merged: 3,
          })
          byKind.triangle = (byKind.triangle ?? 0) + 1
          break
        }
        // 其余折线：逐段拆成线段（拐弯管道、轮廓线都走这条路）。
        for (let index = 1; index < entity.points.length; index += 1) {
          const from = entity.points[index - 1]
          const to = entity.points[index]
          if (!from || !to) continue
          pushSegment(entity.layer, from, to)
        }
        if (entity.closed && entity.points.length > 2) {
          const first = entity.points[0]
          const last = entity.points[entity.points.length - 1]
          if (first && last) pushSegment(entity.layer, last, first)
        }
        break
      }
      case 'circle': {
        const diameter = entity.radius * 2 * scale
        if (diameter < minSize) break
        const center = toCanvas(entity.center)
        shapes.push({
          symbolKey: 'basic.ellipse',
          id: '',
          rect: {
            x: center.x - diameter / 2,
            y: center.y - diameter / 2,
            width: diameter,
            height: diameter,
          },
          rotation: 'none',
          props: {},
          name: '圆',
          layer: entity.layer,
          merged: 1,
        })
        byKind.circle = (byKind.circle ?? 0) + 1
        break
      }
      case 'ellipse': {
        const radius = Math.hypot(entity.major.x, entity.major.y) * scale
        if (radius * 2 < minSize) break
        const center = toCanvas(entity.center)
        shapes.push({
          symbolKey: 'basic.ellipse',
          id: '',
          rect: { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 },
          rotation: 'none',
          props: {},
          name: '椭圆',
          layer: entity.layer,
          merged: 1,
        })
        byKind.ellipse = (byKind.ellipse ?? 0) + 1
        break
      }
      case 'text': {
        const fontSize = Math.max(entity.height * scale, 8)
        const at = toCanvas(entity.at)
        // 文字宽度按汉字宽 ≈ 字号估：组态画布的文本是居中绘制的，宽度给足才不会挤。
        const estimated = Math.max(entity.text.length * fontSize * 1.02, fontSize)
        texts.push({
          at: { x: at.x + estimated / 2, y: at.y },
          box: { minX: at.x, minY: at.y - fontSize, maxX: at.x + estimated, maxY: at.y + fontSize * 0.2 },
          text: entity.text,
          height: fontSize,
        })
        break
      }
      case 'point':
        break
    }
  }

  // 合并轴向线段 → 管道 / 线段。
  const runs = mergeRuns(segmentQueue, Math.max(1, 2 / Math.max(scale, 1e-6)))
  for (const run of runs) {
    mergedCount += run.segments - 1
    const a = toCanvas(run.from)
    const b = toCanvas(run.to)
    const length = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    const thickness = Math.max(8, Math.min(24, length * 0.05))
    if (length < minSize) continue
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    if (run.axis === 'h') {
      shapes.push({
        symbolKey: 'pipe.line-h',
        id: '',
        rect: clampRect({ x, y: y - thickness / 2, width: length, height: thickness }, canvas),
        rotation: 'none',
        props: {},
        name: '管道',
        layer: run.layer,
        merged: run.segments,
      })
      byKind['pipe-h'] = (byKind['pipe-h'] ?? 0) + 1
    } else {
      shapes.push({
        symbolKey: 'pipe.line-v',
        id: '',
        rect: clampRect({ x: x - thickness / 2, y, width: thickness, height: length }, canvas),
        rotation: 'none',
        props: {},
        name: '管道',
        layer: run.layer,
        merged: run.segments,
      })
      byKind['pipe-v'] = (byKind['pipe-v'] ?? 0) + 1
    }
  }

  // 文字 → basic.text；落在矩形里的文字顺带成为该矩形的名称。
  for (const entry of texts) {
    if (entry.height < 8) continue
    const host = shapes.find((shape) => (
      shape.symbolKey === 'basic.rect' || shape.symbolKey === 'basic.triangle'
      || shape.symbolKey === 'basic.ellipse'
    ) && textInside(
      { minX: shape.rect.x, minY: shape.rect.y, maxX: shape.rect.x + shape.rect.width, maxY: shape.rect.y + shape.rect.height },
      entry.at,
    ))
    if (host && host.name === '矩形') host.name = entry.text
    shapes.push({
      symbolKey: 'basic.text',
      id: '',
      // 文字框直接用包围盒：DXF 的插入点是「文字基线左端」，不是画布的中心点，
      // 所以这里按 `box.minX / box.maxY` 取左上角，高度给 1.2 倍留出上下留白。
      rect: clampRect({
        x: entry.box.minX,
        y: entry.box.maxY - entry.height * 1.2,
        width: entry.box.maxX - entry.box.minX,
        height: entry.height * 1.2,
      }, canvas),
      rotation: 'none',
      props: { content: entry.text, fontSize: Math.round(entry.height) },
      name: entry.text.slice(0, 12),
      layer: '',
      merged: 1,
    })
    byKind.text = (byKind.text ?? 0) + 1
  }

  if (clipped > 0) warnings.push(`${clipped} 个实体在取景范围外（多半是画错或缩放异常的图元），已略过`)

  // 数量上限：按面积取大者（小标注线先丢），避免一张密集图纸把画布塞满。
  let dropped = clipped
  if (shapes.length > maxShapes) {
    const sorted = [...shapes].sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)
    const keep = new Set(sorted.slice(0, maxShapes).map((shape) => shape))
    dropped += shapes.length - maxShapes
    warnings.push(`图元太多（${shapes.length} 个），按面积保留前 ${maxShapes} 个，其余 ${dropped} 个已省略`)
    shapes.length = 0
    for (const shape of sorted.slice(0, maxShapes)) if (keep.has(shape)) shapes.push(shape)
  }

  // 稳定 id：类型 + 序号，AI 与指令都用它引用；按位置排序让编号符合阅读顺序。
  shapes.sort((left, right) => Math.round(left.rect.y / 8) - Math.round(right.rect.y / 8) || left.rect.x - right.rect.x)
  const counters = new Map<string, number>()
  for (const shape of shapes) {
    const prefix = shape.symbolKey.split('.').pop() ?? 'shape'
    const next = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, next)
    shape.id = `${prefix}-${next}`
  }

  return {
    shapes,
    canvas,
    scale,
    warnings,
    stats: {
      entities: usable.length,
      used: shapes.length,
      dropped,
      merged: mergedCount,
      byKind,
    },
  }
}
