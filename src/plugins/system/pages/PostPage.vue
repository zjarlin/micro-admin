<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { Post } from '@/shared/types'

const http = useService<HttpClient>('http')
const rows = ref<Post[]>([])
const loading = ref(false)
onMounted(async () => {
  loading.value = true
  try { rows.value = await http.request<Post[]>('/system/posts') } finally { loading.value = false }
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>岗位管理</h1><p>维护岗位编码与排序，供用户档案引用。</p></div>
      <el-button type="primary">新增岗位</el-button>
    </header>
    <section class="panel">
      <el-table v-loading="loading" :data="rows">
        <el-table-column prop="name" label="岗位名称" min-width="160" />
        <el-table-column prop="code" label="岗位编码" width="160"><template #default="{ row }"><code class="mono">{{ row.code }}</code></template></el-table-column>
        <el-table-column prop="order" label="排序" width="90" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '正常' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="120"><template #default><el-button link type="primary">编辑</el-button></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>
