<script setup lang="ts">
// 图纸设计器：IDE / CAD 式布局——一条 40px 工具条 + 画布吃掉剩余全部空间。
//
// 空间分配的优先级（越靠上越重要）：
// 1. 画布：无限画布 + 缩放/平移，只有它铺满视口；
// 2. 左栏：元素库与结构树合并成单列，可整体收起（收起点图标轨道只剩 36px）；
// 3. 其余一切（页面设置、元素属性、数据与事件、vibeelement、编译结果）都是**弹窗**，
//    用的时候出现、不用的时候不占一个像素。
//
// 「所见即所得」体现在画布本身：元素不是线框占位，而是运行期同一批组件
// （CrudQueryField / CrudFormField / CellValue / VibeElement / el-button），
// 编译产物 `analysis.fragments` 把「图纸元素」映射到「schema 片段」，两边同源。
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Delete, DocumentAdd, FullScreen, Link, MagicStick, MoreFilled, Promotion,
  Setting, SortDown, SortUp, Stamp, View, ZoomIn, ZoomOut,
} from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import {
  ROLE_LIST, channelsOf, createEmptyDrawing, defaultCodeOf, effectiveProps, isContainer,
  findElement, inspectCode, regionsOf, specOf, validateBindings, vibeSchemaOf,
  type UiDiagnostic, type UiDrawing, type UiElement, type UiElementFragment, type UiElementProps,
  type UiQuestion, type UiRect, type UiRole,
} from '@/shared/ui-canvas'
import type { UiCompileResponse } from '@/shared/ui-canvas/http'
import { createUiCanvasApi, parseDrawing } from '@/shared/ui-canvas/http'
import DrawingCanvas from '@/components/ui-canvas/DrawingCanvas.vue'
// 预览与线上页面共用同一个活元素运行时，不维护第二套渲染实现。
import VibeElement from '@zjarlin/data-page-element/VibeElement.vue'

const route = useRoute()
const router = useRouter()
const api = createUiCanvasApi(useService<HttpClient>('http'))

const drawingId = computed(() => Number(route.query.id ?? 0))

const drawing = ref<UiDrawing>(createEmptyDrawing())
const name = ref('')
const description = ref('')
const savedVersion = ref(0)
const selectedIds = ref<string[]>([])
const zoom = ref(1)
const snap = ref(true)
const showRegions = ref(false)
const saving = ref(false)
const publishing = ref(false)
const asking = ref(false)
const loading = ref(false)
const compileResult = ref<UiCompileResponse | null>(null)
const dirty = ref(false)
/** 检查器弹窗页签：属性 / 数据与事件 / vibeelement / 编译。 */
const inspectorTab = ref('props')
/** 检查器弹窗是否打开；`meta` 页签在没有选中元素时显示页面设置。 */
const inspectorOpen = ref(false)
/** 左栏是否展开（收起后只剩 36px 图标轨道）。 */
const railOpen = ref(true)
/** 左栏页签：元素库 / 结构树。 */
const railTab = ref<'palette' | 'tree'>('palette')
/** 画布滚动宿主：缩放与平移都作用在它上面。 */
const canvasViewport = ref<HTMLElement | null>(null)

const selected = computed<UiElement | null>(() => {
  if (selectedIds.value.length !== 1) return null
  const id = selectedIds.value[0]
  return id ? (findElement(drawing.value, id) ?? null) : null
})

const selectedSpec = computed(() => (selected.value ? specOf(selected.value.role) : null))
const selectedProps = computed<UiElementProps>(() => (selected.value ? effectiveProps(selected.value) : {}))
const selectedChannels = computed(() => (selected.value ? channelsOf(selected.value) : []))

/**
 * 元素树：容器进「页面骨架」，叶子按所属区域归组，编辑器里一眼看清「谁在哪个区域里」。
 *
 * 顺序沿用图纸的区域装配结果（大区域在前），因此和右侧编译出的「区域 → 元素」一致。
 */
const elementTree = computed(() => {
  const regions = regionsOf(drawing.value)
  const groups: Array<{ label: string; elements: UiElement[] }> = []

  const containers = drawing.value.elements.filter((element) => isContainer(element))
  if (containers.length) groups.push({ label: '页面骨架', elements: containers })

  for (const region of regions) {
    const children = region.childIds
      .map((id) => findElement(drawing.value, id))
      .filter((element): element is UiElement => Boolean(element))
    if (!children.length) continue
    groups.push({ label: `${specOf(region.role).label} · ${region.id}`, elements: children })
  }

  // 兜底：既不是容器、也没落进任何区域的元素，不能悄悄消失。
  const placed = new Set([...containers, ...groups.flatMap((group) => group.elements)].map((element) => element.id))
  const orphans = drawing.value.elements.filter((element) => !placed.has(element.id))
  if (orphans.length) groups.push({ label: '未归区域', elements: orphans })

  return groups
})

const diagnostics = computed<UiDiagnostic[]>(() => compileResult.value?.diagnostics ?? [])
const errors = computed(() => diagnostics.value.filter((item) => item.level === 'error'))
const questions = computed<UiQuestion[]>(() => compileResult.value?.questions ?? [])

/** 用当前图纸现算 vibeelement 的绑定/模板问题（比等编译更即时）。 */
const selectedIssues = computed(() => {
  if (!selected.value) return [] as string[]
  const issues: string[] = []
  for (const issue of validateBindings(selected.value)) {
    if (issue.level === 'error') issues.push(issue.message)
  }
  for (const issue of inspectCode(String(selectedProps.value.code ?? ''))) {
    issues.push(issue.message)
  }
  return issues
})

async function load(): Promise<void> {
  if (!drawingId.value) return
  loading.value = true
  try {
    const detail = await api.detail(drawingId.value)
    name.value = detail.name
    description.value = detail.description ?? ''
    drawing.value = parseDrawing(detail.drawingJson)
    savedVersion.value = detail.version
    dirty.value = false
    await recompile()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸读取失败')
  } finally {
    loading.value = false
  }
}

/** 现算编译：不落库，纯本地，因此每次拖动都能即时看到结果。 */
async function recompile(): Promise<void> {
  try {
    compileResult.value = await api.compile({ drawingJson: JSON.stringify(drawing.value) })
  } catch (error) {
    compileResult.value = null
    void error
  }
}

let recompileTimer: number | null = null
function scheduleRecompile(): void {
  if (recompileTimer !== null) window.clearTimeout(recompileTimer)
  recompileTimer = window.setTimeout(() => {
    recompileTimer = null
    void recompile()
  }, 260)
}

watch(() => drawing.value, () => {
  // 载入图纸本身会触发这里（赋值即变更），但那是「从后端取回」而不是「用户改了」；
  // 不挡住的话打开设计器就显示「未保存」，预览/发布还会先多做一次无谓保存。
  if (loading.value) return
  dirty.value = true
  scheduleRecompile()
}, { deep: true })

function markDirty(): void {
  dirty.value = true
}

/** 工具条「更多」的二级动作：页面设置 / 运行预览 / 编译 / 下线。 */
function onMore(command: string): void {
  if (command === 'settings') openInspector('props')
  else if (command === 'run') openRun()
  else if (command === 'compile') openInspector('compile')
  else if (command === 'unpublish') void unpublish()
}

// ---------------- 画布交互 ----------------

function onElementRect(id: string, rect: UiRect): void {
  const element = findElement(drawing.value, id)
  if (!element) return
  element.rect = rect
  markDirty()
}

function addRole(role: UiRole, point?: { x: number; y: number }): void {
  const spec = specOf(role)
  const id = `el-${Date.now().toString(36)}`
  const element: UiElement = {
    id,
    role,
    rect: {
      x: Math.round(point?.x ?? 40 / 1),
      y: Math.round(point?.y ?? 40),
      width: spec.defaultWidth,
      height: spec.defaultHeight,
    },
    zIndex: drawing.value.elements.length,
    text: spec.defaultText,
    props: {},
    bindings: [],
    locked: false,
    visible: true,
  }
  drawing.value.elements.push(element)
  selectedIds.value = [id]
  markDirty()
}

function removeSelected(): void {
  if (!selectedIds.value.length) return
  drawing.value.elements = drawing.value.elements.filter((element) => !selectedIds.value.includes(element.id))
  selectedIds.value = []
  markDirty()
}

function duplicateSelected(): void {
  const source = selected.value
  if (!source) return
  const copy: UiElement = {
    ...structuredClone(source),
    id: `el-${Date.now().toString(36)}`,
    rect: { ...source.rect, x: source.rect.x + 20, y: source.rect.y + 20 },
    zIndex: drawing.value.elements.length,
  }
  drawing.value.elements.push(copy)
  selectedIds.value = [copy.id]
  markDirty()
}

function bringForward(): void {
  const element = selected.value
  if (!element) return
  element.zIndex = Math.max(...drawing.value.elements.map((item) => item.zIndex)) + 1
  markDirty()
}

function sendBackward(): void {
  const element = selected.value
  if (!element) return
  element.zIndex = Math.min(...drawing.value.elements.map((item) => item.zIndex)) - 1
  markDirty()
}

function toggleLock(): void {
  const element = selected.value
  if (!element) return
  element.locked = !element.locked
  markDirty()
}

// ---------------- 属性编辑 ----------------

function setProp(key: keyof UiElementProps, value: unknown): void {
  const element = selected.value
  if (!element) return
  if (value === '' || value === undefined || value === null) delete element.props[key]
  else (element.props as Record<string, unknown>)[key] = value
  markDirty()
}

/** JSON 类属性（options / request / tagMap / resolveFrom）在面板里按 JSON 文本编辑。 */
function jsonPropOf(key: keyof UiElementProps): string {
  const value = selectedProps.value[key]
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function setJsonProp(key: keyof UiElementProps, text: string): void {
  if (!text.trim()) {
    setProp(key, null)
    return
  }
  try {
    setProp(key, JSON.parse(text))
  } catch {
    ElMessage.warning(`${key} 不是合法 JSON，未写入`)
  }
}

function setMeta(key: 'key' | 'title' | 'endpoint' | 'entity', value: string): void {
  drawing.value.meta[key] = value
  markDirty()
}

// ---------------- vibeelement ----------------

function ensureCode(): void {
  const element = selected.value
  if (!element) return
  if (!String(selectedProps.value.code ?? '').trim()) {
    setProp('code', defaultCodeOf(element))
  }
}

function addBinding(kind: 'data' | 'event', channel: string): void {
  const element = selected.value
  if (!element) return
  if (element.bindings.some((binding) => binding.channel === channel)) {
    ElMessage.info(`通道 ${channel} 已经挂过了`)
    return
  }
  element.bindings.push(
    kind === 'data'
      ? { kind, channel, source: '' }
      : { kind, channel, action: channel === 'click' ? 'dialog' : 'reload' },
  )
  markDirty()
}

function removeBinding(index: number): void {
  const element = selected.value
  if (!element) return
  element.bindings.splice(index, 1)
  markDirty()
}

function setBindingField(index: number, field: 'source' | 'action', value: string): void {
  const element = selected.value
  if (!element) return
  const binding = element.bindings[index]
  if (!binding) return
  if (field === 'source') {
    if (value) binding.source = value
    else delete binding.source
  } else {
    binding.action = value as NonNullable<typeof binding.action>
  }
  markDirty()
}

/** 事件动作参数（request 的 method/path、navigate 的 path）用 JSON 编辑。 */
function setBindingParams(index: number, text: string): void {
  const element = selected.value
  if (!element) return
  const binding = element.bindings[index]
  if (!binding) return
  if (!text.trim()) {
    delete binding.params
    markDirty()
    return
  }
  try {
    binding.params = JSON.parse(text) as Record<string, unknown>
    markDirty()
  } catch {
    ElMessage.warning('动作参数不是合法 JSON，未写入')
  }
}

/** 预览用的事件处理器：真实动作由运行期宿主提供，这里只回显触发了哪个通道。 */
const vibeHandlers = computed<Record<string, (payload?: unknown) => void>>(() => {
  const out: Record<string, (payload?: unknown) => void> = {}
  for (const channel of selectedChannels.value) {
    if (channel.kind !== 'event') continue
    out[channel.channel] = () => ElMessage.info(`触发事件通道 ${channel.channel}`)
  }
  return out
})

/** 当前元素的活模板：与发布时下发的 `vibe` 是同一份转换。 */
const selectedVibe = computed(() => (selected.value ? vibeSchemaOf(selected.value) : null))

/** 预览数据：一行示例值，直接看模板渲染成什么。 */
const vibePreviewData = computed<Record<string, unknown>>(() => {
  if (!selected.value) return {}
  const props = selectedProps.value
  const label = String(props.label ?? selected.value.text ?? '按钮')
  return {
    value: props.value ?? '示例值',
    label,
    text: String(props.label ?? selected.value.text ?? '示例文本'),
    series: [],
    total: 18,
  }
})

// ---------------- 保存 / 发布 / AI ----------------

async function save(): Promise<void> {
  if (!drawingId.value) return
  saving.value = true
  try {
    const detail = await api.update({
      id: drawingId.value,
      name: name.value,
      description: description.value,
      drawingJson: JSON.stringify(drawing.value),
    })
    savedVersion.value = detail.version
    dirty.value = false
    ElMessage.success('已保存')
    await recompile()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function publish(): Promise<void> {
  if (dirty.value) await save()
  publishing.value = true
  try {
    const result = await api.publish(drawingId.value)
    ElMessage.success(`已发布为页面 ${result.key}（schema v${result.version}），侧栏与路由下次加载即可看到`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发布失败')
  } finally {
    publishing.value = false
  }
}

async function unpublish(): Promise<void> {
  try {
    await ElMessageBox.confirm('下线会把该页面从后端注册表移除（图纸保留）。确定下线？', '下线页面', {
      type: 'warning', confirmButtonText: '下线', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const result = await api.unpublish(drawingId.value)
    ElMessage.success(result.removed ? `已下线 ${result.key}` : '该图纸尚未发布')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下线失败')
  }
}

async function askAi(): Promise<void> {
  if (dirty.value) await save()
  asking.value = true
  try {
    const result = await api.ask(drawingId.value)
    if (!result.ai.called) {
      ElMessage.info('当前规则表已覆盖全部元素，不需要追问模型')
    } else {
      ElMessage.success(`模型回填 ${result.applied} 个字段${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ''}`)
      if (result.drawingJson) drawing.value = parseDrawing(result.drawingJson)
      await recompile()
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '追问失败')
  } finally {
    asking.value = false
  }
}

/** 运行预览：把编译出的 schema 直接交给通用页面壳渲染，所见即上线后。 */
function openRun(): void {
  void router.push({ name: 'ui-canvas-run', query: { id: String(drawingId.value) } })
}

async function sendToGroup(role: UiRole): Promise<void> {
  addRole(role, { x: 60, y: 200 + drawing.value.elements.length * 8 })
}

// ---------------- 检查器弹窗 ----------------

/** 打开检查器：不带元素就是页面设置，带元素就是该元素的属性。 */
function openInspector(tab: 'props' | 'bindings' | 'vibe' | 'compile' = 'props', elementId?: string): void {
  if (elementId) selectedIds.value = [elementId]
  inspectorTab.value = tab
  inspectorOpen.value = true
}

/** 弹窗标题：选中一个元素时显示角色与 id，否则是页面级设置。 */
const inspectorTitle = computed(() => (selected.value
  ? `${selectedSpec.value?.label ?? '元素'} · ${selected.value.id}`
  : `页面设置 · ${drawing.value.meta.key || '未命名'}`))

/** 画布双击元素 → 直接进属性页。 */
function openElement(elementId: string): void {
  openInspector('props', elementId)
}

// ---------------- 缩放 / 平移（CAD 手感） ----------------

const ZOOM_MIN = 0.1
const ZOOM_MAX = 3

function applyZoom(next: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100))
  const viewport = canvasViewport.value
  if (viewport && clamped !== zoom.value) {
    // 以视口中心为锚点缩放：鼠标位置不变，缩放才不像「跳一下」。
    const ratio = clamped / zoom.value
    const centerX = viewport.scrollLeft + viewport.clientWidth / 2
    const centerY = viewport.scrollTop + viewport.clientHeight / 2
    zoom.value = clamped
    void nextTick(() => {
      viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2
      viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2
    })
    return
  }
  zoom.value = clamped
}

function zoomIn(): void {
  applyZoom(zoom.value * 1.2)
}

function zoomOut(): void {
  applyZoom(zoom.value / 1.2)
}

/** 适配窗口：把整张图纸塞进当前视口，缩放上限 100%（放太大反而看不清结构）。 */
function zoomFit(): void {
  const viewport = canvasViewport.value
  if (!viewport) return
  const padding = 32
  const fit = Math.min(
    (viewport.clientWidth - padding) / drawing.value.canvas.width,
    (viewport.clientHeight - padding) / drawing.value.canvas.height,
  )
  applyZoom(Math.min(1, Math.max(ZOOM_MIN, fit)))
}

/** Ctrl/⌘ + 滚轮缩放；普通滚轮照常滚动（与浏览器/IDE 一致）。 */
function onWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  applyZoom(zoom.value * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
}

/**
 * 平移画布：中键，或按住 Alt 拖左键（与 CAD / Figma 同一套手感）。
 *
 * 用 capture 阶段接管：否则画布里的选择/框选会先吃掉这次按下，
 * 变成「想平移却拖动了元素」。
 */
let pan: { x: number; y: number; left: number; top: number } | null = null
const panning = ref(false)

function onViewportPointerDown(event: PointerEvent): void {
  const viaMiddle = event.button === 1
  const viaAlt = event.button === 0 && event.altKey
  if (!viaMiddle && !viaAlt) return
  const viewport = canvasViewport.value
  if (!viewport) return
  event.preventDefault()
  event.stopPropagation()
  pan = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }
  panning.value = true
  viewport.setPointerCapture(event.pointerId)
}

function onViewportPointerMove(event: PointerEvent): void {
  if (!pan) return
  const viewport = canvasViewport.value
  if (!viewport) return
  viewport.scrollLeft = pan.left - (event.clientX - pan.x)
  viewport.scrollTop = pan.top - (event.clientY - pan.y)
}

function onViewportPointerUp(): void {
  pan = null
  panning.value = false
}

// ---------------- 编译片段：画布上的真实组件 ----------------

/** 元素 id → 编译片段；没有片段的元素按角色兜底渲染。 */
const fragments = computed<UiElementFragment[]>(() => compileResult.value?.analysis.fragments ?? [])

/** 状态栏：画布尺寸、元素数、选中数、缩放。 */
const canvasSize = computed(() => `${drawing.value.canvas.width} × ${drawing.value.canvas.height}`)
const unsupportedCount = computed(() => fragments.value.filter((item) => item.kind === 'unsupported').length)

onMounted(load)
onBeforeUnmount(() => {
  if (recompileTimer !== null) window.clearTimeout(recompileTimer)
})
</script>

<template>
  <div class="ui-designer" v-loading="loading">
    <!-- ① 唯一一条工具条：返回 / 标题 / 状态 / 动作。没有页头、没有面包屑、没有大标题行。 -->
    <div class="dz-bar">
      <el-tooltip content="返回图纸库" placement="bottom" :show-after="400">
        <button class="dz-icon" type="button" @click="router.push({ name: 'ui-canvas-gallery' })">
          <el-icon :size="15"><ArrowLeft /></el-icon>
        </button>
      </el-tooltip>
      <button class="dz-title" type="button" :title="`${name || '未命名图纸'} · 点击编辑页面设置`" @click="openInspector('props')">
        <strong>{{ name || '未命名图纸' }}</strong>
        <span class="dz-title__meta">
          <em :class="{ 'is-dirty': dirty }">{{ dirty ? '未保存' : `v${savedVersion}` }}</em>
          <em v-if="errors.length" class="is-error">{{ errors.length }} 处错误</em>
          <em v-else-if="unsupportedCount" class="is-warn">{{ unsupportedCount }} 处待扩展</em>
        </span>
      </button>

      <span class="dz-divider" />

      <el-tooltip content="运行预览：用当前图纸编译出的 schema 渲染真实页面" placement="bottom" :show-after="400">
        <button class="dz-icon" type="button" @click="openRun"><el-icon :size="15"><View /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="问模型补参：只为缺失字段追问，不整份图纸回传" placement="bottom" :show-after="400">
        <button class="dz-icon" type="button" :disabled="asking" @click="askAi">
          <el-icon :size="15" :class="{ 'is-spin': asking }"><MagicStick /></el-icon>
          <span v-if="questions.length" class="dz-badge">{{ questions.length }}</span>
        </button>
      </el-tooltip>
      <el-tooltip content="编译检查与诊断" placement="bottom" :show-after="400">
        <button class="dz-icon" type="button" @click="openInspector('compile')">
          <el-icon :size="15"><Setting /></el-icon>
          <span v-if="diagnostics.length" class="dz-badge" :class="{ 'is-danger': errors.length }">{{ diagnostics.length }}</span>
        </button>
      </el-tooltip>

      <span class="dz-spacer" />

      <!-- 画布控制：缩放/适配，居中偏右，和 CAD 一样不打断视线。 -->
      <div class="dz-zoom">
        <button class="dz-icon dz-icon--sm" type="button" title="缩小（Ctrl/⌘ + 滚轮）" @click="zoomOut">
          <el-icon :size="13"><ZoomOut /></el-icon>
        </button>
        <button class="dz-zoom__value" type="button" title="适配窗口" @click="zoomFit">{{ Math.round(zoom * 100) }}%</button>
        <button class="dz-icon dz-icon--sm" type="button" title="放大（Ctrl/⌘ + 滚轮）" @click="zoomIn">
          <el-icon :size="13"><ZoomIn /></el-icon>
        </button>
      </div>
      <el-tooltip content="画布铺满视口（隐藏左栏）" placement="bottom" :show-after="400">
        <button class="dz-icon" type="button" :class="{ 'is-on': !railOpen }" @click="railOpen = !railOpen">
          <el-icon :size="15"><FullScreen /></el-icon>
        </button>
      </el-tooltip>

      <span class="dz-divider" />

      <button class="dz-btn" type="button" :disabled="saving" @click="save">保存</button>
      <button class="dz-btn dz-btn--primary" type="button" :disabled="publishing" @click="publish">发布</button>
      <el-dropdown trigger="click" @command="onMore">
        <button class="dz-icon" type="button" title="更多"><el-icon :size="15"><MoreFilled /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="settings" :icon="Setting">页面设置</el-dropdown-item>
            <el-dropdown-item command="run" :icon="View">运行预览</el-dropdown-item>
            <el-dropdown-item command="compile" :icon="Stamp">编译结果</el-dropdown-item>
            <el-dropdown-item v-if="compileResult?.key" command="unpublish" divided :icon="Delete">下线页面</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- ② 画布区：左图标轨道 + 画布，剩余空间全部归画布。 -->
    <div class="dz-body">
      <aside v-show="railOpen" class="dz-rail">
        <div class="dz-rail__tabs">
          <button
            class="dz-rail__tab" type="button" :class="{ 'is-active': railTab === 'palette' }"
            title="元素库：点一下加到画布，或拖到指定位置" @click="railTab = 'palette'"
          >
            <el-icon :size="14"><DocumentAdd /></el-icon>
          </button>
          <button
            class="dz-rail__tab" type="button" :class="{ 'is-active': railTab === 'tree' }"
            :title="`结构树（${drawing.elements.length} 元素）`" @click="railTab = 'tree'"
          >
            <el-icon :size="14"><SortUp /></el-icon>
          </button>
        </div>

        <div v-show="railTab === 'palette'" class="dz-rail__body">
          <div v-for="layer in ['container', 'leaf', 'band'] as const" :key="layer" class="dz-group">
            <p class="dz-group__label">{{ layer === 'container' ? '容器' : layer === 'leaf' ? '数据' : '装饰' }}</p>
            <button
              v-for="spec in ROLE_LIST.filter((item) => item.layer === layer)"
              :key="spec.role"
              class="dz-role"
              type="button"
              :title="`${spec.label}：${spec.description}`"
              :disabled="!(layer === 'container' || drawing.meta.endpoint)"
              draggable="true"
              @click="sendToGroup(spec.role)"
              @dragstart="($event.dataTransfer?.setData('application/x-ui-role', spec.role))"
            >
              <span class="dz-role__dot" :style="{ background: spec.tint }" />
              <span class="dz-role__text">{{ spec.label }}</span>
            </button>
          </div>
        </div>

        <div v-show="railTab === 'tree'" class="dz-rail__body">
          <div v-for="group in elementTree" :key="group.label" class="dz-group">
            <p class="dz-group__label">{{ group.label }}</p>
            <button
              v-for="element in group.elements"
              :key="element.id"
              type="button"
              class="dz-node"
              :class="{ 'is-active': selectedIds.includes(element.id) }"
              :title="`${element.id} · 双击打开属性`"
              @click="selectedIds = [element.id]"
              @dblclick="openElement(element.id)"
            >
              <span class="dz-role__dot" :style="{ background: specOf(element.role).tint }" />
              <span class="dz-node__text">{{ effectiveProps(element).label ?? element.text ?? specOf(element.role).label }}</span>
              <span class="dz-node__role">{{ specOf(element.role).label }}</span>
            </button>
          </div>
          <p v-if="!drawing.elements.length" class="dz-empty">从元素库点一个开始画。</p>
        </div>
      </aside>

      <!-- 画布：滚轮平移，Ctrl/⌘+滚轮缩放，Alt/中键拖拽平移 -->
      <div
        ref="canvasViewport"
        class="dz-viewport"
        :class="{ 'is-panning': panning }"
        @wheel="onWheel"
        @pointerdown.capture="onViewportPointerDown"
        @pointermove="onViewportPointerMove"
        @pointerup="onViewportPointerUp"
        @pointercancel="onViewportPointerUp"
      >
        <div class="dz-canvas">
          <DrawingCanvas
            :drawing="drawing"
            :selected-ids="selectedIds"
            :zoom="zoom"
            :snap="snap"
            :show-regions="showRegions"
            :fragments="fragments"
            :entity="drawing.meta.entity"
            @update:selected-ids="selectedIds = $event"
            @update="onElementRect"
            @drop-role="addRole"
            @open="openElement"
          />
        </div>
      </div>
    </div>

    <!-- ③ 底部状态条：CAD 式信息栏（吸附/区域线/元素统计），只有 24px。 -->
    <div class="dz-status">
      <button class="dz-status__btn" type="button" :class="{ 'is-on': snap }" @click="snap = !snap">吸附 {{ snap ? '开' : '关' }}</button>
      <button class="dz-status__btn" type="button" :class="{ 'is-on': showRegions }" @click="showRegions = !showRegions">区域线</button>
      <span class="dz-status__sep" />
      <span>{{ drawing.elements.length }} 元素</span>
      <span v-if="selectedIds.length">{{ selectedIds.length }} 选中</span>
      <span class="dz-status__grow" />
      <span v-if="selected">{{ selectedSpec?.label }} · {{ selected.id }}</span>
      <span class="dz-status__sep" />
      <span>{{ canvasSize }}</span>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <span class="dz-status__hint">Alt / 中键拖拽平移 · Ctrl+滚轮缩放 · 双击元素改属性</span>
      <el-button v-if="selected" text size="small" class="dz-status__link" @click="openInspector('props')">属性</el-button>
    </div>

    <!-- ④ 元素操作浮条：选中后贴在画布底部居中，不再占用工具条宽度。 -->
    <transition name="dz-rise">
      <div v-if="selectedIds.length" class="dz-floating">
        <span class="dz-floating__name">{{ selected ? (selectedSpec?.label + ' · ' + selected.id) : `${selectedIds.length} 个元素` }}</span>
        <span class="dz-divider" />
        <button class="dz-icon dz-icon--sm" type="button" title="复制" :disabled="!selected" @click="duplicateSelected">
          <el-icon :size="13"><DocumentAdd /></el-icon>
        </button>
        <button class="dz-icon dz-icon--sm" type="button" title="上移一层" :disabled="!selected" @click="bringForward">
          <el-icon :size="13"><SortUp /></el-icon>
        </button>
        <button class="dz-icon dz-icon--sm" type="button" title="下移一层" :disabled="!selected" @click="sendBackward">
          <el-icon :size="13"><SortDown /></el-icon>
        </button>
        <button class="dz-icon dz-icon--sm" type="button" title="锁定/解锁" :disabled="!selected" @click="toggleLock">
          <el-icon :size="13"><MagicStick /></el-icon>
        </button>
        <button class="dz-icon dz-icon--sm is-danger" type="button" title="删除" @click="removeSelected">
          <el-icon :size="13"><Delete /></el-icon>
        </button>
        <span class="dz-divider" />
        <button class="dz-btn dz-btn--px" type="button" @click="openInspector('props')">属性</button>
        <button class="dz-btn dz-btn--px" type="button" @click="openInspector('bindings')">数据/事件</button>
        <button class="dz-btn dz-btn--px" type="button" @click="openInspector('vibe')">模板</button>
      </div>
    </transition>

    <!-- ⑤ 检查器：属性 / 数据与事件 / vibeelement / 编译，全部在弹窗里。 -->
    <el-dialog
      v-model="inspectorOpen"
      :title="inspectorTitle"
      width="min(880px, 92vw)"
      top="6vh"
      append-to-body
      destroy-on-close
      class="dz-dialog"
    >
      <div class="dz-inspector">
      <el-tabs v-model="inspectorTab" class="inspector-tabs">
        <el-tab-pane :label="selected ? '属性' : '页面设置'" name="props">
          <template v-if="!selected">
            <p class="muted empty-hint">选中一个元素后在这里配置；多选时只显示数量（{{ selectedIds.length }}）。</p>
            <el-divider />
            <div class="form-block">
              <span class="form-label">页面 key</span>
              <el-input :model-value="drawing.meta.key" @update:model-value="setMeta('key', $event)" placeholder="system.user" />
            </div>
            <div class="form-block">
              <span class="form-label">页面标题</span>
              <el-input :model-value="drawing.meta.title" @update:model-value="setMeta('title', $event)" placeholder="用户管理" />
            </div>
            <div class="form-block">
              <span class="form-label">列表接口</span>
              <el-input :model-value="drawing.meta.endpoint ?? ''" @update:model-value="setMeta('endpoint', $event)" placeholder="/system/users" />
            </div>
            <div class="form-block">
              <span class="form-label">实体名</span>
              <el-input :model-value="drawing.meta.entity ?? ''" @update:model-value="setMeta('entity', $event)" placeholder="用户" />
            </div>
          </template>
          <template v-else>
            <div class="inspector-head">
              <strong>{{ selectedSpec?.label }}</strong>
              <span class="muted">{{ selected.id }}</span>
              <el-tag size="small" :type="selected.locked ? 'info' : 'success'">{{ selected.locked ? '已锁定' : '可编辑' }}</el-tag>
            </div>
            <p class="muted inspector-desc">{{ selectedSpec?.description }}</p>

            <div class="form-block">
              <span class="form-label">文案</span>
              <el-input :model-value="selected.text" @update:model-value="selected.text = $event; markDirty()" />
            </div>

            <div v-if="selectedSpec?.editable.includes('label')" class="form-block">
              <span class="form-label">标签 label</span>
              <el-input :model-value="String(selectedProps.label ?? '')" @update:model-value="setProp('label', $event)" />
            </div>
            <div v-if="selectedSpec?.editable.includes('prop')" class="form-block">
              <span class="form-label">字段 prop</span>
              <el-input :model-value="String(selectedProps.prop ?? '')" @update:model-value="setProp('prop', $event)" placeholder="nickname" />
            </div>
            <div v-if="selectedSpec?.editable.includes('help')" class="form-block">
              <span class="form-label">说明</span>
              <el-input :model-value="String(selectedProps.help ?? '')" @update:model-value="setProp('help', $event)" />
            </div>

            <!-- 列 -->
            <template v-if="selected.role === 'column'">
              <div class="form-block">
                <span class="form-label">单元格语义</span>
                <el-select :model-value="selectedProps.cell ?? 'text'" @update:model-value="setProp('cell', $event)">
                  <el-option v-for="kind in ['text','code','status','tagMap','datetime','dict','link','custom']" :key="kind" :label="kind" :value="kind" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">对齐</span>
                <el-select :model-value="selectedProps.align ?? 'left'" @update:model-value="setProp('align', $event)">
                  <el-option label="左" value="left" /><el-option label="中" value="center" /><el-option label="右" value="right" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">固定</span>
                <el-select :model-value="selectedProps.fixed ?? ''" @update:model-value="setProp('fixed', $event)" clearable>
                  <el-option label="不固定" value="" /><el-option label="左" value="left" /><el-option label="右" value="right" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">状态映射 tagMap（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('tagMap')" @update:model-value="setJsonProp('tagMap', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">跨资源取值 resolveFrom（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('resolveFrom')" @update:model-value="setJsonProp('resolveFrom', $event)" />
              </div>
            </template>

            <!-- 字段 -->
            <template v-if="selected.role === 'field'">
              <div class="form-block">
                <span class="form-label">控件</span>
                <el-select :model-value="selectedProps.control ?? 'input'" @update:model-value="setProp('control', $event)">
                  <el-option v-for="control in ['input','password','textarea','number','select','radio','switch','treeSelect','date']" :key="control" :label="control" :value="control" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">必填</span>
                <el-switch :model-value="Boolean(selectedProps.required)" @update:model-value="setProp('required', $event)" />
                <span class="muted hint">必填会同时生成标签星号与校验规则</span>
              </div>
              <div class="form-block">
                <span class="form-label">编辑时禁用</span>
                <el-switch :model-value="Boolean(selectedProps.disabledOnEdit)" @update:model-value="setProp('disabledOnEdit', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">栅格跨度</span>
                <el-radio-group :model-value="selectedProps.span ?? 24" @update:model-value="setProp('span', $event)">
                  <el-radio :value="12">半行</el-radio><el-radio :value="24">整行</el-radio>
                </el-radio-group>
              </div>
              <div class="form-block">
                <span class="form-label">选项 options（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('options')" @update:model-value="setJsonProp('options', $event)" placeholder='[{"label":"正常","value":"active"}]' />
              </div>
              <div class="form-block">
                <span class="form-label">字典编码</span>
                <el-input :model-value="String(selectedProps.dict ?? '')" @update:model-value="setProp('dict', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">树接口</span>
                <el-input :model-value="String(selectedProps.treeEndpoint ?? '')" @update:model-value="setProp('treeEndpoint', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">校验规则（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('rules')" @update:model-value="setJsonProp('rules', $event)" />
              </div>
            </template>

            <!-- 查询 -->
            <template v-if="selected.role === 'query'">
              <div class="form-block">
                <span class="form-label">控件</span>
                <el-select :model-value="selectedProps.control ?? 'input'" @update:model-value="setProp('control', $event)">
                  <el-option label="输入框" value="input" /><el-option label="下拉" value="select" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">匹配方式</span>
                <el-select :model-value="selectedProps.match ?? ''" @update:model-value="setProp('match', $event)" clearable placeholder="按控件推断">
                  <el-option label="精确 eq" value="eq" /><el-option label="模糊 like" value="like" /><el-option label="集合 in" value="in" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">参与模糊匹配的字段</span>
                <el-input
                  :model-value="(selectedProps.props ?? []).join(',')"
                  @update:model-value="setProp('props', $event ? $event.split(',').map((item: string) => item.trim()).filter(Boolean) : null)"
                  placeholder="username,nickname"
                />
              </div>
              <div class="form-block">
                <span class="form-label">占位提示</span>
                <el-input :model-value="String(selectedProps.placeholder ?? '')" @update:model-value="setProp('placeholder', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">选项 options（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('options')" @update:model-value="setJsonProp('options', $event)" />
              </div>
            </template>

            <!-- 动作 -->
            <template v-if="selected.role === 'action'">
              <div class="form-block">
                <span class="form-label">动作类型</span>
                <el-select :model-value="selectedProps.kind ?? 'request'" @update:model-value="setProp('kind', $event)">
                  <el-option v-for="kind in ['create','edit','delete','toggle','detail','request']" :key="kind" :label="kind" :value="kind" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">样式</span>
                <el-select :model-value="selectedProps.variant ?? 'default'" @update:model-value="setProp('variant', $event)">
                  <el-option v-for="variant in ['default','primary','success','warning','danger']" :key="variant" :label="variant" :value="variant" />
                </el-select>
              </div>
              <div class="form-block">
                <span class="form-label">权限码</span>
                <el-input :model-value="String(selectedProps.permission ?? '')" @update:model-value="setProp('permission', $event)" placeholder="system:user:add" />
              </div>
              <div class="form-block">
                <span class="form-label">请求模板 request（JSON）</span>
                <el-input type="textarea" :rows="3" :model-value="jsonPropOf('request')" @update:model-value="setJsonProp('request', $event)" placeholder='{"method":"DELETE","path":"/system/users/{id}"}' />
              </div>
              <div class="form-block">
                <span class="form-label">二次确认文案</span>
                <el-input :model-value="String(selectedProps.confirm ?? '')" @update:model-value="setProp('confirm', $event)" placeholder="确定删除「{nickname}」？" />
              </div>
              <div class="form-block">
                <span class="form-label">行级禁用条件（JSON）</span>
                <el-input type="textarea" :rows="2" :model-value="jsonPropOf('disabledWhen')" @update:model-value="setJsonProp('disabledWhen', $event)" />
              </div>
              <div class="form-block">
                <span class="form-label">行级可见条件（JSON）</span>
                <el-input type="textarea" :rows="2" :model-value="jsonPropOf('visibleWhen')" @update:model-value="setJsonProp('visibleWhen', $event)" />
              </div>
            </template>

            <!-- 容器 -->
            <template v-if="selectedSpec?.layer === 'container'">
              <div v-if="selectedSpec.editable.includes('endpoint')" class="form-block">
                <span class="form-label">接口 endpoint</span>
                <el-input :model-value="String(selectedProps.endpoint ?? '')" @update:model-value="setProp('endpoint', $event)" />
              </div>
              <div v-if="selectedSpec.editable.includes('pageSize')" class="form-block">
                <span class="form-label">每页条数</span>
                <el-input-number :model-value="Number(selectedProps.pageSize ?? 10)" @update:model-value="setProp('pageSize', Number($event))" :min="5" :max="200" />
              </div>
              <div v-if="selectedSpec.editable.includes('layout')" class="form-block">
                <span class="form-label">页面形态</span>
                <el-select :model-value="selectedProps.layout ?? 'table'" @update:model-value="setProp('layout', $event)">
                  <el-option label="查询 + 表格" value="table" /><el-option label="树形表格" value="tree-table" />
                </el-select>
              </div>
              <div v-if="selectedSpec.editable.includes('treeEndpointOf')" class="form-block">
                <span class="form-label">树接口</span>
                <el-input :model-value="String(selectedProps.treeEndpointOf ?? '')" @update:model-value="setProp('treeEndpointOf', $event)" />
              </div>
              <div v-if="selectedSpec.editable.includes('treeParam')" class="form-block">
                <span class="form-label">查询参数名</span>
                <el-input :model-value="String(selectedProps.treeParam ?? '')" @update:model-value="setProp('treeParam', $event)" />
              </div>
            </template>

            <el-divider />
            <div class="inspector-actions">
              <el-button size="small" @click="toggleLock">{{ selected.locked ? '解锁' : '锁定' }}</el-button>
              <el-button size="small" @click="duplicateSelected">复制</el-button>
              <el-button size="small" type="danger" @click="removeSelected">删除</el-button>
            </div>
          </template>
        </el-tab-pane>

        <el-tab-pane :label="`数据与事件${selected?.bindings.length ? ' · ' + selected.bindings.length : ''}`" name="bindings">
          <template v-if="!selected">
            <p class="muted empty-hint">选中元素后可挂数据通道与事件通道。</p>
          </template>
          <template v-else>
            <div class="form-block">
              <span class="form-label">可用通道</span>
              <div class="channel-list">
                <el-button
                  v-for="channel in selectedChannels"
                  :key="channel.channel"
                  size="small"
                  :icon="channel.kind === 'data' ? Link : Promotion"
                  @click="addBinding(channel.kind, channel.channel)"
                >
                  {{ channel.label }}（{{ channel.channel }}）
                </el-button>
              </div>
            </div>
            <div v-for="(binding, index) in selected.bindings" :key="index" class="binding-card">
              <div class="binding-card__head">
                <el-tag size="small" :type="binding.kind === 'data' ? 'success' : 'warning'">
                  {{ binding.kind === 'data' ? '数据' : '事件' }}
                </el-tag>
                <code>{{ binding.channel }}</code>
                <el-button text size="small" type="danger" :icon="Delete" @click="removeBinding(index)" />
              </div>
              <div v-if="binding.kind === 'data'" class="form-block">
                <span class="form-label">数据源</span>
                <el-input :model-value="binding.source ?? ''" @update:model-value="setBindingField(index, 'source', $event)" placeholder="行字段名 / 上下文键" />
              </div>
              <template v-else>
                <div class="form-block">
                  <span class="form-label">动作</span>
                  <el-select :model-value="binding.action ?? 'reload'" @update:model-value="setBindingField(index, 'action', $event)">
                    <el-option v-for="action in ['navigate','request','reload','dialog','emit']" :key="action" :label="action" :value="action" />
                  </el-select>
                </div>
                <div class="form-block">
                  <span class="form-label">参数 params（JSON）</span>
                  <el-input
                    type="textarea" :rows="3"
                    :model-value="binding.params ? JSON.stringify(binding.params, null, 2) : ''"
                    @update:model-value="setBindingParams(index, $event)"
                    placeholder='{"method":"POST","path":"/system/users"}' 
                  />
                </div>
              </template>
            </div>
            <p v-if="selectedIssues.length" class="issue-list">
              <span v-for="(issue, index) in selectedIssues" :key="index">· {{ issue }}</span>
            </p>
          </template>
        </el-tab-pane>

        <el-tab-pane label="vibeelement" name="vibe">
          <template v-if="!selected">
            <p class="muted empty-hint">选中元素后可以写模板片段，改一个字即时预览。</p>
          </template>
          <template v-else>
            <div class="form-block">
              <span class="form-label">
                模板片段
                <el-button text size="small" @click="ensureCode">填入默认模板</el-button>
              </span>
              <el-input
                type="textarea" :rows="6" resize="vertical"
                :model-value="String(selectedProps.code ?? '')"
                @update:model-value="setProp('code', $event)"
                placeholder='<el-button type="primary" @click="onClick">{{ label }}</el-button>'
              />
              <span class="muted hint">
                只允许插值与已注册组件；禁 &lt;script&gt; / v-html / 内联表达式 —— 模板会随图纸下发，必须可安全执行。
              </span>
            </div>
            <div class="form-block">
              <span class="form-label">实时预览</span>
              <div class="vibe-preview">
                <VibeElement
                  v-if="selectedVibe && selectedVibe.code"
                  :vibe="selectedVibe"
                  :data="vibePreviewData"
                  :handlers="vibeHandlers"
                />
                <span v-else class="muted">该元素还没写模板片段（按角色默认样式上线）</span>
              </div>
            </div>
            <p v-if="selectedIssues.length" class="issue-list">
              <span v-for="(issue, index) in selectedIssues" :key="index">· {{ issue }}</span>
            </p>
          </template>
        </el-tab-pane>

        <el-tab-pane :label="`编译${diagnostics.length ? ' · ' + diagnostics.length : ''}`" name="compile">
          <div v-if="compileResult" class="compile-summary">
            <div><span>页面 key</span><strong>{{ compileResult.key }}</strong></div>
            <div><span>列</span><strong>{{ compileResult.analysis.columns.length }}</strong></div>
            <div><span>字段</span><strong>{{ compileResult.analysis.fields.length }}</strong></div>
            <div><span>查询</span><strong>{{ compileResult.analysis.queries.length }}</strong></div>
            <div><span>动作</span><strong>{{ compileResult.analysis.actions.length }}</strong></div>
            <div><span>左树</span><strong>{{ compileResult.analysis.hasTree ? '有' : '无' }}</strong></div>
            <div><span>AI</span><strong>{{ compileResult.ai.enabled ? compileResult.ai.model : '未启用' }}</strong></div>
          </div>
          <div v-if="diagnostics.length" class="diagnostic-list">
            <div v-for="(item, index) in diagnostics" :key="index" class="diagnostic" :class="`is-${item.level}`">
              <el-tag size="small" :type="item.level === 'error' ? 'danger' : item.level === 'warn' ? 'warning' : 'info'">{{ item.level }}</el-tag>
              <span>{{ item.message }}</span>
            </div>
          </div>
          <p v-else class="muted">没有诊断，可以发布。</p>
          <template v-if="questions.length">
            <el-divider />
            <div class="form-block">
              <span class="form-label">会问模型的字段</span>
              <div class="question-list">
                <div v-for="question in questions" :key="question.id" class="question">
                  <code>{{ question.elementId ?? 'meta' }}</code>
                  <span>{{ question.prompt }}</span>
                </div>
              </div>
            </div>
          </template>
          <el-divider />
          <div class="form-block">
            <span class="form-label">编译出的 schema（即将发布的内容）</span>
            <el-input type="textarea" :rows="14" :model-value="JSON.stringify(compileResult?.schema ?? {}, null, 2)" readonly />
          </div>
        </el-tab-pane>
      </el-tabs>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 全出血：外层 .page 的 padding/间距一律不要，画布自己管滚动。 */
.ui-designer {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0; min-width: 0; box-sizing: border-box;
  background: var(--app-bg); color: var(--app-text);
  --dz-bar-h: 40px; --dz-status-h: 24px;
}

/* ① 工具条 */
.dz-bar {
  flex: 0 0 auto; height: var(--dz-bar-h); display: flex; align-items: center; gap: 4px;
  padding: 0 8px; background: var(--surface); border-bottom: 1px solid var(--line);
  font-size: 12px; user-select: none;
}
.dz-title {
  display: flex; align-items: baseline; gap: 8px; min-width: 0; max-width: 340px;
  padding: 2px 8px; border: 0; border-radius: 5px; background: transparent; cursor: pointer;
  color: var(--app-text); font: inherit; text-align: left;
}
.dz-title:hover { background: var(--hover); }
.dz-title strong { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-title__meta { display: inline-flex; gap: 6px; flex: 0 0 auto; }
.dz-title__meta em { font-style: normal; font-size: 11px; color: var(--muted); }
.dz-title__meta em.is-dirty { color: #d97706; }
.dz-title__meta em.is-error { color: #dc2626; }
.dz-title__meta em.is-warn { color: #b45309; }
.dz-icon {
  position: relative; display: inline-grid; place-items: center; width: 26px; height: 26px;
  border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer;
}
.dz-icon--sm { width: 22px; height: 22px; }
.dz-icon:hover:not(:disabled) { background: var(--hover); color: var(--app-text); }
.dz-icon:disabled { opacity: .4; cursor: not-allowed; }
.dz-icon.is-on { background: rgba(99, 102, 241, .14); color: #4f46e5; }
.dz-icon.is-danger:hover { background: rgba(220, 38, 38, .12); color: #dc2626; }
.dz-icon.is-spin :deep(.el-icon) { animation: dz-spin 1s linear infinite; }
@keyframes dz-spin { to { transform: rotate(360deg); } }
.dz-badge {
  position: absolute; top: -2px; right: -2px; min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 7px; background: #6366f1; color: #fff; font-size: 9px; line-height: 13px; text-align: center;
}
.dz-badge.is-danger { background: #dc2626; }
.dz-divider { width: 1px; height: 18px; margin: 0 4px; background: var(--line); flex: 0 0 auto; }
.dz-spacer { flex: 1 1 auto; }
.dz-zoom { display: inline-flex; align-items: center; height: 24px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.dz-zoom__value {
  min-width: 46px; height: 100%; border: 0; border-left: 1px solid var(--line); border-right: 1px solid var(--line);
  background: transparent; color: var(--app-text); font-size: 11px; cursor: pointer;
}
.dz-zoom__value:hover { background: var(--hover); }
.dz-btn {
  height: 26px; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px;
  background: transparent; color: var(--app-text); font-size: 12px; cursor: pointer;
}
.dz-btn:hover:not(:disabled) { border-color: rgba(99, 102, 241, .55); color: #4f46e5; }
.dz-btn:disabled { opacity: .5; cursor: not-allowed; }
.dz-btn--primary { border-color: #4f46e5; background: #4f46e5; color: #fff; }
.dz-btn--primary:hover:not(:disabled) { background: #4338ca; border-color: #4338ca; color: #fff; }
.dz-btn--px { height: 22px; padding: 0 8px; font-size: 11px; }

/* ② 画布区 */
.dz-body { flex: 1 1 auto; display: flex; min-height: 0; min-width: 0; }
.dz-rail {
  flex: 0 0 auto; width: 176px; display: flex; flex-direction: column;
  background: var(--surface); border-right: 1px solid var(--line); overflow: hidden;
}
.dz-rail__tabs { display: flex; padding: 4px; gap: 2px; border-bottom: 1px solid var(--line); }
.dz-rail__tab {
  flex: 1 1 0; height: 24px; display: grid; place-items: center;
  border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer;
}
.dz-rail__tab:hover { background: var(--hover); }
.dz-rail__tab.is-active { background: rgba(99, 102, 241, .12); color: #4f46e5; }
.dz-rail__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 6px; }
.dz-group + .dz-group { margin-top: 10px; }
.dz-group__label {
  margin: 0 0 3px; padding: 0 4px; font-size: 10px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted);
}
.dz-role, .dz-node {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 24px; padding: 0 6px;
  border: 0; border-radius: 4px; background: transparent; color: var(--app-text);
  font-size: 12px; text-align: left; cursor: pointer;
}
.dz-role:hover:not(:disabled), .dz-node:hover { background: var(--hover); }
.dz-role:disabled { opacity: .38; cursor: not-allowed; }
.dz-role__dot { width: 7px; height: 7px; border-radius: 2px; flex: 0 0 auto; }
.dz-role__text, .dz-node__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-node__role { color: var(--muted); font-size: 10px; flex: 0 0 auto; }
.dz-node.is-active { background: rgba(99, 102, 241, .14); color: #4f46e5; }
.dz-empty { margin: 8px 4px; font-size: 11px; color: var(--muted); }

.dz-viewport {
  flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; position: relative;
  background:
    linear-gradient(0deg, rgba(148, 163, 184, .1) 1px, transparent 1px) 0 0 / 100% 24px,
    var(--app-bg);
}
.dz-viewport.is-panning { cursor: grabbing; }
.dz-canvas { display: inline-block; padding: 16px; min-width: 100%; min-height: 100%; box-sizing: border-box; }

/* ③ 状态条 */
.dz-status {
  flex: 0 0 auto; height: var(--dz-status-h); display: flex; align-items: center; gap: 10px;
  padding: 0 10px; background: var(--surface); border-top: 1px solid var(--line);
  font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden;
}
.dz-status__btn {
  height: 18px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
}
.dz-status__btn:hover { background: var(--hover); }
.dz-status__btn.is-on { border-color: rgba(99, 102, 241, .4); color: #4f46e5; background: rgba(99, 102, 241, .1); }
.dz-status__sep { width: 1px; height: 12px; background: var(--line); }
.dz-status__grow { flex: 1 1 auto; }
.dz-status__hint { color: var(--muted); opacity: .8; }
.dz-status__link { height: 18px; padding: 0 4px; font-size: 11px; }

/* ④ 选中浮条 */
.dz-floating {
  position: absolute; left: 50%; bottom: calc(var(--dz-status-h) + 14px); transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 4px 6px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 7px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, .14); z-index: 8;
}
.dz-floating__name { max-width: 200px; padding: 0 4px; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dz-rise-enter-active, .dz-rise-leave-active { transition: opacity .14s ease, transform .14s ease; }
.dz-rise-enter-from, .dz-rise-leave-to { opacity: 0; transform: translate(-50%, 6px); }

/* ⑤ 检查器弹窗内部 */
.dz-inspector { max-height: 72vh; overflow: auto; padding-right: 4px; }
.dz-inspector :deep(.el-tabs__header) { margin-bottom: 10px; }
.form-block { display: flex; flex-direction: column; gap: 3px; margin-bottom: 9px; }
.form-label { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--muted); }
.inspector-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.inspector-desc { margin: 0 0 10px; font-size: 12px; }
.inspector-actions { display: flex; gap: 8px; }
.hint { font-size: 11px; line-height: 1.5; }
.empty-hint { font-size: 12px; }
.channel-list { display: flex; flex-wrap: wrap; gap: 6px; }
.channel-list :deep(.el-button) { margin: 0; }
.binding-card { margin-bottom: 8px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; }
.binding-card__head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.binding-card__head code { flex: 1 1 auto; font-size: 11px; }
.issue-list { display: flex; flex-direction: column; gap: 2px; margin: 0; font-size: 11px; color: #b45309; }
.vibe-preview {
  display: flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px;
  border: 1px dashed var(--line); border-radius: 6px;
}
.compile-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.compile-summary div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.compile-summary span { color: var(--muted); }
.diagnostic-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.diagnostic { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; }
.question-list { display: flex; flex-direction: column; gap: 6px; }
.question { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.question code { font-size: 11px; color: var(--muted); }

/* 窄屏：左栏收成更窄的图标栏，工具条隐藏次要按钮。 */
@container shell (max-width: 900px) {
  .dz-rail { width: 132px; }
  .dz-status__hint { display: none; }
}
@media (max-width: 720px) {
  .dz-rail { position: absolute; z-index: 6; height: calc(100% - var(--dz-bar-h) - var(--dz-status-h)); }
}
</style>
