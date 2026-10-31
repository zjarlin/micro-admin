<script setup lang="ts">
// 画面库：九宫格管理所有画过的画面。
//
// 缩略图不是截图，而是把画面按 IFC 计划真算一遍轴测图（服务端批量返回 SVG），
// 所以点开前就能看出「这一页立起来长什么样」。版式走公共壳 `CanvasGallery`：
// 左侧筛选、右侧自适应网格，高度吃满，不再自建一条模块 rail（导航已归画布页签）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Plus, Refresh, VideoPlay } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { ScadaScreenSummary } from '@/shared/scada/types'
import CanvasGallery from '@/components/canvas/CanvasGallery.vue'
import CanvasCard from '@/components/canvas/CanvasCard.vue'

const http = useService<HttpClient>('http')
const router = useRouter()

const PROJECT_ID = 1

const screens = ref<ScadaScreenSummary[]>([])
const thumbs = ref<Record<number, string>>({})
const loading = ref(false)
const keyword = ref('')
const projection = ref<'facade' | 'plan'>('facade')
const error = ref<string | null>(null)

const filtered = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return screens.value
  return screens.value.filter(
    (screen) =>
      screen.name.toLowerCase().includes(text) ||
      (screen.description ?? '').toLowerCase().includes(text),
  )
})

const stats = computed(() => [
  { label: '画面', value: screens.value.length },
  { label: '图元', value: screens.value.reduce((sum, screen) => sum + screen.widgetCount, 0) },
  { label: '已建 3D', value: screens.value.filter((screen) => screen.threeD).length },
])

function describeError(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  return fallback
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    screens.value = await http.request<ScadaScreenSummary[]>(`/scada/screens?projectId=${PROJECT_ID}`)
    const items = await http.request<Array<{ id: number; svg: string }>>('/scada/screens/iso', {
      method: 'POST',
      body: JSON.stringify({
        projectId: PROJECT_ID,
        projection: projection.value,
        scale: 0.09,
        screenIds: screens.value.map((screen) => screen.id),
      }),
    })
    const next: Record<number, string> = {}
    for (const item of items) next[item.id] = item.svg
    thumbs.value = next
  } catch (failure) {
    error.value = describeError(failure, '画面库加载失败')
  } finally {
    loading.value = false
  }
}

async function switchProjection(next: 'facade' | 'plan'): Promise<void> {
  if (projection.value === next) return
  projection.value = next
  await load()
}

function openEditor(screenId: number): void {
  void router.push({ path: '/canvas', query: { tab: 'scada.workbench', screenId: String(screenId) } })
}

function openPreview(screenId: number): void {
  void router.push({ path: '/canvas', query: { tab: 'scada.preview', screenId: String(screenId) } })
}

/** 导出走后端：文件由服务端生成，浏览器只负责落盘。 */
async function exportIfc(screen: ScadaScreenSummary): Promise<void> {
  try {
    const token = localStorage.getItem('micro-admin.token') ?? ''
    const response = await fetch(
      `/api/scada/screen/ifc?screenId=${screen.id}&projection=${projection.value}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
    if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${screen.name}.ifc`
    anchor.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出「${screen.name}」的 IFC`)
    // 导出会写回 3D 决策标记，刷新一次让「已建 3D」角标同步。
    await load()
  } catch (failure) {
    ElMessage.error(describeError(failure, '导出 IFC 失败'))
  }
}

async function remove(screen: ScadaScreenSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除画面「${screen.name}」？该操作不可撤销。`, '删除画面', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await http.request<{ deleted: number }>('/scada/screen/delete', {
      method: 'POST',
      body: JSON.stringify({ screenId: screen.id }),
    })
    ElMessage.success('画面已删除')
    await load()
  } catch (failure) {
    ElMessage.error(describeError(failure, '删除失败'))
  }
}

function formatTime(value: number): string {
  if (!value) return '—'
  const date = new Date(value)
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

onMounted(load)
</script>

<template>
  <CanvasGallery
    v-model:keyword="keyword"
    placeholder="画面名称 / 描述"
    :stats="stats"
    :loading="loading"
    :min-card-width="240"
    empty-text="还没有画面。切到「组态画布」新建一页，回来就能在这里找到。"
  >
    <template #filters>
      <span class="filter-label">三维口径</span>
      <el-radio-group :model-value="projection" size="small" @change="switchProjection($event as 'facade' | 'plan')">
        <el-radio-button label="facade">立墙</el-radio-button>
        <el-radio-button label="plan">铺地</el-radio-button>
      </el-radio-group>
      <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon />
    </template>

    <template #actions>
      <el-button size="small" :icon="Plus" @click="router.push({ path: '/canvas', query: { tab: 'scada.workbench' } })">
        新建画面
      </el-button>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <span class="muted">{{ filtered.length }} / {{ screens.length }}</span>
    </template>

    <CanvasCard
      v-for="screen in filtered"
      :key="screen.id"
      :title="screen.name"
      :badge="`v${screen.documentVersion}`"
      :description="screen.description"
      :svg="thumbs[screen.id]"
      :footnote="`${screen.widgetCount} 图元`"
      :status="screen.threeD ? { text: '已建 3D', tone: 'info' } : undefined"
      :meta="formatTime(screen.updatedAt)"
      @open="openPreview(screen.id)"
    >
      <template #actions>
        <el-tooltip content="进入编辑" placement="top">
          <el-button size="small" text :icon="VideoPlay" @click="openEditor(screen.id)" />
        </el-tooltip>
        <el-tooltip content="导出 IFC" placement="top">
          <el-button size="small" text :icon="Download" @click="exportIfc(screen)" />
        </el-tooltip>
        <el-tooltip content="删除" placement="top">
          <el-button size="small" text type="danger" :icon="Delete" @click="remove(screen)" />
        </el-tooltip>
      </template>
    </CanvasCard>
  </CanvasGallery>
</template>

<style scoped>
.filter-label { color: var(--muted); font-size: 12px; }
</style>
