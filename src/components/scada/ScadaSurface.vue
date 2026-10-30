<!-- 画布渲染面：吃「画面文档 + 图元库 + 变量值」，画面内容由 shared/scada/scene 求值。
     这里没有选择、拖动、缩放等编辑语义——只读大屏、监视页、缩略图都直接用它；
     编辑器把它当画布底色，再用插槽叠命中层与交互图层。 -->
<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { ScadaDocument, ScadaSymbolDefinition } from '@/shared/scada/types'
import type { TagValueSource } from '@/shared/scada/render'
import { buildScene } from '@/shared/scada/scene'

const props = defineProps<{
  document: ScadaDocument
  symbols: Record<string, ScadaSymbolDefinition>
  values: Map<number, TagValueSource>
  /** 显示缩放；画面坐标始终是文档坐标。 */
  zoom?: number
}>()

const svgRef = ref<SVGSVGElement | null>(null)
const zoom = computed(() => props.zoom ?? 1)
/** 同一页面可能有多块画布，网格 pattern 的 id 必须唯一。 */
const gridId = `scada-grid-${useId()}`

const scene = computed(() => buildScene(props.document, props.symbols, props.values))

defineExpose({ svgRef, scene })
</script>

<template>
  <svg
    ref="svgRef"
    class="scada-surface"
    :width="scene.width * zoom"
    :height="scene.height * zoom"
    :viewBox="`0 0 ${scene.width} ${scene.height}`"
  >
    <rect
      :x="0"
      :y="0"
      :width="scene.width"
      :height="scene.height"
      :fill="scene.background"
    />
    <template v-if="scene.showGrid && scene.grid > 0">
      <defs>
        <pattern
          :id="gridId"
          :width="scene.grid"
          :height="scene.grid"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${scene.grid} 0 L 0 0 0 ${scene.grid}`"
            fill="none"
            stroke="rgba(148,163,184,0.18)"
            stroke-width="0.6"
          />
        </pattern>
      </defs>
      <rect
        :x="0"
        :y="0"
        :width="scene.width"
        :height="scene.height"
        :fill="`url(#${gridId})`"
      />
    </template>

    <g
      v-for="widget in scene.widgets"
      :key="widget.id"
      :data-widget-id="widget.id"
      :transform="widget.transform ?? undefined"
    >
      <template v-for="part in widget.primitives" :key="part.partId">
        <text
          v-if="part.kind === 'text'"
          :x="part.x"
          :y="part.y"
          :fill="part.fill"
          :font-size="part.fontSize"
          :font-weight="part.bold ? 700 : 400"
          font-family="Noto Sans SC, Microsoft YaHei, sans-serif"
          text-anchor="middle"
          style="pointer-events: none"
        >{{ part.text }}</text>
        <path
          v-else
          :d="part.d"
          :fill="part.fill"
          :stroke="part.stroke ?? undefined"
          :stroke-width="part.stroke ? part.strokeWidth : undefined"
          :transform="part.transform ?? undefined"
          stroke-linejoin="round"
          stroke-linecap="round"
          style="pointer-events: none"
        />
      </template>
      <!-- 命中层/选中框：编辑器按图元往组里塞，只读端不传就什么都不画。 -->
      <slot name="widget" :widget="widget" />
    </g>

    <!-- 画布级叠加层：手柄、参考线、框选。 -->
    <slot :scene="scene" />
  </svg>
</template>
