<!-- 图元库面板：按分类分组，点击或拖拽把图元加到画布。
     图元来自后端 /scada/symbols（内置图元 + 安装包 scada-symbols/symbols.json 合并）。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { ScadaSymbolCategory, ScadaSymbolDefinition } from '@/shared/scada/types'

const props = defineProps<{
  symbols: ScadaSymbolDefinition[]
  loading?: boolean
  externalSource?: string | null
}>()

const emit = defineEmits<{
  (event: 'add', symbol: ScadaSymbolDefinition): void
}>()

const keyword = ref('')
const collapsed = ref<Record<string, boolean>>({})

const CATEGORY_LABELS: Record<ScadaSymbolCategory, string> = {
  basic: '基础图形',
  pipe: '管道阀门',
  machine: '动力设备',
  vessel: '容器储罐',
  instrument: '仪表显示',
  control: '控制元件',
  custom: '自定义图元',
}

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return props.symbols
  return props.symbols.filter((symbol) =>
    [symbol.name, symbol.key, symbol.description ?? '', CATEGORY_LABELS[symbol.category] ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
})

const groups = computed(() => {
  const order: ScadaSymbolCategory[] = ['instrument', 'control', 'machine', 'vessel', 'pipe', 'basic', 'custom']
  const map = new Map<ScadaSymbolCategory, ScadaSymbolDefinition[]>()
  for (const symbol of filtered.value) {
    const list = map.get(symbol.category) ?? []
    list.push(symbol)
    map.set(symbol.category, list)
  }
  return order
    .filter((category) => (map.get(category)?.length ?? 0) > 0)
    .map((category) => ({ category, label: CATEGORY_LABELS[category] ?? category, items: map.get(category)! }))
})

function toggle(category: ScadaSymbolCategory) {
  collapsed.value = { ...collapsed.value, [category]: !collapsed.value[category] }
}

function onDragStart(event: DragEvent, symbol: ScadaSymbolDefinition) {
  event.dataTransfer?.setData('text/x-scada-symbol', symbol.key)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
  }
}
</script>

<template>
  <div class="scada-palette">
    <el-input
      v-model="keyword"
      size="small"
      clearable
      placeholder="搜索图元"
      :prefix-icon="Search"
      class="scada-palette__search"
    />
    <div v-loading="loading" class="scada-palette__body">
      <section v-for="group in groups" :key="group.category" class="scada-palette__group">
        <button type="button" class="scada-palette__group-head" @click="toggle(group.category)">
          <span>{{ group.label }}</span>
          <span class="scada-palette__group-count">{{ group.items.length }}</span>
        </button>
        <div v-show="!collapsed[group.category]" class="scada-palette__items">
          <button
            v-for="symbol in group.items"
            :key="symbol.key"
            type="button"
            class="scada-palette__item"
            :title="symbol.description ?? symbol.key"
            draggable="true"
            @click="emit('add', symbol)"
            @dragstart="onDragStart($event, symbol)"
          >
            <span class="scada-palette__item-name">{{ symbol.name }}</span>
            <span class="scada-palette__item-size">
              {{ Math.round(symbol.defaultWidth) }}×{{ Math.round(symbol.defaultHeight) }}
            </span>
            <span v-if="symbol.bindingSlots.length" class="scada-palette__item-slot">
              {{ symbol.bindingSlots.length }} 绑定
            </span>
          </button>
        </div>
      </section>
      <div v-if="!groups.length" class="scada-palette__empty">没有匹配的图元。</div>
    </div>
    <div v-if="externalSource" class="scada-palette__source" :title="externalSource">
      已加载外部图元包
    </div>
  </div>
</template>

<style scoped>
.scada-palette {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.scada-palette__search :deep(.el-input__inner) {
  font-size: 12px;
}

.scada-palette__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.scada-palette__group {
  margin-bottom: 6px;
}

.scada-palette__group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: var(--muted-text, #8d98b2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.scada-palette__group-count {
  font-weight: 400;
}

.scada-palette__items {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}

.scada-palette__item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  text-align: left;
  cursor: grab;
}

.scada-palette__item:hover {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(56, 189, 248, 0.1);
}

.scada-palette__item-name {
  font-size: 12px;
  font-weight: 600;
}

.scada-palette__item-size,
.scada-palette__item-slot {
  font-size: 10px;
  color: var(--muted-text, #8d98b2);
}

.scada-palette__empty {
  padding: 16px 0;
  font-size: 11px;
  color: var(--muted-text, #8d98b2);
  text-align: center;
}

.scada-palette__source {
  font-size: 10px;
  color: var(--muted-text, #8d98b2);
}
</style>
