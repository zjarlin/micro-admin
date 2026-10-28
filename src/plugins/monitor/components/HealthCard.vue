<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { ServerMetric } from '@/shared/types'

const http = useService<HttpClient>('http')
const metric = ref<ServerMetric | null>(null)

onMounted(async () => {
  metric.value = await http.request<ServerMetric>('/monitor/server')
})
</script>

<template>
  <el-card class="health-card" shadow="never">
    <div class="health-head">
      <div>
        <span class="eyebrow">MONITOR PLUGIN</span>
        <h3>服务运行状态</h3>
      </div>
      <el-tag type="success" effect="dark" round>运行中</el-tag>
    </div>
    <el-skeleton v-if="!metric" :rows="1" animated />
    <div v-else class="health-grid">
      <div><span>CPU</span><strong>{{ metric.cpu }}%</strong></div>
      <div><span>内存</span><strong>{{ metric.memory }}%</strong></div>
      <div><span>磁盘</span><strong>{{ metric.disk }}%</strong></div>
      <div><span>负载</span><strong>{{ metric.load.join(' / ') }}</strong></div>
    </div>
    <p class="health-note">这张卡片由 <code>monitor</code> 插件通过 <code>dashboard:after-metrics</code> 槽位注入，无需修改工作台页面。</p>
  </el-card>
</template>

<style scoped>
.health-card { border-radius: 16px; border-color: var(--line); background: var(--surface); }
.health-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
.health-head h3 { margin: 6px 0 0; font-size: 18px; color: var(--app-text); }
.eyebrow { color: var(--muted); font-size: 11px; letter-spacing: .16em; font-weight: 700; }
.health-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.health-grid div { background: var(--surface-soft); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.health-grid span { color: var(--muted); font-size: 12px; }
.health-grid strong { color: var(--app-text); font-size: 20px; }
.health-note { color: var(--muted); font-size: 12px; margin: 16px 0 0; }
code { background: var(--surface-soft); padding: 1px 5px; border-radius: 4px; }
</style>
