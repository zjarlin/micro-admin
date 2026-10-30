// 场景图：把「画面文档 + 图元库 + 变量值」求值成可直接绘制的图元列表。
//
// 这是画布唯一的渲染数据源：浏览器（`ScadaSurface.vue`）、服务端（`/scada/preview`）
// 都吃同一个 `buildScene` 的结果，前者交给 Vue 画 DOM，后者交给 `sceneToSvg` 拼字符串。
// 因此这里不许出现 DOM / Vue —— 否则服务端又得复制一份绘制逻辑。
//
// 求值语义仍以 Rust crate `az-scada-canvas` 的 `behavior::resolve_widget` 为准；
// 本文件只负责「求值结果 → 几何图元」这一段。

import type { ScadaDocument, ScadaRect, ScadaSymbolDefinition } from './types.ts'
import { resolveWidget, type ResolvedPart, type TagValueSource } from './render.ts'

/** 文本图元：居中对齐，坐标已换算到画面绝对坐标。 */
export interface ScadaTextPrimitive {
  kind: 'text'
  partId: string
  x: number
  y: number
  text: string
  fill: string
  fontSize: number
  bold: boolean
}

/** 路径图元：`d` 与样式全部算好，绘制方不需要再认识图形类型。 */
export interface ScadaPathPrimitive {
  kind: 'path'
  partId: string
  d: string
  fill: string
  stroke: string | null
  strokeWidth: number
  /** 指针类部件的绕心旋转；其余为 null。 */
  transform: string | null
}

export type ScadaPrimitive = ScadaTextPrimitive | ScadaPathPrimitive

export interface ScadaSceneWidget {
  id: string
  /** 图元占位矩形：编辑器拿它做命中层与选中框，只读端可以不画。 */
  rect: ScadaRect
  locked: boolean
  /** 整图旋转（90 度倍数），作用在组上。 */
  transform: string | null
  primitives: ScadaPrimitive[]
}

export interface ScadaScene {
  width: number
  height: number
  background: string
  grid: number
  showGrid: boolean
  widgets: ScadaSceneWidget[]
}

/** 保留三位小数：DOM 与 SVG 字符串输出同一份数值，避免两端口径漂移。 */
function round3(value: number): number {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

function roundRect(rect: ScadaRect): ScadaRect {
  return {
    x: round3(rect.x),
    y: round3(rect.y),
    width: round3(rect.width),
    height: round3(rect.height),
  }
}

// ---------------- 形状 → SVG path ----------------

function roundRectPath(rect: ScadaRect, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(rect.width, rect.height) / 2))
  const { x, y, width, height } = rect
  if (r <= 0) {
    return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`
  }
  return [
    `M ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${y + height - r}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ')
}

function ellipsePath(rect: ScadaRect): string {
  const rx = Math.max(rect.width / 2, 0)
  const ry = Math.max(rect.height / 2, 0)
  const cx = rect.x + rx
  const cy = rect.y + ry
  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`
}

function pointsPath(points: Array<[number, number]>, close: boolean): string {
  if (!points.length) return ''
  const commands = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${round3(x)} ${round3(y)}`)
  return `${commands.join(' ')}${close ? ' Z' : ''}`
}

/** 填充条：从底部按比例向上填充。 */
function fillBarPath(rect: ScadaRect, ratio: number, radius: number): string {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  const height = Math.max(rect.height, 0) * clamped
  const filled: ScadaRect = {
    x: rect.x,
    y: rect.y + (Math.max(rect.height, 0) - height),
    width: Math.max(rect.width, 0),
    height,
  }
  return roundRectPath(filled, radius)
}

export function partPath(part: ResolvedPart): string {
  switch (part.shape) {
    case 'rect':
      return roundRectPath(part.rect, 0)
    case 'roundRect':
      return roundRectPath(part.rect, part.cornerRadius)
    case 'ellipse':
      return ellipsePath(part.rect)
    case 'line':
      return pointsPath(part.points.slice(0, 2), false)
    case 'polyline':
      return pointsPath(part.points, false)
    case 'polygon':
      return pointsPath(part.points, true)
    case 'path':
      return part.path ?? ''
    case 'fillBar':
      return fillBarPath(part.rect, part.ratio, part.cornerRadius)
    case 'text':
    default:
      return ''
  }
}

/** 指针类部件按角度旋转：绕部件中心，0 度指向 12 点方向。 */
export function partTransform(part: ResolvedPart): string | null {
  if (!part.angle) return null
  const cx = round3(part.rect.x + part.rect.width / 2)
  const cy = round3(part.rect.y + part.rect.height / 2)
  return `rotate(${round3(part.angle)} ${cx} ${cy})`
}

export function partFill(part: ResolvedPart): string {
  if (part.shape === 'polyline' || part.shape === 'line') return 'none'
  if (part.shape === 'path') return part.fill || 'none'
  return part.fill
}

export function partStrokeWidth(part: ResolvedPart): number {
  if (part.shape === 'line' || part.shape === 'polyline') return Math.max(part.strokeWidth, 1)
  return part.strokeWidth
}

export function partStroke(part: ResolvedPart): string | null {
  if (part.shape === 'line' || part.shape === 'polyline') {
    return part.stroke ?? part.fill ?? '#94a3b8'
  }
  if (!part.stroke) return null
  return part.strokeWidth > 0 ? part.stroke : null
}

/** 文本垂直居中：按字号经验补偿，与编辑器历史输出保持一致。 */
export function textAnchor(part: ResolvedPart): { x: number; y: number } {
  return {
    x: round3(part.rect.x + part.rect.width / 2),
    y: round3(part.rect.y + part.rect.height / 2 + part.fontSize * 0.35),
  }
}

// ---------------- 场景构建 ----------------

function primitiveOf(part: ResolvedPart): ScadaPrimitive | null {
  if (!part.visible) return null
  if (part.shape === 'text') {
    if (!part.text) return null
    const anchor = textAnchor(part)
    return {
      kind: 'text',
      partId: part.id,
      x: anchor.x,
      y: anchor.y,
      text: part.text,
      fill: part.fill,
      fontSize: round3(Math.max(part.fontSize, 6)),
      bold: part.bold,
    }
  }
  return {
    kind: 'path',
    partId: part.id,
    d: partPath(part),
    fill: partFill(part),
    stroke: partStroke(part),
    strokeWidth: round3(partStrokeWidth(part)),
    transform: partTransform(part),
  }
}

/**
 * 画面 → 场景图。
 *
 * 绘制顺序按 `zIndex` 再按 id 排序，与后端落库顺序一致；
 * 图元库缺失的 `symbolKey` 直接跳过（编辑器里表现为「不显示」，不报错）。
 */
export function buildScene(
  document: ScadaDocument,
  symbols: Record<string, ScadaSymbolDefinition>,
  values: Map<number, TagValueSource>,
): ScadaScene {
  const ordered = [...document.widgets].sort(
    (left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id),
  )
  const widgets: ScadaSceneWidget[] = []
  for (const widget of ordered) {
    const symbol = symbols[widget.symbolKey]
    if (!symbol) continue
    const resolved = resolveWidget(widget, symbol, values)
    const rect = roundRect(resolved.rect)
    const primitives: ScadaPrimitive[] = []
    for (const part of resolved.parts) {
      const primitive = primitiveOf(part)
      if (primitive) primitives.push(primitive)
    }
    widgets.push({
      id: widget.id,
      rect,
      locked: Boolean(widget.locked),
      transform: resolved.rotationDegrees
        ? `rotate(${round3(resolved.rotationDegrees)} ${round3(rect.x + rect.width / 2)} ${round3(rect.y + rect.height / 2)})`
        : null,
      primitives,
    })
  }

  return {
    width: round3(document.canvas.width),
    height: round3(document.canvas.height),
    background: document.canvas.background || '#0f172a',
    grid: round3(document.canvas.grid),
    showGrid: Boolean(document.canvas.showGrid),
    widgets,
  }
}

// ---------------- 场景 → SVG 字符串 ----------------

const TEXT_FONT_FAMILY = 'Noto Sans SC, Microsoft YaHei, sans-serif'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attr(name: string, value: string | number | null): string {
  return value === null ? '' : ` ${name}="${escapeXml(String(value))}"`
}

/**
 * 场景 → 独立 SVG 文档。
 *
 * 服务端渲染用（`/scada/preview`、缩略图、导出），不依赖 DOM：
 * 编辑器在浏览器里用同一份场景走 Vue 模板，两边输出视觉一致。
 */
export function sceneToSvg(scene: ScadaScene): string {
  const parts: string[] = []
  const width = scene.width
  const height = scene.height
  const gridId = 'scada-grid-pattern'
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
  )
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(scene.background)}"/>`)
  if (scene.showGrid && scene.grid > 0) {
    parts.push(
      `<defs><pattern id="${gridId}" width="${scene.grid}" height="${scene.grid}" patternUnits="userSpaceOnUse">` +
        `<path d="M ${scene.grid} 0 L 0 0 0 ${scene.grid}" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="0.6"/>` +
        `</pattern></defs>`,
    )
    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gridId})"/>`)
  }
  for (const widget of scene.widgets) {
    const transform = widget.transform ? ` transform="${escapeXml(widget.transform)}"` : ''
    parts.push(`<g data-widget-id="${escapeXml(widget.id)}"${transform}>`)
    for (const primitive of widget.primitives) {
      if (primitive.kind === 'text') {
        parts.push(
          `<text${attr('x', primitive.x)}${attr('y', primitive.y)}${attr('fill', primitive.fill)}` +
            `${attr('font-size', primitive.fontSize)}${attr('font-weight', primitive.bold ? 700 : 400)}` +
            `${attr('font-family', TEXT_FONT_FAMILY)} text-anchor="middle">${escapeXml(primitive.text)}</text>`,
        )
        continue
      }
      parts.push(
        `<path${attr('d', primitive.d)}${attr('fill', primitive.fill)}` +
          `${primitive.stroke ? attr('stroke', primitive.stroke) : ''}` +
          `${primitive.stroke ? attr('stroke-width', primitive.strokeWidth) : ''}` +
          `${primitive.transform ? attr('transform', primitive.transform) : ''}` +
          ' stroke-linejoin="round" stroke-linecap="round"/>',
      )
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('')
}
