<script setup lang="ts">
// 3D 预览：直接用画面元数据渲染，不改画布本身。
//
// 链路与后端导出 IFC 完全一致（`buildPartScene` → `buildPlan` → `renderPlanIsometric`），
// 区别只是这份几何在浏览器里算，滚动条一拖就能看不同角度；导出时仍然交给服务端，
// 保证「看到的」和「下载到的」是同一套规则。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Back, Download, MagicStick } from '@element-plus/icons-vue'
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

// 视图参数：都不落库，纯浏览器状态。
const projection = ref<'facade' | 'plan'>('facade')
const angle = ref(30)
const zoom = ref(0.14)
const showLabels = ref(true)
// 底板默认关：画面内容通常只占画布一角，开着底板会把图元压成小黑点。
const showBackdrop = ref(false)

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

const iso = computed(() => {
  if (!plan.value) return { svg: '', width: 0, height: 0 }
  return renderPlanIsometric(plan.value, {
    scale: zoom.value,
    angle: (angle.value * Math.PI) / 180,
    labels: showLabels.value,
    background: '#080d18',
    backdrop: showBackdrop.value ? '#101a2c' : null,
  })
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

/**
 * 适应画面：先按 scale=1 量包围盒再折算。
 *
 * 画面内容常常只占画布一角（标题在左上、设备在中部），固定比例会得到「大墙 + 小黑点」。
 */
function fitView(): void {
  if (!plan.value) return
  const measured = renderPlanIsometric(plan.value, {
    scale: 1,
    angle: (angle.value * Math.PI) / 180,
    labels: false,
    background: null,
    padding: 0,
    backdrop: null,
  })
  if (!measured.width || !measured.height) return
  const scale = Math.min(900 / measured.width, 620 / measured.height)
  zoom.value = Math.min(Math.max(Math.round(scale * 1000) / 1000, 0.02), 1.2)
}

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
  <div class="page scada-preview">
    <header class="page-head">
      <div>
        <h1>3D 预览 · {{ detail?.name ?? '未选择画面' }}</h1>
        <p>
          画面元数据直接渲染成 IFC 计划（毫米、+Z 向上），拖动角度就能看不同视角；导出按钮拿到的 `.ifc` 与这里同源。
        </p>
      </div>
      <div class="page-actions">
        <el-button :icon="Back" @click="router.push('/scada/gallery')">画面库</el-button>
        <el-button type="primary" :icon="Download" :loading="busy" :disabled="!detail" @click="exportIfc">
          导出 IFC
        </el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon />

    <div class="preview-layout">
      <!-- 第一栏：画面 + 图层 -->
      <aside class="panel preview-left">
        <div class="panel-title"><h2>画面</h2><span>{{ screens.length }}</span></div>
        <div class="preview-screens">
          <button
            v-for="screen in screens"
            :key="screen.id"
            type="button"
            class="preview-screen"
            :class="{ 'is-active': screen.id === detail?.id }"
            @click="loadScreen(screen.id)"
          >
            <span class="preview-screen__name">{{ screen.name }}</span>
            <span class="preview-screen__meta">{{ screen.widgetCount }}</span>
          </button>
        </div>

        <div class="panel-title preview-layer-head"><h2>图层</h2><span>{{ layers.length }}</span></div>
        <div class="preview-layers">
          <button
            v-for="layer in layers"
            :key="layer.id"
            type="button"
            class="preview-layer"
            :class="{ 'is-active': layer.id === selectedWidgetId }"
            @click="selectedWidgetId = layer.id"
          >
            <span class="preview-layer__name">{{ layer.name }}</span>
            <span class="preview-layer__meta">{{ layer.solids }}/{{ layer.parts }}</span>
          </button>
        </div>
      </aside>

      <!-- 中间：轴测视图 -->
      <section class="panel preview-stage">
        <div class="preview-bar">
          <div class="preview-bar__group">
            <span class="muted">口径</span>
            <el-radio-group v-model="projection" size="small">
              <el-radio-button label="facade">立墙</el-radio-button>
              <el-radio-button label="plan">铺地</el-radio-button>
            </el-radio-group>
          </div>
          <div class="preview-bar__group">
            <span class="muted">角度</span>
            <el-slider v-model="angle" :min="10" :max="60" :step="1" size="small" class="preview-slider" />
          </div>
          <div class="preview-bar__group">
            <span class="muted">缩放</span>
            <el-slider v-model="zoom" :min="0.02" :max="1.2" :step="0.005" size="small" class="preview-slider" />
          </div>
          <el-checkbox v-model="showLabels" size="small">标签</el-checkbox>
          <el-checkbox v-model="showBackdrop" size="small">底板</el-checkbox>
          <el-button size="small" text @click="fitView">适应画面</el-button>
        </div>
        <div class="preview-canvas" :class="{ 'is-loading': loading }">
          <span v-if="!iso.svg" class="muted">没有可出实体的图元</span>
          <span v-else class="preview-svg" v-html="iso.svg" />
        </div>
      </section>

      <!-- 右栏：选中图元 + 缺参清单 -->
      <aside class="panel preview-right">
        <div class="panel-title"><h2>IFC 摘要</h2><span>{{ projection === 'facade' ? '立墙' : '铺地' }}</span></div>
        <div class="preview-kpi">
          <div><span>图元</span><strong>{{ plan?.stats.widgets ?? 0 }}</strong></div>
          <div><span>零件</span><strong>{{ plan?.stats.parts ?? 0 }}</strong></div>
          <div><span>实体</span><strong>{{ plan?.stats.solids ?? 0 }}</strong></div>
          <div><span>贴面</span><strong>{{ plan?.stats.decals ?? 0 }}</strong></div>
        </div>
        <p class="muted preview-note">
          画布 {{ Math.round(plan?.canvas.widthMm ?? 0) }} × {{ Math.round(plan?.canvas.heightMm ?? 0) }} mm ·
          1 px = {{ (plan?.settings.pixelsPerMeter ?? 1000) / 1000 }} mm · 估算 {{ ifcHints.entities }} 个 IFC 实体
        </p>

        <div class="panel-title preview-section"><h2>选中图元</h2><span>{{ selectedItems.length }} 零件</span></div>
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

        <div class="panel-title preview-section"><h2>缺参追问</h2><span>{{ missingItems.length }}</span></div>
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
            {{ aiEnabled ? '让 AI 补全' : 'AI 未启用（缺 SUB2API_API_KEY）' }}
          </el-button>
        </div>
        <p v-else class="muted preview-ok">规则表已覆盖全部图元，不需要追问模型。</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.scada-preview { min-width: 0; }
.preview-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
.preview-left, .preview-right { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.preview-screens, .preview-layers { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.preview-screen, .preview-layer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 6px 9px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--app-text); font-size: 12px; cursor: pointer; text-align: left;
}
.preview-screen:hover, .preview-layer:hover { background: rgba(99, 102, 241, .08); }
.preview-screen.is-active, .preview-layer.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); }
.preview-screen__name, .preview-layer__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-screen__meta, .preview-layer__meta { color: var(--muted); font-size: 11px; }
.preview-layer-head, .preview-section { margin-top: 8px; }
.preview-stage { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.preview-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 12px; }
.preview-bar__group { display: flex; align-items: center; gap: 8px; }
.preview-slider { width: 120px; }
.preview-canvas {
  display: flex; align-items: center; justify-content: center;
  min-height: 460px; max-height: 70vh; overflow: auto;
  border-radius: 12px; background: #080d18;
}
.preview-canvas.is-loading { opacity: .55; }
.preview-svg { display: block; max-width: 100%; }
.preview-svg :deep(svg) { display: block; max-width: 100%; height: auto; }
.preview-kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.preview-kpi div {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--line); font-size: 12px;
}
.preview-kpi span { color: var(--muted); }
.preview-kpi strong { color: var(--app-text); font-size: 15px; }
.preview-note { font-size: 11px; line-height: 1.6; margin: 0; }
.preview-parts, .preview-missing-list { display: flex; flex-direction: column; gap: 8px; }
.preview-part { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.preview-part__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; }
.preview-part p { margin: 4px 0 0; font-size: 11px; line-height: 1.6; }
.preview-source { color: rgba(148, 163, 184, .8); }
.preview-missing { color: #fca5a5; font-size: 12px; line-height: 1.6; margin: 0; }
.preview-ok { font-size: 12px; }
@media (max-width: 1360px) { .preview-layout { grid-template-columns: 190px minmax(0, 1fr); } .preview-right { grid-column: 1 / -1; } }
@media (max-width: 980px) { .preview-layout { grid-template-columns: 1fr; } }
</style>
