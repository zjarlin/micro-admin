<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { formatDateTime } from '@/shared/format'
import type { OnlineSession } from '@/shared/types'

const http = useService<HttpClient>('http')
const rows = ref<OnlineSession[]>([])
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try { rows.value = await http.request<OnlineSession[]>('/monitor/online') } finally { loading.value = false }
}

async function kick(row: OnlineSession): Promise<void> {
  await ElMessageBox.confirm(`强制 ${row.username} 下线？`, '踢出会话', { type: 'warning' })
  await http.request<void>(`/monitor/online/${encodeURIComponent(row.token)}`, { method: 'DELETE' })
  ElMessage.success('会话已移除')
  await load()
}

onMounted(() => void load())
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>在线用户</h1><p>当前活跃会话清单；强制下线只影响所选会话。</p></div><el-button @click="load">刷新</el-button></header>
    <section class="panel">
      <el-table v-loading="loading" :data="rows">
        <el-table-column prop="username" label="用户名" width="140" />
        <el-table-column prop="ip" label="登录 IP" width="140" />
        <el-table-column prop="browser" label="客户端" min-width="180" />
        <el-table-column label="登录时间" width="180"><template #default="{ row }">{{ formatDateTime(row.loginAt) }}</template></el-table-column>
        <el-table-column label="最近活跃" width="180"><template #default="{ row }">{{ formatDateTime(row.lastActiveAt) }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button link type="danger" @click="kick(row)">强制下线</el-button></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>
