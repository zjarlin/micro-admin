<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Bell, Close, Fold, FullScreen, Moon, Setting, Sunny, SwitchButton } from '@element-plus/icons-vue'
import { getKernel } from '@/router'
import { useSessionStore } from '@/stores/session'
import { useKernelStore } from '@/stores/kernel'
import { useUiStore } from '@/stores/ui'
import { initialsOf } from '@/shared/format'
import { AppFrame } from '@addzero/app-frame'
import TagsView from '@/components/shell/TagsView.vue'
import LayoutSettingsPanel from '@/components/shell/LayoutSettingsPanel.vue'
import SlotHost from '@/components/shell/SlotHost.vue'
import { RIGHT_PANEL_HOST_ID, appLayout, closeRightPanel, openRightPanel, useRightPanel } from '@/shared/shell'
import { useTabsStore } from '@/stores/tabs'
import { applyTheme, useTheme } from '@/shared/theme'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const ui = useUiStore()

// 三栏框架：几何与面板导航由 @addzero/app-frame 持有（与 dsh 的 ctx.layout 同形）。
// 服务放在 @/shared/shell 里而不是这里，页面要开右栏时拿的是同一份实例。
const layout = appLayout
const rightPanel = useRightPanel()
const tabs = useTabsStore()

const kernelStore = useKernelStore()
const booted = ref(true)

const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : '工作台'))

/**
 * 全出血页面：设计器、运行预览这类「画布要吃满视口」的页面，
 * 不要外壳的 28px 边距与滚动条——滚动交给页面自己，否则画布永远少一截。
 */
const fullBleed = computed(() => route.meta.fullBleed === true)

onMounted(() => {
  const kernel = getKernel()
  if (kernel) kernelStore.attach(kernel)
})

// 标签页与路由同源：进入即登记（隐藏页如个人中心也允许），标题取路由 meta。
watch(
  () => route.fullPath,
  () => {
    if (typeof route.name === 'string' && route.name === 'not-found') return
    tabs.add({ path: route.path, title: pageTitle.value })
  },
  { immediate: true },
)

/** 布局设置与页面检查器共用右栏：再点一次即关闭。 */
function toggleLayoutPanel(): void {
  if (rightPanel.active?.id === 'shell.layout') {
    closeRightPanel('shell.layout')
    return
  }
  openRightPanel({ id: 'shell.layout', title: '布局设置', hint: '三栏几何与面板偏好' })
}

async function logout(): Promise<void> {
  await ElMessageBox.confirm('确定退出当前账号吗？', '退出登录', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' })
  await session.logout()
  await router.replace('/login')
}

const theme = useTheme()

function toggleTheme(): void {
  ui.toggleDark()
  // 深色模式不使用主题里的背景/文字色，但品牌色与圆角密度照旧生效。
  applyTheme(theme.value, ui.dark)
}
</script>

<template>
  <AppFrame :layout="layout">
    <!-- 侧栏整个是插件（`sidebar`）：外壳只声明槽位，品牌/搜索/折叠树/收起都在插件里。
         停用该插件时这里只剩一段最小占位，不会出现「外壳自己画菜单」的第二套实现。 -->
    <template #sidebar="{ collapsed, toggle }">
      <SlotHost name="shell:sidebar" :bind="{ collapsed, toggle }">
        <!-- 侧栏插件被停用时的兜底：保留轨道与品牌位，不自己重画菜单。 -->
        <aside class="sidebar-fallback" :class="{ 'is-collapsed': collapsed }">
          <div class="sidebar-fallback__logo">MK</div>
          <p v-if="!collapsed" class="sidebar-fallback__hint">侧栏插件未启用</p>
        </aside>
      </SlotHost>
    </template>

    <template #default="{ toggleSidebar: toggle }">
    <div class="main-area">
      <header class="topbar">
        <div class="topbar-left">
          <el-button circle text @click="toggle">
            <el-icon :size="18"><Fold /></el-icon>
          </el-button>
          <!-- 全出血页（设计器/运行预览）自带标题与状态，这里不再重复一条面包屑：
                IDE 型页面每一像素都要还给画布。 -->
          <div v-if="!fullBleed" class="breadcrumb">
            <span>控制台</span>
            <i>/</i>
            <strong>{{ pageTitle }}</strong>
          </div>
        </div>

        <div class="topbar-right">
          <!-- 顶栏动作槽位：全站级入口放这里（例如页面助手的 AI 图标）。
               外壳只声明位置，具体按钮由插件贡献；停用插件即整块消失。 -->
          <SlotHost name="shell:topbar-actions" />
          <el-tooltip content="布局设置" placement="bottom">
            <el-button circle text @click="toggleLayoutPanel">
              <el-icon :size="17"><Setting /></el-icon>
            </el-button>
          </el-tooltip>
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

      <TagsView />

      <main class="content-area" :class="{ 'is-full-bleed': fullBleed }">
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
    </template>

    <!-- 右栏：外壳出标题栏与内容宿主，页面用 Teleport 把检查器/属性面板投进来。 -->
    <template #rightbar="{ fullscreen }">
      <div class="shell-rightbar">
        <header class="shell-rightbar__head">
          <div class="shell-rightbar__title">
            <strong>{{ rightPanel.active?.title ?? '右侧面板' }}</strong>
            <small v-if="rightPanel.active?.hint">{{ rightPanel.active.hint }}</small>
          </div>
          <div class="shell-rightbar__tools">
            <el-tooltip :content="fullscreen ? '退出全屏' : '全屏'" placement="bottom">
              <el-button circle text @click="layout.openRightbar(true, !fullscreen)">
                <el-icon :size="16"><FullScreen /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip content="关闭右侧面板" placement="bottom">
              <el-button circle text @click="closeRightPanel()">
                <el-icon :size="16"><Close /></el-icon>
              </el-button>
            </el-tooltip>
          </div>
        </header>
        <!-- 布局设置占用整条右栏：宿主容器让位（display:none），否则 flex:1 会把设置面板推到最底部。 -->
        <div
          :id="RIGHT_PANEL_HOST_ID"
          class="shell-rightbar__body"
          :class="{ 'is-stashed': rightPanel.active?.id === 'shell.layout' }"
        ></div>
        <LayoutSettingsPanel v-if="rightPanel.active?.id === 'shell.layout'" />
        <p v-else-if="!rightPanel.active" class="shell-rightbar__empty">
          选中画布图元、打开通用页面详情时，面板会出现在这里。
        </p>
      </div>
    </template>
  </AppFrame>
</template>

<style scoped>
/* 侧栏插件停用时的兜底样式（深色轨道 + 品牌方块），与插件内部视觉一致。 */
.sidebar-fallback { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 20px 12px; background: var(--sidebar-bg); }
.sidebar-fallback__logo { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; background: linear-gradient(135deg, var(--brand), var(--accent)); color: #08111d; font-weight: 900; }
.sidebar-fallback__hint { margin: 0; font-size: 12px; color: var(--sidebar-muted); text-align: center; }
/* 宽度由 @addzero/app-frame 的列求解决定，这里只负责把内容填满所在轨道。 */
/* 中栏宽度由布局服务求解（右栏一开就让位），所以响应式按「容器宽度」判断，
   而不是按视口——视口 1600px 时中栏可能只有 880px。 */
.main-area { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; container-type: inline-size; container-name: shell; }
.topbar { height: 76px; flex: 0 0 76px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 28px; background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 15; backdrop-filter: blur(12px); }
.topbar-left, .topbar-right { display: flex; align-items: center; gap: 12px; min-width: 0; }
.breadcrumb { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--muted); white-space: nowrap; }
.breadcrumb i { font-style: normal; color: var(--line-strong); }
.breadcrumb strong { color: var(--app-text); font-weight: 600; }
.user-chip { display: flex; align-items: center; gap: 9px; background: transparent; border: 0; cursor: pointer; padding: 4px 6px; border-radius: 9px; }
.user-chip:hover { background: var(--hover); }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: #0f172a; color: white; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
.user-meta { display: flex; flex-direction: column; text-align: left; line-height: 1.25; min-width: 0; }
.user-meta strong, .user-meta small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 128px; }
.breadcrumb { min-width: 0; }
.breadcrumb strong { overflow: hidden; text-overflow: ellipsis; }
.topbar-left { flex: 1 1 auto; }
.user-meta strong { color: var(--app-text); font-size: 13px; }
.user-meta small { color: var(--muted); font-size: 11px; }
/* 内容区：铺满剩余高度、只在自身内部滚动，与侧栏底边严格对齐。 */
.content-area { flex: 1 1 auto; min-height: 0; min-width: 0; padding: 28px; overflow: auto; overscroll-behavior: contain; }
/* 全出血：去掉内边距并禁止外层滚动，页面内部自己排版（画布/IDE 型页面）。 */
.content-area.is-full-bleed { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.content-area.is-full-bleed > * { flex: 1 1 auto; min-height: 0; }
.shell-rightbar { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; overflow: hidden; }
.shell-rightbar__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 14px 14px 12px 16px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 2; }
.shell-rightbar__title { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.shell-rightbar__title strong { font-size: 14px; color: var(--app-text); }
.shell-rightbar__title small { font-size: 11px; color: var(--muted); }
.shell-rightbar__tools { display: flex; align-items: center; gap: 2px; flex: none; }
.shell-rightbar__body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.shell-rightbar__body.is-stashed { display: none; }
.shell-rightbar__empty { margin: 0; padding: 20px 16px; font-size: 12px; line-height: 1.8; color: var(--muted); }
.page-skeleton { background: var(--surface); padding: 24px; border-radius: 16px; }
.page-fade-enter-active, .page-fade-leave-active { transition: opacity .16s ease, transform .16s ease; }
.page-fade-enter-from { opacity: 0; transform: translateY(5px); }
.page-fade-leave-to { opacity: 0; }
/* 容器查询：右栏占轨道时中栏变窄，先收用户部门，最后只留面包屑。 */
@container shell (max-width: 860px) { .user-meta { display: none; } .breadcrumb span, .breadcrumb i { display: none; } }
@media (max-width: 760px) { .topbar { padding: 0 16px; } .content-area { padding: 16px; } }
</style>
