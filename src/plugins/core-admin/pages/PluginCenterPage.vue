<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Refresh, Warning } from '@element-plus/icons-vue'
import { useKernelStore } from '@/stores/kernel'
import { getKernel } from '@/router'
import { formatDateTime } from '@/shared/format'

const kernelStore = useKernelStore()
const busy = ref<string | null>(null)
const selected = ref<string | null>(null)

const statuses = computed(() => kernelStore.statuses)
const selectedPlugin = computed(() => statuses.value.find((item) => item.id === selected.value) ?? null)
const topology = computed(() => {
  const kernel = getKernel()
  return kernel ? kernel.order : []
})
const services = computed(() => getKernel()?.serviceTokens() ?? [])
const commands = computed(() => getKernel()?.contextFor('core-admin').commands.list() ?? [])

async function toggle(id: string, enabled: boolean): Promise<void> {
  busy.value = id
  try {
    if (!enabled) {
      await ElMessageBox.confirm('停用后其依赖插件也会被一并停用，确定继续？', '停用插件', { type: 'warning' })
    }
    await kernelStore.toggle(id, enabled)
    ElMessage.success(`${enabled ? '已启用' : '已停用'}插件 ${id}`)
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="page plugin-page">
    <header class="page-head">
      <div>
        <h1>插件中心</h1>
        <p>插件由内核统一发现、按依赖拓扑启动，并通过路由、菜单、服务、命令与槽位向宿主贡献能力。停用插件会同步回收其全部注册项。</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Refresh" @click="kernelStore.refresh()">刷新状态</el-button>
      </div>
    </header>

    <div class="plugin-summary metric-grid">
      <article class="metric-card"><span>已注册</span><strong>{{ statuses.length }}<small class="unit">个</small></strong><small>清单来自 pluginCatalog</small></article>
      <article class="metric-card"><span>运行中</span><strong>{{ statuses.filter((p) => p.enabled).length }}<small class="unit">个</small></strong><small>依赖已满足</small></article>
      <article class="metric-card"><span>服务能力</span><strong>{{ services.length }}<small class="unit">项</small></strong><small>由插件注册到容器</small></article>
      <article class="metric-card"><span>命令</span><strong>{{ commands.length }}<small class="unit">条</small></strong><small>可通过运行时调用</small></article>
    </div>

    <div class="plugin-layout">
      <section class="panel plugin-list">
        <div class="panel-title"><h2>已发现插件</h2><span>点击行查看详情</span></div>
        <button
          v-for="plugin in statuses"
          :key="plugin.id"
          type="button"
          class="plugin-row"
          :class="{ selected: selected === plugin.id }"
          @click="selected = plugin.id"
        >
          <span class="plugin-icon">{{ plugin.name.slice(0, 1) }}</span>
          <span class="plugin-main">
            <strong>{{ plugin.name }} <code>{{ plugin.id }}</code></strong>
            <small>{{ plugin.description }}</small>
            <span class="plugin-deps">
              <span v-for="dep in plugin.requires" :key="dep" class="dep-chip"><el-icon><Connection /></el-icon>{{ dep }}</span>
              <span v-if="plugin.requires.length === 0" class="dep-chip root">根插件</span>
            </span>
          </span>
          <span class="plugin-side">
            <el-tag :type="plugin.enabled ? 'success' : 'info'" size="small">{{ plugin.enabled ? '运行中' : '已停用' }}</el-tag>
            <el-switch
              :model-value="plugin.enabled"
              :loading="busy === plugin.id"
              :disabled="plugin.id === 'core-admin'"
              @click.stop
              @change="(value: string | number | boolean) => toggle(plugin.id, Boolean(value))"
            />
          </span>
        </button>
        <el-empty v-if="statuses.length === 0" description="尚未加载插件" :image-size="70" />
      </section>

      <aside class="panel plugin-detail">
        <template v-if="selectedPlugin">
          <div class="panel-title"><h2>{{ selectedPlugin.name }}</h2><el-tag size="small">{{ selectedPlugin.version }}</el-tag></div>
          <dl>
            <dt>插件 ID</dt><dd class="mono">{{ selectedPlugin.id }}</dd>
            <dt>作者</dt><dd>{{ selectedPlugin.author }}</dd>
            <dt>启动序</dt><dd>#{{ selectedPlugin.order }}</dd>
            <dt>状态</dt><dd>{{ selectedPlugin.enabled ? '运行中' : '已停用' }}</dd>
            <dt>强依赖</dt><dd>{{ selectedPlugin.requires.join(', ') || '无' }}</dd>
            <dt>说明</dt><dd>{{ selectedPlugin.description }}</dd>
          </dl>
          <el-alert v-if="selectedPlugin.error" type="error" :closable="false" show-icon :title="selectedPlugin.error" />
        </template>
        <el-empty v-else description="选择一个插件查看详情" :image-size="64" />
      </aside>
    </div>

    <section class="panel">
      <div class="panel-title"><h2>启动拓扑</h2><span>按依赖顺序执行 setup</span></div>
      <ol class="topology">
        <li v-for="(id, index) in topology" :key="id">
          <span class="topology-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <code>{{ id }}</code>
          <span class="topology-state" :class="{ on: statuses.find((p) => p.id === id)?.enabled }">
            {{ statuses.find((p) => p.id === id)?.enabled ? 'enabled' : 'disabled' }}
          </span>
        </li>
      </ol>
    </section>

    <section class="panel">
      <div class="panel-title"><h2>运行期错误</h2><span>最多保留 20 条</span></div>
      <el-table v-if="kernelStore.recentErrors.length" :data="kernelStore.recentErrors" size="small">
        <el-table-column prop="pluginId" label="插件" width="160" />
        <el-table-column prop="message" label="错误" />
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.at) }}</template>
        </el-table-column>
      </el-table>
      <div v-else class="empty-inline"><el-icon><Warning /></el-icon>当前没有插件运行错误</div>
    </section>
  </div>
</template>

<style scoped>
.plugin-summary small { color: var(--muted); }
.unit { font-size: 12px; margin-left: 3px; color: var(--muted); }
.plugin-layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, .75fr); gap: 16px; }
.plugin-row { width: 100%; display: flex; align-items: flex-start; gap: 14px; padding: 15px 14px; background: transparent; border: 1px solid transparent; border-radius: 12px; text-align: left; cursor: pointer; transition: .18s ease; }
.plugin-row:hover { background: var(--hover); }
.plugin-row.selected { border-color: #bfdbfe; background: #eff6ff; }
.plugin-icon { width: 38px; height: 38px; flex: 0 0 38px; border-radius: 10px; display: grid; place-items: center; background: #0f172a; color: #e2e8f0; font-weight: 700; font-size: 15px; }
.plugin-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.plugin-main strong { color: var(--app-text); font-size: 14px; }
.plugin-main code { margin-left: 6px; color: #2563eb; background: #dbeafe; border-radius: 4px; padding: 1px 5px; font-size: 11px; }
.plugin-main small { color: var(--muted); font-size: 12px; line-height: 1.6; }
.plugin-deps { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; }
.dep-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #475467; background: #f2f4f7; border-radius: 999px; padding: 2px 8px; }
.dep-chip.root { color: #067647; background: #ecfdf3; }
.plugin-side { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; padding-top: 2px; }
.plugin-detail dl { margin: 0; display: grid; grid-template-columns: 72px 1fr; gap: 10px 12px; font-size: 13px; }
.plugin-detail dt { color: var(--muted); }
.plugin-detail dd { margin: 0; color: var(--app-text); word-break: break-word; }
.plugin-detail .el-alert { margin-top: 16px; }
.topology { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.topology li { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--surface-soft); border-radius: 9px; }
.topology-index { color: #94a3b8; font-size: 11px; font-variant-numeric: tabular-nums; }
.topology code { flex: 1; color: var(--app-text); }
.topology-state { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.topology-state.on { color: #067647; }
.empty-inline { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; padding: 6px 2px; }
@media (max-width: 1000px) { .plugin-layout { grid-template-columns: 1fr; } }
</style>
