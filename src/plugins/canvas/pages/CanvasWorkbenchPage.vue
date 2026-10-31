<script setup lang="ts">
// 画布工作台：一条页签 + 一块吃满视口的舞台。
//
// 页签不是宿主写死的清单，而是 `canvas:tab` 槽位的贡献：谁提供画布页面谁登记一条，
// 停用插件页签即消失。切换用 `v-show` 而不是 `v-if`——画布上未保存的修改、
// 拖好的缩放与选中的图元都要留住，切回去还是原来那一页。
//
// 当前页签落在 `?tab=`：深链接、刷新、浏览器前进后退都能复现同一个视图；
// 老地址（`/scada/gallery` 等）由各插件注册成带查询串的 redirect 跳到对应页签。
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getKernel } from '@/router'
import { useKernelStore } from '@/stores/kernel'
import { useSessionStore } from '@/stores/session'
import { filterByPermission, type SlotContribution } from '@/kernel'

const route = useRoute()
const router = useRouter()
const kernelStore = useKernelStore()
const session = useSessionStore()

/** 页签贡献：只认启用的插件，与侧栏菜单同一套过滤规则。 */
const tabs = computed<SlotContribution[]>(() => {
  const kernel = getKernel()
  if (!kernel) return []
  void kernelStore.statuses
  const enabled = new Set(kernelStore.statuses.filter((item) => item.enabled).map((item) => item.id))
  return filterByPermission(
    kernel.slotContributions('canvas:tab').filter((slot) => !slot.pluginId || enabled.has(slot.pluginId)),
    session.permissions,
  )
})

const activeId = ref('')

/** 地址栏里的 `?tab=` 是唯一真相；没有或指向不存在的页签时回落到第一个。 */
function resolveTab(): string {
  const wanted = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (wanted && tabs.value.some((tab) => tab.id === wanted)) return wanted
  return tabs.value[0]?.id ?? ''
}

watch([tabs, () => route.query.tab], () => {
  const next = resolveTab()
  if (next !== activeId.value) activeId.value = next
}, { immediate: true })

function select(id: string): void {
  if (id === activeId.value) return
  // 切页签保留同一屏上的其它查询参数（screenId / id），组态与 3D 才能看着同一张画面。
  void router.replace({ path: '/canvas', query: { ...route.query, tab: id } })
}

/** 已挂载过的页签：首次点开才渲染，之后用 v-show 留住状态。 */
const mounted = ref<Set<string>>(new Set())
watch(activeId, (id) => {
  if (id) mounted.value = new Set([...mounted.value, id])
}, { immediate: true })
</script>

<template>
  <div class="canvas-workbench">
    <nav class="canvas-tabs" aria-label="画布视图">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="canvas-tab"
        :class="{ 'is-active': tab.id === activeId }"
        @click="select(tab.id)"
      >
        <el-icon v-if="tab.icon" :size="14"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.title ?? tab.id }}</span>
      </button>
      <p v-if="!tabs.length" class="canvas-tabs__empty muted">没有可用的画布页面：检查「组态画布」「图纸设计」插件是否启用。</p>
    </nav>

    <div class="canvas-stage">
      <template v-for="tab in tabs" :key="tab.id">
        <div v-if="mounted.has(tab.id)" v-show="tab.id === activeId" class="canvas-pane">
          <component :is="tab.component" />
        </div>
      </template>
      <p v-if="!tabs.length" class="muted canvas-stage__empty">画布页签为空。</p>
    </div>
  </div>
</template>

<style scoped>
/* 一列到底：页签条定高，舞台吃满剩余；滚动交给页面自己。 */
.canvas-workbench { display: flex; flex-direction: column; min-width: 0; min-height: 0; flex: 1 1 auto; height: 100%; background: var(--app-bg); }
.canvas-tabs {
  display: flex; align-items: center; gap: 4px; flex: none;
  padding: 6px 12px 0; background: var(--surface); border-bottom: 1px solid var(--line);
}
.canvas-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; margin-bottom: -1px;
  border: 1px solid transparent; border-bottom-color: transparent; border-radius: 8px 8px 0 0;
  background: transparent; color: var(--muted); font: 500 12px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  cursor: pointer; white-space: nowrap;
}
.canvas-tab:hover { color: var(--app-text); background: var(--hover); }
.canvas-tab.is-active {
  color: var(--brand); border-color: var(--line); border-bottom-color: var(--surface);
  background: var(--surface);
}
.canvas-tabs__empty { margin: 0 0 6px; font-size: 12px; }
.canvas-stage { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
.canvas-pane { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.canvas-pane > * { flex: 1 1 auto; min-height: 0; }
.canvas-stage__empty { padding: 24px; font-size: 12px; }
</style>
