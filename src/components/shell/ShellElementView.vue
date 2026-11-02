<!-- 外壳元素视图：把一个外壳条目（品牌 / 菜单 / 图标 / 用户 / 文本…）渲染成真机样子。
     画布设计器与运行期外壳**共用这一个组件**，所以「画布里看到的外壳」就是「上线后的外壳」，
     不存在第二份渲染实现。菜单、用户区、图标行都按真组件渲染（el-menu / el-dropdown / el-button）。

     图标名解析：外壳元素的 `icon` 是 Element Plus 图标名（`Sunny` / `Bell` …），
     主入口已全局注册全部图标，因此 `<component :is="icon">` 即得真图标；
     名字写错时退回一个占位方框，不静默消失，设计师一眼能发现问题。 -->
<script setup lang="ts">
import { computed } from 'vue'
import type { ShellItem } from '@/shared/shell'
import type { ShellViewContext } from './context'
import VibeElement from '@zjarlin/data-page-element/VibeElement.vue'

const props = defineProps<{
  item: ShellItem
  ctx: ShellViewContext
  /** 是否处于「已选中」态（画布高亮用）。 */
  selected?: boolean | undefined
}>()

const emit = defineEmits<{
  /** 点击条目：由外层决定执行动作（设计器只回显，运行期真执行）。 */
  (event: 'activate', item: ShellItem, payload?: unknown): void
}>()

const label = computed(() => props.item.label ?? '')
const tooltip = computed(() => props.item.tooltip ?? props.item.label ?? props.item.id)
const collapsed = computed(() => props.ctx.collapsed)

/** 在线模板优先：与页面元素同一运行时。 */
const vibe = computed(() => (props.item.code
  ? {
      code: props.item.code,
      // 模板作用域只关心「数据通道从哪取值」；事件动作由外壳执行，不在这里下发。
      bindings: (props.item.bindings ?? [])
        .filter((binding) => binding.kind === 'data')
        .map((binding) => ({
          channel: binding.channel,
          kind: 'data' as const,
          ...(binding.source ? { source: binding.source } : {}),
        })),
    }
  : null))

/** 模板作用域：外壳有意义的取值（标签、图标、当前路径、用户…）。 */
const vibeData = computed<Record<string, unknown>>(() => ({
  value: label.value,
  label: label.value,
  text: label.value,
  icon: props.item.icon ?? '',
  count: props.item.badge ?? '',
  path: props.ctx.activePath,
  title: props.ctx.pageTitle,
  user: props.ctx.user.name,
}))

/** 模板能调用的事件方法名：`click` → `onClick`。 */
const vibeHandlers = computed<Record<string, (payload?: unknown) => void>>(() => ({
  click: (payload?: unknown) => emit('activate', props.item, payload),
}))

function activate(): void {
  emit('activate', props.item)
}
</script>

<template>
  <!-- 自定义模板：在线写的代码在这里运行。
       点击事件由模板里的 `@click="onClick"` 触发（外层不再叠加一层，
       否则会「点一下跑两次」）；模板没写 onClick 就是作者主动放弃点击。 -->
  <div v-if="vibe" class="shell-item shell-item--vibe">
    <VibeElement :vibe="vibe" :data="vibeData" :handlers="vibeHandlers" />
  </div>

  <!-- 品牌块：Logo 方块 + 主/副标题。 -->
  <div v-else-if="item.role === 'brand'" class="shell-brand">
    <span class="shell-brand__logo">{{ item.logoText || 'MK' }}</span>
    <span v-show="!collapsed" class="shell-brand__text">
      <strong>{{ label || 'Micro Admin' }}</strong>
      <small>{{ item.subtitle || '微内核控制台' }}</small>
    </span>
  </div>

  <!-- 菜单：分组 + 高亮当前项；菜单由内核贡献装配，这里只画。 -->
  <nav v-else-if="item.role === 'menu'" class="shell-menu" aria-label="主导航">
    <template v-for="group in ctx.groups" :key="group.name">
      <p v-show="!collapsed" class="shell-menu__title">{{ group.name }}</p>
      <a
        v-for="entry in group.items"
        :key="entry.id"
        class="shell-menu__item"
        :class="{ 'is-active': entry.path === ctx.activePath }"
        :title="collapsed ? entry.title : undefined"
        :href="entry.path"
        @click.prevent
      >
        <el-icon :size="18"><component :is="entry.icon ?? 'Menu'" /></el-icon>
        <span v-show="!collapsed" class="shell-menu__label">{{ entry.title }}</span>
        <span v-if="entry.badge && !collapsed" class="shell-menu__badge">{{ entry.badge }}</span>
      </a>
    </template>
    <p v-if="!ctx.groups.length" class="shell-menu__empty">没有匹配的菜单</p>
  </nav>

  <!-- 菜单搜索 -->
  <div v-else-if="item.role === 'menu-search'" class="shell-search">
    <el-input
      :model-value="ctx.keyword"
      size="small"
      :prefix-icon="item.icon ? undefined : 'Search'"
      placeholder="搜索菜单"
      clearable
    >
      <template v-if="item.icon" #prefix>
        <el-icon><component :is="item.icon" /></el-icon>
      </template>
    </el-input>
  </div>

  <!-- 收起按钮 -->
  <button v-else-if="item.role === 'collapse'" class="shell-collapse" type="button" @click="activate">
    <el-icon><component :is="collapsed ? 'ArrowRightBold' : (item.icon ?? 'ArrowLeftBold')" /></el-icon>
    <span v-show="!collapsed">{{ label || '收起侧栏' }}</span>
  </button>

  <!-- 面包屑：控制台 / 页名 -->
  <div v-else-if="item.role === 'breadcrumb'" class="shell-breadcrumb">
    <span>控制台</span>
    <i>/</i>
    <strong>{{ label || ctx.pageTitle }}</strong>
  </div>

  <!-- 图标按钮：点击动作与模板都可配，是全站图标行的一等元素。 -->
  <el-tooltip v-else-if="item.role === 'icon'" :content="tooltip" placement="bottom">
    <el-button
      circle
      text
      class="shell-icon"
      :class="[`is-${item.variant ?? 'default'}`, { 'is-on': selected }]"
      @click="activate"
    >
      <el-badge v-if="item.badge" :is-dot="item.badge === 'dot'" :value="item.badge === 'dot' ? undefined : item.badge" type="danger">
        <el-icon :size="17"><component :is="item.icon ?? 'Bell'" /></el-icon>
      </el-badge>
      <el-icon v-else :size="17"><component :is="item.icon ?? 'Bell'" /></el-icon>
    </el-button>
  </el-tooltip>

  <!-- 用户区：头像 + 名字 + 下拉 -->
  <el-dropdown v-else-if="item.role === 'user'" trigger="click" @command="(command: string) => emit('activate', item, { command })">
    <button class="shell-user" type="button">
      <span class="shell-user__avatar">{{ ctx.user.initials }}</span>
      <span v-show="!collapsed" class="shell-user__meta">
        <strong>{{ label || ctx.user.name }}</strong>
        <small>{{ item.tooltip && item.tooltip !== label ? item.tooltip : ctx.user.department }}</small>
      </span>
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="profile">个人中心</el-dropdown-item>
        <el-dropdown-item command="plugins">插件中心</el-dropdown-item>
        <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <!-- 页签条（可选） -->
  <div v-else-if="item.role === 'tabs'" class="shell-tabs">{{ label || '页签条' }}</div>

  <!-- 分隔线 -->
  <div v-else-if="item.role === 'divider'" class="shell-divider" />

  <!-- 文本：在线模板之外的静态文案 -->
  <div v-else class="shell-text">{{ label || '文本' }}</div>
</template>

<style scoped>
.shell-item { display: flex; align-items: center; }
.shell-item--vibe { width: 100%; cursor: pointer; }

.shell-brand { display: flex; align-items: center; gap: 12px; padding: 0 20px; height: 100%; }
.shell-brand__logo {
  width: 38px; height: 38px; flex: 0 0 38px; border-radius: 11px; display: grid; place-items: center;
  background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #08111d; font-weight: 900;
}
.shell-brand__text { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.shell-brand__text strong { color: #f8fafc; font-size: 14px; white-space: nowrap; }
.shell-brand__text small { color: #7d8da4; font-size: 11px; white-space: nowrap; }

.shell-menu { display: flex; flex-direction: column; gap: 2px; padding: 18px 12px 24px; }
.shell-menu__title {
  margin: 0 0 8px; padding: 0 12px; font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
  color: #64748b; font-weight: 700;
}
.shell-menu__item {
  position: relative; display: flex; align-items: center; gap: 11px; min-height: 40px; padding: 0 12px;
  border-radius: 9px; color: #a9b6c9; text-decoration: none; transition: background .18s ease, color .18s ease;
}
.shell-menu__item:hover { background: rgba(148, 163, 184, .09); color: #f1f5f9; }
.shell-menu__item.is-active { background: linear-gradient(90deg, rgba(59, 130, 246, .22), rgba(34, 211, 238, .07)); color: #f8fafc; }
.shell-menu__item.is-active::before {
  content: ''; position: absolute; left: 0; top: 11px; bottom: 11px; width: 2px; border-radius: 2px; background: #38bdf8;
}
.shell-menu__label { white-space: nowrap; font-size: 13px; }
.shell-menu__badge { margin-left: auto; background: #1d4ed8; color: #fff; font-size: 10px; padding: 2px 6px; border-radius: 999px; }
.shell-menu__empty { color: #64748b; font-size: 12px; padding: 0 12px; }

.shell-search { width: 100%; padding: 0 4px; }
.shell-collapse {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; height: 38px;
  border: 0; border-radius: 9px; background: rgba(148, 163, 184, .08); color: #94a3b8; cursor: pointer; font-size: 12px;
}
.shell-collapse:hover { background: rgba(148, 163, 184, .14); color: #e2e8f0; }

.shell-breadcrumb { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--muted); white-space: nowrap; }
.shell-breadcrumb i { font-style: normal; color: var(--line-strong); }
.shell-breadcrumb strong { color: var(--app-text); font-weight: 600; }

.shell-icon :deep(.el-icon) { display: inline-flex; }
.shell-icon.is-on { outline: 1px dashed var(--brand, #4f46e5); outline-offset: 2px; }
.shell-icon.is-primary { color: var(--brand, #4f46e5); }
.shell-icon.is-danger { color: #ef4444; }
.shell-icon.is-success { color: #16a34a; }
.shell-icon.is-warning { color: #f59e0b; }

.shell-user { display: flex; align-items: center; gap: 9px; background: transparent; border: 0; cursor: pointer; padding: 4px 6px; border-radius: 9px; }
.shell-user:hover { background: var(--hover); }
.shell-user__avatar {
  width: 34px; height: 34px; border-radius: 50%; background: #0f172a; color: #fff;
  display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: 0 0 34px;
}
.shell-user__meta { display: flex; flex-direction: column; text-align: left; line-height: 1.25; min-width: 0; }
.shell-user__meta strong { color: var(--app-text); font-size: 13px; white-space: nowrap; }
.shell-user__meta small { color: var(--muted); font-size: 11px; white-space: nowrap; }

.shell-tabs { font-size: 12px; color: var(--muted); padding: 0 8px; }
.shell-divider { width: 1px; align-self: stretch; margin: 0 6px; background: var(--line); }
.shell-text { font-size: 13px; color: var(--app-text); padding: 0 8px; white-space: nowrap; }
</style>
