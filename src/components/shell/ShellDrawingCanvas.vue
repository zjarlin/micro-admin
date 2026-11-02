<!-- 外壳画布：把整机外壳画出来，并让每个图标成为一等元素。
     元素用 `ShellElementView` 渲染成真机样子（真菜单、真用户区、真图标行），
     交互复用页面画布同一内核（`useCanvasInteraction`）；因此「画布上的外壳」
     与「运行期外壳」是同一份渲染，拖动图标改位置 = 改运行期顶栏排布。

     与页面画布的唯一差别：外壳元素按角色分层（区域在下、元素在上），并给选中元素
     叠一层淡淡的角色色，方便在深色侧栏上仍然看清边界。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { ShellDrawing, ShellElement, ShellRole } from '@/shared/shell'
import type { UiRect } from '@/shared/ui-canvas'
import { shellItemOf, shellSpecOf } from '@/shared/shell'
import { useCanvasInteraction } from '@/components/canvas/useCanvasInteraction'
import ShellElementView from './ShellElementView.vue'
import type { ShellViewContext } from './context'

const props = defineProps<{
  drawing: ShellDrawing
  selectedIds: string[]
  zoom: number
  snap: boolean
  showRegions: boolean
  /** 渲染上下文：设计器传示例数据，运行预览传真实数据。 */
  ctx: ShellViewContext
}>()

const emit = defineEmits<{
  (event: 'update:selectedIds', ids: string[]): void
  (event: 'update', id: string, rect: UiRect): void
  (event: 'drop-role', role: ShellRole, point: { x: number; y: number }): void
  (event: 'open', id: string): void
  (event: 'activate', element: ShellElement): void
}>()

const grid = computed(() => (props.drawing.canvas.grid > 0 ? props.drawing.canvas.grid : 0))

const interaction = useCanvasInteraction<ShellElement>({
  elements: () => props.drawing.elements.filter((element) => element.visible !== false),
  selectedIds: () => props.selectedIds,
  zoom: () => props.zoom,
  snap: () => props.snap,
  grid: () => grid.value,
  onSelect: (ids) => emit('update:selectedIds', ids),
  onRect: (id, rect) => emit('update', id, rect),
  onOpen: (id) => emit('open', id),
  onDropRole: (role, point) => emit('drop-role', role as ShellRole, point),
  dragKey: 'application/x-shell-role',
})

const {
  host, marquee, ordered, toCanvasPoint, onCanvasPointerDown, onDoubleClick,
  onHandlePointerDown, onDrop, onDragOver, selectionBox, handlePoint, HANDLES, dispose,
} = interaction

const selectedSet = computed(() => new Set(props.selectedIds))

/** 区域在上层元素之前绘制；装饰在最上。 */
const layered = computed(() => [...ordered.value].sort(
  (left, right) => shellSpecOf(left.role).layer.localeCompare(shellSpecOf(right.role).layer),
))

function boxStyle(rect: UiRect): Record<string, string> {
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }
}

const surfaceStyle = computed(() => ({
  width: `${props.drawing.canvas.width}px`,
  height: `${props.drawing.canvas.height}px`,
  transform: `scale(${props.zoom})`,
  transformOrigin: '0 0',
}))

const handleSize = computed(() => 8 / props.zoom)
const strokeWidth = computed(() => 1.5 / props.zoom)

function onCanvasClick(element: ShellElement): void {
  emit('activate', element)
}

onBeforeUnmount(() => dispose())
defineExpose({ toCanvasPoint, host })
</script>

<template>
  <div class="shell-canvas" :style="{ width: `${drawing.canvas.width * zoom}px`, height: `${drawing.canvas.height * zoom}px` }">
    <div class="shell-canvas__surface" :style="surfaceStyle">
      <div
        class="shell-canvas__grid"
        :style="{
          backgroundSize: drawing.canvas.showGrid ? `${drawing.canvas.grid || 20}px ${drawing.canvas.grid || 20}px` : '0 0',
          backgroundColor: drawing.canvas.background || '#f8fafc',
        }"
      />

      <!-- 元素层：真机渲染。区域用浅底色标出，元素用 ShellElementView。 -->
      <div class="shell-canvas__elements">
        <div
          v-for="element in layered"
          :key="element.id"
          class="shell-canvas__element"
          :class="{
            'is-region': shellSpecOf(element.role).layer === 'region',
            'is-hidden': element.visible === false,
            'is-selected': selectedSet.has(element.id),
          }"
          :style="boxStyle(element.rect)"
        >
          <!-- 区域：画一层角色底色 + 名称标签（开区域线时）。 -->
          <div
            v-if="shellSpecOf(element.role).layer === 'region'"
            class="shell-region"
            :style="{ background: shellSpecOf(element.role).tint }"
          >
            <span v-if="showRegions" class="shell-region__label">{{ shellSpecOf(element.role).label }}</span>
          </div>
          <!-- 元素：真机预览；元素 → 条目走编译同一处映射（`shellItemOf`）。 -->
          <ShellElementView
            v-else
            :item="shellItemOf(element)"
            :ctx="ctx"
            :selected="selectedSet.has(element.id)"
            @activate="onCanvasClick(element)"
          />
        </div>
      </div>

      <svg
        ref="host"
        class="shell-canvas__hit"
        :width="drawing.canvas.width"
        :height="drawing.canvas.height"
        :viewBox="`0 0 ${drawing.canvas.width} ${drawing.canvas.height}`"
        @pointerdown="onCanvasPointerDown"
        @dblclick="onDoubleClick"
        @drop="onDrop"
        @dragover="onDragOver"
      >
        <rect
          v-if="marquee"
          :x="marquee.x" :y="marquee.y" :width="marquee.width" :height="marquee.height"
          fill="rgba(59,130,246,.12)" stroke="rgba(59,130,246,.7)" stroke-dasharray="4 3"
        />
        <rect
          v-for="element in layered"
          :key="`hit-${element.id}`"
          :x="element.rect.x" :y="element.rect.y" :width="element.rect.width" :height="element.rect.height"
          fill="transparent" :class="{ 'is-locked': element.locked }"
        >
          <title>{{ shellSpecOf(element.role).label }} · {{ element.id }}</title>
        </rect>
        <template v-if="selectionBox">
          <rect
            :x="selectionBox.x" :y="selectionBox.y" :width="selectionBox.width" :height="selectionBox.height"
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
.shell-canvas { position: relative; background: #fff; box-shadow: 0 0 0 1px rgba(148, 163, 184, .35); }
.shell-canvas__surface { position: absolute; left: 0; top: 0; will-change: transform; }
.shell-canvas__grid {
  position: absolute; inset: 0;
  background-image: linear-gradient(to right, rgba(148, 163, 184, .18) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(148, 163, 184, .18) 1px, transparent 1px);
}
.shell-canvas__elements { position: absolute; inset: 0; pointer-events: none; }
.shell-canvas__element { position: absolute; overflow: visible; }
/* 区域层的浅底色：帮设计师看清「这个图标落在顶栏还是侧栏」，但不遮住真机渲染。 */
.shell-region { position: absolute; inset: 0; border: 1px dashed rgba(99, 102, 241, .5); border-radius: 4px; opacity: .28; }
.shell-region__label { position: absolute; left: 6px; top: 3px; font-size: 11px; color: #475569; opacity: .9; }
.shell-canvas__element.is-region { opacity: 1; }
.shell-canvas__element.is-region .shell-region { opacity: .28; }
.shell-canvas__element.is-selected :deep(.shell-icon),
.shell-canvas__element.is-selected :deep(.shell-collapse) { outline: 1px dashed rgba(37, 99, 235, .8); outline-offset: 1px; }
.shell-canvas__hit { position: relative; display: block; touch-action: none; }
.handle { cursor: nwse-resize; }
.is-locked { cursor: not-allowed; }
</style>
