// 线框渲染：把图纸画成可预览的 SVG。
//
// 与 ifc-canvas 的 isometric 同构：纯几何、零依赖、同一份输入产出同一份字符串，
// 因此服务端能批量出缩略图（九宫格画面库），前端也能在编辑器里即时重画。
//
// 两种用法：
// - `renderWireframe`：静态缩略图，元素按其角色上色，一眼能认出是哪一页；
// - `renderOverlay`：在已有 DOM 之上标注区域边界，用于「图纸 ↔ 运行页」对照。

import type { UiDrawing, UiElement, UiRect, UiRole } from './types.ts'
import { specOf } from './roles.ts'
import { regionsOf } from './layout.ts'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** 元素在缩略图上的标签：优先 label，其次按钮字，最后角色名。 */
function captionOf(element: UiElement): string {
  const label = String((element.props as { label?: string }).label ?? '').trim()
  if (label) return label
  if (element.text?.trim()) return element.text.trim()
  return specOf(element.role).label
}

function rectAttrs(rect: UiRect): string {
  return `x="${round(rect.x)}" y="${round(rect.y)}" width="${round(Math.max(0, rect.width))}" height="${round(Math.max(0, rect.height))}"`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** 角色层级透明度：容器淡、叶层实，缩略图一眼看出结构。 */
function opacityOf(role: UiRole): number {
  const layer = specOf(role).layer
  if (layer === 'container') return 0.35
  if (layer === 'band') return 0.75
  return 0.95
}

export interface WireframeOptions {
  /** 是否画栅格。 */
  showGrid?: boolean
  /** 是否画元素文案。 */
  showLabels?: boolean
  /** 缩放：0 表示按 `maxWidth` 自适应。 */
  scale?: number
  maxWidth?: number
  maxHeight?: number
  /** 是否把区域边界也描出来（默认不画，避免和元素框重叠）。 */
  showRegions?: boolean
}

/**
 * 把图纸渲染成 SVG 字符串。
 *
 * 自适应逻辑与 `renderPlanIsometricFit` 一致：先按画布尺寸算比例，
 * 再乘上最大外框，保证九宫格里的缩略图不会因为画布大小不同而忽大忽小。
 */
export function renderWireframe(drawing: UiDrawing, options: WireframeOptions = {}): string {
  const canvas = drawing.canvas
  const width = Math.max(1, canvas.width)
  const height = Math.max(1, canvas.height)

  let scale = options.scale && options.scale > 0 ? options.scale : 1
  if (!options.scale && (options.maxWidth || options.maxHeight)) {
    const fitWidth = options.maxWidth ? options.maxWidth / width : Number.POSITIVE_INFINITY
    const fitHeight = options.maxHeight ? options.maxHeight / height : Number.POSITIVE_INFINITY
    scale = Math.min(fitWidth, fitHeight, 1)
  }

  const viewWidth = round(width * scale)
  const viewHeight = round(height * scale)
  const grid = canvas.showGrid && canvas.grid > 0 && options.showGrid !== false ? canvas.grid : 0

  const defs = grid
    ? `<defs><pattern id="uic-grid" width="${round(grid * scale)}" height="${round(grid * scale)}" patternUnits="userSpaceOnUse">`
      + `<path d="M ${round(grid * scale)} 0 L 0 0 0 ${round(grid * scale)}" fill="none" stroke="rgba(148,163,184,.18)" stroke-width="0.5"/></pattern></defs>`
    : ''

  const gridLayer = grid ? `<rect width="${viewWidth}" height="${viewHeight}" fill="url(#uic-grid)"/>` : ''

  const regionLayer = options.showRegions
    ? regionsOf(drawing)
      .map((region) => {
        const rect = region.rect
        return `<rect ${rectAttrs({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale })}`
          + ` fill="none" stroke="rgba(99,102,241,.35)" stroke-dasharray="6 4" rx="4"/>`
      })
      .join('')
    : ''

  const elements = [...drawing.elements]
    .filter((element) => element.visible !== false)
    .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id))

  const body = elements.map((element) => {
    const spec = specOf(element.role)
    const rect = {
      x: element.rect.x * scale,
      y: element.rect.y * scale,
      width: element.rect.width * scale,
      height: element.rect.height * scale,
    }
    const fill = spec.tint
    const opacity = opacityOf(element.role)
    const stroke = spec.layer === 'container' ? 'rgba(71,85,105,.65)' : 'rgba(71,85,105,.45)'
    const shape = `<rect ${rectAttrs(rect)} rx="${spec.layer === 'container' ? 6 : 3}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1"/>`
    if (options.showLabels === false) return shape
    const fontSize = Math.max(8, Math.min(round(Math.min(rect.height * 0.5, 13)), 18))
    const cx = round(rect.x + rect.width / 2)
    const cy = round(rect.y + rect.height / 2 + fontSize * 0.35)
    const text = `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fontSize}" fill="#0f172a" font-family="system-ui, sans-serif">${escapeXml(trim(captionOf(element), fontSize, rect.width))}</text>`
    return shape + text
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img">`
    + defs
    + `<rect width="${viewWidth}" height="${viewHeight}" fill="${escapeXml(canvas.background || '#f8fafc')}"/>`
    + gridLayer
    + regionLayer
    + body
    + '</svg>'
}

/** 文本截断：缩略图里长文案不该糊成一团。 */
function trim(text: string, fontSize: number, pixelWidth: number): string {
  const capacity = Math.max(2, Math.floor(pixelWidth / (fontSize * 0.62)))
  return text.length > capacity ? `${text.slice(0, capacity)}…` : text
}

/** 运行页对照用的区域标注：把区域框与「该区域编译出了什么」一起标出来。 */
export interface OverlayRegion {
  id: string
  role: UiRole
  label: string
  compiled: number
  mismatched: boolean
}

/** 算出每个区域编译出的元素数，用于「图纸 ↔ 页面」对照面板。 */
export function overlayRegions(drawing: UiDrawing): OverlayRegion[] {
  const compiled = new Set<string>()
  for (const element of drawing.elements) {
    if (element.visible === false) continue
    compiled.add(element.id)
  }
  return regionsOf(drawing).map((region) => {
    const spec = specOf(region.role)
    return {
      id: region.id,
      role: region.role,
      label: spec.label,
      compiled: region.childIds.filter((id) => compiled.has(id)).length,
      mismatched: region.childIds.some((id) => !compiled.has(id)),
    }
  })
}
