<!-- 图纸画布：所见即所得地画页面。
     元素用运行期真实组件渲染（`CanvasElementPreview`），线框只保留容器骨架与选中框；
     几何求值复用 `@zjarlin/ui-canvas` 的角色表与区域装配，交互只做命中与拖拽，
     因此「编辑里看到的层叠顺序、区域归属」与编译时看到的是同一份数据。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { UiDrawing, UiElement, UiElementFragment, UiRect, UiRole } from '@/shared/ui-canvas'
import { isContainer, regionsOf, specOf } from '@/shared/ui-canvas'
import CanvasContainerPreview from './CanvasContainerPreview.vue'
import CanvasElementPreview from './CanvasElementPreview.vue'

const props = defineProps<{
  drawing: UiDrawing
  selectedIds: string[]
  zoom: number
  snap: boolean
  showRegions: boolean
  /** 元素 id → 编译片段：决定该元素用哪个真实组件渲染。 */
  fragments?: UiElementFragment[] | undefined
  /** 页面实体名（「新增××」按钮文案）。 */
  entity?: string | undefined
}>()

const emit = defineEmits<{
  (event: 'update:selectedIds', ids: string[]): void
  (event: 'update', id: string, rect: UiRect): void
  (event: 'drop-role', role: UiRole, point: { x: number; y: number }): void
  /** 双击元素：打开属性弹窗。 */
  (event: 'open', id: string): void
}>()

const host = ref<SVGSVGElement | null>(null)
const marquee = ref<UiRect | null>(null)

const grid = computed(() => (props.drawing.canvas.grid > 0 ? props.drawing.canvas.grid : 0))
const selectedSet = computed(() => new Set(props.selectedIds))

const fragmentOf = computed<Record<string, UiElementFragment>>(() => {
  const map: Record<string, UiElementFragment> = {}
  for (const fragment of props.fragments ?? []) map[fragment.elementId] = fragment
  return map
})

const ordered = computed(() => [...props.drawing.elements]
  .filter((element) => element.visible !== false)
  .sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id)))

/**
 * 由真实壳接管子元素的容器：表格 / 查询栏 / 表单 / 左树 / 分页。
 *
 * 页头、工具条、卡片、页签不在其列：它们的内容本身就是图纸元素（标题文本、按钮），
 * 再套一层运行期页头会出现两个标题；这些容器由 `CanvasElementPreview` 画出结构框，
 * 里面每个元素各按自己的真实组件渲染。
 */
const CONTAINER_FAMILY: ReadonlyArray<string> = ['filter', 'table', 'form', 'tree', 'footer']

const childrenOf = computed<Record<string, UiElement[]>>(() => {
  const map: Record<string, UiElement[]> = {}
  for (const region of regionsOf(props.drawing)) {
    map[region.id] = region.childIds
      .map((id) => elementOf(id))
      .filter((element): element is UiElement => Boolean(element))
  }
  return map
})

/**
 * 由容器壳接管的元素：容器的直属叶层子元素，且容器本身支持真实壳渲染。
 *
 * 其余元素照旧逐元素渲染——留出「容器画不出来时」的降级路径，
 * 而不是整块消失。
 */
const absorbed = computed<Set<string>>(() => {
  const set = new Set<string>()
  for (const container of ordered.value) {
    if (!CONTAINER_FAMILY.includes(container.role)) continue
    if (!columnsAvailable(container)) continue
    for (const child of childrenOf.value[container.id] ?? []) set.add(child.id)
  }
  return set
})

/**
 * 容器能不能用真实壳画。
 *
 * 判定标准是「这个壳拿不到内容会不会只剩空架子」：
 * - 表格没列 → 空表；查询栏没条件 → 只剩按钮；表单没字段 → 空表单；
 *   这三种退回逐元素渲染（子元素各自成框），设计师才看得出「里面还缺东西」。
 */
function columnsAvailable(container: UiElement): boolean {
  const children = childrenOf.value[container.id] ?? []
  if (!children.length) return container.role === 'tree' || container.role === 'footer'
  return true
}

const topLevel = computed(() => ordered.value.filter((element) => !absorbed.value.has(element.id)))

const regions = computed(() => regionsOf(props.drawing))

/** 示例行：多行是为了让表格像真表（一行看不出斑马纹与行高），值全部来自图纸声明。 */
const sampleRows = computed<Record<string, unknown>[]>(() => {
  const seeds = ['示例', '样例', '演示']
  return seeds.map((seed, index) => {
    const row: Record<string, unknown> = { id: String(index + 1) }
    for (const element of props.drawing.elements) {
      const prop = String(element.props.prop ?? '')
      if (!prop) continue
      const cell = element.props.cell ?? 'text'
      if (cell === 'datetime') row[prop] = `2026-10-${String(21 + index).padStart(2, '0')}T09:0${index}:00.000Z`
      else if (cell === 'status' || cell === 'tagMap') {
        const keys = Object.keys(element.props.tagMap ?? {})
        row[prop] = keys[index % Math.max(keys.length, 1)] ?? 'active'
      } else if (element.props.value !== undefined) row[prop] = element.props.value
      else row[prop] = `${seed}${element.props.label ?? element.props.prop}`
    }
    return row
  })
})


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
  if (hit.locked) return
  beginDrag(event, 'move')
}

function onDoubleClick(event: MouseEvent): void {
  const hit = hitTest(toCanvasPoint(event))
  if (hit) emit('open', hit.id)
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

/**
 * 元素定位：1:1 按图纸矩形摆放，**缩放由外层 transform 统一施加**。
 *
 * 这是 CAD / IDE 的做法：内部永远是真实尺寸，所以表格列宽、字号、间距在
 * 任何缩放级别都保持正确比例。若改成「逐元素乘 zoom」，容器变窄而 schema 里的
 * 列宽还是像素值，表格就会横向溢出（缩到 79% 时状态列被操作列挤掉就是这么来的）。
 */
function boxStyle(rect: UiRect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

/** 画布表面：真实尺寸 + 统一缩放，鼠标坐标反算仍按 zoom 除。 */
const surfaceStyle = computed(() => ({
  width: `${props.drawing.canvas.width}px`,
  height: `${props.drawing.canvas.height}px`,
  transform: `scale(${props.zoom})`,
  transformOrigin: '0 0',
}))

/** 选中手柄 / 描边按缩放反向补偿：屏幕上始终是同一个大小，不随缩放忽大忽小。 */
const handleSize = computed(() => 8 / props.zoom)
const strokeWidth = computed(() => 1.5 / props.zoom)

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})

defineExpose({ toCanvasPoint })
</script>

<template>
  <div
    class="drawing-canvas"
    :style="{ width: `${drawing.canvas.width * zoom}px`, height: `${drawing.canvas.height * zoom}px` }"
  >
    <div class="drawing-canvas__surface" :style="surfaceStyle">
    <!-- 网格背景：随缩放变化，不做成图片。 -->
    <div
      class="drawing-canvas__grid"
      :style="{
        backgroundSize: drawing.canvas.showGrid ? `${drawing.canvas.grid || 20}px ${drawing.canvas.grid || 20}px` : '0 0',
        backgroundColor: drawing.canvas.background || '#fff',
      }"
    />

    <!-- 元素层：真实组件，指针事件全部交给上面的命中层。 -->
    <div class="drawing-canvas__elements">
      <div
        v-for="element in topLevel"
        :key="element.id"
        class="drawing-canvas__element"
        :class="{ 'is-container': isContainer(element), 'is-hidden': element.visible === false }"
        :style="boxStyle(element.rect)"
      >
        <!-- 容器走运行期同一个壳（真表头/真控件）；叶层元素走单元素渲染。 -->
        <CanvasContainerPreview
          v-if="isContainer(element) && CONTAINER_FAMILY.includes(element.role)"
          :element="element"
          :children="childrenOf[element.id] ?? []"
          :fragments="fragments ?? []"
          :entity="entity"
          :sample-rows="sampleRows"
        />
        <CanvasElementPreview
          v-else
          :element="element"
          :fragment="fragmentOf[element.id]"
          :sample-row="sampleRows[0] ?? {}"
          :show-region-labels="showRegions"
          :entity="entity"
        />
      </div>
    </div>

    <svg
      ref="host"
      class="drawing-canvas__hit"
      :width="drawing.canvas.width"
      :height="drawing.canvas.height"
      :viewBox="`0 0 ${drawing.canvas.width} ${drawing.canvas.height}`"
      @pointerdown="onCanvasPointerDown"
      @dblclick="onDoubleClick"
      @drop="onDrop"
      @dragover="onDragOver"
    >
      <!-- 区域边界（可关）：只做参考，不遮住真实组件。 -->
      <g v-if="showRegions">
        <rect
          v-for="region in regions"
          :key="region.id"
          :x="region.rect.x" :y="region.rect.y"
          :width="region.rect.width" :height="region.rect.height"
          fill="none" stroke="rgba(99,102,241,.45)" stroke-dasharray="6 4" rx="4"
        />
      </g>
      <!-- 框选 -->
      <rect
        v-if="marquee"
        :x="marquee.x" :y="marquee.y"
        :width="marquee.width" :height="marquee.height"
        fill="rgba(59,130,246,.12)" stroke="rgba(59,130,246,.7)" stroke-dasharray="4 3"
      />
      <!-- 悬停/选中：只描边，不盖住组件 -->
      <rect
        v-for="element in ordered"
        :key="`hit-${element.id}`"
        :x="element.rect.x" :y="element.rect.y"
        :width="element.rect.width" :height="element.rect.height"
        fill="transparent"
        :class="{ 'is-locked': element.locked }"
      >
        <title>{{ specOf(element.role).label }}</title>
      </rect>
      <template v-if="selectionBox">
        <rect
          :x="selectionBox.x" :y="selectionBox.y"
          :width="selectionBox.width" :height="selectionBox.height"
          fill="none" stroke="rgba(37,99,235,.9)" :stroke-width="strokeWidth"
        />
        <rect
          v-for="handle in HANDLES"
          :key="handle"
          :x="handlePoint(handle).x - handleSize / 2" :y="handlePoint(handle).y - handleSize / 2"
          :width="handleSize" :height="handleSize" fill="#fff" stroke="rgba(37,99,235,.9)" :stroke-width="strokeWidth"
          class="handle"
          @pointerdown="onHandlePointerDown($event, handle)"
        />
      </template>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.drawing-canvas { position: relative; background: #fff; box-shadow: 0 0 0 1px rgba(148, 163, 184, .35); }
/* 真实尺寸表面：缩放统一施加在这里，内部一切（表格、字号、间距）保持 1:1 比例。 */
.drawing-canvas__surface { position: absolute; left: 0; top: 0; will-change: transform; }
.drawing-canvas__grid { position: absolute; inset: 0; background-image: linear-gradient(to right, rgba(148, 163, 184, .18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, .18) 1px, transparent 1px); }
.drawing-canvas__elements { position: absolute; inset: 0; pointer-events: none; }
.drawing-canvas__element { position: absolute; overflow: hidden; }
.drawing-canvas__element.is-container { overflow: visible; }
.drawing-canvas__hit { position: relative; display: block; touch-action: none; }
.handle { cursor: nwse-resize; }
.is-locked { cursor: not-allowed; }
</style>
