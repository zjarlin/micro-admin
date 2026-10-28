<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, TrendCharts } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { formatDateTime } from '@/shared/format'
import { useSessionStore } from '@/stores/session'
import { getKernel } from '@/router'

interface DashboardData {
  metrics: Array<{ label: string; value: number; unit: string; delta: number; trend: 'up' | 'down' }>
  trend: number[]
  distribution: Array<{ label: string; value: number }>
  notices: Array<{ id: number; title: string; type: string; author: string; publishedAt: string }>
  recentOperations: Array<{ id: number; module: string; action: string; operator: string; status: string; createdAt: string }>
  updatedAt: string
}

const http = useService<HttpClient>('http')
const session = useSessionStore()
const router = useRouter()
const data = ref<DashboardData | null>(null)
const loading = ref(true)
const slots = computed(() => getKernel()?.slotContributions('dashboard:after-metrics') ?? [])
const maxTrend = computed(() => Math.max(...(data.value?.trend ?? [1])))
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '上午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

onMounted(async () => {
  try {
    data.value = await http.request<DashboardData>('/dashboard/overview')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page dashboard">
    <div class="hero">
      <div class="hero-copy">
        <p class="eyebrow">OVERVIEW · {{ new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) }}</p>
        <h1>{{ greeting }}，{{ session.displayName }}</h1>
        <p>当前登录角色为 <strong>{{ session.user?.roles.join(' / ') }}</strong>。控制台由 <code>core-admin</code> 插件提供，所有卡片与页面都可在插件中心按需启停。</p>
        <div class="hero-actions">
          <el-button type="primary" @click="router.push('/system/user')">用户管理</el-button>
          <el-button @click="router.push('/plugins')">查看插件拓扑</el-button>
        </div>
      </div>
      <div class="hero-chart" aria-hidden="true">
        <div class="chart-head"><span>近 12 周活跃</span><el-icon><TrendCharts /></el-icon></div>
        <div class="bars">
          <i v-for="(value, index) in (data?.trend ?? [])" :key="index" :style="{ height: `${Math.max(12, (value / maxTrend) * 100)}%` }" />
        </div>
      </div>
    </div>

    <el-skeleton v-if="loading" :rows="6" animated />
    <template v-else-if="data">
      <div class="metric-grid">
        <article v-for="metric in data.metrics" :key="metric.label" class="metric-card">
          <span>{{ metric.label }}</span>
          <strong>{{ metric.value }}<small class="unit">{{ metric.unit }}</small></strong>
          <small :class="metric.trend === 'up' ? 'up' : 'down'">
            {{ metric.delta > 0 ? '+' : '' }}{{ metric.delta }}% 较上周
          </small>
        </article>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-title">
            <h2>部门人员分布</h2>
            <span>按在职账号统计</span>
          </div>
          <ul class="distribution">
            <li v-for="item in data.distribution" :key="item.label">
              <div class="distribution-label"><span>{{ item.label }}</span><strong>{{ item.value }}%</strong></div>
              <div class="distribution-track"><i :style="{ width: `${item.value}%` }" /></div>
            </li>
          </ul>
        </section>

        <section class="panel">
          <div class="panel-title">
            <h2>通知公告</h2>
            <el-button text type="primary" @click="router.push('/system/notice')">全部 <el-icon><ArrowRight /></el-icon></el-button>
          </div>
          <ul class="notice-list">
            <li v-for="notice in data.notices" :key="notice.id">
              <el-tag :type="notice.type === 'announcement' ? 'warning' : 'info'" size="small" effect="plain">
                {{ notice.type === 'announcement' ? '公告' : '通知' }}
              </el-tag>
              <div><strong>{{ notice.title }}</strong><span>{{ notice.author }} · {{ formatDateTime(notice.publishedAt) }}</span></div>
            </li>
          </ul>
        </section>
      </div>

      <section class="panel">
        <div class="panel-title">
          <h2>最近操作</h2>
          <span>最新 6 条审计记录</span>
        </div>
        <el-table :data="data.recentOperations" size="small">
          <el-table-column prop="module" label="模块" width="120" />
          <el-table-column prop="action" label="操作" width="90" />
          <el-table-column prop="operator" label="操作人" width="110" />
          <el-table-column label="时间" min-width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }"><el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">{{ row.status === 'success' ? '成功' : '失败' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </section>

      <section class="plugin-slots">
        <component :is="slot.component" v-for="slot in slots" :key="slot.id" />
      </section>
      <p class="update-time">数据更新时间：{{ formatDateTime(data.updatedAt) }}</p>
    </template>
  </div>
</template>

<style scoped>
.hero { position: relative; overflow: hidden; border-radius: 20px; padding: 34px; background: linear-gradient(120deg, #0f172a 0%, #152a4a 60%, #0e3a52 100%); color: #e6eef9; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(240px, .7fr); gap: 30px; }
.hero::after { content: ''; position: absolute; inset: auto -100px -160px auto; width: 360px; height: 360px; border-radius: 50%; border: 1px solid rgba(125,211,252,.22); box-shadow: 0 0 0 60px rgba(125,211,252,.05); }
.eyebrow { margin: 0; color: #7dd3fc; font-size: 11px; letter-spacing: .16em; font-weight: 700; }
.hero h1 { margin: 12px 0 12px; font-size: clamp(28px, 3vw, 38px); letter-spacing: -.03em; }
.hero-copy > p:not(.eyebrow) { margin: 0; color: #a8b8cd; font-size: 14px; line-height: 1.8; max-width: 66ch; }
.hero-copy strong { color: #e6eef9; }
.hero-copy code, .health-note code { background: rgba(148,163,184,.18); border-radius: 4px; padding: 1px 5px; }
.hero-actions { display: flex; gap: 10px; margin-top: 22px; }
.hero-chart { align-self: stretch; background: rgba(15,23,42,.45); border: 1px solid rgba(125,211,252,.14); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; }
.chart-head { display: flex; justify-content: space-between; align-items: center; color: #93a6bd; font-size: 12px; }
.bars { flex: 1; display: flex; align-items: flex-end; gap: 6px; padding-top: 18px; min-height: 110px; }
.bars i { flex: 1; border-radius: 4px 4px 2px 2px; background: linear-gradient(180deg, #38bdf8, #2563eb); opacity: .82; min-height: 8px; }
.dashboard-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 16px; }
.distribution { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.distribution-label { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); margin-bottom: 7px; }
.distribution-label strong { color: var(--app-text); }
.distribution-track { height: 7px; border-radius: 99px; background: var(--surface-soft); overflow: hidden; }
.distribution-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #22d3ee); }
.notice-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.notice-list li { display: flex; gap: 10px; align-items: flex-start; }
.notice-list div { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.notice-list strong { font-size: 13px; color: var(--app-text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notice-list span { color: var(--muted); font-size: 11px; }
.unit { font-size: 12px; font-weight: 500; color: var(--muted); margin-left: 3px; }
.metric-card small.up { color: #12b76a; }
.metric-card small.down { color: #f04438; }
.plugin-slots { display: grid; gap: 16px; }
.update-time { margin: 0; text-align: right; color: var(--muted); font-size: 11px; }
@media (max-width: 1080px) { .hero { grid-template-columns: 1fr; } .dashboard-grid { grid-template-columns: 1fr; } }
</style>
