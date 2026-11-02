// 画布交互内核：命中测试、框选、拖拽、缩放手柄、坐标反算——一套实现，多种图纸共用。
//
// 为什么抽出来：页面图纸（`DrawingCanvas`）与外壳图纸（`ShellDrawingCanvas`）的**交互语义完全一致**
// （同一套 CAD 手感：中键/Alt 平移由外层负责，这里是选择与几何），差别只在「元素用什么组件预览」。
// 因此把交互与几何放在这里，两边都调它，不出现第二份命中/拖拽实现。
//
// 参数化的最小元素形状：只要 id / rect / locked / visible。图纸自己的类型都满足它。
import { computed, ref } from 'vue'
import type { UiRect } from '@/shared/ui-canvas'

/** 交互能识别的最小元素：页面元素、外壳元素都满足。 */
export interface CanvasElementLike {
  id: string
  rect: UiRect
  /** 层叠顺序：命中测试用它决定「点在哪个元素上」。 */
  zIndex?: number
  locked?: boolean
  visible?: boolean
}

export interface CanvasInteractionOptions<T extends CanvasElementLike> {
  /** 当前可见元素（已由调用方过滤；顺序无关，内部会排序）。 */
  elements: () => T[]
  /** 选中集合（双向绑定由调用方持有）。 */
  selectedIds: () => string[]
  zoom: () => number
  snap: () => boolean
  /** 栅格（0 表示不吸附）。 */
  grid: () => number
  /** 选择变更。 */
  onSelect: (ids: string[]) => void
  /** 元素几何变更。 */
  onRect: (id: string, rect: UiRect) => void
  /** 双击元素。 */
  onOpen?: (id: string) => void
  /** 拖入新元素（角色 → 落点）。 */
  onDropRole?: (role: string, point: { x: number; y: number }) => void
  /** 拖入时 dataTransfer 的 key（缺省 `application/x-ui-role`）。 */
  dragKey?: string
}

export function useCanvasInteraction<T extends CanvasElementLike>(options: CanvasInteractionOptions<T>) {
  const host = ref<SVGSVGElement | null>(null)
  const marquee = ref<UiRect | null>(null)
  const dragKey = options.dragKey ?? 'application/x-ui-role'

  /** 层叠顺序：zIndex 升序（小的在下），同值按 id 稳定排序，命中测试反向遍历。 */
  const ordered = computed(() => [...options.elements()]
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id)))

  /** 画布坐标：与缩放无关，避免不同 zoom 下拖拽手感不同。 */
  function toCanvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const svg = host.value
    if (!svg) return { x: 0, y: 0 }
    const box = svg.getBoundingClientRect()
    const zoom = options.zoom()
    return { x: (event.clientX - box.left) / zoom, y: (event.clientY - box.top) / zoom }
  }

  function snapValue(value: number): number {
    const grid = options.grid()
    if (!options.snap() || grid <= 0) return Math.round(value)
    return Math.round(value / grid) * grid
  }

  function elementOf(id: string): T | undefined {
    return options.elements().find((element) => element.id === id)
  }

  /** 容器排在后面：点容器空白处应选中容器，点元素优先选叶层。 */
  function hitTest(point: { x: number; y: number }): T | null {
    const sorted = [...ordered.value].reverse()
    return sorted.find((element) =>
      point.x >= element.rect.x && point.x <= element.rect.x + element.rect.width
      && point.y >= element.rect.y && point.y <= element.rect.y + element.rect.height,
    ) ?? null
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

  function beginDrag(event: PointerEvent, mode: DragState['mode'], handle?: string): void {
    const point = toCanvasPoint(event)
    const origin = new Map<string, UiRect>()
    for (const id of options.selectedIds()) {
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
      options.onSelect([])
      marquee.value = { x: point.x, y: point.y, width: 0, height: 0 }
      beginDrag(event, 'marquee')
      return
    }
    const selected = options.selectedIds()
    const has = selected.includes(hit.id)
    const ids = event.shiftKey
      ? (has ? selected.filter((id) => id !== hit.id) : [...selected, hit.id])
      : (has ? selected : [hit.id])
    options.onSelect(ids)
    if (hit.locked) return
    beginDrag(event, 'move')
  }

  function onDoubleClick(event: MouseEvent): void {
    const hit = hitTest(toCanvasPoint(event))
    if (hit && options.onOpen) options.onOpen(hit.id)
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
      options.onRect(id, next)
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
      if (ids.length) options.onSelect(ids)
      marquee.value = null
    }
    drag = null
  }

  function onDrop(event: DragEvent): void {
    const role = event.dataTransfer?.getData(dragKey)
    if (!role) return
    event.preventDefault()
    options.onDropRole?.(role, toCanvasPoint(event as unknown as MouseEvent))
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  /** 选中框与手柄：位置由被选元素的并集包围盒决定，多选时也能整体缩放。 */
  const selectionBox = computed(() => {
    const rects = options.selectedIds()
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

  function dispose(): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  return {
    host,
    marquee,
    ordered,
    toCanvasPoint,
    hitTest,
    selectionBox,
    handlePoint,
    HANDLES,
    onCanvasPointerDown,
    onDoubleClick,
    onHandlePointerDown,
    onDrop,
    onDragOver,
    dispose,
  }
}
