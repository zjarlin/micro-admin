<!-- 运行期外壳：读 `/shell/config` 编译出的 `ShellSchema`，把它渲染成真正的后台外壳。
     侧栏品牌/菜单/搜索/收起、顶栏图标行/面包屑/用户区、内容区全部来自 schema——
     改外壳 = 改图纸 + 发布，不再改这个文件。

     内容区用默认插槽接收路由页面（`router-view`），因此「外壳」与「页面」解耦：
     外壳可以从后端下发、可以回滚、可以按角色出不同外壳，而这个组件一行都不用动。

     图标点击动作由 `dispatchShellAction` 执行（跳转/请求/命令/派发/弹窗），
     与画布设计器配的是同一份声明。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { filterByPermission, type MenuContribution } from '@/kernel'
import { getKernel } from '@/router'
import { http } from '@/shared/api'
import { initialsOf } from '@/shared/format'
import { useSessionStore } from '@/stores/session'
import { useKernelStore } from '@/stores/kernel'
import { useUiStore } from '@/stores/ui'
import { useShellStore } from '@/stores/shell'
import { dispatchShellAction } from '@/shared/shell/actions'
import { shellItemClickable, type ShellViewContext, type ShellMenuGroup } from './context'
import ShellElementView from './ShellElementView.vue'

const props = defineProps<{
  /**
   * 外壳 schema 覆盖：运行预览/设计器传本地现编译的 schema，
   * 缺省读运行期 store（已发布外壳，或内置兜底）。同一渲染实现，两处只有数据来源不同。
   */
  override?: import('@/shared/shell').ShellSchema | undefined
}>()

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const ui = useUiStore()
const kernelStore = useKernelStore()
const shell = useShellStore()

const quickSearch = ref('')

const schema = computed(() => props.override ?? shell.active)

/** 菜单分组：与内核菜单贡献同一套装配（插件启用 + 权限过滤 + 分组排序）。 */
const groups = computed<ShellMenuGroup[]>(() => {
  const kernel = getKernel()
  if (!kernel) return []
  const enabled = new Set(kernelStore.statuses.filter((item) => item.enabled).map((item) => item.id))
  const menus = filterByPermission(
    kernel.menuContributions()
      .filter((menu: MenuContribution) => !menu.pluginId || enabled.has(menu.pluginId))
      .filter((menu) => !menu.hidden),
    session.permissions,
  )
  const order = ['概览', '系统管理', '系统工具', '系统监控', '组态与画面']
  const bucket = new Map<string, MenuContribution[]>()
  for (const menu of menus) {
    const key = menu.group ?? '其他'
    bucket.set(key, [...(bucket.get(key) ?? []), menu])
  }
  const keyword = quickSearch.value.trim().toLowerCase()
  return [...bucket.entries()]
    .sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)))
    .map(([name, items]) => ({
      name,
      items: items
        // 目录节点（只有子项、没有 path）不是可点的导航项：侧栏菜单只画叶子页面。
        .filter((item): item is MenuContribution & { path: string } => Boolean(item.path))
        .filter((item) => !keyword || item.title.toLowerCase().includes(keyword))
        .map((item) => ({
          id: item.id,
          title: item.title,
          path: item.path,
          ...(item.icon ? { icon: item.icon } : {}),
          ...(item.badge ? { badge: item.badge } : {}),
        })),
    }))
    .filter((group) => group.items.length > 0)
})

const activeMenu = computed(() => route.path)
const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : '工作台'))
const fullBleed = computed(() => route.meta.fullBleed === true)

/** 渲染上下文：设计器与运行期共用同一形状，这里喂真实数据。 */
const context = computed<ShellViewContext>(() => ({
  mode: 'runtime',
  collapsed: ui.collapsed,
  activePath: activeMenu.value,
  pageTitle: pageTitle.value,
  dark: ui.dark,
  user: {
    name: session.displayName,
    department: session.user?.department ?? '未分配部门',
    initials: initialsOf(session.displayName),
  },
  groups: groups.value,
  keyword: quickSearch.value,
}))

/** 顶栏右排里的用户区不允许被图纸藏掉：它是登录态的唯一出口。 */
const topbarRight = computed(() => schema.value.topbar.right.filter(visible))

/**
 * 内核命令清单（顶栏图标可用性判定用）。
 *
 * 外壳不认识具体插件，只问「这条命令还在不在」；`kernelStore.statuses` 是响应式依赖，
 * 插件在插件中心启停后顶栏图标随之出现/消失，不需要重新加载页面。
 */
const commandNames = computed<readonly string[]>(() => {
  void kernelStore.statuses
  return getKernel()?.contextFor('core-admin')?.commands.list() ?? []
})

/**
 * 图标可见性：权限 + 命令可用性。
 *
 * 顶栏插件入口（页面助手 / 元素定位 / …）由图纸声明为「点击执行某条命令」，
 * 命令随插件启停消失——所以停用插件后图标自然不渲染，外壳不需要为它们维护任何槽位。
 * 未声明命令的图标（兜底）不受影响。
 */
function visible(item: { permission?: string; action?: { kind?: string; params?: Record<string, unknown> } } | undefined): boolean {
  if (!item) return false
  if (!session.can(item.permission)) return false
  const action = item.action
  if (action?.kind === 'command') {
    const name = typeof action.params?.name === 'string' ? action.params.name : ''
    return Boolean(name) && commandNames.value.includes(name)
  }
  return true
}

onMounted(() => {
  const kernel = getKernel()
  if (kernel) kernelStore.attach(kernel)
})

async function logout(): Promise<void> {
  await ElMessageBox.confirm('确定退出当前账号吗？', '退出登录', { type: 'warning', confirmButtonText: '退出', cancelButtonText: '取消' })
  await session.logout()
  await router.replace('/login')
}

/** 图标/收起/用户区点击 → 执行图纸上配的动作；没配动作时按角色兜底。 */
async function onActivate(item: { id: string; role: string; action?: unknown; params?: unknown }, payload?: unknown): Promise<void> {
  const action = item.action as Parameters<typeof dispatchShellAction>[0]
  if (action && action.kind !== 'none') {
    await dispatchShellAction(action, {
      router,
      http,
      emit: (event, data) => getKernel()?.contextFor('core-admin')?.events.emit(event, data),
      command: (name, ...args) => getKernel()?.contextFor('core-admin')?.commands.execute(name, ...args) ?? Promise.resolve(undefined),
    })
    return
  }
  // 没配动作时的角色兜底：内置外壳的老行为，避免「新外壳一发布，收起/主题就失灵」。
  if (item.role === 'collapse') ui.toggleSidebar()
  else if (item.role === 'user') await onUserCommand(payload && typeof payload === 'object' && 'command' in payload ? String((payload as { command: unknown }).command) : '')
  else if (item.role === 'icon') ElMessage.info(`图标「${item.id}」还没有配置点击动作，可在「外壳设计」里配`)
}

async function onUserCommand(command: string): Promise<void> {
  if (command === 'profile') await router.push('/profile')
  else if (command === 'plugins') await router.push('/plugins')
  else if (command === 'logout') await logout()
}
</script>

<template>
  <div class="shell-frame" :class="{ 'is-collapsed': ui.collapsed }">
    <aside
      v-if="schema.sidebar.visible"
      class="shell-sidebar"
      :style="{
        width: `${ui.collapsed ? schema.frame.sidebarCollapsedWidth : schema.frame.sidebarWidth}px`,
        flexBasis: `${ui.collapsed ? schema.frame.sidebarCollapsedWidth : schema.frame.sidebarWidth}px`,
        background: schema.frame.sidebarBg,
        color: schema.frame.sidebarText,
        '--brand': schema.frame.accent,
      }"
    >
      <div class="shell-sidebar__head" :style="{ height: `${schema.frame.topbarHeight}px` }">
        <ShellElementView
          v-if="visible(schema.sidebar.brand)"
          :item="schema.sidebar.brand!"
          :ctx="context"
          @activate="onActivate($event)"
        />
      </div>

      <div v-if="visible(schema.sidebar.search)" class="shell-sidebar__search">
        <ShellElementView :item="schema.sidebar.search!" :ctx="context" @activate="onActivate($event)" />
      </div>

      <el-scrollbar class="shell-sidebar__scroll">
        <ShellElementView
          v-if="visible(schema.sidebar.menu)"
          :item="schema.sidebar.menu!"
          :ctx="context"
          @activate="onActivate($event)"
        />
        <!-- 侧栏私有自定义条目：菜单之外的自定义图标。 -->
        <div v-for="item in schema.sidebar.items.filter((entry) => shellItemClickable(entry) && visible(entry))" :key="item.id" class="shell-sidebar__extra">
          <ShellElementView :item="item" :ctx="context" @activate="onActivate($event)" />
        </div>
      </el-scrollbar>

      <div v-if="visible(schema.sidebar.collapse)" class="shell-sidebar__foot">
        <ShellElementView :item="schema.sidebar.collapse!" :ctx="context" @activate="onActivate($event)" />
      </div>
    </aside>

    <div class="shell-main">
      <header
        v-if="schema.topbar.visible"
        class="shell-topbar"
        :style="{ height: `${schema.frame.topbarHeight}px`, flexBasis: `${schema.frame.topbarHeight}px` }"
      >
        <div class="shell-topbar__left">
          <el-button circle text @click="ui.toggleSidebar">
            <el-icon :size="18"><component :is="ui.collapsed ? 'Expand' : 'Fold'" /></el-icon>
          </el-button>
          <!-- 靠左条目：面包屑 / 自定义文本 / 图标。 -->
          <template v-for="item in schema.topbar.left.filter(visible)" :key="item.id">
            <!-- 全出血页（设计器/运行预览）自带标题，不再重复一条面包屑。 -->
            <ShellElementView
              v-if="!fullBleed || item.role !== 'breadcrumb'"
              :item="item"
              :ctx="context"
              @activate="onActivate($event)"
            />
          </template>
        </div>

        <div class="shell-topbar__right">
          <template v-for="item in topbarRight" :key="item.id">
            <el-dropdown
              v-if="item.role === 'user'"
              trigger="click"
              @command="onUserCommand"
            >
              <ShellElementView :item="item" :ctx="context" />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item command="plugins">插件中心</el-dropdown-item>
                  <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <ShellElementView v-else :item="item" :ctx="context" @activate="onActivate($event)" />
          </template>
        </div>
      </header>

      <main class="shell-content" :class="{ 'is-full-bleed': fullBleed }">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell-frame { height: 100vh; min-height: 0; overflow: hidden; display: flex; background: var(--app-bg); color: var(--app-text); }
.shell-sidebar {
  flex: 0 0 auto; display: flex; flex-direction: column; transition: width .22s ease, flex-basis .22s ease;
  position: sticky; top: 0; height: 100vh; z-index: 20; overflow: hidden;
}
.is-collapsed .shell-sidebar :deep(.shell-brand) { padding: 0 16px; justify-content: center; }
.shell-sidebar__head { display: flex; align-items: center; border-bottom: 1px solid rgba(148, 163, 184, .12); }
.shell-sidebar__search { padding: 8px 12px 0; }
.shell-sidebar__scroll { flex: 1; min-height: 0; }
.shell-sidebar__extra { padding: 0 12px 8px; }
.shell-sidebar__foot { border-top: 1px solid rgba(148, 163, 184, .12); padding: 12px; }
.is-collapsed .shell-sidebar__foot { padding: 12px 8px; }

.shell-main { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.shell-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 28px;
  background: var(--surface); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 15;
  backdrop-filter: blur(12px);
}
.shell-topbar__left, .shell-topbar__right { display: flex; align-items: center; gap: 12px; min-width: 0; }

.shell-content { flex: 1; padding: 28px; min-width: 0; min-height: 0; overflow: auto; }
.shell-content.is-full-bleed { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.shell-content.is-full-bleed > * { flex: 1 1 auto; min-height: 0; }

@media (max-width: 1100px) {
  .shell-sidebar__search { display: none; }
}
@media (max-width: 760px) {
  .shell-sidebar { position: fixed; left: 0; top: 0; }
  .is-collapsed .shell-sidebar { transform: translateX(-100%); }
  .shell-topbar { padding: 0 16px; }
  .shell-content { padding: 16px; }
  .shell-topbar__left :deep(.shell-breadcrumb span),
  .shell-topbar__left :deep(.shell-breadcrumb i) { display: none; }
}
</style>
