<script setup lang="ts">
// 图纸库：所有画过的 2D 图纸都在这里找得到。
//
// 缩略图是**图纸线框**而不是渲染结果：设计师一眼看出这一页的结构，同时卡片上直接显示
// 「编译错误 / 已发布」，点进去才需要看细节。版式与画面库共用 `CanvasGallery` 壳
// （左侧筛选 + 自适应九宫格），导航已归画布页签，这里不再自建 rail。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Box, CirclePlus, Delete, MagicStick, Refresh, View } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { createUiCanvasApi, type UiDrawingSummary, type UiWireframeItem } from '@/shared/ui-canvas/http'
import CanvasGallery from '@/components/canvas/CanvasGallery.vue'
import CanvasCard from '@/components/canvas/CanvasCard.vue'

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

const stats = computed(() => [
  { label: '图纸', value: drawings.value.length },
  { label: '元素', value: drawings.value.reduce((sum, drawing) => sum + drawing.elementCount, 0) },
  { label: '已发布', value: drawings.value.filter((drawing) => drawing.publishedKey).length },
  { label: '有错误', value: drawings.value.filter((drawing) => (thumbs.value[drawing.id]?.errorCount ?? 0) > 0).length },
])

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

function statusOf(drawing: UiDrawingSummary): { text: string; tone: 'ok' | 'warn' } | undefined {
  if (drawing.publishedKey) return { text: '已发布', tone: 'ok' }
  const errors = thumbs.value[drawing.id]?.errorCount ?? 0
  if (errors > 0) return { text: `${errors} 处错误`, tone: 'warn' }
  return undefined
}

onMounted(load)
</script>

<template>
  <CanvasGallery
    v-model:keyword="keyword"
    placeholder="图纸名称 / 页面 key"
    :stats="stats"
    :loading="loading"
    :min-card-width="240"
    empty-text="还没有图纸。点「新建图纸」进设计器，把元素拖出来就是一张要上线的页面。"
  >
    <template #filters>
      <span class="filter-label">状态</span>
      <el-checkbox v-model="onlyPublished" label="只看已发布" size="small" />
      <el-checkbox v-model="onlyBroken" label="只看有错误" size="small" />
    </template>

    <template #actions>
      <el-button size="small" type="primary" :icon="CirclePlus" :loading="creating" @click="create">新建图纸</el-button>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      <span class="muted">{{ filtered.length }} / {{ drawings.length }}</span>
    </template>

    <CanvasCard
      v-for="drawing in filtered"
      :key="drawing.id"
      :title="drawing.name"
      :badge="`v${drawing.version}`"
      :description="drawing.description"
      :svg="thumbs[drawing.id]?.svg"
      :footnote="`${drawing.elementCount} 元素`"
      :status="statusOf(drawing)"
      :meta="formatTime(drawing.updatedAt)"
      thumb-background="#eef2f7"
      @open="openDesigner(drawing.id)"
    >
      <template #meta>
        <code>{{ drawing.publishedKey ?? drawing.title ?? '未设置页面 key' }}</code>
      </template>
      <template #actions>
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
      </template>
    </CanvasCard>
  </CanvasGallery>
</template>

<style scoped>
.filter-label { color: var(--muted); font-size: 12px; }
</style>
