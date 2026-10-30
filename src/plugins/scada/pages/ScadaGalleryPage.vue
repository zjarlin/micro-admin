<script setup lang="ts">
// 画面库：九宫格管理所有画过的画面。
//
// 缩略图不是截图，而是把画面按 IFC 计划真算一遍等轴测图（服务端批量返回 SVG），
// 所以点开前就能看出「这一页立起来长什么样」。左侧是双栏菜单的第一栏（模块导航），
// 第二栏是筛选/投影方式，避免把工具都塞进一条竖条。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Box, Delete, Download, Files, Grid, Refresh, Search, VideoPlay } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { ScadaScreenSummary } from '@/shared/scada/types'

const http = useService<HttpClient>('http')
const router = useRouter()
const route = useRoute()

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

const stats = computed(() => ({
  count: screens.value.length,
  widgets: screens.value.reduce((sum, screen) => sum + screen.widgetCount, 0),
  threeD: screens.value.filter((screen) => screen.threeD).length,
}))

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
  void router.push({ path: '/scada/workbench', query: { screenId: String(screenId) } })
}

function openPreview(screenId: number): void {
  void router.push({ path: '/scada/preview', query: { screenId: String(screenId) } })
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

onMounted(async () => {
  await load()
  const screenId = Number(route.query.screenId ?? 0)
  if (screenId && screens.value.some((screen) => screen.id === screenId)) {
    // 从工作台跳过来时保持上下文：直接高亮那一页。
    keyword.value = ''
  }
})
</script>

<template>
  <div class="page screen-gallery">
    <header class="page-head">
      <div>
        <h1>画面库</h1>
        <p>
          所有画过的组态画面都在这里，缩略图按 IFC 计划实时算成等轴测图；点卡片进 3D 预览或直接导出 `.ifc`。
        </p>
      </div>
      <div class="page-actions">
        <el-button :icon="Grid" @click="router.push('/scada/workbench')">组态画布</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" show-icon />

    <div class="gallery-layout">
      <!-- 双栏菜单第一栏：模块导航 -->
      <aside class="panel gallery-rail">
        <button type="button" class="rail-item" @click="router.push('/scada/workbench')">
          <el-icon><Grid /></el-icon>
          <span>编辑</span>
        </button>
        <button type="button" class="rail-item is-active">
          <el-icon><Files /></el-icon>
          <span>画面库</span>
        </button>
        <button
          type="button"
          class="rail-item"
          :disabled="!screens.length"
          @click="screens[0] && openPreview(screens[0].id)"
        >
          <el-icon><Box /></el-icon>
          <span>3D</span>
        </button>
      </aside>

      <!-- 第二栏：筛选与投影口径 -->
      <aside class="panel gallery-filter">
        <div class="panel-title"><h2>筛选</h2><span>{{ filtered.length }} / {{ screens.length }}</span></div>
        <el-input v-model="keyword" :prefix-icon="Search" placeholder="画面名称 / 描述" clearable size="small" />
        <div class="filter-block">
          <span class="filter-label">三维口径</span>
          <el-radio-group :model-value="projection" size="small" @change="switchProjection($event as 'facade' | 'plan')">
            <el-radio-button label="facade">立墙</el-radio-button>
            <el-radio-button label="plan">铺地</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-stats">
          <div><span>画面</span><strong>{{ stats.count }}</strong></div>
          <div><span>图元</span><strong>{{ stats.widgets }}</strong></div>
          <div><span>已建 3D</span><strong>{{ stats.threeD }}</strong></div>
        </div>
      </aside>

      <section class="gallery-grid" :class="{ 'is-loading': loading }">
        <article v-for="screen in filtered" :key="screen.id" class="gallery-card">
          <button type="button" class="gallery-thumb" @click="openPreview(screen.id)">
            <span v-if="!thumbs[screen.id]" class="gallery-thumb__empty">生成中…</span>
            <span v-else class="gallery-thumb__svg" v-html="thumbs[screen.id]" />
            <span class="gallery-thumb__badge">{{ screen.widgetCount }} 图元</span>
            <span v-if="screen.threeD" class="gallery-thumb__3d">已建 3D</span>
          </button>
          <div class="gallery-meta">
            <div class="gallery-meta__title">
              <strong>{{ screen.name }}</strong>
              <span class="muted">v{{ screen.documentVersion }}</span>
            </div>
            <p class="muted">{{ screen.description || '未填写描述' }}</p>
            <div class="gallery-meta__foot">
              <span class="muted">{{ formatTime(screen.updatedAt) }}</span>
              <div class="gallery-actions">
                <el-tooltip content="进入编辑" placement="top">
                  <el-button size="small" text :icon="VideoPlay" @click="openEditor(screen.id)" />
                </el-tooltip>
                <el-tooltip content="3D 预览" placement="top">
                  <el-button size="small" text :icon="Box" @click="openPreview(screen.id)" />
                </el-tooltip>
                <el-tooltip content="导出 IFC" placement="top">
                  <el-button size="small" text :icon="Download" @click="exportIfc(screen)" />
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <el-button size="small" text type="danger" :icon="Delete" @click="remove(screen)" />
                </el-tooltip>
              </div>
            </div>
          </div>
        </article>
        <p v-if="!filtered.length && !loading" class="gallery-empty muted">
          还没有画面。去「组态画布」新建一页，回来就能在这里找到。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.screen-gallery { min-width: 0; }
.gallery-layout {
  display: grid;
  grid-template-columns: 76px 210px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.gallery-rail {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 8px;
}
.rail-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; border-radius: 10px; border: 1px solid transparent;
  background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
}
.rail-item:hover { background: rgba(99, 102, 241, .08); color: var(--app-text); }
.rail-item.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); color: var(--app-text); }
.rail-item:disabled { opacity: .4; cursor: not-allowed; }
.gallery-filter { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
.filter-block { display: flex; flex-direction: column; gap: 6px; }
.filter-label { color: var(--muted); font-size: 12px; }
.filter-stats { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
.filter-stats div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.filter-stats span { color: var(--muted); }
.filter-stats strong { color: var(--app-text); font-size: 14px; }
.gallery-grid {
  /* 九宫格：一屏 3 列 × 3 行，宽屏也不再变窄，靠单卡最大宽度限制。 */
  display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr));
  gap: 16px; align-content: start; max-width: 1320px;
}
@media (max-width: 1400px) { .gallery-grid { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
@media (max-width: 980px) { .gallery-grid { grid-template-columns: minmax(0, 1fr); } }
.gallery-grid.is-loading { opacity: .6; }
.gallery-card {
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  transition: border-color .15s ease, transform .15s ease;
}
.gallery-card:hover { border-color: rgba(99, 102, 241, .5); transform: translateY(-2px); }
.gallery-thumb {
  position: relative; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: #0b1220; aspect-ratio: 4 / 3; cursor: pointer; overflow: hidden;
}
.gallery-thumb__svg { display: block; width: 100%; height: 100%; }
.gallery-thumb__svg :deep(svg) { width: 100%; height: 100%; display: block; }
.gallery-thumb__empty { color: var(--muted); font-size: 12px; }
.gallery-thumb__badge {
  position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(15, 23, 42, .78); color: #cbd5e1; font-size: 11px;
}
.gallery-thumb__3d {
  position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(56, 189, 248, .18); border: 1px solid rgba(56, 189, 248, .5); color: #7dd3fc; font-size: 11px;
}
.gallery-meta { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 10px; }
.gallery-meta__title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.gallery-meta__title strong { font-size: 14px; color: var(--app-text); }
.gallery-meta p {
  margin: 0; font-size: 12px; line-height: 1.6; min-height: 19px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gallery-meta__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: nowrap; }
.gallery-meta__foot > .muted { white-space: nowrap; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.gallery-actions { display: flex; align-items: center; gap: 0; }
.gallery-empty { grid-column: 1 / -1; padding: 40px 0; text-align: center; }
@media (max-width: 1280px) { .gallery-layout { grid-template-columns: 68px 190px minmax(0, 1fr); } }
@media (max-width: 980px) { .gallery-layout { grid-template-columns: 1fr; } .gallery-rail { flex-direction: row; justify-content: flex-start; } .rail-item { flex-direction: row; } }
</style>
