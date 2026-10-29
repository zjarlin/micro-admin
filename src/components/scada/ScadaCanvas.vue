<!-- 组态画布：SVG 渲染 + 选择/拖动/缩放/旋转/框选/对齐吸附。
     求值语义来自 shared/scada/render.ts（与 Rust crate az-scada-canvas 对齐），
     这里只负责交互与绘制，不直接调用后端。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ScadaDocument, ScadaRect, ScadaSymbolDefinition, ScadaWidget } from '@/shared/scada/types'
import {
  collectGuides,
  nearestAlignment,
  nextRotation,
  normalizeRect,
  rectIntersects,
  resolveWidget,
  type ResolvedPart,
  type TagValueSource,
} from '@/shared/scada/render'

const props = defineProps<{
  document: ScadaDocument
  symbols: Record<string, ScadaSymbolDefinition>
  values: Map<number, TagValueSource>
  selectedIds: string[]
  zoom: number
  snap: boolean
  guides: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:selectedIds', ids: string[]): void
  (event: 'changed'): void
  (event: 'zoom', zoom: number): void
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const marquee = ref<ScadaRect | null>(null)
const guideLines = ref<{ axis: 'vertical' | 'horizontal'; position: number }[]>([])

const gridSize = computed(() => (props.document.canvas.grid > 0 ? props.document.canvas.grid : 0))

/** 按 zIndex 绘制顺序求值，保证叠放顺序与后端一致。 */
const resolvedWidgets = computed(() => {
  const ordered = [...props.document.widgets].sort(
    (left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id),
  )
  return ordered
    .map((widget) => {
      const symbol = props.symbols[widget.symbolKey]
      if (!symbol) return null
      return { widget, resolved: resolveWidget(widget, symbol, props.values) }
    })
    .filter((item): item is { widget: ScadaWidget; resolved: ReturnType<typeof resolveWidget> } => Boolean(item))
})

const selectedSet = computed(() => new Set(props.selectedIds))

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
  const commands = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
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

function partPath(part: ResolvedPart): string {
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
function partTransform(part: ResolvedPart): string | undefined {
  if (!part.angle) return undefined
  const cx = part.rect.x + part.rect.width / 2
  const cy = part.rect.y + part.rect.height / 2
  return `rotate(${part.angle} ${cx} ${cy})`
}

function partFill(part: ResolvedPart): string {
  if (part.shape === 'polyline' || part.shape === 'line') return 'none'
  if (part.shape === 'path') return part.fill || 'none'
  return part.fill
}

function borderWidth(part: ResolvedPart): number {
  return part.shape === 'line' || part.shape === 'polyline' ? Math.max(part.strokeWidth, 1) : part.strokeWidth
}

function partStroke(part: ResolvedPart): string | null {
  if (part.shape === 'line' || part.shape === 'polyline') {
    return part.stroke ?? part.fill ?? '#94a3b8'
  }
  if (!part.stroke) return null
  return part.strokeWidth > 0 ? part.stroke : null
}

function textAnchorX(part: ResolvedPart): number {
  return part.rect.x + part.rect.width / 2
}

function textAnchorY(part: ResolvedPart): number {
  return part.rect.y + part.rect.height / 2 + part.fontSize * 0.35
}

// ---------------- 坐标换算 ----------------

function toCanvasPoint(event: PointerEvent | MouseEvent) {
  const svg = svgRef.value
  if (!svg) return { x: 0, y: 0 }
  const box = svg.getBoundingClientRect()
  return {
    x: (event.clientX - box.left) / props.zoom,
    y: (event.clientY - box.top) / props.zoom,
  }
}

// ---------------- 交互 ----------------

type DragMode = 'move' | 'resize' | 'marquee'

interface DragState {
  mode: DragMode
  handle?: string | undefined
  startX: number
  startY: number
  origin: Map<string, ScadaRect>
  anchor?: ScadaRect | undefined
  moved: boolean
}

let drag: DragState | null = null

function findWidget(id: string): ScadaWidget | undefined {
  return props.document.widgets.find((item) => item.id === id)
}

function beginDrag(event: PointerEvent, mode: DragMode, handle?: string) {
  const point = toCanvasPoint(event)
  const origin = new Map<string, ScadaRect>()
  for (const id of props.selectedIds) {
    const widget = findWidget(id)
    if (widget) origin.set(id, { ...widget.rect })
  }
  drag = { mode, handle, startX: point.x, startY: point.y, origin, moved: false }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onHandlePointerDown(event: PointerEvent, handle: string) {
  event.stopPropagation()
  if (props.readonly) return
  const widget = props.selectedIds.length === 1 ? findWidget(props.selectedIds[0] ?? '') : null
  if (!widget || widget.locked) return
  beginDrag(event, 'resize', handle)
}

function onWidgetPointerDown(event: PointerEvent, widget: ScadaWidget) {
  event.stopPropagation()
  if (props.readonly) return
  const additive = event.shiftKey || event.metaKey || event.ctrlKey
  let nextSelection = props.selectedIds
  if (additive) {
    nextSelection = props.selectedIds.includes(widget.id)
      ? props.selectedIds.filter((id) => id !== widget.id)
      : [...props.selectedIds, widget.id]
  } else if (!props.selectedIds.includes(widget.id)) {
    nextSelection = [widget.id]
  }
  if (nextSelection !== props.selectedIds) {
    emit('update:selectedIds', nextSelection)
  }
  if (widget.locked) return
  // 等父组件把选择落下去之后再开始拖动，避免只拖动新选中之外的图元。
  const movable = nextSelection
    .map((id) => findWidget(id))
    .filter((item): item is ScadaWidget => Boolean(item) && !item!.locked)
  const origin = new Map<string, ScadaRect>()
  for (const item of movable) origin.set(item.id, { ...item.rect })
  const point = toCanvasPoint(event)
  drag = { mode: 'move', startX: point.x, startY: point.y, origin, moved: false }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onCanvasPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (props.readonly) return
  const point = toCanvasPoint(event)
  const additive = event.shiftKey || event.metaKey || event.ctrlKey
  if (!additive) emit('update:selectedIds', [])
  marquee.value = { x: point.x, y: point.y, width: 0, height: 0 }
  drag = {
    mode: 'marquee',
    startX: point.x,
    startY: point.y,
    origin: new Map(),
    anchor: { x: point.x, y: point.y, width: 0, height: 0 },
    moved: false,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function applyMove(event: PointerEvent, state: DragState) {
  const point = toCanvasPoint(event)
  const dx = point.x - state.startX
  const dy = point.y - state.startY
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) state.moved = true
  const grid = props.snap ? gridSize.value : 0

  for (const [id, origin] of state.origin) {
    const widget = findWidget(id)
    if (!widget) continue
    let rect: ScadaRect = { ...origin, x: origin.x + dx, y: origin.y + dy }
    if (grid > 0) {
      rect.x = Math.round(rect.x / grid) * grid
      rect.y = Math.round(rect.y / grid) * grid
    }
    widget.rect = rect
  }

  guideLines.value = []
  if (props.guides && state.origin.size === 1) {
    const first = [...state.origin.entries()][0]
    if (!first) return
    const [id, origin] = first
    const others = props.document.widgets.filter((item) => item.id !== id)
    const { vertical, horizontal } = collectGuides(others, new Set([id]))
    const threshold = 6
    const current = findWidget(id)?.rect
    if (current) {
      const snapped = applyAlignment(current, origin, vertical, horizontal, threshold)
      if (snapped.vertical !== null) {
        current.x = snapped.x
        guideLines.value.push({ axis: 'vertical', position: snapped.vertical })
      }
      if (snapped.horizontal !== null) {
        current.y = snapped.y
        guideLines.value.push({ axis: 'horizontal', position: snapped.horizontal })
      }
    }
  }
}

function applyAlignment(
  rect: ScadaRect,
  origin: ScadaRect,
  vertical: number[],
  horizontal: number[],
  threshold: number,
) {
  let x = rect.x
  let y = rect.y
  let verticalMatch: number | null = null
  let horizontalMatch: number | null = null
  const width = origin.width
  const height = origin.height

  const leftMatch = nearestAlignment(vertical, x, threshold)
  const rightMatch = nearestAlignment(vertical, x + width, threshold)
  const centerMatch = nearestAlignment(vertical, x + width / 2, threshold)
  if (leftMatch !== null) {
    x = leftMatch
    verticalMatch = leftMatch
  } else if (rightMatch !== null) {
    x = rightMatch - width
    verticalMatch = rightMatch
  } else if (centerMatch !== null) {
    x = centerMatch - width / 2
    verticalMatch = centerMatch
  }

  const topMatch = nearestAlignment(horizontal, y, threshold)
  const bottomMatch = nearestAlignment(horizontal, y + height, threshold)
  const middleMatch = nearestAlignment(horizontal, y + height / 2, threshold)
  if (topMatch !== null) {
    y = topMatch
    horizontalMatch = topMatch
  } else if (bottomMatch !== null) {
    y = bottomMatch - height
    horizontalMatch = bottomMatch
  } else if (middleMatch !== null) {
    y = middleMatch - height / 2
    horizontalMatch = middleMatch
  }

  return { x, y, vertical: verticalMatch, horizontal: horizontalMatch }
}

function applyResize(event: PointerEvent, state: DragState) {
  const handle = state.handle ?? 'se'
  const widget = props.selectedIds.length === 1 ? findWidget(props.selectedIds[0] ?? '') : null
  if (!widget) return
  const origin = state.origin.get(widget.id)
  if (!origin) return
  const point = toCanvasPoint(event)
  const dx = point.x - state.startX
  const dy = point.y - state.startY
  const grid = props.snap ? gridSize.value : 0
  const snap = (value: number) => (grid > 0 ? Math.round(value / grid) * grid : value)

  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.width
  let bottom = origin.y + origin.height
  if (handle.includes('w')) left = snap(origin.x + dx)
  if (handle.includes('e')) right = snap(origin.x + origin.width + dx)
  if (handle.includes('n')) top = snap(origin.y + dy)
  if (handle.includes('s')) bottom = snap(origin.y + origin.height + dy)

  const minSize = grid > 0 ? Math.max(grid, 10) : 10
  if (right - left < minSize) {
    if (handle.includes('w')) left = right - minSize
    else right = left + minSize
  }
  if (bottom - top < minSize) {
    if (handle.includes('n')) top = bottom - minSize
    else bottom = top + minSize
  }

  const symbol = props.symbols[widget.symbolKey]
  if (symbol?.keepAspect) {
    const ratio = origin.width / origin.height
    const width = right - left
    const height = bottom - top
    if (width / height > ratio) {
      const adjusted = width / ratio
      if (handle.includes('n')) top = bottom - adjusted
      else bottom = top + adjusted
    } else {
      const adjusted = height * ratio
      if (handle.includes('w')) left = right - adjusted
      else right = left + adjusted
    }
  }

  widget.rect = normalizeRect({ x: left, y: top, width: right - left, height: bottom - top })
  if (state.moved === false && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
    state.moved = true
  }
}

function applyMarquee(event: PointerEvent, state: DragState) {
  const point = toCanvasPoint(event)
  const anchor = state.anchor ?? { x: state.startX, y: state.startY, width: 0, height: 0 }
  const rect = normalizeRect({
    x: anchor.x,
    y: anchor.y,
    width: point.x - anchor.x,
    height: point.y - anchor.y,
  })
  marquee.value = rect
  state.moved = true
  const hit = props.document.widgets
    .filter((widget) => widget.visible !== false && rectIntersects(rect, widget.rect))
    .map((widget) => widget.id)
  emit('update:selectedIds', hit)
}

function onPointerMove(event: PointerEvent) {
  if (!drag) return
  if (drag.mode === 'move') applyMove(event, drag)
  else if (drag.mode === 'resize') applyResize(event, drag)
  else applyMarquee(event, drag)
}

function onPointerUp() {
  const finished = drag
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  marquee.value = null
  guideLines.value = []
  if (finished?.mode !== 'marquee' && finished?.moved) {
    emit('changed')
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
})

// ---------------- 键盘 ----------------

function onKeydown(event: KeyboardEvent) {
  if (props.readonly) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  const step = props.snap && gridSize.value > 0 ? gridSize.value : 1
  const selected = props.selectedIds
    .map((id) => findWidget(id))
    .filter((item): item is ScadaWidget => Boolean(item))
  if (!selected.length) return
  const delta = (dx: number, dy: number) => {
    for (const widget of selected) {
      if (widget.locked) continue
      widget.rect = { ...widget.rect, x: widget.rect.x + dx, y: widget.rect.y + dy }
    }
    emit('changed')
  }
  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      event.preventDefault()
      props.document.widgets = props.document.widgets.filter((item) => !selected.includes(item))
      emit('update:selectedIds', [])
      emit('changed')
      break
    case 'ArrowLeft':
      event.preventDefault()
      delta(-(event.shiftKey ? step * 10 : step), 0)
      break
    case 'ArrowRight':
      event.preventDefault()
      delta(event.shiftKey ? step * 10 : step, 0)
      break
    case 'ArrowUp':
      event.preventDefault()
      delta(0, -(event.shiftKey ? step * 10 : step))
      break
    case 'ArrowDown':
      event.preventDefault()
      delta(0, event.shiftKey ? step * 10 : step)
      break
    case 'r':
    case 'R':
      event.preventDefault()
      for (const widget of selected) {
        if (widget.locked) continue
        widget.rotation = nextRotation(widget.rotation)
      }
      emit('changed')
      break
    default:
      break
  }
}

function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const next = props.zoom + (event.deltaY > 0 ? -0.1 : 0.1)
  emit('zoom', Math.min(Math.max(Number(next.toFixed(2)), 0.2), 4))
}

const zoomPercent = computed(() => Math.round(props.zoom * 100))

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

function handleRect(handle: string, rect: ScadaRect) {
  const size = 8 / props.zoom
  const half = size / 2
  const positions: Record<string, [number, number]> = {
    nw: [rect.x, rect.y],
    n: [rect.x + rect.width / 2, rect.y],
    ne: [rect.x + rect.width, rect.y],
    e: [rect.x + rect.width, rect.y + rect.height / 2],
    se: [rect.x + rect.width, rect.y + rect.height],
    s: [rect.x + rect.width / 2, rect.y + rect.height],
    sw: [rect.x, rect.y + rect.height],
    w: [rect.x, rect.y + rect.height / 2],
  }
  const [x, y] = positions[handle] ?? [0, 0]
  return { x: x - half, y: y - half, width: size, height: size }
}

function handleCursor(handle: string) {
  if (handle === 'n' || handle === 's') return 'ns-resize'
  if (handle === 'e' || handle === 'w') return 'ew-resize'
  if (handle === 'nw' || handle === 'se') return 'nwse-resize'
  return 'nesw-resize'
}

const singleSelection = computed(() => {
  if (props.selectedIds.length !== 1) return null
  return findWidget(props.selectedIds[0] ?? '') ?? null
})
</script>

<template>
  <div class="scada-canvas" @wheel="onWheel">
    <svg
      ref="svgRef"
      class="scada-canvas__svg"
      :width="document.canvas.width * zoom"
      :height="document.canvas.height * zoom"
      :viewBox="`0 0 ${document.canvas.width} ${document.canvas.height}`"
      :style="{ cursor: readonly ? 'default' : 'default' }"
      tabindex="0"
      @pointerdown="onCanvasPointerDown"
      @keydown="onKeydown"
    >
      <rect
        :x="0"
        :y="0"
        :width="document.canvas.width"
        :height="document.canvas.height"
        :fill="document.canvas.background || '#0f172a'"
      />
      <template v-if="document.canvas.showGrid && gridSize > 0">
        <defs>
          <pattern
            id="scada-grid-pattern"
            :width="gridSize"
            :height="gridSize"
            patternUnits="userSpaceOnUse"
          >
            <path
              :d="`M ${gridSize} 0 L 0 0 0 ${gridSize}`"
              fill="none"
              stroke="rgba(148,163,184,0.18)"
              stroke-width="0.6"
            />
          </pattern>
        </defs>
        <rect
          :x="0"
          :y="0"
          :width="document.canvas.width"
          :height="document.canvas.height"
          fill="url(#scada-grid-pattern)"
        />
      </template>

      <g
        v-for="item in resolvedWidgets"
        :key="item.widget.id"
        :data-widget-id="item.widget.id"
        :transform="
          item.resolved.rotationDegrees
            ? `rotate(${item.resolved.rotationDegrees} ${item.resolved.rect.x + item.resolved.rect.width / 2} ${item.resolved.rect.y + item.resolved.rect.height / 2})`
            : undefined
        "
        :style="{ cursor: readonly || item.widget.locked ? 'default' : 'move' }"
        @pointerdown="onWidgetPointerDown($event, item.widget)"
      >
        <!-- 命中层：部件自身是 pointer-events:none，需要一块透明矩形承接选择与拖动。 -->
        <rect
          v-if="item.resolved.parts.some((part) => part.visible)"
          :x="item.resolved.rect.x"
          :y="item.resolved.rect.y"
          :width="item.resolved.rect.width"
          :height="item.resolved.rect.height"
          fill="transparent"
          style="pointer-events: all"
        />
        <template v-for="part in item.resolved.parts" :key="`${item.widget.id}-${part.id}`">
          <text
            v-if="part.shape === 'text' && part.visible && part.text"
            :x="textAnchorX(part)"
            :y="textAnchorY(part)"
            :fill="part.fill"
            :font-size="Math.max(part.fontSize, 6)"
            :font-weight="part.bold ? 700 : 400"
            font-family="Noto Sans SC, Microsoft YaHei, sans-serif"
            text-anchor="middle"
            style="pointer-events: none"
          >{{ part.text }}</text>
          <path
            v-else-if="part.shape !== 'text' && part.visible"
            :d="partPath(part)"
            :fill="partFill(part)"
            :stroke="partStroke(part) ?? undefined"
            :stroke-width="partStroke(part) ? borderWidth(part) : undefined"
            :transform="partTransform(part)"
            stroke-linejoin="round"
            stroke-linecap="round"
            style="pointer-events: none"
          />
        </template>
        <rect
          v-if="selectedSet.has(item.widget.id)"
          :x="item.resolved.rect.x"
          :y="item.resolved.rect.y"
          :width="item.resolved.rect.width"
          :height="item.resolved.rect.height"
          fill="none"
          stroke="#38bdf8"
          :stroke-width="1.5 / zoom"
          :stroke-dasharray="`${6 / zoom} ${4 / zoom}`"
          style="pointer-events: none"
        />
      </g>

      <template v-if="singleSelection && !readonly && !singleSelection.locked">
        <rect
          v-for="handle in HANDLES"
          :key="`handle-${handle}`"
          :x="handleRect(handle, singleSelection.rect).x"
          :y="handleRect(handle, singleSelection.rect).y"
          :width="handleRect(handle, singleSelection.rect).width"
          :height="handleRect(handle, singleSelection.rect).height"
          fill="#38bdf8"
          stroke="#0f172a"
          :stroke-width="1 / zoom"
          :style="{ cursor: handleCursor(handle) }"
          @pointerdown="onHandlePointerDown($event, handle)"
        />
      </template>

      <template v-if="!readonly">
        <template
          v-if="selectedSet.size > 1"
        >
          <rect
            v-for="widget in document.widgets.filter((item) => selectedSet.has(item.id))"
            :key="`multi-${widget.id}`"
            :x="widget.rect.x"
            :y="widget.rect.y"
            :width="widget.rect.width"
            :height="widget.rect.height"
            fill="rgba(56,189,248,0.08)"
            stroke="rgba(56,189,248,0.5)"
            :stroke-width="1 / zoom"
            style="pointer-events: none"
          />
        </template>
        <line
          v-for="guide in guideLines"
          :key="`guideline-${guide.axis}-${guide.position}`"
          :x1="guide.axis === 'vertical' ? guide.position : 0"
          :y1="guide.axis === 'vertical' ? 0 : guide.position"
          :x2="guide.axis === 'vertical' ? guide.position : document.canvas.width"
          :y2="guide.axis === 'vertical' ? document.canvas.height : guide.position"
          stroke="#f472b6"
          :stroke-width="1 / zoom"
          stroke-dasharray="4 4"
          style="pointer-events: none"
        />
        <rect
          v-if="marquee"
          :x="marquee.x"
          :y="marquee.y"
          :width="marquee.width"
          :height="marquee.height"
          fill="rgba(56,189,248,0.12)"
          stroke="#38bdf8"
          :stroke-width="1 / zoom"
          style="pointer-events: none"
        />
      </template>
    </svg>
    <div class="scada-canvas__hint">
      {{ Math.round(document.canvas.width) }} × {{ Math.round(document.canvas.height) }} · {{ zoomPercent }}%
      <template v-if="!document.widgets.length"> · 从左侧图元库拖入或点击添加</template>
    </div>
  </div>
</template>

<style scoped>
.scada-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  background:
    radial-gradient(circle at 20% 0%, rgba(56, 189, 248, 0.06), transparent 45%),
    rgba(2, 6, 23, 0.6);
}

.scada-canvas__svg {
  display: block;
  margin: 0 auto;
  outline: none;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.32);
}

.scada-canvas__hint {
  position: sticky;
  bottom: 0;
  left: 0;
  margin-top: 8px;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
}
</style>
