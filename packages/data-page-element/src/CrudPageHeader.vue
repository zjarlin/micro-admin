<script setup lang="ts">
// 页面头部：标题 + 说明 + 页面级按钮（导出 / 新增）。
//
// CrudPage 与设计器画布共用这一份：画布上的页头就是运行页的页头，
// 不再各自画一遍（按钮文案、图标、顺序、权限判断全部同源）。
import { Download, Plus } from '@element-plus/icons-vue'
import type { CrudPageSchema } from '@zjarlin/data-page'
import HelpHint from './HelpHint.vue'

defineProps<{
  schema: CrudPageSchema
  canAdd?: boolean
  canExport?: boolean
}>()

const emit = defineEmits<{
  (event: 'export'): void
  (event: 'create'): void
}>()
</script>

<template>
  <header class="page-head">
    <div class="crud-head">
      <h1>{{ schema.title }}<HelpHint :text="schema.description" :label="schema.title" /></h1>
    </div>
    <div class="page-actions">
      <el-button v-if="canExport" :icon="Download" @click="emit('export')">导出</el-button>
      <el-button v-if="canAdd" type="primary" :icon="Plus" @click="emit('create')">新增{{ schema.entity ?? '记录' }}</el-button>
    </div>
  </header>
</template>

<style scoped>
.crud-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.crud-head h1 { display: inline-flex; align-items: center; gap: 4px; margin: 0; }
</style>
