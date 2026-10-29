<script setup lang="ts">
// 组态工作台：画面列表 + 图元库 + 画布 + 属性面板。
//
// 数据全部走后端契约（/scada/*），mock 模式下由 src/shared/scada/mock-store.ts 顶替；
// 画布求值与几何在 src/shared/scada/render.ts，页面只做交互编排。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DocumentAdd, Download, Refresh } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type {
  ScadaDocument,
  ScadaRect,
  ScadaScreenDetail,
  ScadaScreenSummary,
  ScadaSymbolDefinition,
  ScadaTagOption,
  ScadaWidget,
} from '@/shared/scada/types'
import { createEmptyScadaDocument, isWritableAccessMode, parseScadaDocument } from '@/shared/scada/types'
import type { TagValueSource } from '@/shared/scada/render'
import { referencedTagIds } from '@/shared/scada/render'
import ScadaCanvas from '@/components/scada/ScadaCanvas.vue'
import ScadaInspector from '@/components/scada/ScadaInspector.vue'
import ScadaSymbolPalette from '@/components/scada/ScadaSymbolPalette.vue'
import ScadaTagPicker from '@/components/scada/ScadaTagPicker.vue'

/** 演示工程：真实部署由路由参数或工程上下文注入。 */
const PROJECT_ID = 1

const http = useService<HttpClient>('http')

const screens = ref<ScadaScreenSummary[]>([])
const currentScreen = ref<ScadaScreenDetail | null>(null)
const document = ref<ScadaDocument>(createEmptyScadaDocument())
const symbols = ref<ScadaSymbolDefinition[]>([])
const symbolSource = ref<string | null>(null)
const tagOptions = ref<ScadaTagOption[]>([])
const selectedIds = ref<string[]>([])
const zoom = ref(1)
const snapEnabled = ref(true)
const guideEnabled = ref(true)
const dirty = ref(false)
const loading = ref(false)
const saving = ref(false)
const tagPickerVisible = ref(false)
const tagPickerSlot = ref<string | null>(null)
const loadError = ref<string | null>(null)
const canvasHost = ref<HTMLElement | null>(null)

const symbolMap = computed(() => {
  const map: Record<string, ScadaSymbolDefinition> = {}
  for (const symbol of symbols.value) map[symbol.key] = symbol
  return map
})

const tagById = computed(() => {
  const map = new Map<number, ScadaTagOption>()
  for (const tag of tagOptions.value) map.set(tag.tagId, tag)
  return map
})

/** 画布求值用的变量值：质量一起带过来，BAD 时画布不显示旧值。 */
const canvasValues = computed(() => {
  const values = new Map<number, TagValueSource>()
  for (const tag of tagOptions.value) {
    if (!tag.currentValueText) continue
    const numeric = Number(tag.currentValueText)
    values.set(tag.tagId, {
      raw: Number.isFinite(numeric) ? numeric : null,
      text: tag.currentValueText,
      quality: tag.qualityText ?? tag.qualityCode ?? null,
    })
  }
  return values
})

const selectedWidget = computed<ScadaWidget | null>(() => {
  if (selectedIds.value.length !== 1) return null
  const id = selectedIds.value[0]
  return document.value.widgets.find((widget) => widget.id === id) ?? null
})

const selectedSymbol = computed<ScadaSymbolDefinition | null>(() => {
  const widget = selectedWidget.value
  return widget ? symbolMap.value[widget.symbolKey] ?? null : null
})

const boundSlotCount = computed(() =>
  document.value.widgets.reduce((total, widget) => total + widget.bindings.length, 0),
)

const resolvedTagCount = computed(() => referencedTagIds(document.value).length)

const writableTagCount = computed(() => tagOptions.value.filter((tag) => isWritableAccessMode(tag.accessMode)).length)

const pickerTitle = computed(() => {
  const slot = tagPickerSlot.value
  if (!slot) return '选择通道变量'
  const spec = selectedSymbol.value?.bindingSlots.find((item) => item.key === slot)
  return spec ? `选择变量 · ${spec.label}` : '选择通道变量'
})

const pickerHint = computed(() => {
  const slot = tagPickerSlot.value
  const spec = selectedSymbol.value?.bindingSlots.find((item) => item.key === slot)
  if (!spec) return undefined
  switch (spec.style) {
    case 'stateColor':
      return '状态色槽位：绑定后按阈值或文本映射切换图元颜色。'
    case 'fillRatio':
      return `填充比例槽位：变量值按量程 ${spec.min} ~ ${spec.max} 换算成 0~100% 填充。`
    case 'needle':
      return `指针槽位：变量值按量程 ${spec.min} ~ ${spec.max} 换算成 -120° ~ 120° 指针。`
    case 'visibility':
      return '可见性槽位：变量为 0 / 空 / 关 / 断开时隐藏该图元。'
    case 'textMap':
      return '文本映射槽位：按映射表把原始值文本替换成显示文本。'
    default:
      return '数值文本槽位：按小数位与单位格式化变量当前值。'
  }
})

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

// ---------------- 数据加载 ----------------

async function loadSymbols(): Promise<void> {
  try {
    const library = await http.request<{ version: number; symbols: ScadaSymbolDefinition[]; externalSource: string | null }>(
      '/scada/symbols',
    )
    symbols.value = library.symbols
    symbolSource.value = library.externalSource
  } catch (error) {
    ElMessage.error(describeError(error, '读取图元库失败'))
  }
}

async function loadTags(): Promise<void> {
  try {
    const catalog = await http.request<{ items: ScadaTagOption[] }>(`/scada/tags?projectId=${PROJECT_ID}`)
    tagOptions.value = catalog.items
  } catch (error) {
    ElMessage.error(describeError(error, '读取通道变量失败'))
  }
}

async function openScreen(screenId: number): Promise<void> {
  loading.value = true
  try {
    const detail = await http.request<ScadaScreenDetail>(`/scada/screen?screenId=${screenId}`)
    currentScreen.value = detail
    document.value = parseScadaDocument(detail.documentJson)
    selectedIds.value = []
    dirty.value = false
    loadError.value = null
    fitToWidth()
  } catch (error) {
    loadError.value = describeError(error, '读取画面详情失败')
  } finally {
    loading.value = false
  }
}

async function loadScreens(): Promise<void> {
  try {
    const items = await http.request<ScadaScreenSummary[]>(`/scada/screens?projectId=${PROJECT_ID}`)
    screens.value = items
    if (!items.length) {
      currentScreen.value = null
      document.value = createEmptyScadaDocument()
      selectedIds.value = []
      dirty.value = false
      return
    }
    const keep = currentScreen.value?.id
    const target = items.find((item) => item.id === keep) ?? items[0]
    if (target) await openScreen(target.id)
  } catch (error) {
    loadError.value = describeError(error, '读取组态画面失败')
  }
}

async function refreshAll(): Promise<void> {
  loadError.value = null
  await Promise.all([loadSymbols(), loadTags()])
  await loadScreens()
}

onMounted(() => void refreshAll())

// ---------------- 画面增删改 ----------------

async function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('当前画面有未保存的修改，切换后会丢失。继续？', '未保存的修改', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '留在当前画面',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}

async function selectScreen(screenId: number): Promise<void> {
  if (screenId === currentScreen.value?.id) return
  if (!(await confirmDiscard())) return
  await openScreen(screenId)
}

async function createScreen(): Promise<void> {
  const suggested = `画面 ${screens.value.length + 1}`
  const result = await ElMessageBox.prompt('新画面名称', '新建组态画面', {
    confirmButtonText: '创建',
    cancelButtonText: '取消',
    inputPattern: /\S+/,
    inputErrorMessage: '名称不能为空',
    inputValue: suggested,
  }).catch(() => null)
  if (!result) return
  const name = String(result.value ?? '').trim()
  if (!name) return
  try {
    const created = await http.request<ScadaScreenDetail>('/scada/screen/create', {
      method: 'POST',
      body: JSON.stringify({ projectId: PROJECT_ID, name }),
    })
    ElMessage.success(`已创建画面「${name}」`)
    dirty.value = false
    // 新建后直接进入新画面：loadScreens 会保留当前画面，不能指望它切过去。
    await loadScreens()
    if (created?.id) await openScreen(created.id)
  } catch (error) {
    ElMessage.error(describeError(error, '创建画面失败'))
  }
}

async function renameScreen(): Promise<void> {
  const screen = currentScreen.value
  if (!screen) return
  const result = await ElMessageBox.prompt('画面名称', '重命名画面', {
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    inputPattern: /\S+/,
    inputErrorMessage: '名称不能为空',
    inputValue: screen.name,
  }).catch(() => null)
  if (!result) return
  const name = String(result.value ?? '').trim()
  if (!name || name === screen.name) return
  try {
    const updated = await http.request<ScadaScreenDetail>('/scada/screen/update', {
      method: 'POST',
      body: JSON.stringify({ screenId: screen.id, name }),
    })
    currentScreen.value = updated
    ElMessage.success('已重命名')
    await loadScreens()
  } catch (error) {
    ElMessage.error(describeError(error, '重命名失败'))
  }
}

async function deleteScreen(): Promise<void> {
  const screen = currentScreen.value
  if (!screen) return
  const confirmed = await ElMessageBox.confirm(`删除画面「${screen.name}」？该操作不可撤销。`, '删除画面', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning',
  }).catch(() => null)
  if (!confirmed) return
  try {
    await http.request<{ deleted: number }>('/scada/screen/delete', {
      method: 'POST',
      body: JSON.stringify({ screenId: screen.id }),
    })
    ElMessage.success('画面已删除')
    currentScreen.value = null
    dirty.value = false
    await loadScreens()
  } catch (error) {
    ElMessage.error(describeError(error, '删除画面失败'))
  }
}

async function saveScreen(): Promise<void> {
  const screen = currentScreen.value
  if (!screen) {
    ElMessage.warning('先新建或选择一个画面')
    return
  }
  saving.value = true
  try {
    // 保存前同步变量名快照：变量改名后属性面板仍显示正确来源。
    for (const widget of document.value.widgets) {
      for (const binding of widget.bindings) {
        const tag = tagById.value.get(binding.tagId)
        if (tag && binding.tagLabel !== tag.name) binding.tagLabel = tag.name
      }
    }
    const documentJson = JSON.stringify(document.value)
    const validation = await http.request<{ valid: boolean; issues: string[] }>('/scada/validate', {
      method: 'POST',
      body: JSON.stringify({ projectId: PROJECT_ID, documentJson }),
    })
    if (!validation.valid) {
      ElMessage.error(`画面未通过校验：${validation.issues.join('；')}`)
      return
    }
    const updated = await http.request<ScadaScreenDetail>('/scada/screen/update', {
      method: 'POST',
      body: JSON.stringify({
        screenId: screen.id,
        documentJson,
        documentVersion: document.value.version,
      }),
    })
    currentScreen.value = updated
    dirty.value = false
    ElMessage.success('组态画面已保存')
    await loadScreens()
  } catch (error) {
    ElMessage.error(describeError(error, '保存画面失败'))
  } finally {
    saving.value = false
  }
}

// ---------------- 画布编辑 ----------------

let widgetSeq = 0

function nextWidgetId(): string {
  widgetSeq += 1
  return `w-${Date.now().toString(36)}-${widgetSeq}`
}

function nextZIndex(): number {
  return document.value.widgets.reduce((max, widget) => Math.max(max, widget.zIndex), 0) + 1
}

/** 两个矩形是否重叠，留 1px 容差避免贴边误判。 */
function rectsOverlap(left: ScadaRect, right: ScadaRect): boolean {
  return (
    left.x < right.x + right.width - 1 &&
    right.x < left.x + left.width - 1 &&
    left.y < right.y + right.height - 1 &&
    right.y < left.y + left.height - 1
  )
}

/** 新图元落位：按栅格从左上找第一个不重叠的位置。 */
function findFreeSpot(width: number, height: number, grid: number): { x: number; y: number } {
  const step = grid > 0 ? grid : 10
  const maxX = Math.max(document.value.canvas.width - width, 0)
  const maxY = Math.max(document.value.canvas.height - height, 0)
  const startX = Math.min(step * 6, maxX)
  const startY = Math.min(step * 6, maxY)
  for (let y = startY; y <= maxY; y += step) {
    for (let x = startX; x <= maxX; x += step) {
      const candidate = { x, y, width, height }
      if (!document.value.widgets.some((widget) => rectsOverlap(candidate, widget.rect))) return { x, y }
    }
  }
  return { x: startX, y: startY }
}

function addSymbol(symbol: ScadaSymbolDefinition): void {
  const grid = document.value.canvas.grid || 10
  const spot = findFreeSpot(symbol.defaultWidth, symbol.defaultHeight, grid)
  const widget: ScadaWidget = {
    id: nextWidgetId(),
    symbolKey: symbol.key,
    name: symbol.name,
    rect: { x: spot.x, y: spot.y, width: symbol.defaultWidth, height: symbol.defaultHeight },
    rotation: 'none',
    zIndex: nextZIndex(),
    props: {},
    bindings: [],
    locked: false,
    visible: true,
    groupId: null,
  }
  document.value.widgets.push(widget)
  selectedIds.value = [widget.id]
  dirty.value = true
}

function onDrop(event: DragEvent): void {
  const key = event.dataTransfer?.getData('text/x-scada-symbol')
  if (!key) return
  const symbol = symbolMap.value[key]
  if (!symbol) return
  event.preventDefault()
  addSymbol(symbol)
}

function deleteSelected(): void {
  if (!selectedIds.value.length) return
  const remove = new Set(selectedIds.value)
  document.value.widgets = document.value.widgets.filter((widget) => !remove.has(widget.id))
  selectedIds.value = []
  dirty.value = true
}

function duplicateSelected(): void {
  const widget = selectedWidget.value
  if (!widget) return
  const copy: ScadaWidget = structuredClone(widget)
  copy.id = nextWidgetId()
  copy.name = `${widget.name} 副本`
  copy.rect = { ...widget.rect, x: widget.rect.x + 20, y: widget.rect.y + 20 }
  copy.zIndex = nextZIndex()
  document.value.widgets.push(copy)
  selectedIds.value = [copy.id]
  dirty.value = true
}

function rotateSelected(): void {
  const order = ['none', 'deg90', 'deg180', 'deg270'] as const
  for (const id of selectedIds.value) {
    const widget = document.value.widgets.find((item) => item.id === id)
    if (!widget || widget.locked) continue
    const index = order.indexOf(widget.rotation)
    widget.rotation = order[(index + 1) % order.length] ?? 'none'
  }
  dirty.value = true
}

function toggleLock(): void {
  const widget = selectedWidget.value
  if (!widget) return
  widget.locked = !widget.locked
  dirty.value = true
}

function changeZIndex(delta: number): void {
  const widget = selectedWidget.value
  if (!widget) return
  widget.zIndex = Math.max(0, widget.zIndex + delta)
  dirty.value = true
}

function pickTag(slot: string): void {
  if (!selectedWidget.value) return
  tagPickerSlot.value = slot
  tagPickerVisible.value = true
}

function applyTag(option: ScadaTagOption): void {
  const widget = selectedWidget.value
  const slot = tagPickerSlot.value
  if (!widget || !slot) return
  const existing = widget.bindings.find((binding) => binding.slot === slot)
  if (existing) {
    existing.tagId = option.tagId
    existing.tagLabel = option.name
  } else {
    widget.bindings.push({ slot, tagId: option.tagId, tagLabel: option.name })
  }
  tagPickerVisible.value = false
  dirty.value = true
}

function clearBinding(slot: string): void {
  const widget = selectedWidget.value
  if (!widget) return
  widget.bindings = widget.bindings.filter((binding) => binding.slot !== slot)
  dirty.value = true
}

// ---------------- 视图 ----------------

/** 按容器宽度算缩放：画布 1920 宽在窄栏里默认会裁掉右侧图元。 */
function fitToWidth(): void {
  const host = canvasHost.value
  if (!host) {
    zoom.value = 1
    return
  }
  const width = host.clientWidth - 24
  if (width <= 0) return
  const ratio = width / document.value.canvas.width
  zoom.value = Math.min(1, Math.max(0.2, Math.round(ratio * 100) / 100))
}

// ---------------- 导出 ----------------

/** 导出当前画布 SVG：直接序列化画布节点，保证导出与所见一致。 */
function exportSvg(): void {
  const svg = canvasHost.value?.querySelector('svg')
  if (!svg) {
    ElMessage.info('画布还没准备好')
    return
  }
  const markup = new XMLSerializer().serializeToString(svg)
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = `${currentScreen.value?.name ?? 'scada'}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="page scada-page">
    <header class="page-head">
      <div>
        <h1>组态画布</h1>
        <p>图元库、画面文档与通道变量都走后端契约；画布求值与交互与 okmy_dics 组态一致。</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Refresh" :loading="loading" @click="refreshAll">刷新</el-button>
        <el-button :icon="DocumentAdd" @click="createScreen">新建画面</el-button>
        <el-button :icon="Download" @click="exportSvg">导出 SVG</el-button>
        <el-button type="primary" :loading="saving" :disabled="!currentScreen" @click="saveScreen">保存</el-button>
      </div>
    </header>

    <el-alert v-if="loadError" type="error" :closable="false" :title="loadError" show-icon />

    <div class="scada-layout">
      <aside class="panel scada-pane">
        <div class="panel-title">
          <h2>画面</h2>
          <div class="scada-pane-actions">
            <el-button size="small" text :disabled="!currentScreen" @click="renameScreen">重命名</el-button>
            <el-button size="small" text type="danger" :icon="Delete" :disabled="!currentScreen" @click="deleteScreen" />
          </div>
        </div>
        <div class="scada-screens">
          <button
            v-for="item in screens"
            :key="item.id"
            type="button"
            class="scada-screen-item"
            :class="{ 'is-active': item.id === currentScreen?.id }"
            @click="selectScreen(item.id)"
          >
            <span class="scada-screen-item__name">{{ item.name }}</span>
            <span class="scada-screen-item__meta">{{ item.widgetCount }} 图元</span>
          </button>
          <p v-if="!screens.length" class="muted scada-empty">还没有画面，点「新建画面」开始。</p>
        </div>
        <div class="panel-title scada-palette-head"><h2>图元库</h2></div>
        <ScadaSymbolPalette
          :symbols="symbols"
          :loading="loading"
          :external-source="symbolSource"
          @add="addSymbol"
        />
      </aside>

      <section class="panel scada-pane scada-pane--canvas" @dragover.prevent @drop="onDrop">
        <div class="scada-bar">
          <div class="scada-bar__left">
            <el-checkbox v-model="snapEnabled" size="small">栅格吸附</el-checkbox>
            <el-checkbox v-model="guideEnabled" size="small">对齐参考线</el-checkbox>
            <span class="muted">
              {{ document.widgets.length }} 个图元 · {{ boundSlotCount }} 个绑定槽位 ·
              {{ resolvedTagCount }} 个变量（可写 {{ writableTagCount }}）
            </span>
          </div>
          <div class="scada-bar__right">
            <el-button-group>
              <el-button size="small" :disabled="selectedIds.length !== 1" @click="changeZIndex(-1)">下移</el-button>
              <el-button size="small" :disabled="selectedIds.length !== 1" @click="changeZIndex(1)">上移</el-button>
            </el-button-group>
            <el-button size="small" :disabled="!selectedIds.length" @click="rotateSelected">旋转</el-button>
            <el-button size="small" :disabled="!selectedIds.length" @click="deleteSelected">删除</el-button>
            <el-button size="small" @click="fitToWidth">适应宽度</el-button>
            <el-slider v-model="zoom" class="scada-zoom" :min="0.2" :max="2" :step="0.05" size="small" :show-tooltip="false" />
          </div>
        </div>

        <div ref="canvasHost" class="scada-canvas-host">
          <ScadaCanvas
            v-model:selectedIds="selectedIds"
            :document="document"
            :symbols="symbolMap"
            :values="canvasValues"
            :zoom="zoom"
            :snap="snapEnabled"
            :guides="guideEnabled"
            @changed="dirty = true"
            @update:zoom="zoom = $event"
          />
        </div>
      </section>

      <aside class="panel scada-pane scada-pane--right">
        <ScadaInspector
          :document="document"
          :widget="selectedWidget"
          :symbol="selectedSymbol"
          :tag-by-id="tagById"
          :selected-count="selectedIds.length"
          @update-widget="dirty = true"
          @update-canvas="dirty = true"
          @pick-tag="pickTag"
          @clear-binding="clearBinding"
          @delete="deleteSelected"
          @duplicate="duplicateSelected"
          @rotate="rotateSelected"
          @toggle-lock="toggleLock"
        />
      </aside>
    </div>

    <ScadaTagPicker
      v-model="tagPickerVisible"
      :options="tagOptions"
      :loading="loading"
      :title="pickerTitle"
      :hint="pickerHint"
      @select="applyTag"
    />
  </div>
</template>

<style scoped>
.scada-page { min-width: 0; }
.scada-layout { display: grid; grid-template-columns: 244px minmax(0, 1fr) 300px; gap: 16px; align-items: stretch; }
.scada-pane { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px; }
.scada-pane--canvas { padding: 12px; }
.scada-pane-actions { display: flex; align-items: center; gap: 2px; }
.scada-screens { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.scada-screen-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 10px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--app-text); font-size: 13px; cursor: pointer; text-align: left;
}
.scada-screen-item:hover { background: rgba(99, 102, 241, .08); }
.scada-screen-item.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); }
.scada-screen-item__meta { color: var(--muted); font-size: 11px; }
.scada-empty { font-size: 12px; margin: 4px 0; }
.scada-palette-head { margin: 4px 0 0; }
.scada-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.scada-bar__left { display: flex; align-items: center; gap: 12px; font-size: 12px; flex-wrap: wrap; }
.scada-bar__right { display: flex; align-items: center; gap: 8px; }
.scada-zoom { width: 130px; }
.scada-canvas-host {
  display: flex; align-items: flex-start; justify-content: center;
  max-height: 72vh; overflow: auto; border-radius: 10px;
}
@media (max-width: 1280px) { .scada-layout { grid-template-columns: 220px minmax(0, 1fr); } .scada-pane--right { grid-column: 1 / -1; } }
@media (max-width: 900px) { .scada-layout { grid-template-columns: 1fr; } }
</style>
