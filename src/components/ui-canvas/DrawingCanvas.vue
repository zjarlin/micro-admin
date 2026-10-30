<!-- 图纸画布：选择 / 拖动 / 缩放 / 框选 / 吸附。
     几何求值复用 `@zjarlin/ui-canvas` 的角色表与区域装配，交互只做命中与拖拽，
     因此「编辑里看到的层叠顺序、区域归属」与编译时看到的是同一份数据。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { UiDrawing, UiElement, UiRect, UiRole } from '@/shared/ui-canvas'
import { isContainer, regionsOf, renderWireframe, specOf } from '@/shared/ui-canvas'

const props = defineProps<{
  drawing: UiDrawing
  selectedIds: string[]
  zoom: number
  snap: boolean
  showRegions: boolean
}>()

const emit = defineEmits<{
  (event: 'update:selectedIds', ids: string[]): void
  (event: 'update', id: string, rect: UiRect): void
  (event: 'drop-role', role: UiRole, point: { x: number; y: number }): void
}>()

const host = ref<SVGSVGElement | null>(null)
const marquee = ref<UiRect | null>(null)

const grid = computed(() => (props.drawing.canvas.grid > 0 ? props.drawing.canvas.grid : 0))
const selectedSet = computed(() => new Set(props.selectedIds))

/** 缩略图用的同一份渲染，只是按 zoom 缩放，保证「画布 == 缩略图 == 线框」。 */
const wireframe = computed(() => renderWireframe(props.drawing, {
  scale: props.zoom,
  showGrid: true,
  showLabels: true,
  showRegions: props.showRegions,
}))

const ordered = computed(() => [...props.drawing.elements]
  .filter((element) => element.visible !== false)
  .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)))

const regions = computed(() => regionsOf(props.drawing))

/** 画布坐标：与缩放无关，避免不同 zoom 下拖拽手感不同。 */
function toCanvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const svg = host.value
  if (!svg) return { x: 0, y: 0 }
  const box = svg.getBoundingClientRect()
  return { x: (event.clientX - box.left) / props.zoom, y: (event.clientY - box.top) / props.zoom }
}

function snapValue(value: number): number {
  if (!props.snap || grid.value <= 0) return Math.round(value)
  return Math.round(value / grid.value) * grid.value
}

interface DragState {
  mode: 'move' | 'resize' | 'marquee'
  handle?: string
  startX: number
  startY: number
  origin: Map<string, UiRect>
  moved: boolean
}

let drag: DragState | null = null

function elementOf(id: string): UiElement | undefined {
  return props.drawing.elements.find((element) => element.id === id)
}

/** 容器排在后面：点容器空白处应选中容器，点元素优先选叶层。 */
function hitTest(point: { x: number; y: number }): UiElement | null {
  const sorted = [...ordered.value].reverse()
  return sorted.find((element) =>
    point.x >= element.rect.x && point.x <= element.rect.x + element.rect.width
    && point.y >= element.rect.y && point.y <= element.rect.y + element.rect.height,
  ) ?? null
}

function beginDrag(event: PointerEvent, mode: DragState['mode'], handle?: string): void {
  const element = mode === 'move' || mode === 'resize' ? null : null
  void element
  const point = toCanvasPoint(event)
  const origin = new Map<string, UiRect>()
  for (const id of props.selectedIds) {
    const target = elementOf(id)
    if (target) origin.set(id, { ...target.rect })
  }
  drag = { mode, startX: point.x, startY: point.y, origin, moved: false, ...(handle ? { handle } : {}) }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onCanvasPointerDown(event: PointerEvent): void {
  const point = toCanvasPoint(event)
  const hit = hitTest(point)
  if (!hit) {
    // 空白处起框选；已选中多个时不再清空，避免误操作丢选择。
    emit('update:selectedIds', [])
    marquee.value = { x: point.x, y: point.y, width: 0, height: 0 }
    beginDrag(event, 'marquee')
    return
  }
  const ids = event.shiftKey
    ? (selectedSet.value.has(hit.id) ? props.selectedIds.filter((id) => id !== hit.id) : [...props.selectedIds, hit.id])
    : (selectedSet.value.has(hit.id) ? props.selectedIds : [hit.id])
  emit('update:selectedIds', ids)
  beginDrag(event, 'move')
}

function onHandlePointerDown(event: PointerEvent, handle: string): void {
  event.stopPropagation()
  beginDrag(event, 'resize', handle)
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return
  const point = toCanvasPoint(event)
  const dx = point.x - drag.startX
  const dy = point.y - drag.startY
  if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
  drag.moved = true

  if (drag.mode === 'marquee' && marquee.value) {
    marquee.value = {
      x: Math.min(drag.startX, point.x),
      y: Math.min(drag.startY, point.y),
      width: Math.abs(point.x - drag.startX),
      height: Math.abs(point.y - drag.startY),
    }
    return
  }

  for (const [id, origin] of drag.origin) {
    const next = drag.mode === 'move'
      ? { x: snapValue(origin.x + dx), y: snapValue(origin.y + dy), width: origin.width, height: origin.height }
      : resizeRect(origin, drag.handle ?? 'se', dx, dy)
    emit('update', id, next)
  }
}

function resizeRect(origin: UiRect, handle: string, dx: number, dy: number): UiRect {
  let { x, y, width, height } = origin
  if (handle.includes('e')) width = Math.max(12, snapValue(width + dx))
  if (handle.includes('s')) height = Math.max(12, snapValue(height + dy))
  if (handle.includes('w')) {
    const nextWidth = Math.max(12, snapValue(width - dx))
    x = snapValue(x + (width - nextWidth))
    width = nextWidth
  }
  if (handle.includes('n')) {
    const nextHeight = Math.max(12, snapValue(height - dy))
    y = snapValue(y + (height - nextHeight))
    height = nextHeight
  }
  return { x, y, width, height }
}

function onPointerUp(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  if (drag?.mode === 'marquee' && marquee.value) {
    const box = marquee.value
    const ids = ordered.value
      .filter((element) =>
        element.rect.x < box.x + box.width && element.rect.x + element.rect.width > box.x
        && element.rect.y < box.y + box.height && element.rect.y + element.rect.height > box.y)
      .map((element) => element.id)
    if (ids.length) emit('update:selectedIds', ids)
    marquee.value = null
  }
  drag = null
}

function onDrop(event: DragEvent): void {
  const role = event.dataTransfer?.getData('application/x-ui-role') as UiRole | undefined
  if (!role) return
  event.preventDefault()
  emit('drop-role', role, toCanvasPoint(event as unknown as MouseEvent))
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

/** 选中框与手柄：位置由被选元素的并集包围盒决定，多选时也能整体缩放。 */
const selectionBox = computed(() => {
  const rects = props.selectedIds
    .map((id) => elementOf(id)?.rect)
    .filter((rect): rect is UiRect => Boolean(rect))
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
})

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

function handlePoint(handle: string): { x: number; y: number } {
  const box = selectionBox.value
  if (!box) return { x: 0, y: 0 }
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2
  return { x, y }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

defineExpose({ toCanvasPoint })
</script>

<template>
  <div class="drawing-canvas" :style="{ width: `${drawing.canvas.width * zoom}px`, height: `${drawing.canvas.height * zoom}px` }">
    <!-- 底图与线框：同一份 renderWireframe 输出，保证「画布 = 缩略图」。 -->
    <div class="drawing-canvas__base" v-html="wireframe" />
    <svg
      ref="host"
      class="drawing-canvas__hit"
      :width="drawing.canvas.width * zoom"
      :height="drawing.canvas.height * zoom"
      :viewBox="`0 0 ${drawing.canvas.width * zoom} ${drawing.canvas.height * zoom}`"
      @pointerdown="onCanvasPointerDown"
      @drop="onDrop"
      @dragover="onDragOver"
    >
      <!-- 区域边界 -->
      <g v-if="showRegions">
        <rect
          v-for="region in regions"
          :key="region.id"
          :x="region.rect.x * zoom" :y="region.rect.y * zoom"
          :width="region.rect.width * zoom" :height="region.rect.height * zoom"
          fill="none" stroke="rgba(99,102,241,.5)" stroke-dasharray="6 4" rx="4"
        />
      </g>
      <!-- 框选 -->
      <rect
        v-if="marquee"
        :x="marquee.x * zoom" :y="marquee.y * zoom"
        :width="marquee.width * zoom" :height="marquee.height * zoom"
        fill="rgba(59,130,246,.12)" stroke="rgba(59,130,246,.7)" stroke-dasharray="4 3"
      />
      <!-- 选中框 -->
      <template v-if="selectionBox">
        <rect
          :x="selectionBox.x * zoom" :y="selectionBox.y * zoom"
          :width="selectionBox.width * zoom" :height="selectionBox.height * zoom"
          fill="none" stroke="rgba(37,99,235,.9)" stroke-width="1.5"
        />
        <rect
          v-for="handle in HANDLES"
          :key="handle"
          :x="handlePoint(handle).x * zoom - 4" :y="handlePoint(handle).y * zoom - 4"
          width="8" height="8" fill="#fff" stroke="rgba(37,99,235,.9)" stroke-width="1.5"
          class="handle"
          @pointerdown="onHandlePointerDown($event, handle)"
        />
      </template>
      <!-- 元素命中层：可点可拖，锁定元素不可拖 -->
      <rect
        v-for="element in ordered"
        :key="element.id"
        :x="element.rect.x * zoom" :y="element.rect.y * zoom"
        :width="element.rect.width * zoom" :height="element.rect.height * zoom"
        fill="transparent"
        :class="{ 'is-locked': element.locked, 'is-container': isContainer(element) }"
      />
      <!-- 角色标记：容器左侧竖条，叶层右上角小点，便于在多元素叠放时看清层级 -->
      <g>
        <rect
          v-for="element in ordered"
          :key="`mark-${element.id}`"
          :x="element.rect.x * zoom" :y="element.rect.y * zoom" width="3"
          :height="element.rect.height * zoom"
          :fill="specOf(element.role).tint"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.drawing-canvas { position: relative; background: #fff; }
.drawing-canvas__base { position: absolute; inset: 0; }
.drawing-canvas__base :deep(svg) { width: 100%; height: 100%; display: block; }
.drawing-canvas__hit { position: relative; display: block; touch-action: none; }
.handle { cursor: nwse-resize; }
.is-locked { cursor: not-allowed; }
.is-container { cursor: move; }
</style>
