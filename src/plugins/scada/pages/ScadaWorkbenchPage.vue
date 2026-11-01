<script setup lang="ts">
// 组态工作台：画布 + 可收起的资源抽屉（画面 / 图元库）+ 外壳右栏（属性 / AI 助手）。
//
// 数据全部走后端契约（/scada/*，实现在 `server/plugins/scada/`）；
// 画布求值与几何在 src/shared/scada/render.ts，页面只做交互编排。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bottom, Delete, DocumentAdd, Download, Operation, Refresh, RefreshRight, Sort, Top, Upload } from '@element-plus/icons-vue'
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
import { createEmptyScadaDocument, parseScadaDocument } from '@/shared/scada/types'
import type { TagValueSource } from '@/shared/scada/render'
import { referencedTagIds } from '@/shared/scada/render'
import ScadaCanvas from '@/components/scada/ScadaCanvas.vue'
import ScadaInspector from '@/components/scada/ScadaInspector.vue'
import ScadaSymbolPalette from '@/components/scada/ScadaSymbolPalette.vue'
import ScadaShapeStrip from '@/components/scada/ScadaShapeStrip.vue'
import ScadaTagPicker from '@/components/scada/ScadaTagPicker.vue'
import ScadaCadImportDialog from '@/components/scada/ScadaCadImportDialog.vue'
import { RIGHT_PANEL_HOST_ID, closeRightPanel, openRightPanel, updateRightPanel, useRightPanel } from '@/shared/shell'
import { getKernel } from '@/router'
import { attachScadaWorkbench, toggleScadaPanel, useScadaWorkbench, SCADA_PANEL_ID } from '../workbench'

const rightPanel = useRightPanel()

/** 右栏面板 id：属性面板由外壳右栏承载，和其它页面的面板共用同一条轨道。 */
/**
 * 深拷贝：Vue 的响应式对象是 Proxy，`structuredClone` 会抛 DataCloneError；
 * 画布文档本身只含 JSON 可表达的字段，用 JSON 往返最稳。
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const INSPECTOR_PANEL_ID = SCADA_PANEL_ID
/** 右栏宿主就绪后才挂 Teleport，避免目标还未渲染就先挂载。 */
const inspectorReady = ref(false)

/** 演示工程：真实部署由路由参数或工程上下文注入。 */
const PROJECT_ID = 1

const http = useService<HttpClient>('http')
const route = useRoute()

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
/** CAD 图纸导入对话框：图纸解析与指令生成都在服务端，页面只负责打开与写回。 */
const cadImportVisible = ref(false)
const tagPickerSlot = ref<string | null>(null)
const loadError = ref<string | null>(null)
const canvasHost = ref<HTMLElement | null>(null)

/** 左侧资源抽屉：默认收起，画布拿满宽度（CAD/组态王的空间怎么都不够用）。 */
const railOpen = ref(false)
const railTab = ref<'screens' | 'symbols'>('symbols')

const symbolMap = computed(() => {
  const map: Record<string, ScadaSymbolDefinition> = {}
  for (const symbol of symbols.value) map[symbol.key] = symbol
  return map
})

/**
 * 基础图形：工具条上那一排小图标。
 *
 * 取自图元库自身（`category === 'basic'`），不在页面里再写一份 key 清单——
 * 加一个基础图元，工具条自动多一格。
 */
const basicSymbols = computed(() => symbols.value.filter((symbol) => symbol.category === 'basic'))

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
    fitToView()
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

const inspectorHint = computed(() => {
  if (selectedIds.value.length > 1) return `已选中 ${selectedIds.value.length} 个图元`
  if (selectedWidget.value) return '位置、层叠、外观与通道变量绑定'
  return '在画布上选中图元后编辑属性'
})

const inspectorOpen = computed(() => rightPanel.active?.id === INSPECTOR_PANEL_ID)

/** 右栏页签：属性 / AI 助手。页签状态放在 workbench 模块里共享——
 *  外部入口（工具条、页面助手）要能把右栏切到这个页签，只有一份真相才不会打架。 */
const { panelTab } = useScadaWorkbench()
const assistantSlots = computed(() => getKernel()?.slotContributions('scada:assistant') ?? [])
const detachWorkbench = ref<null | (() => void)>(null)

/** 工具条上的「属性」：开右栏并切到属性页签；已开且停在属性页签时再点即收起。 */
function openInspector(): void {
  toggleScadaPanel('inspector', inspectorHint.value)
}

/** 工具条上的「AI」：同一右栏的同一条轨道，只是切到 AI 页签（AI 页签来自 ai 插件的槽位）。 */
// 选中变化只更新右栏标题栏的说明，不重开面板、不重置用户拖好的宽度。
watch(inspectorHint, (hint) => updateRightPanel(INSPECTOR_PANEL_ID, { hint }))

onMounted(async () => {
  await refreshAll()
  // 从「画面库」点「编辑」进来时带 screenId：直接打开那一页，不覆盖本地已选。
  const queryId = Number(route.query.screenId ?? 0)
  if (queryId && queryId !== currentScreen.value?.id) await openScreen(queryId)
  // 把画布的读写能力挂到公开句柄上：AI 插件（以及将来任何插件）只通过它协作。
  detachWorkbench.value = attachScadaWorkbench({
    readDocument: () => deepClone(document.value),
    readSymbols: () => symbols.value,
    readTags: () => tagOptions.value,
    readSelection: () => [...selectedIds.value],
    writeDocument: (next) => {
      document.value = next
      selectedIds.value = []
      dirty.value = true
    },
    readScreenId: () => currentScreen.value?.id ?? null,
    /** AI 在服务端改完画面后，页面上这份视图要重新拉一次才能看到结果。 */
    reload: async () => {
      const id = currentScreen.value?.id
      if (!id) return
      const detail = await http.request<ScadaScreenDetail>(`/scada/screen?screenId=${id}`)
      currentScreen.value = detail
      document.value = parseScadaDocument(detail.documentJson)
      selectedIds.value = []
      dirty.value = false
      fitToView()
    },
    openPanel: (tab, hint) => {
      if (tab === 'ai' && !assistantSlots.value.length) return false
      panelTab.value = tab
      openRightPanel({
        id: INSPECTOR_PANEL_ID,
        title: tab === 'ai' ? 'AI 助手' : '画布面板',
        hint: hint ?? inspectorHint.value,
      })
      return true
    },
    closePanel: () => closeRightPanel(INSPECTOR_PANEL_ID),
  })
  // 属性面板进外壳右栏，但默认**不打开**：一进页面就占掉 300+px 与「画布吃满」冲突，
  // 用户点工具条上的「属性 / AI」才开，关掉即一像素不留（宽度由布局服务统一求解）。
  panelTab.value = 'inspector'
  void nextTick(() => {
    inspectorReady.value = window.document.getElementById(RIGHT_PANEL_HOST_ID) !== null
  })
})

onBeforeUnmount(() => {
  detachWorkbench.value?.()
  detachWorkbench.value = null
  closeRightPanel(INSPECTOR_PANEL_ID)
})

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

/**
 * 加点：`at` 是画布坐标（工具条拖放时给「落点」，就是 CAD 的放法）；
 * 不传则按第一个空位放（图标点一下加的默认行为）。
 */
function addSymbol(symbol: ScadaSymbolDefinition, at?: { x: number; y: number }): void {
  const grid = document.value.canvas.grid || 10
  const spot = at
    ? {
        // 落点对准图元中心，和 CAD / Photoshop 里「拖到哪儿就落在哪儿」的手感一致。
        x: Math.max(0, Math.round((at.x - symbol.defaultWidth / 2) / grid) * grid),
        y: Math.max(0, Math.round((at.y - symbol.defaultHeight / 2) / grid) * grid),
      }
    : findFreeSpot(symbol.defaultWidth, symbol.defaultHeight, grid)
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
  addSymbol(symbol, dropPoint(event))
}

/**
 * 拖放落点 → 画布坐标。
 *
 * 画布坐标是文档坐标，视口里的位置要除以缩放；取不到 svg（还没渲染）时返回 undefined，
 * 交给 `addSymbol` 退回「第一个空位」。
 */
function dropPoint(event: DragEvent): { x: number; y: number } | undefined {
  const svg = canvasHost.value?.querySelector('svg')
  if (!svg) return undefined
  const box = svg.getBoundingClientRect()
  const scale = zoom.value || 1
  return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale }
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
  const copy: ScadaWidget = deepClone(widget)
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

// ---------------- CAD 导入 ----------------

/**
 * 导入结果 → 画布。
 *
 * 图纸就是这张画面：直接替换图元列表，保留画面名称与文档版本。
 * 不自动保存——与工具条其它改动一致，用户点「保存」才算落库。
 */
function applyCadDocument(next: ScadaDocument): void {
  document.value = { ...next, canvas: { ...next.canvas, showGrid: document.value.canvas.showGrid } }
  selectedIds.value = []
  dirty.value = true
  void nextTick(() => fitToView())
}

// ---------------- 视图 ----------------

/**
 * 适应画面：同时按宽高算比例取小值。
 *
 * 只按宽度算的话，16:9 的画布放到宽而矮的视口里会纵向溢出，编辑器底部被推出可视区；
 * 反之亦然。缩放必须是外层 `transform: scale()`（见 `ScadaCanvas`），逐元素乘 zoom 会让表格溢出。
 */
function fitToView(): void {
  const host = canvasHost.value
  if (!host) {
    zoom.value = 1
    return
  }
  const width = host.clientWidth - 16
  const height = host.clientHeight - 16
  if (width <= 0 || height <= 0) return
  const ratio = Math.min(width / document.value.canvas.width, height / document.value.canvas.height)
  zoom.value = Math.min(2, Math.max(0.1, Math.round(ratio * 100) / 100))
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
  <div class="scada-page" v-loading="loading">
    <!-- 唯一一条工具条：返回态在页签里，这里只留「文件 + 编辑 + 视图 + 右栏」。
         没有页头、没有面包屑、没有大标题行——和 CAD 一样，每一像素都还给画布。 -->
    <div class="scada-bar">
      <!-- 内容套一层 row：工具条自己当容器查询的宿主（`container-type` 在外面那层），
           极端窄的时候让 row 横向滚动，而不是把右侧的「保存」直接裁掉。 -->
      <div class="scada-bar__row">
        <div class="scada-bar__group">
          <el-tooltip content="资源抽屉：画面与图元库" placement="bottom" :show-after="400">
            <el-button
              size="small"
              :type="railOpen ? 'primary' : 'default'"
              :plain="railOpen"
              :icon="Operation"
              @click="railOpen = !railOpen"
            >
              资源
            </el-button>
          </el-tooltip>
          <el-dropdown trigger="click" @command="(command: string) => command === 'new' ? createScreen() : renameScreen()">
            <button class="scada-title" type="button" :title="`${currentScreen?.name ?? '未选择画面'} · 点击管理画面`">
              <strong>{{ currentScreen?.name ?? '未选择画面' }}</strong>
              <em :class="{ 'is-dirty': dirty }">{{ dirty ? '未保存' : `v${currentScreen?.documentVersion ?? 0}` }}</em>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="new" :icon="DocumentAdd">新建画面</el-dropdown-item>
                <el-dropdown-item command="rename" :disabled="!currentScreen">重命名</el-dropdown-item>
                <el-dropdown-item v-if="currentScreen" divided :icon="Delete" @click="deleteScreen">删除画面</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <span class="scada-divider" />

        <!-- 导入图纸：丢一个 DXF 进来，服务端本地解析成绘图指令集（不花 token），
             确认后才写画面；要不要 AI 补语义由用户在对话框里选。 -->
        <el-tooltip content="导入 CAD 图纸（DXF）→ 组态画面" placement="bottom" :show-after="400">
          <el-button size="small" :icon="Upload" aria-label="导入 CAD 图纸" :disabled="loading" @click="cadImportVisible = true" />
        </el-tooltip>

        <span class="scada-divider" />

        <!-- 基础图形：CAD / Photoshop 那种「一排很小的图形图标」。
             图标来自图元定义本身，点一下放到空位、拖到画布上放到指定位置。 -->
        <el-tooltip content="基础图形：点一下加到画布，或拖到指定位置" placement="bottom" :show-after="400">
          <span class="scada-bar__hint">图形</span>
        </el-tooltip>
        <ScadaShapeStrip :symbols="basicSymbols" :disabled="loading" @add="addSymbol" />

        <span class="scada-divider" />

        <!-- 开关用图标按钮而不是带字的复选框：一条工具条只许一行，字是第一个让位的东西。 -->
        <div class="scada-bar__group">
          <el-tooltip :content="`栅格吸附：${snapEnabled ? '开' : '关'}`" placement="bottom">
            <el-button size="small" :type="snapEnabled ? 'primary' : 'default'" :plain="snapEnabled" @click="snapEnabled = !snapEnabled">
              吸附
            </el-button>
          </el-tooltip>
          <el-tooltip :content="`对齐参考线：${guideEnabled ? '开' : '关'}`" placement="bottom">
            <el-button size="small" :type="guideEnabled ? 'primary' : 'default'" :plain="guideEnabled" @click="guideEnabled = !guideEnabled">
              参考线
            </el-button>
          </el-tooltip>
          <span class="scada-stat muted">
            {{ document.widgets.length }} 图元 · {{ boundSlotCount }} 绑定 · {{ resolvedTagCount }} 变量
          </span>
        </div>

        <span class="scada-spacer" />

        <div class="scada-bar__group">
          <el-tooltip content="下移一层" placement="bottom">
            <el-button size="small" :icon="Bottom" :disabled="selectedIds.length !== 1" @click="changeZIndex(-1)" />
          </el-tooltip>
          <el-tooltip content="上移一层" placement="bottom">
            <el-button size="small" :icon="Top" :disabled="selectedIds.length !== 1" @click="changeZIndex(1)" />
          </el-tooltip>
          <el-tooltip content="旋转 90°" placement="bottom">
            <el-button size="small" :icon="RefreshRight" :disabled="!selectedIds.length" @click="rotateSelected" />
          </el-tooltip>
          <el-tooltip content="删除选中" placement="bottom">
            <el-button size="small" :icon="Delete" :disabled="!selectedIds.length" @click="deleteSelected" />
          </el-tooltip>
        </div>

        <div class="scada-bar__group scada-zoom">
          <el-tooltip content="缩小" placement="bottom">
            <el-button size="small" text @click="zoom = Math.max(0.1, Math.round((zoom - 0.1) * 100) / 100)">−</el-button>
          </el-tooltip>
          <el-slider v-model="zoom" :min="0.1" :max="2" :step="0.05" size="small" :show-tooltip="false" class="scada-zoom__slider" />
          <el-tooltip content="放大" placement="bottom">
            <el-button size="small" text @click="zoom = Math.min(2, Math.round((zoom + 0.1) * 100) / 100)">＋</el-button>
          </el-tooltip>
          <span class="scada-stat muted scada-zoom__value">{{ Math.round(zoom * 100) }}%</span>
          <!-- 适应画面：改成纯图标按钮，给基础图形那一排让出宽度（文字在工具条上最先让位）。 -->
          <el-tooltip content="适应画面（宽高同时利用）" placement="bottom">
            <el-button size="small" :icon="Sort" @click="fitToView" />
          </el-tooltip>
        </div>

        <span class="scada-divider" />

        <div class="scada-bar__group">
          <el-tooltip content="属性面板（右栏）" placement="bottom">
            <el-button
              size="small"
              :type="inspectorOpen && panelTab === 'inspector' ? 'primary' : 'default'"
              :plain="inspectorOpen && panelTab === 'inspector'"
              @click="openInspector"
            >
              属性
            </el-button>
          </el-tooltip>
          <!-- AI 不在这里放第二个入口：全站唯一的 AI 入口在顶栏（页面助手旁边），
               工具条只留「属性」，否则同一个动作会有两条路径。 -->
        </div>

        <span class="scada-divider" />

        <div class="scada-bar__group">
          <el-tooltip content="重新拉取画面、图元库与变量" placement="bottom">
            <el-button size="small" :icon="Refresh" @click="refreshAll" />
          </el-tooltip>
          <el-tooltip content="导出当前画布为 SVG" placement="bottom">
            <el-button size="small" :icon="Download" @click="exportSvg" />
          </el-tooltip>
          <el-button size="small" type="primary" :loading="saving" :disabled="!currentScreen" @click="saveScreen">保存</el-button>
        </div>
      </div>
    </div>

    <el-alert v-if="loadError" type="error" :closable="false" :title="loadError" show-icon class="scada-alert" />

    <!-- 画布区：唯一一列。资源抽屉浮在上面（不占宽度），画布始终吃满。 -->
    <div class="scada-stage" @dragover.prevent @drop="onDrop">
      <aside v-show="railOpen" class="scada-rail">
        <div class="scada-rail__tabs">
          <button
            type="button"
            class="scada-rail__tab"
            :class="{ 'is-active': railTab === 'symbols' }"
            title="图元库：点一下加到画布，或拖到指定位置"
            @click="railTab = 'symbols'"
          >
            <el-icon :size="14"><Operation /></el-icon>
            <span>图元库</span>
          </button>
          <button
            type="button"
            class="scada-rail__tab"
            :class="{ 'is-active': railTab === 'screens' }"
            :title="`画面（${screens.length}）`"
            @click="railTab = 'screens'"
          >
            <el-icon :size="14"><Sort /></el-icon>
            <span>画面</span>
          </button>
        </div>

        <div v-show="railTab === 'symbols'" class="scada-rail__body">
          <ScadaSymbolPalette
            :symbols="symbols"
            :loading="loading"
            :external-source="symbolSource"
            @add="addSymbol"
          />
        </div>

        <div v-show="railTab === 'screens'" class="scada-rail__body">
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
            <p v-if="!screens.length" class="muted scada-empty">还没有画面，点标题右侧「新建画面」开始。</p>
          </div>
          <div class="scada-rail__actions">
            <el-button size="small" :icon="DocumentAdd" @click="createScreen">新建画面</el-button>
            <el-button size="small" :disabled="!currentScreen" @click="renameScreen">重命名</el-button>
            <el-button size="small" type="danger" plain :icon="Delete" :disabled="!currentScreen" @click="deleteScreen" />
          </div>
        </div>
      </aside>

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
    </div>

    <!-- 右栏内容投到外壳面板：属性与 AI 助手同处一条轨道，可拖宽、可全屏。
         默认关闭，点工具条上的「属性 / AI」才开——省下的宽度全给画布。 -->
    <Teleport v-if="inspectorReady" :to="`#${RIGHT_PANEL_HOST_ID}`">
      <el-tabs v-model="panelTab" class="scada-panel-tabs">
        <el-tab-pane label="属性" name="inspector">
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
        </el-tab-pane>
        <el-tab-pane v-if="assistantSlots.length" label="AI 助手" name="ai">
          <component :is="slot.component" v-for="slot in assistantSlots" :key="slot.id" />
        </el-tab-pane>
      </el-tabs>
    </Teleport>

    <ScadaCadImportDialog
      v-model="cadImportVisible"
      :http="http"
      :document="document"
      :symbols="symbols"
      :tags="tagOptions"
      @apply="applyCadDocument"
    />

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
/* 一列到底：工具条定高，舞台吃满剩余，滚动只发生在画布内部。 */
.scada-page { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 auto; height: 100%; background: var(--app-bg); }
.scada-bar {
  display: flex; align-items: center; flex: none;
  /* 严格一行：CAD 里工具条换行等于凭空吃掉一条画布高度。放不下就按下面 @container 的次序收控件。 */
  overflow: hidden;
  /* 工具条是自己的容器：收控件的判据是「工具条有多宽」，不是「窗口有多宽」。 */
  container-type: inline-size;
  height: 40px; padding: 0 10px;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
/* 内容层：一条不换行的行。收到极限还放不下时横向滚动——
   宁可多一个滚动条，也不能让「保存」这种按钮在窄屏上变成点不到的死区。 */
.scada-bar__row {
  display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;
  flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none;
}
.scada-bar__row::-webkit-scrollbar { height: 0; }
.scada-bar__group { display: flex; align-items: center; gap: 6px; flex: none; }
.scada-bar__group .el-button + .el-button { margin-left: 0; }
.scada-bar__group .el-button { padding-left: 8px; padding-right: 8px; }
.scada-spacer { flex: 1 1 auto; }
.scada-divider { width: 1px; height: 18px; background: var(--line); flex: none; }
.scada-stat { font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.scada-title {
  display: inline-flex; align-items: center; gap: 6px; max-width: 180px; min-width: 0;
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--app-text); cursor: pointer;
}
.scada-title:hover { border-color: var(--brand); }
.scada-title strong { font: 600 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scada-title em { font-style: normal; font-size: 11px; color: var(--muted); flex: none; }
.scada-title em.is-dirty { color: #f59e0b; }
.scada-zoom { flex: none; }
.scada-zoom__slider { width: 64px; }
/* 「图形」两个字只是给那排图标一个标签，做到最小。 */
.scada-bar__hint { font-size: 11px; color: var(--muted); white-space: nowrap; flex: none; }
.scada-zoom__value { min-width: 34px; text-align: right; }
.scada-alert { margin: 8px 12px 0; }

.scada-stage { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
.scada-canvas-host { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }

/* 资源抽屉：浮在画布上，关掉即一像素不留。 */
.scada-rail {
  position: absolute; top: 10px; left: 10px; bottom: 10px; width: 252px; z-index: 5;
  display: flex; flex-direction: column; min-height: 0;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 18px 40px rgba(2, 6, 23, .28); backdrop-filter: blur(6px);
}
.scada-rail__tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); }
.scada-rail__tab {
  flex: 1 1 0; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 6px 4px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--muted); font-size: 12px; cursor: pointer;
}
.scada-rail__tab:hover { color: var(--app-text); background: var(--hover); }
.scada-rail__tab.is-active { color: var(--brand); border-color: var(--line); background: var(--surface); }
.scada-rail__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; display: flex; flex-direction: column; }
.scada-rail__actions { display: flex; align-items: center; gap: 6px; padding-top: 10px; border-top: 1px solid var(--line); margin-top: 10px; }
.scada-screens { display: flex; flex-direction: column; gap: 3px; }
.scada-screen-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 9px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--app-text); font-size: 12px; cursor: pointer; text-align: left;
}
.scada-screen-item:hover { background: rgba(99, 102, 241, .08); }
.scada-screen-item.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); }
.scada-screen-item__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scada-screen-item__meta { color: var(--muted); font-size: 11px; flex: none; }
.scada-empty { font-size: 12px; margin: 4px 0; }
/* 右栏页签（属性 / AI 助手）由外壳面板承载，这里只让页签头贴住滚动区。 */
.scada-panel-tabs { padding: 0 12px 12px; }
.scada-panel-tabs :deep(.el-tabs__header) { margin-bottom: 10px; position: sticky; top: 0; background: var(--surface); z-index: 1; }
/* 工具条变窄时按「谁最没用谁先让位」逐级收，收的顺序只由本条决定：
   统计文字 → 「图形」标签 → 缩放百分比 → 缩放滑杆。
   那排图形图标与「属性/保存」这类主操作永远留着，它不是装饰。

   用容器查询而不是 `@media (max-width: …)`：工具条的实际宽度取决于窗口 + 侧栏是否收起
   （侧栏一收就多出 200+px），拿视口宽度当判据会在「窄窗口 + 侧栏收起」时白扔控件、
   在「宽窗口 + 侧栏展开 + 右栏拖宽」时溢出。容器查询直接盯工具条自己的宽度，与谁占地方无关。 */
@container (max-width: 1160px) { .scada-stat { display: none; } }
@container (max-width: 1040px) { .scada-bar__hint { display: none; } }
@container (max-width: 1000px) { .scada-zoom__value { display: none; } }
@container (max-width: 900px) { .scada-zoom__slider { display: none; } }
</style>
