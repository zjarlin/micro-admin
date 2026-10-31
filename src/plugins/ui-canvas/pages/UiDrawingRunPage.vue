<script setup lang="ts">
// 图纸运行预览：不落库、不发版，直接把当前图纸编译出的 schema 交给通用页面壳渲染。
//
// 这是「所见即上线后」的锚点：预览里看到的表格、列、查询、表单、行操作，
// 与发布后端上出现在的完全同源——同一份 `CrudPageSchema`、同一个 `CrudPage` 壳。
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Refresh, Stamp } from '@element-plus/icons-vue'
import CrudPage from '@zjarlin/data-page-element/CrudPage.vue'
import TreePage from '@zjarlin/data-page-element/TreePage.vue'
import type { CrudPageSchema, Row } from '@zjarlin/data-page'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { compileDrawing } from '@/shared/ui-canvas'
import { createUiCanvasApi, parseDrawing } from '@/shared/ui-canvas/http'

const route = useRoute()
const router = useRouter()
const api = createUiCanvasApi(useService<HttpClient>('http'))

const drawingId = computed(() => Number(route.query.id ?? 0))

const schema = shallowRef<CrudPageSchema | null>(null)
const name = ref('')
const published = ref(false)
const loading = ref(false)

const mode = computed<'crud' | 'tree'>(() => (schema.value?.layout === 'tree-table' ? 'tree' : 'crud'))

async function load(): Promise<void> {
  if (!drawingId.value) return
  loading.value = true
  try {
    const detail = await api.detail(drawingId.value)
    name.value = detail.name
    published.value = Boolean(detail.publishedKey)
    const drawing = parseDrawing(detail.drawingJson)
    const compiled = compileDrawing(drawing)
    schema.value = compiled.schema as unknown as CrudPageSchema
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '图纸读取失败')
    schema.value = null
  } finally {
    loading.value = false
  }
}

async function publish(): Promise<void> {
  try {
    const result = await api.publish(drawingId.value)
    published.value = true
    ElMessage.success(`已发布为 ${result.key}（v${result.version}）`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发布失败')
  }
}

function onDetail(row: Row): void {
  ElMessage.info(`详情：${JSON.stringify(row).slice(0, 120)}`)
}

onMounted(load)
</script>

<template>
  <div class="page ui-run" v-loading="loading">
    <!-- 运行预览也是全出血页：让页面壳占满视口，与上线后一致（上线页没有 28px 边距）。 -->
    <header class="page-head ui-run__bar">
      <div class="crud-head">
        <el-button text :icon="ArrowLeft" @click="router.push({ name: 'ui-canvas-designer', query: { id: String(drawingId) } })">
          回设计器
        </el-button>
        <h1>运行预览 · {{ name }}</h1>
        <el-tag size="small" type="info">当前图纸实时编译，未落库</el-tag>
        <el-tag v-if="published" size="small" type="success">已发布</el-tag>
      </div>
      <div class="page-actions">
        <el-button :icon="Refresh" @click="load">重新编译</el-button>
        <el-button :icon="Stamp" type="primary" :disabled="published" @click="publish">发布此页</el-button>
      </div>
    </header>

    <el-alert
      v-if="!schema"
      type="warning"
      :closable="false"
      show-icon
      title="这份图纸还不能渲染"
      description="先回设计器把编译错误修掉（缺少字段名、接口、选项等），再回来预览。"
    />
    <TreePage
      v-else-if="mode === 'tree'"
      :schema="schema"
      @detail="onDetail"
    />
    <CrudPage v-else :schema="schema" @detail="onDetail" />
  </div>
</template>

<style scoped>
/* 全出血页：自身承担内边距，页面壳在下方自由伸展。 */
.ui-run { min-width: 0; height: 100%; min-height: 0; padding: 16px 20px 20px; overflow: auto; gap: 12px; }
.ui-run__bar { align-items: center; }
.ui-run__bar h1 { font-size: 18px; }
</style>
