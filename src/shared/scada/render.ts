// 画布求值与几何：编辑器里的「所见即所得」预览。
//
// 语义唯一权威是 Rust crate `az-scada-canvas`（backend 校验 + /scada/preview 渲染）；
// 前端这份实现只用于交互期的即时回显，输出形状与 crate 的
// `behavior::resolve_widget` / `render` 保持一致：改一边必须同步另一边。
// 保存前的最终校验与落库预览都由后端完成，因此前端算错只会「先看到错角度」，
// 不会把渲染不了的内容存进库。

import type {
  ScadaBindingSlotSpec,
  ScadaBindingSlotStyle,
  ScadaRect,
  ScadaRotation,
  ScadaSymbolDefinition,
  ScadaSymbolPart,
  ScadaWidget,
  ScadaWidgetBinding,
} from '@/shared/scada/types'
import { SCADA_ROTATION_DEGREES } from '@/shared/scada/types'

/** 通道变量当前值：与 crate `TagValueSource` 同构。 */
export interface TagValueSource {
  raw?: number | null
  text?: string | null
  quality?: string | null
}

export type ScadaSlotValue =
  | { kind: 'text'; text: string }
  | { kind: 'ratio'; ratio: number }
  | { kind: 'color'; color: string }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'angle'; degrees: number }

/** 求值后的部件：绝对坐标，可直接画到 SVG。 */
export interface ResolvedPart {
  id: string
  shape: ScadaSymbolPart['shape']
  rect: ScadaRect
  fill: string
  stroke: string | null
  strokeWidth: number
  text: string | null
  fontSize: number
  bold: boolean
  points: Array<[number, number]>
  path: string | null
  visible: boolean
  ratio: number
  angle: number
  cornerRadius: number
}

export interface ResolvedWidget {
  id: string
  symbolKey: string
  name: string
  rect: ScadaRect
  rotationDegrees: number
  zIndex: number
  visible: boolean
  parts: ResolvedPart[]
  slots: Record<string, ScadaSlotValue>
  unresolvedSlots: string[]
}

// ---------------- 几何 ----------------

export function rotationDegrees(rotation: ScadaRotation | undefined): number {
  return SCADA_ROTATION_DEGREES[rotation ?? 'none'] ?? 0
}

const ROTATION_ORDER: ScadaRotation[] = ['none', 'deg90', 'deg180', 'deg270']

export function nextRotation(rotation: ScadaRotation | undefined): ScadaRotation {
  const index = ROTATION_ORDER.indexOf(rotation ?? 'none')
  return ROTATION_ORDER[(index + 1) % ROTATION_ORDER.length] ?? 'none'
}

export function snapValueToGrid(value: number, grid: number): number {
  if (!Number.isFinite(grid) || grid <= 0) return value
  return Math.round(value / grid) * grid
}

export function snapRectToGrid(rect: ScadaRect, grid: number): ScadaRect {
  if (!Number.isFinite(grid) || grid <= 0) return rect
  return {
    x: snapValueToGrid(rect.x, grid),
    y: snapValueToGrid(rect.y, grid),
    width: Math.max(snapValueToGrid(rect.width, grid), grid),
    height: Math.max(snapValueToGrid(rect.height, grid), grid),
  }
}

export function rectContains(rect: ScadaRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

export function rectIntersects(left: ScadaRect, right: ScadaRect): boolean {
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  )
}

export function normalizeRect(rect: ScadaRect): ScadaRect {
  if (rect.width >= 0 && rect.height >= 0) return rect
  return {
    x: rect.width >= 0 ? rect.x : rect.x + rect.width,
    y: rect.height >= 0 ? rect.y : rect.y + rect.height,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

/** 对齐吸附：在阈值内找最近的参考位置，找不到返回 null。 */
export function nearestAlignment(candidates: number[], value: number, threshold: number): number | null {
  let matched: number | null = null
  let best = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value)
    if (distance <= threshold && distance < best) {
      best = distance
      matched = candidate
    }
  }
  return matched
}

/** 其他图元的吸附参考线：左右边与水平中线 / 上下边与垂直中线。 */
export function collectGuides(widgets: ScadaWidget[], excludeIds: Set<string>) {
  const vertical: number[] = []
  const horizontal: number[] = []
  for (const widget of widgets) {
    if (excludeIds.has(widget.id)) continue
    const rect = widget.rect
    vertical.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width)
    horizontal.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height)
  }
  return { vertical, horizontal }
}

// ---------------- 求值 ----------------

function formatValue(value: number, precision: number): string {
  return value.toFixed(Math.min(Math.max(precision, 0), 6))
}

function isTrustworthy(source: TagValueSource): boolean {
  const quality = (source.quality ?? '').trim().toUpperCase()
  return quality === '' || quality === 'GOOD' || quality === 'OK' || quality === '正常'
}

function resolveSlot(
  binding: ScadaWidgetBinding,
  spec: ScadaBindingSlotSpec,
  source: TagValueSource,
): ScadaSlotValue | null {
  if (!isTrustworthy(source)) return null
  const rangeMin = Number(spec.min ?? 0)
  const rangeMax = Number(spec.max ?? 100) > rangeMin ? Number(spec.max) : rangeMin + 1
  const style: ScadaBindingSlotStyle = spec.style
  switch (style) {
    case 'valueText': {
      const precision = binding.precision ?? spec.precision ?? 0
      const unit = binding.unit ?? spec.unit ?? ''
      if (source.raw !== null && source.raw !== undefined && Number.isFinite(source.raw)) {
        return { kind: 'text', text: `${formatValue(source.raw, precision)}${unit}` }
      }
      if (source.text) return { kind: 'text', text: source.text }
      return null
    }
    case 'fillRatio': {
      if (source.raw === null || source.raw === undefined) return null
      const ratio = (source.raw - rangeMin) / (rangeMax - rangeMin)
      return { kind: 'ratio', ratio: Math.min(Math.max(ratio, 0), 1) }
    }
    case 'needle': {
      if (source.raw === null || source.raw === undefined) return null
      const ratio = (source.raw - rangeMin) / (rangeMax - rangeMin)
      return { kind: 'angle', degrees: -120 + Math.min(Math.max(ratio, 0), 1) * 240 }
    }
    case 'stateColor': {
      if (source.raw !== null && source.raw !== undefined) {
        const thresholds = [...(binding.thresholds ?? [])].sort((left, right) => right.limit - left.limit)
        const matched = thresholds.find((item) => (source.raw as number) >= item.limit)
        return { kind: 'color', color: matched?.color ?? '#64748b' }
      }
      if (source.text) {
        return { kind: 'color', color: binding.textMap?.[source.text] ?? '#64748b' }
      }
      return null
    }
    case 'visibility': {
      if (source.raw !== null && source.raw !== undefined) {
        return { kind: 'visible', visible: Math.abs(source.raw) > Number.EPSILON }
      }
      if (source.text !== null && source.text !== undefined) {
        const trimmed = source.text.trim()
        const falsy = trimmed === '' || trimmed === '0'
          || trimmed.toLowerCase() === 'false'
          || trimmed === '关' || trimmed === '断开'
        return { kind: 'visible', visible: !falsy }
      }
      return { kind: 'visible', visible: false }
    }
    case 'textMap': {
      const key = source.text ?? (
        source.raw !== null && source.raw !== undefined
          ? formatValue(source.raw, spec.precision ?? 0)
          : null
      )
      if (key === null) return null
      return { kind: 'text', text: binding.textMap?.[key] ?? key }
    }
    default:
      return null
  }
}

function propString(props: Record<string, unknown>, key: string): string | null {
  const value = props[key]
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return null
}

/**
 * 颜色角色解析：字面颜色 → 颜色属性覆盖 → 调色板角色 → 中性色回退。
 *
 * 与 crate 的 `ColorRole::resolve` 保持同一顺序，但**只接受 `kind=color` 的属性**。
 * 否则图元里 `fill: "caption"` 这类写法会命中同名的文字属性（如「标签」= "数值"），
 * 输出 `fill="数值"` 这种非法颜色，浏览器按黑色渲染 —— 深色画布上直接看不清。
 */
function resolveColor(
  role: string | null | undefined,
  palette: Record<string, string>,
  props: Record<string, unknown>,
  colorPropKeys: Set<string>,
): string {
  const value = (role ?? '').trim()
  if (!value) return '#cbd5e1'
  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')
    || value === 'none' || value === 'transparent') {
    return value
  }
  if (colorPropKeys.has(value)) {
    const fromProps = props[value]
    if (typeof fromProps === 'string' && fromProps.trim()) return fromProps.trim()
  }
  return palette[value] ?? '#cbd5e1'
}

/** 图元里声明为颜色类型的属性键（属性覆盖只对这些键生效）。 */
function colorPropKeys(symbol: ScadaSymbolDefinition): Set<string> {
  return new Set(symbol.props.filter((spec) => spec.kind === 'color').map((spec) => spec.key))
}

/** 合并图元默认属性与实例覆盖，得到有效属性。 */
export function effectiveProps(
  widget: ScadaWidget,
  symbol: ScadaSymbolDefinition,
): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const spec of symbol.props) {
    props[spec.key] = spec.default
  }
  for (const [key, value] of Object.entries(widget.props ?? {})) {
    props[key] = value
  }
  return props
}

function partFontSize(part: ScadaSymbolPart, props: Record<string, unknown>): number {
  if (part.fontSizeProp) {
    const value = props[part.fontSizeProp]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return part.fontSize || 12
}

/** 求值单个图元实例（对应 crate 的 `resolve_widget`）。 */
export function resolveWidget(
  widget: ScadaWidget,
  symbol: ScadaSymbolDefinition,
  values: Map<number, TagValueSource>,
): ResolvedWidget {
  const slots: Record<string, ScadaSlotValue> = {}
  const unresolvedSlots: string[] = []
  const slotColors = new Map<string, string>()
  const slotRatios = new Map<string, number>()
  const slotVisibility = new Map<string, boolean>()
  const slotAngles = new Map<string, number>()

  for (const binding of widget.bindings ?? []) {
    const spec = symbol.bindingSlots.find((item) => item.key === binding.slot)
    if (!spec) {
      unresolvedSlots.push(binding.slot)
      continue
    }
    const source = values.get(binding.tagId)
    const resolved = source ? resolveSlot(binding, spec, source) : null
    if (!resolved) {
      unresolvedSlots.push(binding.slot)
      continue
    }
    switch (resolved.kind) {
      case 'color':
        slotColors.set(binding.slot, resolved.color)
        break
      case 'ratio':
        slotRatios.set(binding.slot, resolved.ratio)
        break
      case 'visible':
        slotVisibility.set(binding.slot, resolved.visible)
        break
      case 'angle':
        slotAngles.set(binding.slot, resolved.degrees)
        break
      default:
        break
    }
    slots[binding.slot] = resolved
  }

  const props = effectiveProps(widget, symbol)
  const colorKeys = colorPropKeys(symbol)
  const host = widget.rect
  const parts: ResolvedPart[] = symbol.parts.map((part) => {
    const frame = part.frame
    const rect: ScadaRect = {
      x: host.x + frame.x * host.width,
      y: host.y + frame.y * host.height,
      width: frame.width * host.width,
      height: frame.height * host.height,
    }
    const boundSlot = part.bindingSlot ?? null
    const slotColor = boundSlot ? slotColors.get(boundSlot) : undefined
    const ratio = boundSlot ? slotRatios.get(boundSlot) ?? 1 : 1
    const angle = boundSlot ? slotAngles.get(boundSlot) ?? 0 : 0
    let text: string | null = null
    if (part.textSlot) {
      const slotValue = slots[part.textSlot]
      text = slotValue && slotValue.kind === 'text' ? slotValue.text : null
    } else if (part.textProp) {
      text = propString(props, part.textProp)
    } else if (part.text) {
      text = part.text
    }
    let visible = boundSlot ? slotVisibility.get(boundSlot) ?? true : true
    visible = visible && widget.visible !== false
    if (part.textSlot && text === null) {
      visible = false
    }
    return {
      id: part.id,
      shape: part.shape,
      rect,
      fill: slotColor ?? resolveColor(part.fill, symbol.palette ?? {}, props, colorKeys),
      stroke: part.stroke ? resolveColor(part.stroke, symbol.palette ?? {}, props, colorKeys) : null,
      strokeWidth: part.strokeWidth ?? 0,
      text,
      fontSize: partFontSize(part, props),
      bold: Boolean(part.bold),
      points: (part.points ?? []).map(([x, y]) => [host.x + x * host.width, host.y + y * host.height] as [number, number]),
      path: part.path ?? null,
      visible,
      ratio,
      angle,
      cornerRadius: part.cornerRadius ?? 0,
    }
  })

  return {
    id: widget.id,
    symbolKey: widget.symbolKey,
    name: widget.name,
    rect: host,
    rotationDegrees: rotationDegrees(widget.rotation),
    zIndex: widget.zIndex,
    visible: widget.visible !== false,
    parts,
    slots,
    unresolvedSlots,
  }
}

/** 画面内所有绑定变量 id（去重升序），用于一次性取当前值。 */
export function referencedTagIds(document: { widgets: ScadaWidget[] }): number[] {
  const ids = new Set<number>()
  for (const widget of document.widgets) {
    for (const binding of widget.bindings ?? []) {
      if (binding.tagId > 0) ids.add(binding.tagId)
    }
  }
  return [...ids].sort((left, right) => left - right)
}

/** 把绑定的变量展示名快照替换成当前变量名（变量改名后保存时同步）。 */
export function describeBinding(widget: ScadaWidget, slot: string): ScadaWidgetBinding | null {
  return (widget.bindings ?? []).find((item) => item.slot === slot) ?? null
}

/** 点位展示：`通道号 / 寄存器类型 / 地址`，供变量选择器与属性面板复用。 */
export function describeTagAddress(option: {
  channelType: string | null
  channelNo: number | null
  registerTypeName: string
  registerAddress: number
}): string {
  const channel = option.channelType
    ? `${option.channelType}${option.channelNo === null ? '' : ` ${option.channelNo}`}`
    : '—'
  return `${channel} · ${option.registerTypeName || '—'} ${option.registerAddress}`
}
