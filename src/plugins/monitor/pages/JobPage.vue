<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import { formatDateTime } from '@/shared/format'
import type { Job } from '@/shared/types'

const http = useService<HttpClient>('http')
const crud = useCrud<Job>(http, { endpoint: '/monitor/jobs' })
onMounted(() => void crud.load())

async function toggle(row: Job): Promise<void> {
  try {
    await http.request<Job>(`/monitor/jobs/${row.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: row.status === 'running' ? 'paused' : 'running' }),
    })
    ElMessage.success(row.status === 'running' ? '任务已暂停' : '任务已恢复')
    await crud.load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>定时任务</h1><p>展示 cron 表达式、上次与下次执行时间。暂停/恢复会写入演示数据。</p></div><el-button type="primary">新增任务</el-button></header>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索任务名称或分组" :prefix-icon="Search" clearable @keyup.enter="crud.search" />
        <el-button type="primary" @click="crud.search">查询</el-button>
      </div>
      <el-table v-loading="crud.loading" :data="crud.rows">
        <el-table-column prop="name" label="任务名称" min-width="170" />
        <el-table-column prop="group" label="分组" width="120" />
        <el-table-column prop="target" label="调用目标" min-width="180"><template #default="{ row }"><code class="mono">{{ row.target }}</code></template></el-table-column>
        <el-table-column prop="cron" label="cron" width="150"><template #default="{ row }"><code class="mono">{{ row.cron }}</code></template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'running' ? 'success' : 'info'" size="small">{{ row.status === 'running' ? '运行中' : '已暂停' }}</el-tag></template></el-table-column>
        <el-table-column label="下次执行" width="170"><template #default="{ row }">{{ formatDateTime(row.nextRunAt) }}</template></el-table-column>
        <el-table-column label="操作" width="150"><template #default="{ row }"><el-button link type="primary" @click="toggle(row)">{{ row.status === 'running' ? '暂停' : '恢复' }}</el-button><el-button link type="primary">执行一次</el-button></template></el-table-column>
      </el-table>
      <div class="table-footer"><el-pagination :current-page="crud.page" :page-size="crud.pageSize" :total="crud.total" layout="total, prev, pager, next" @current-change="crud.changePage" /></div>
    </section>
  </div>
</template>
