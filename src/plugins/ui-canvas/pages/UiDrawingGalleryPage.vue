<script setup lang="ts">
// 图纸库：所有画过的 2D 图纸都在这里找得到。
//
// 版式与「画面库」一致（双栏：图标栏 + 筛选栏，主区九宫格一屏 3 × 3），
// 但缩略图是**图纸线框**而不是渲染结果：设计师一眼看出这一页的结构，
// 同时卡片上直接显示「编译错误 / 已发布」，点进去才需要看细节。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Box, CirclePlus, Delete, Files, Grid, MagicStick, Refresh, Search, Stamp, View,
} from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { createUiCanvasApi, type UiDrawingSummary, type UiWireframeItem } from '@/shared/ui-canvas/http'

const router = useRouter()
const api = createUiCanvasApi(useService<HttpClient>('http'))

const drawings = ref<UiDrawingSummary[]>([])
const thumbs = ref<Record<number, UiWireframeItem>>({})
const loading = ref(false)
const keyword = ref('')
const onlyPublished = ref(false)
const onlyBroken = ref(false)
const creating = ref(false)

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return drawings.value.filter((drawing) => {
    if (onlyPublished.value && !drawing.publishedKey) return false
    if (onlyBroken.value && !(thumbs.value[drawing.id]?.errorCount)) return false
    if (!needle) return true
    return [drawing.name, drawing.description ?? '', drawing.publishedKey ?? '', drawing.title ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle)
  })
})

const stats = computed(() => ({
  count: drawings.value.length,
  elements: drawings.value.reduce((sum, drawing) => sum + drawing.elementCount, 0),
  published: drawings.value.filter((drawing) => drawing.publishedKey).length,
  broken: drawings.value.filter((drawing) => (thumbs.value[drawing.id]?.errorCount ?? 0) > 0).length,
}))

async function load(): Promise<void> {
  loading.value = true
  try {
    drawings.value = await api.list()
    thumbs.value = Object.fromEntries((await api.wireframes()).map((item) => [item.id, item]))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸清单读取失败')
  } finally {
    loading.value = false
  }
}

async function create(): Promise<void> {
  let name = ''
  try {
    const result = await ElMessageBox.prompt('新图纸先起个名字，随后进设计器拖元素。', '新建图纸', {
      confirmButtonText: '创建并打开',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    name = result.value.trim()
  } catch {
    return
  }
  creating.value = true
  try {
    const detail = await api.create({ name })
    await router.push({ name: 'ui-canvas-designer', query: { id: String(detail.id) } })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    creating.value = false
  }
}

function openDesigner(id: number): void {
  void router.push({ name: 'ui-canvas-designer', query: { id: String(id) } })
}

function openRun(id: number): void {
  void router.push({ name: 'ui-canvas-run', query: { id: String(id) } })
}

async function remove(drawing: UiDrawingSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(
      drawing.publishedKey
        ? `「${drawing.name}」已发布为页面 ${drawing.publishedKey}；删除图纸不会下线该页面。确定删除？`
        : `确定删除图纸「${drawing.name}」？`,
      '删除图纸',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await api.remove(drawing.id)
    ElMessage.success('已删除')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function compileOnly(drawing: UiDrawingSummary): Promise<void> {
  try {
    const result = await api.compile({ id: drawing.id })
    const errors = result.diagnostics.filter((item) => item.level === 'error')
    if (errors.length) {
      ElMessage.warning(`「${drawing.name}」还有 ${errors.length} 处错误：${errors[0]?.message ?? ''}`)
    } else {
      const warns = result.diagnostics.filter((item) => item.level === 'warn').length
      ElMessage.success(
        `「${drawing.name}」编译通过：${result.analysis.columns.length} 列 / ${result.analysis.fields.length} 字段 / ${result.analysis.queries.length} 条件${warns ? ` / ${warns} 处提醒` : ''}`,
      )
    }
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '编译失败')
  }
}

function formatTime(value: number): string {
  const date = new Date(value)
  const pad = (input: number): string => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

onMounted(load)
</script>

<template>
  <div class="page drawing-gallery">
    <header class="page-head">
      <div class="crud-head">
        <h1>图纸库</h1>
        <span class="muted head-note">画完的 2D 图纸都在这里：改图纸即改页面，发布不需要发版</span>
      </div>
      <div class="page-actions">
        <el-button :icon="CirclePlus" type="primary" :loading="creating" @click="create">新建图纸</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </header>

    <div class="gallery-layout">
      <aside class="panel gallery-rail">
        <button class="rail-item" type="button" @click="router.push({ name: 'scada-workbench' })">
          <el-icon><Grid /></el-icon><span>组态</span>
        </button>
        <button class="rail-item" type="button" @click="router.push({ name: 'scada-gallery' })">
          <el-icon><Files /></el-icon><span>画面库</span>
        </button>
        <button class="rail-item is-active" type="button">
          <el-icon><Stamp /></el-icon><span>图纸库</span>
        </button>
        <button class="rail-item" type="button" disabled>
          <el-icon><View /></el-icon><span>3D</span>
        </button>
      </aside>

      <aside class="panel gallery-filter">
        <div class="filter-block">
          <span class="filter-label">筛选</span>
          <el-input v-model="keyword" placeholder="图纸名称 / 页面 key" clearable :prefix-icon="Search" />
        </div>
        <div class="filter-block">
          <span class="filter-label">状态</span>
          <el-checkbox v-model="onlyPublished" label="只看已发布" />
          <el-checkbox v-model="onlyBroken" label="只看有错误" />
        </div>
        <div class="filter-stats">
          <div><span>图纸</span><strong>{{ stats.count }}</strong></div>
          <div><span>元素</span><strong>{{ stats.elements }}</strong></div>
          <div><span>已发布</span><strong>{{ stats.published }}</strong></div>
          <div><span>有错误</span><strong>{{ stats.broken }}</strong></div>
        </div>
      </aside>

      <section class="gallery-grid" :class="{ 'is-loading': loading }">
        <article v-for="drawing in filtered" :key="drawing.id" class="gallery-card">
          <button type="button" class="gallery-thumb" @click="openDesigner(drawing.id)">
            <span v-if="!thumbs[drawing.id]" class="gallery-thumb__empty">生成中…</span>
            <span v-else class="gallery-thumb__svg" v-html="thumbs[drawing.id]?.svg" />
            <span class="gallery-thumb__badge">{{ drawing.elementCount }} 元素</span>
            <span v-if="drawing.publishedKey" class="gallery-thumb__ok">已发布</span>
            <span v-else-if="(thumbs[drawing.id]?.errorCount ?? 0) > 0" class="gallery-thumb__bad">
              {{ thumbs[drawing.id]?.errorCount }} 处错误
            </span>
          </button>
          <div class="gallery-meta">
            <div class="gallery-meta__title">
              <strong>{{ drawing.name }}</strong>
              <span class="muted">v{{ drawing.version }}</span>
            </div>
            <p class="muted">{{ drawing.description || '未填写描述' }}</p>
            <p class="muted key-line">
              <el-icon><Stamp /></el-icon>
              <code>{{ drawing.publishedKey ?? drawing.title ?? '未设置页面 key' }}</code>
            </p>
            <div class="gallery-meta__foot">
              <span class="muted">{{ formatTime(drawing.updatedAt) }}</span>
              <div class="gallery-actions">
                <el-tooltip content="编译检查" placement="top">
                  <el-button size="small" text :icon="MagicStick" @click="compileOnly(drawing)" />
                </el-tooltip>
                <el-tooltip content="打开设计器" placement="top">
                  <el-button size="small" text :icon="View" @click="openDesigner(drawing.id)" />
                </el-tooltip>
                <el-tooltip content="运行预览" placement="top">
                  <el-button size="small" text :icon="Box" @click="openRun(drawing.id)" />
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <el-button size="small" text type="danger" :icon="Delete" @click="remove(drawing)" />
                </el-tooltip>
              </div>
            </div>
          </div>
        </article>
        <p v-if="!filtered.length && !loading" class="gallery-empty muted">
          还没有图纸。点「新建图纸」进设计器，把元素拖出来就是一张要上线的页面。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.drawing-gallery { min-width: 0; }
.head-note { font-size: 12px; }
.gallery-layout { display: grid; grid-template-columns: 76px 210px minmax(0, 1fr); gap: 16px; align-items: start; }
.gallery-rail { display: flex; flex-direction: column; gap: 6px; padding: 10px 8px; }
.rail-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; border-radius: 10px; border: 1px solid transparent;
  background: transparent; color: var(--muted); font-size: 11px; cursor: pointer;
}
.rail-item:hover:not(:disabled) { background: rgba(99, 102, 241, .08); color: var(--app-text); }
.rail-item.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); color: var(--app-text); }
.rail-item:disabled { opacity: .4; cursor: not-allowed; }
.gallery-filter { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
.filter-block { display: flex; flex-direction: column; gap: 6px; }
.filter-label { color: var(--muted); font-size: 12px; }
.filter-stats { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
.filter-stats div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.filter-stats span { color: var(--muted); }
.filter-stats strong { color: var(--app-text); font-size: 14px; }
.gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: 16px; align-content: start; max-width: 1320px; }
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
  padding: 0; border: 0; background: #eef2f7; aspect-ratio: 4 / 3; cursor: pointer; overflow: hidden;
}
.gallery-thumb__svg { display: block; width: 100%; height: 100%; }
.gallery-thumb__svg :deep(svg) { width: 100%; height: 100%; display: block; }
.gallery-thumb__empty { color: var(--muted); font-size: 12px; }
.gallery-thumb__badge {
  position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(15, 23, 42, .78); color: #cbd5e1; font-size: 11px;
}
.gallery-thumb__ok {
  position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(34, 197, 94, .2); border: 1px solid rgba(34, 197, 94, .55); color: #15803d; font-size: 11px;
}
.gallery-thumb__bad {
  position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(248, 113, 113, .2); border: 1px solid rgba(248, 113, 113, .6); color: #b91c1c; font-size: 11px;
}
.gallery-meta { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px 10px; }
.gallery-meta__title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.gallery-meta__title strong { font-size: 14px; color: var(--app-text); }
.gallery-meta p {
  margin: 0; font-size: 12px; line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.key-line { display: flex; align-items: center; gap: 4px; }
.key-line code { font-size: 11px; }
.gallery-meta__foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.gallery-meta__foot > .muted { white-space: nowrap; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.gallery-actions { display: flex; align-items: center; gap: 0; }
.gallery-empty { grid-column: 1 / -1; padding: 40px 0; text-align: center; }
@media (max-width: 1280px) { .gallery-layout { grid-template-columns: 68px 190px minmax(0, 1fr); } }
@media (max-width: 980px) {
  .gallery-layout { grid-template-columns: 1fr; }
  .gallery-rail { flex-direction: row; }
  .rail-item { flex-direction: row; }
}
</style>
