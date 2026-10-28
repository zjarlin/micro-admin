<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  ArrowLeftBold, ArrowRightBold, Bell, Expand, Fold, Grid, Moon, Search, Sunny, SwitchButton,
} from '@element-plus/icons-vue'
import { filterByPermission, type MenuContribution } from '@/kernel'
import { getKernel } from '@/router'
import { useSessionStore } from '@/stores/session'
import { useKernelStore } from '@/stores/kernel'
import { useUiStore } from '@/stores/ui'
import { initialsOf } from '@/shared/format'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const ui = useUiStore()
const kernelStore = useKernelStore()
const booted = ref(true)
const quickSearch = ref('')

const groups = computed(() => {
  const kernel = getKernel()
  if (!kernel) return [] as Array<{ name: string; items: MenuContribution[] }>
  const enabled = new Set(kernelStore.statuses.filter((item) => item.enabled).map((item) => item.id))
  const menus = filterByPermission(
    kernel.menuContributions().filter((menu) => !menu.pluginId || enabled.has(menu.pluginId)),
    session.permissions,
  )
  const order = ['概览', '系统管理', '系统工具', '系统监控']
  const bucket = new Map<string, MenuContribution[]>()
  for (const menu of menus) {
    const key = menu.group ?? '其他'
    bucket.set(key, [...(bucket.get(key) ?? []), menu])
  }
  return [...bucket.entries()]
    .sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
    .map(([name, items]) => ({ name, items }))
})

const filteredGroups = computed(() => {
  const keyword = quickSearch.value.trim().toLowerCase()
  if (!keyword) return groups.value
  return groups.value
    .map((group) => ({ ...group, items: group.items.filter((item) => item.title.toLowerCase().includes(keyword)) }))
    .filter((group) => group.items.length > 0)
})

const activeMenu = computed(() => route.path)
const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : '工作台'))
const enabledPlugins = computed(() => kernelStore.statuses.filter((item) => item.enabled).length)

onMounted(() => {
  const kernel = getKernel()
  if (kernel) kernelStore.attach(kernel)
})

async function logout(): Promise<void> {
  await ElMessageBox.confirm('确定退出当前账号吗？', '退出登录', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' })
  await session.logout()
  await router.replace('/login')
}

function toggleTheme(): void {
  ui.toggleDark()
}
</script>

<template>
  <div class="admin-shell" :class="{ 'is-collapsed': ui.collapsed }">
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="logo">MA</div>
        <div v-show="!ui.collapsed" class="logo-text">
          <strong>Micro Admin</strong>
          <span>微内核控制台</span>
        </div>
      </div>

      <el-scrollbar class="sidebar-scroll">
        <nav class="menu-nav" aria-label="主导航">
          <section v-for="group in filteredGroups" :key="group.name" class="menu-group">
            <p v-show="!ui.collapsed" class="menu-group-title">{{ group.name }}</p>
            <router-link
              v-for="item in group.items"
              :key="item.id"
              :to="item.path"
              class="menu-item"
              :class="{ active: activeMenu === item.path }"
              :title="ui.collapsed ? item.title : undefined"
            >
              <el-icon :size="18"><component :is="item.icon ?? 'Menu'" /></el-icon>
              <span v-show="!ui.collapsed" class="menu-label">{{ item.title }}</span>
              <span v-if="item.badge && !ui.collapsed" class="menu-badge">{{ item.badge }}</span>
            </router-link>
          </section>
          <p v-if="filteredGroups.length === 0" class="menu-empty">没有匹配的菜单</p>
        </nav>
      </el-scrollbar>

      <div class="sidebar-foot">
        <button class="collapse-button" type="button" @click="ui.toggleSidebar">
          <el-icon><ArrowRightBold v-if="ui.collapsed" /><ArrowLeftBold v-else /></el-icon>
          <span v-show="!ui.collapsed">收起侧栏</span>
        </button>
      </div>
    </aside>

    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <el-button circle text @click="ui.toggleSidebar">
            <el-icon :size="18"><Expand v-if="ui.collapsed" /><Fold v-else /></el-icon>
          </el-button>
          <div class="breadcrumb">
            <span>控制台</span>
            <i>/</i>
            <strong>{{ pageTitle }}</strong>
          </div>
        </div>

        <div class="topbar-right">
          <el-input v-model="quickSearch" class="menu-search" placeholder="搜索菜单" :prefix-icon="Search" clearable />
          <router-link to="/plugins" class="plugin-pill" title="插件中心">
            <el-icon><Grid /></el-icon>
            <span>{{ enabledPlugins }} 个插件运行中</span>
          </router-link>
          <el-tooltip :content="ui.dark ? '切换浅色' : '切换深色'" placement="bottom">
            <el-button circle text @click="toggleTheme">
              <el-icon :size="17"><Sunny v-if="ui.dark" /><Moon v-else /></el-icon>
            </el-button>
          </el-tooltip>
          <el-tooltip content="通知公告" placement="bottom">
            <el-button circle text @click="router.push('/system/notice')">
              <el-badge is-dot type="danger"><el-icon :size="17"><Bell /></el-icon></el-badge>
            </el-button>
          </el-tooltip>
          <el-dropdown trigger="click">
            <button class="user-chip" type="button">
              <span class="avatar">{{ initialsOf(session.displayName) }}</span>
              <span class="user-meta">
                <strong>{{ session.displayName }}</strong>
                <small>{{ session.user?.department ?? '未分配部门' }}</small>
              </span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/profile')">个人中心</el-dropdown-item>
                <el-dropdown-item @click="router.push('/plugins')">插件中心</el-dropdown-item>
                <el-dropdown-item divided @click="logout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="content-area">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" v-if="booted" :key="route.path" />
            <div v-else class="page-skeleton">
              <el-skeleton :rows="5" animated />
            </div>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell { min-height: 100vh; display: flex; background: var(--app-bg); color: var(--app-text); }
.sidebar { width: 248px; flex: 0 0 248px; background: #0f172a; color: #cbd5e1; display: flex; flex-direction: column; transition: width .22s ease, flex-basis .22s ease; position: sticky; top: 0; height: 100vh; z-index: 20; }
.is-collapsed .sidebar { width: 76px; flex-basis: 76px; }
.sidebar-head { height: 76px; display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: 1px solid rgba(148,163,184,.12); }
.is-collapsed .sidebar-head { padding: 0 16px; justify-content: center; }
.logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #08111d; font-weight: 900; flex: 0 0 38px; }
.logo-text { display: flex; flex-direction: column; line-height: 1.25; }
.logo-text strong { color: #f8fafc; font-size: 14px; letter-spacing: .01em; }
.logo-text span { color: #7d8da4; font-size: 11px; }
.sidebar-scroll { flex: 1; min-height: 0; }
.menu-nav { padding: 18px 12px 24px; }
.menu-group { margin-bottom: 18px; }
.menu-group-title { margin: 0 0 8px; padding: 0 12px; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: #64748b; font-weight: 700; }
.menu-item { position: relative; display: flex; align-items: center; gap: 11px; min-height: 40px; padding: 0 12px; border-radius: 9px; color: #a9b6c9; text-decoration: none; transition: background .18s ease, color .18s ease; }
.menu-item + .menu-item { margin-top: 2px; }
.menu-item:hover { background: rgba(148,163,184,.09); color: #f1f5f9; }
.menu-item.active { background: linear-gradient(90deg, rgba(59,130,246,.22), rgba(34,211,238,.07)); color: #f8fafc; }
.menu-item.active::before { content: ''; position: absolute; left: 0; top: 11px; bottom: 11px; width: 2px; border-radius: 2px; background: #38bdf8; }
.is-collapsed .menu-item { justify-content: center; padding: 0; }
.menu-label { white-space: nowrap; font-size: 13px; }
.menu-badge { margin-left: auto; background: #1d4ed8; color: white; font-size: 10px; padding: 2px 6px; border-radius: 999px; }
.menu-empty { color: #64748b; font-size: 12px; padding: 0 12px; }
.sidebar-foot { border-top: 1px solid rgba(148,163,184,.12); padding: 12px; }
.collapse-button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; height: 38px; border: 0; border-radius: 9px; background: rgba(148,163,184,.08); color: #94a3b8; cursor: pointer; font-size: 12px; }
.collapse-button:hover { background: rgba(148,163,184,.14); color: #e2e8f0; }
.main-area { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.topbar { height: 76px; flex: 0 0 76px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 28px; background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 15; backdrop-filter: blur(12px); }
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 12px; min-width: 0; }
.breadcrumb { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--muted); white-space: nowrap; }
.breadcrumb i { font-style: normal; color: var(--line-strong); }
.breadcrumb strong { color: var(--app-text); font-weight: 600; }
.menu-search { width: 190px; }
.plugin-pill { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 12px; text-decoration: none; white-space: nowrap; }
.plugin-pill:hover { color: #2563eb; border-color: #bfdbfe; background: #eff6ff; }
.user-chip { display: flex; align-items: center; gap: 9px; background: transparent; border: 0; cursor: pointer; padding: 4px 6px; border-radius: 9px; }
.user-chip:hover { background: var(--hover); }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: #0f172a; color: white; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
.user-meta { display: flex; flex-direction: column; text-align: left; line-height: 1.25; }
.user-meta strong { color: var(--app-text); font-size: 13px; }
.user-meta small { color: var(--muted); font-size: 11px; }
.content-area { flex: 1; padding: 28px; min-width: 0; }
.page-skeleton { background: var(--surface); padding: 24px; border-radius: 16px; }
.page-fade-enter-active, .page-fade-leave-active { transition: opacity .16s ease, transform .16s ease; }
.page-fade-enter-from { opacity: 0; transform: translateY(5px); }
.page-fade-leave-to { opacity: 0; }
@media (max-width: 1100px) { .menu-search { display: none; } .plugin-pill span { display: none; } }
@media (max-width: 760px) { .sidebar { position: fixed; left: 0; top: 0; } .is-collapsed .sidebar { transform: translateX(-100%); } .topbar { padding: 0 16px; } .content-area { padding: 16px; } .breadcrumb span, .breadcrumb i { display: none; } .user-meta { display: none; } }
</style>
