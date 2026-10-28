<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { ServerMetric } from '@/shared/types'
import { formatDateTime } from '@/shared/format'

const http = useService<HttpClient>('http')
const metric = ref<ServerMetric | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try { metric.value = await http.request<ServerMetric>('/monitor/server') } finally { loading.value = false }
}
onMounted(() => void load())
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>服务监控</h1><p>主机与运行时资源快照。真实部署时可替换为 Prometheus 或系统探针接口。</p></div><el-button @click="load">刷新</el-button></header>
    <el-skeleton v-if="loading && !metric" :rows="5" animated />
    <template v-else-if="metric">
      <div class="metric-grid">
        <article class="metric-card"><span>CPU 使用率</span><strong>{{ metric.cpu }}<small class="unit">%</small></strong><el-progress :percentage="metric.cpu" :show-text="false" :stroke-width="6" status="success" /></article>
        <article class="metric-card"><span>内存使用率</span><strong>{{ metric.memory }}<small class="unit">%</small></strong><el-progress :percentage="metric.memory" :show-text="false" :stroke-width="6" /></article>
        <article class="metric-card"><span>磁盘使用率</span><strong>{{ metric.disk }}<small class="unit">%</small></strong><el-progress :percentage="metric.disk" :show-text="false" :stroke-width="6" status="warning" /></article>
        <article class="metric-card"><span>系统负载</span><strong class="load">{{ metric.load.join(' / ') }}</strong><small>1 / 5 / 15 分钟</small></article>
      </div>
      <div class="server-grid">
        <section class="panel">
          <div class="panel-title"><h2>主机信息</h2><span>{{ formatDateTime(metric.updatedAt) }}</span></div>
          <dl class="server-dl">
            <dt>主机名</dt><dd>{{ metric.host }}</dd>
            <dt>操作系统</dt><dd>{{ metric.os }}</dd>
            <dt>运行时长</dt><dd>{{ metric.uptime }}</dd>
          </dl>
        </section>
        <section class="panel">
          <div class="panel-title"><h2>运行提示</h2></div>
          <ul class="tips">
            <li>CPU 与内存为采样值，不用于容量承诺。</li>
            <li>磁盘阈值 80% 时应触发告警。</li>
            <li>本页由 <code>monitor</code> 插件独立贡献。</li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.unit { font-size: 12px; margin-left: 3px; color: var(--muted); }
.load { font-size: 20px; }
.metric-card :deep(.el-progress) { margin-top: 14px; }
.server-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.server-dl { margin: 0; display: grid; grid-template-columns: 90px 1fr; gap: 12px; font-size: 13px; }
.server-dl dt { color: var(--muted); }
.server-dl dd { margin: 0; }
.tips { margin: 0; padding-left: 18px; color: var(--muted); font-size: 13px; line-height: 2; }
@media (max-width: 900px) { .server-grid { grid-template-columns: 1fr; } }
</style>
