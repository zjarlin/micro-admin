<!-- 基础图形工具条：CAD / Photoshop 那种「一排很小的图形图标」。
     图标来自图元定义本身（`symbolGlyph`），所以「放下去的东西」和图标永远同形，
     新增基础图形也会自动多一格图标，不存在手绘图标集忘更新的问题。
     单色 currentColor：图标表示工具，不表示配色，浅色深色主题下都不会糊。 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { ScadaSymbolDefinition } from '@/shared/scada/types'
import { symbolGlyph, type ScadaGlyph } from '@/shared/scada/glyph'

const props = defineProps<{
  /** 基础图形图元（按库里顺序，图标顺序就是数据顺序）。 */
  symbols: ScadaSymbolDefinition[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'add', symbol: ScadaSymbolDefinition): void
}>()

/** 图标边长（px）：和工具条图标按钮同高，一排看过去是等距的。 */
const GLYPH_SIZE = 18

interface Cell {
  symbol: ScadaSymbolDefinition
  glyph: ScadaGlyph | null
  label: string
}

const cells = computed<Cell[]>(() =>
  props.symbols.map((symbol) => ({
    symbol,
    glyph: symbolGlyph(symbol, GLYPH_SIZE),
    label: `${symbol.name} · 拖到画布上放，或点一下放到空位`,
  })),
)

function onDragStart(event: DragEvent, symbol: ScadaSymbolDefinition): void {
  event.dataTransfer?.setData('text/x-scada-symbol', symbol.key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div v-if="cells.length" class="scada-shapes" role="toolbar" aria-label="基础图形">
    <el-tooltip
      v-for="cell in cells"
      :key="cell.symbol.key"
      :content="cell.label"
      placement="bottom"
      :show-after="360"
    >
      <button
        type="button"
        class="scada-shapes__item"
        :disabled="disabled"
        :aria-label="cell.symbol.name"
        :draggable="!disabled"
        @click="emit('add', cell.symbol)"
        @dragstart="onDragStart($event, cell.symbol)"
      >
        <svg
          v-if="cell.glyph"
          class="scada-shapes__glyph"
          :width="cell.glyph.size"
          :height="cell.glyph.size"
          :viewBox="`0 0 ${cell.glyph.size} ${cell.glyph.size}`"
          aria-hidden="true"
        >
          <g :transform="cell.glyph.transform">
            <template v-for="(part, index) in cell.glyph.primitives" :key="index">
              <text
                v-if="part.kind === 'text'"
                :x="part.x"
                :y="part.y"
                :font-size="part.fontSize"
                :font-weight="part.bold ? 700 : 400"
                fill="currentColor"
                text-anchor="middle"
              >{{ part.text }}</text>
              <path
                v-else
                :d="part.d"
                :fill="part.fill"
                :fill-opacity="part.fillOpacity"
                :stroke="part.stroke ?? undefined"
                :stroke-width="part.stroke ? part.strokeWidth : undefined"
                :transform="part.transform ?? undefined"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            </template>
          </g>
        </svg>
        <span v-else class="scada-shapes__glyph scada-shapes__glyph--empty" />
      </button>
    </el-tooltip>
  </div>
</template>

<style scoped>
/* 矩形按钮 + 细边：和那排图标按钮同一套视觉，但更小、更密——工具条的位置是抢来的。 */
.scada-shapes {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.scada-shapes__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: grab;
  transition: color .14s ease, border-color .14s ease, background .14s ease;
}

.scada-shapes__item:hover {
  color: var(--brand);
  border-color: color-mix(in srgb, var(--brand) 45%, transparent);
  background: color-mix(in srgb, var(--brand) 10%, transparent);
}

.scada-shapes__item:active {
  cursor: grabbing;
}

.scada-shapes__item:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.scada-shapes__glyph {
  display: block;
}

.scada-shapes__glyph--empty {
  width: 18px;
  height: 18px;
}
</style>
