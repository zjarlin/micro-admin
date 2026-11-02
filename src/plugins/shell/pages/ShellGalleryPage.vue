<script setup lang="ts">
// 外壳库：现役外壳与所有外壳图纸都在这里。缩略图是服务端出的**图纸线框**，
// 「编辑 / 预览 / 设为现役（发布）」都落在卡片上；版式复用画布类页面的 `CanvasGallery` 壳。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CirclePlus, Delete, MagicStick, Refresh, Stamp, View } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { createShellApi, type ShellDrawingSummary } from '@/shared/shell/http'
import { useShellStore } from '@/stores/shell'
import CanvasGallery from '@/components/canvas/CanvasGallery.vue'
import CanvasCard from '@/components/canvas/CanvasCard.vue'

const router = useRouter()
const api = createShellApi(useService<HttpClient>('http'))
const shell = useShellStore()

const drawings = ref<ShellDrawingSummary[]>([])
const thumbs = ref<Record<number, string>>({})
const loading = ref(false)
const keyword = ref('')
const creating = ref(false)
const wiring = ref(false)

const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (!needle) return drawings.value
  return drawings.value.filter((drawing) =>
    [drawing.name, drawing.description ?? '', drawing.publishedKey ?? '', drawing.title ?? '']
      .join(' ').toLowerCase().includes(needle))
})

const stats = computed(() => [
  { label: '外壳图纸', value: drawings.value.length },
  { label: '已发布', value: drawings.value.filter((drawing) => drawing.publishedKey).length },
  { label: '现役版本', value: shell.published ? `v${shell.version}` : '内置兜底' },
  { label: '现役 key', value: shell.key ?? '—' },
])

async function load(): Promise<void> {
  loading.value = true
  try {
    drawings.value = await api.list()
    // 缩略图是服务端出的图纸线框（与图纸库同一做法）：结构一眼可见，不渲染运行期组件。
    const frames = await api.wireframes()
    thumbs.value = Object.fromEntries(frames.map((frame) => [frame.id, frame.svg]))
    await shell.refresh()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '外壳清单读取失败')
  } finally {
    loading.value = false
  }
}

async function create(): Promise<void> {
  let name = ''
  try {
    const result = await ElMessageBox.prompt('新外壳先起个名字，随后进设计器画顶栏与侧栏。', '新建外壳', {
      confirmButtonText: '创建并打开', cancelButtonText: '取消', inputPattern: /\S+/, inputErrorMessage: '名称不能为空',
    })
    name = result.value.trim()
  } catch {
    return
  }
  creating.value = true
  try {
    const detail = await api.create({ name })
    await router.push({ name: 'shell-designer', query: { id: String(detail.id) } })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    creating.value = false
  }
}

function openDesigner(id: number): void {
  void router.push({ name: 'shell-designer', query: { id: String(id) } })
}

async function wire(drawing: ShellDrawingSummary): Promise<void> {
  wiring.value = true
  try {
    const result = await api.publish(drawing.id)
    ElMessage.success(`「${drawing.name}」已设为现役外壳（v${result.version}）`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发布失败')
  } finally {
    wiring.value = false
  }
}

async function unwire(): Promise<void> {
  const current = drawings.value.find((drawing) => drawing.publishedKey)
  if (!current) { ElMessage.info('当前没有已发布外壳，运行期走内置兜底'); return }
  try {
    await ElMessageBox.confirm('下线后运行期会退回内置外壳（图纸保留）。确定下线？', '下线外壳', {
      type: 'warning', confirmButtonText: '下线', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await api.unpublish(current.id)
    ElMessage.success('已下线，运行期回到内置外壳')
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下线失败')
  }
}

async function remove(drawing: ShellDrawingSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(
      drawing.publishedKey
        ? `「${drawing.name}」是现役外壳，删除图纸后运行期会回到内置外壳。确定删除？`
        : `确定删除外壳图纸「${drawing.name}」？`,
      '删除外壳图纸', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
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

async function compileOnly(drawing: ShellDrawingSummary): Promise<void> {
  try {
    const result = await api.compile({ id: drawing.id })
    const errors = result.diagnostics.filter((item) => item.level === 'error')
    if (errors.length) ElMessage.warning(`「${drawing.name}」还有 ${errors.length} 处错误：${errors[0]?.message ?? ''}`)
    else ElMessage.success(`「${drawing.name}」编译通过：顶栏 ${result.schema.topbar.left.length + result.schema.topbar.right.length} 条目 / 在线模板 ${result.analysis.vibes.length} 个`)
    await load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '编译失败')
  }
}

onMounted(load)
</script>

<template>
  <CanvasGallery
    v-model:keyword="keyword"
    placeholder="搜索外壳图纸"
    :stats="stats"
    :loading="loading"
    :min-card-width="260"
    empty-text="还没有外壳图纸，点右上角「新建外壳」开始画。"
  >
    <template #filters>
      <el-button size="small" :icon="Refresh" @click="load">刷新</el-button>
    </template>

    <template #actions>
      <el-button size="small" type="primary" :icon="CirclePlus" :loading="creating" @click="create">新建外壳</el-button>
      <el-button size="small" :icon="Stamp" :disabled="wiring" @click="unwire">下线现役外壳</el-button>
      <span class="muted gallery-hint">改外壳 = 改图纸 + 「设为现役」，不用发版。</span>
    </template>

    <CanvasCard
      v-for="drawing in filtered"
      :key="drawing.id"
      :title="drawing.name"
      :badge="drawing.publishedKey ? '现役' : `v${drawing.version}`"
      :description="drawing.description"
      :svg="thumbs[drawing.id]"
      :footnote="`${drawing.elementCount} 元素`"
      :status="drawing.publishedKey ? { text: '现役外壳', tone: 'ok' } : undefined"
      thumb-background="#0f172a"
      @open="openDesigner(drawing.id)"
    >
      <template #meta>
        <code>{{ drawing.publishedKey ?? drawing.title ?? '未发布' }}</code>
      </template>
      <template #actions>
        <el-tooltip content="编译检查" placement="top">
          <el-button size="small" text :icon="MagicStick" @click="compileOnly(drawing)" />
        </el-tooltip>
        <el-tooltip content="设为现役外壳（发布）" placement="top">
          <el-button size="small" text :icon="Stamp" :disabled="Boolean(drawing.publishedKey)" @click="wire(drawing)" />
        </el-tooltip>
        <el-tooltip content="打开设计器" placement="top">
          <el-button size="small" text :icon="View" @click="openDesigner(drawing.id)" />
        </el-tooltip>
        <el-tooltip content="删除" placement="top">
          <el-button size="small" text type="danger" :icon="Delete" @click="remove(drawing)" />
        </el-tooltip>
      </template>
    </CanvasCard>
  </CanvasGallery>
</template>

<style scoped>
.gallery-hint { font-size: 11px; }
</style>
