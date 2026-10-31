<script setup lang="ts">
// 3D 预览：直接用画面元数据渲染成真三维视图，不改画布本身。
//
// 与后端导出 IFC 同源（`buildPartScene` → `buildPlan` → `renderPlanIsometric`），
// 区别只是这份几何在浏览器里算，拖一下就能绕着 Z 轴转、抬仰角，像 CAD 一样看模型；
// 导出时仍然交给服务端，保证「看到的」和「下载到的」是同一套规则。
//
// 布局按 CAD/IDE 的吝啬标准：视口吃满整块内容区，画面/图层与 IFC 摘要都是**可收起的浮动抽屉**，
// 默认只开左侧，右侧摘要关着也不占一个像素。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Aim, Download, MagicStick, Operation, Refresh } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type {
  ScadaDocument,
  ScadaScreenDetail,
  ScadaScreenSummary,
  ScadaSymbolDefinition,
} from '@/shared/scada/types'
import { parseScadaDocument } from '@/shared/scada/types'
import { buildPartScene } from '@/shared/scada/scene'
import { buildPlan, renderPlanIsometric, type AiExtrusionDecision } from '@/shared/scada/ifc'

const PROJECT_ID = 1

const http = useService<HttpClient>('http')
const router = useRouter()
const route = useRoute()

const screens = ref<ScadaScreenSummary[]>([])
const detail = ref<ScadaScreenDetail | null>(null)
const screenDocument = ref<ScadaDocument | null>(null)
const symbols = ref<ScadaSymbolDefinition[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const selectedWidgetId = ref<string | null>(null)

// ---------------- 视图参数（纯浏览器状态，都不落库） ----------------
/** 口径：立墙 = 画面立成一面墙；铺地 = 画面铺在地面上。 */
const projection = ref<'facade' | 'plan'>('facade')
/** 绕 Z 轴的方位角（度）与仰角（度）：这就是「三维坐标系」的两个自由度。 */
const azimuth = ref(45)
const elevation = ref(30)
const zoom = ref(0.14)
const showLabels = ref(true)
const showAxes = ref(true)
const showGrid = ref(true)
/** 底板默认关：画面内容通常只占画布一角，开着底板会把图元压成小黑点。 */
const showBackdrop = ref(false)

const dockLeft = ref(true)
const dockRight = ref(false)

const symbolMap = computed(() => {
  const map: Record<string, ScadaSymbolDefinition> = {}
  for (const symbol of symbols.value) map[symbol.key] = symbol
  return map
})

const decisions = computed<Record<string, AiExtrusionDecision>>(() => {
  const raw = detail.value?.extrusionJson
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, AiExtrusionDecision>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
})

const plan = computed(() => {
  if (!screenDocument.value) return null
  const scene = buildPartScene(screenDocument.value, symbolMap.value, new Map())
  return buildPlan(scene, {
    screenName: detail.value?.name ?? '未命名画面',
    symbols: symbols.value,
    settings: { projection: projection.value },
    decisions: decisions.value,
  })
})

/** 当前视角的渲染参数；缩略图/适应画面也复用同一份，避免两处口径漂移。 */
const isoOptions = computed(() => ({
  angle: (elevation.value * Math.PI) / 180,
  azimuth: (azimuth.value * Math.PI) / 180,
  labels: showLabels.value,
  axes: showAxes.value,
  grid: showGrid.value ? (true as const) : (false as const),
  background: '#080d18',
  backdrop: showBackdrop.value ? '#101a2c' : null,
}))

const iso = computed(() => {
  if (!plan.value) return { svg: '', width: 0, height: 0 }
  return renderPlanIsometric(plan.value, { ...isoOptions.value, scale: zoom.value })
})

const items = computed(() => plan.value?.items ?? [])

const layers = computed(() => {
  const seen = new Map<string, { id: string; name: string; symbolKey: string; parts: number; solids: number }>()
  for (const item of items.value) {
    const current = seen.get(item.widgetId) ?? {
      id: item.widgetId,
      name: item.widgetName,
      symbolKey: item.symbolKey,
      parts: 0,
      solids: 0,
    }
    current.parts += 1
    if (item.decision && item.decision.form !== 'decal' && item.decision.form !== 'skip') current.solids += 1
    seen.set(item.widgetId, current)
  }
  return [...seen.values()]
})

const selectedItems = computed(() =>
  selectedWidgetId.value ? items.value.filter((item) => item.widgetId === selectedWidgetId.value) : [],
)

const missingItems = computed(() => items.value.filter((item) => item.missing.length > 0))

const viewport = ref<HTMLElement | null>(null)
const viewSize = ref({ width: 900, height: 620 })

/**
 * 适应画面：先按 scale=1 量一遍当前视角的包围盒（含坐标轴与网格），再折算成视口尺寸。
 *
 * 画面内容常常只占画布一角（标题在左上、设备在中部），固定比例会得到「大墙 + 小黑点」。
 */
function fitView(): void {
  if (!plan.value) return
  const measured = renderPlanIsometric(plan.value, {
    ...isoOptions.value,
    scale: 1,
    labels: false,
    background: null,
    padding: 0,
    backdrop: null,
  })
  if (!measured.width || !measured.height) return
  const { width, height } = viewSize.value
  const scale = Math.min((width - 24) / measured.width, (height - 24) / measured.height)
  zoom.value = Math.min(Math.max(Math.round(scale * 1000) / 1000, 0.02), 1.2)
}

function resetView(): void {
  azimuth.value = 45
  elevation.value = 30
  fitView()
}

// ---------------- 轨道旋转 / 滚轮缩放 ----------------

let drag: { x: number; y: number; azimuth: number; elevation: number } | null = null

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  drag = { x: event.clientX, y: event.clientY, azimuth: azimuth.value, elevation: elevation.value }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return
  // 横向拖 = 绕 Z 轴转，纵向拖 = 抬/压仰角；夹在 5°~85° 之间，避免退化成俯视图或侧视图。
  const nextAzimuth = drag.azimuth + (event.clientX - drag.x) * 0.4
  const nextElevation = drag.elevation - (event.clientY - drag.y) * 0.3
  azimuth.value = Math.round(((nextAzimuth % 360) + 360) % 360)
  elevation.value = Math.min(85, Math.max(5, Math.round(nextElevation)))
}

function onPointerUp(): void {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const factor = event.deltaY > 0 ? 0.92 : 1.08
  zoom.value = Math.min(1.2, Math.max(0.02, Math.round(zoom.value * factor * 1000) / 1000))
}

let observer: ResizeObserver | null = null

onMounted(() => {
  observer = new ResizeObserver(() => {
    const host = viewport.value
    if (!host) return
    viewSize.value = { width: host.clientWidth, height: host.clientHeight }
  })
  if (viewport.value) observer.observe(viewport.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  onPointerUp()
})

// ---------------- 数据加载 ----------------

const aiStatus = ref(false)
const aiEnabled = computed(() => aiStatus.value)

const ifcHints = computed(() => {
  if (!plan.value) return { entities: 0, solids: 0, bytes: 0, elements: 0 }
  const solids = plan.value.stats.solids
  // 估算：每个实体约 55 字节，导出后会由服务端返回真实字节数；这里只给量级。
  return { entities: solids * 22, solids, bytes: solids * 1200, elements: solids }
})

function describeError(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  return fallback
}

async function loadScreens(): Promise<void> {
  screens.value = await http.request<ScadaScreenSummary[]>(`/scada/screens?projectId=${PROJECT_ID}`)
}

async function loadScreen(screenId: number): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const screen = await http.request<ScadaScreenDetail>(`/scada/screen?screenId=${screenId}`)
    detail.value = screen
    screenDocument.value = parseScadaDocument(screen.documentJson)
    selectedWidgetId.value = screenDocument.value.widgets[0]?.id ?? null
    fitView()
    // 地址栏跟着走：刷新/分享都能回到同一页画面。
    void router.replace({ path: '/scada/preview', query: { screenId: String(screenId) } })
  } catch (failure) {
    error.value = describeError(failure, '画面加载失败')
  } finally {
    loading.value = false
  }
}

async function loadSymbols(): Promise<void> {
  const library = await http.request<{ symbols: ScadaSymbolDefinition[] }>('/scada/symbols')
  symbols.value = library.symbols
}

async function refreshPlanStatus(): Promise<void> {
  const screenId = detail.value?.id
  if (!screenId) return
  try {
    const result = await http.request<{ ai: { enabled: boolean } }>('/scada/screen/extrusion/plan', {
      method: 'POST',
      body: JSON.stringify({ screenId, projection: projection.value }),
    })
    aiStatus.value = Boolean(result.ai?.enabled)
  } catch {
    aiStatus.value = false
  }
}

async function askAi(): Promise<void> {
  const screenId = detail.value?.id
  if (!screenId) return
  busy.value = true
  try {
    const result = await http.request<{ ready: boolean; missing: string[] }>('/scada/screen/extrusion/ai', {
      method: 'POST',
      body: JSON.stringify({ screenId, projection: projection.value }),
    })
    const refreshed = await http.request<ScadaScreenDetail>(`/scada/screen?screenId=${screenId}`)
    detail.value = refreshed
    ElMessage[result.ready ? 'success' : 'warning'](
      result.ready ? 'AI 已补齐缺失参数' : `仍有 ${result.missing.length} 类参数缺失`,
    )
  } catch (failure) {
    ElMessage.error(describeError(failure, 'AI 补参失败'))
  } finally {
    busy.value = false
  }
}

async function exportIfc(): Promise<void> {
  const screen = detail.value
  if (!screen) return
  busy.value = true
  try {
    const token = localStorage.getItem('micro-admin.token') ?? ''
    const response = await fetch(`/api/scada/screen/ifc?screenId=${screen.id}&projection=${projection.value}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${screen.name}.ifc`
    anchor.click()
    URL.revokeObjectURL(url)
    ElMessage.success('IFC 已导出')
  } catch (failure) {
    ElMessage.error(describeError(failure, '导出失败'))
  } finally {
    busy.value = false
  }
}

watch(projection, () => {
  void refreshPlanStatus()
})

onMounted(async () => {
  try {
    await Promise.all([loadScreens(), loadSymbols()])
    const queryId = Number(route.query.screenId ?? 0)
    const target = queryId || screens.value[0]?.id || 0
    if (target) await loadScreen(target)
    await refreshPlanStatus()
  } catch (failure) {
    error.value = describeError(failure, '初始化失败')
  }
})
</script>

<template>
  <div class="preview">
    <!-- 工具条：一行放完，CAD 的「命令行 + 视图控制」都在这条里。 -->
    <header class="preview-bar">
      <div class="preview-bar__group">
        <span class="preview-bar__label">画面</span>
        <el-select
          :model-value="detail?.id ?? null"
          size="small"
          class="preview-bar__screen"
          placeholder="选择画面"
          @change="(value: number) => loadScreen(value)"
        >
          <el-option v-for="screen in screens" :key="screen.id" :label="screen.name" :value="screen.id" />
        </el-select>
      </div>

      <div class="preview-bar__group">
        <span class="preview-bar__label">口径</span>
        <el-radio-group v-model="projection" size="small">
          <el-radio-button label="facade">立墙</el-radio-button>
          <el-radio-button label="plan">铺地</el-radio-button>
        </el-radio-group>
      </div>

      <div class="preview-bar__group">
        <span class="preview-bar__label">方位角 {{ azimuth }}°</span>
        <el-slider v-model="azimuth" :min="0" :max="359" :step="1" size="small" class="preview-bar__slider" />
      </div>
      <div class="preview-bar__group">
        <span class="preview-bar__label">仰角 {{ elevation }}°</span>
        <el-slider v-model="elevation" :min="5" :max="85" :step="1" size="small" class="preview-bar__slider" />
      </div>

      <div class="preview-bar__group">
        <el-checkbox v-model="showAxes" size="small">坐标系</el-checkbox>
        <el-checkbox v-model="showGrid" size="small">地面网格</el-checkbox>
        <el-checkbox v-model="showLabels" size="small">标签</el-checkbox>
        <el-checkbox v-model="showBackdrop" size="small">底板</el-checkbox>
      </div>

      <div class="preview-bar__spacer" />

      <div class="preview-bar__group">
        <el-tooltip content="适应画面（F）" placement="bottom">
          <el-button size="small" :icon="Aim" @click="fitView">适应</el-button>
        </el-tooltip>
        <el-tooltip content="回到 45° / 30° 标准轴测" placement="bottom">
          <el-button size="small" :icon="Refresh" @click="resetView" />
        </el-tooltip>
        <el-tooltip :content="dockLeft ? '收起画面/图层' : '展开画面/图层'" placement="bottom">
          <el-button size="small" :type="dockLeft ? 'primary' : 'default'" :plain="dockLeft" :icon="Operation" @click="dockLeft = !dockLeft" />
        </el-tooltip>
        <el-tooltip :content="dockRight ? '收起 IFC 摘要' : '展开 IFC 摘要'" placement="bottom">
          <el-button size="small" :type="dockRight ? 'primary' : 'default'" :plain="dockRight" :icon="Operation" @click="dockRight = !dockRight" />
        </el-tooltip>
        <el-button size="small" type="primary" :icon="Download" :loading="busy" :disabled="!detail" @click="exportIfc">
          导出 IFC
        </el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon class="preview-alert" />

    <!-- 视口：吃满剩余空间，坐标轴/网格/模型都在这一块里。 -->
    <div class="preview-viewport">
      <div
        ref="viewport"
        class="preview-stage"
        :class="{ 'is-loading': loading }"
        @pointerdown="onPointerDown"
        @wheel="onWheel"
      >
        <span v-if="!iso.svg" class="muted">没有可出实体的图元</span>
        <span v-else class="preview-svg" v-html="iso.svg" />
        <p class="preview-hud">
          拖动旋转 · 滚轮缩放 · 方位角 {{ azimuth }}° / 仰角 {{ elevation }}° · 1 px = 1 mm
        </p>
      </div>

      <!-- 左抽屉：画面 + 图层 -->
      <aside v-show="dockLeft" class="preview-dock preview-dock--left">
        <div class="preview-dock__head">
          <strong>画面 / 图层</strong>
          <span class="muted">{{ screens.length }} 画面 · {{ layers.length }} 图层</span>
        </div>
        <div class="preview-dock__body">
          <div class="preview-screens">
            <button
              v-for="screen in screens"
              :key="screen.id"
              type="button"
              class="preview-row"
              :class="{ 'is-active': screen.id === detail?.id }"
              @click="loadScreen(screen.id)"
            >
              <span class="preview-row__name">{{ screen.name }}</span>
              <span class="preview-row__meta">{{ screen.widgetCount }}</span>
            </button>
          </div>
          <div class="preview-layers">
            <button
              v-for="layer in layers"
              :key="layer.id"
              type="button"
              class="preview-row"
              :class="{ 'is-active': layer.id === selectedWidgetId }"
              @click="selectedWidgetId = layer.id"
            >
              <span class="preview-row__name">{{ layer.name }}</span>
              <span class="preview-row__meta">{{ layer.solids }}/{{ layer.parts }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- 右抽屉：IFC 摘要 + 选中图元 + 缺参追问 -->
      <aside v-show="dockRight" class="preview-dock preview-dock--right">
        <div class="preview-dock__head">
          <strong>IFC 摘要</strong>
          <span class="muted">{{ projection === 'facade' ? '立墙' : '铺地' }}</span>
        </div>
        <div class="preview-dock__body">
          <div class="preview-kpi">
            <div><span>图元</span><strong>{{ plan?.stats.widgets ?? 0 }}</strong></div>
            <div><span>零件</span><strong>{{ plan?.stats.parts ?? 0 }}</strong></div>
            <div><span>实体</span><strong>{{ plan?.stats.solids ?? 0 }}</strong></div>
            <div><span>贴面</span><strong>{{ plan?.stats.decals ?? 0 }}</strong></div>
          </div>
          <p class="muted preview-note">
            画布 {{ Math.round(plan?.canvas.widthMm ?? 0) }} × {{ Math.round(plan?.canvas.heightMm ?? 0) }} mm ·
            估算 {{ ifcHints.entities }} 个 IFC 实体
          </p>

          <div class="preview-section"><h2>选中图元</h2><span>{{ selectedItems.length }} 零件</span></div>
          <div v-if="selectedItems.length" class="preview-parts">
            <div v-for="item in selectedItems" :key="item.partId" class="preview-part">
              <div class="preview-part__head">
                <strong>{{ item.partId }}</strong>
                <span class="muted">{{ item.shape }}</span>
              </div>
              <p v-if="item.decision" class="muted">
                {{ item.decision.role }} · {{ item.decision.form }} · 厚
                {{ Math.round(item.decision.depth) }} mm · 离墙/地
                {{ Math.round(item.decision.elevation) }} mm · {{ item.decision.material }}
                <span class="preview-source">（{{ item.decision.source }}）</span>
              </p>
              <p v-else class="preview-missing">缺参数：{{ item.missing.join('、') }}</p>
            </div>
          </div>
          <p v-else class="muted">在左侧图层里选一个图元。</p>

          <div class="preview-section"><h2>缺参追问</h2><span>{{ missingItems.length }}</span></div>
          <div v-if="missingItems.length" class="preview-missing-list">
            <p v-for="item in missingItems" :key="`${item.widgetId}/${item.partId}`" class="preview-missing">
              {{ item.hint }}
            </p>
            <el-button
              size="small"
              type="primary"
              :icon="MagicStick"
              :loading="busy"
              :disabled="!aiEnabled"
              @click="askAi"
            >
              {{ aiEnabled ? '让 AI 补全' : 'AI 未启用（缺 AI_API_KEY）' }}
            </el-button>
          </div>
          <p v-else class="muted preview-ok">规则表已覆盖全部图元，不需要追问模型。</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 视口吃满：页面自己就是一列，工具条定高，剩下全给画布。 */
.preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 auto; height: 100%; gap: 0; }
.preview-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 8px 12px; border-bottom: 1px solid var(--line); background: var(--surface);
}
.preview-bar__group { display: flex; align-items: center; gap: 8px; }
.preview-bar__label { color: var(--muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.preview-bar__slider { width: 110px; }
.preview-bar__screen { width: 168px; }
.preview-bar__spacer { flex: 1 1 auto; }
.preview-alert { margin: 8px 12px 0; }
.preview-viewport { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
.preview-stage {
  position: relative; flex: 1 1 auto; min-width: 0; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; background: #080d18; cursor: grab; touch-action: none;
}
.preview-stage:active { cursor: grabbing; }
.preview-stage.is-loading { opacity: .6; }
.preview-svg { display: block; max-width: 100%; max-height: 100%; }
.preview-svg :deep(svg) { display: block; max-width: 100%; max-height: 100%; }
.preview-hud {
  position: absolute; left: 10px; bottom: 8px; margin: 0;
  font-size: 11px; color: rgba(203, 213, 225, .72); pointer-events: none;
}
/* 抽屉：浮在视口上，不占轨道宽度；关掉即一像素不留。 */
.preview-dock {
  position: absolute; top: 10px; bottom: 10px; width: 248px; z-index: 4;
  display: flex; flex-direction: column; min-height: 0;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 18px 40px rgba(2, 6, 23, .35); backdrop-filter: blur(6px);
}
.preview-dock--left { left: 10px; }
.preview-dock--right { right: 10px; }
.preview-dock__head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid var(--line);
}
.preview-dock__head strong { font-size: 12px; color: var(--app-text); }
.preview-dock__head .muted { font-size: 11px; }
.preview-dock__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.preview-screens, .preview-layers { display: flex; flex-direction: column; gap: 3px; }
.preview-layers { border-top: 1px dashed var(--line); padding-top: 6px; }
.preview-row {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 5px 8px; border: 1px solid transparent; border-radius: 7px;
  background: transparent; color: var(--app-text); font-size: 12px; cursor: pointer; text-align: left;
}
.preview-row:hover { background: rgba(99, 102, 241, .08); }
.preview-row.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); }
.preview-row__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-row__meta { color: var(--muted); font-size: 11px; flex: none; }
.preview-kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.preview-kpi div {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; border-radius: 7px; border: 1px solid var(--line); font-size: 11px;
}
.preview-kpi span { color: var(--muted); }
.preview-kpi strong { color: var(--app-text); font-size: 14px; }
.preview-note { font-size: 11px; line-height: 1.6; margin: 0; }
.preview-section { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 6px; }
.preview-section h2 { margin: 0; font-size: 12px; color: var(--app-text); }
.preview-section span { color: var(--muted); font-size: 11px; }
.preview-parts, .preview-missing-list { display: flex; flex-direction: column; gap: 6px; }
.preview-part { border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; }
.preview-part__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; }
.preview-part p { margin: 3px 0 0; font-size: 11px; line-height: 1.6; }
.preview-source { color: rgba(148, 163, 184, .8); }
.preview-missing { color: #fca5a5; font-size: 11px; line-height: 1.6; margin: 0; }
.preview-ok { font-size: 11px; }
@media (max-width: 1100px) { .preview-bar__slider { width: 80px; } .preview-dock { width: 210px; } }
</style>
