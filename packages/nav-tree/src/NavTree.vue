<script setup lang="ts">
// 导航树渲染组件：只吃「行数组」，不认识菜单、路由、权限。
//
// 行由 `tree.ts` 的 `flatten()` 求解好再传进来，因此这里没有递归、没有副作用，
// 折叠只发事件（`toggle`），点击只发 `select`——谁持有展开集合由宿主决定，
// 插件（侧栏）就能各自持久化自己的折叠状态。
import type { NavNode, NavRow } from './types.ts'

const props = withDefaults(
  defineProps<{
    rows: readonly NavRow[]
    /** 紧凑模式（侧栏收成图标轨道）：只显示图标与提示。 */
    compact?: boolean
    /** 分组行是否显示叶子计数。 */
    showCount?: boolean
    /** 计数实现由宿主给（分组下有多少个可达页面）。 */
    countOf?: (node: NavNode) => number
  }>(),
  { compact: false, showCount: false },
)

const emit = defineEmits<{
  (event: 'toggle', node: NavNode): void
  (event: 'select', node: NavNode): void
}>()

function indent(depth: number): Record<string, string> {
  if (props.compact) return {}
  return { paddingLeft: `${12 + depth * 14}px` }
}
</script>

<template>
  <nav class="nav-tree" :class="{ 'is-compact': compact }" aria-label="主导航">
    <template v-for="row in rows" :key="row.node.id">
      <!-- 分组标题：可折叠，折叠时隐藏子行（比「一屏到底」更适合长菜单）。 -->
      <button
        v-if="row.node.kind === 'group'"
        type="button"
        class="nav-tree__group"
        :class="{ 'is-collapsed': !row.expanded }"
        :aria-expanded="row.expanded"
        :title="compact ? row.node.title : undefined"
        @click="emit('toggle', row.node)"
      >
        <span v-if="!compact" class="nav-tree__group-label">{{ row.node.title }}</span>
        <span v-if="!compact && showCount && props.countOf" class="nav-tree__count">{{ props.countOf(row.node) }}</span>
        <svg v-if="!compact" class="nav-tree__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 目录行：整行是按钮，右侧 chevron 指示展开态。 -->
      <button
        v-else-if="row.hasChildren"
        type="button"
        class="nav-tree__row nav-tree__row--folder"
        :class="{ 'is-active': row.active, 'is-expanded': row.expanded }"
        :style="indent(row.depth)"
        :aria-expanded="row.expanded"
        :title="compact ? row.node.title : undefined"
        @click="emit('toggle', row.node)"
      >
        <span v-if="row.node.icon" class="nav-tree__icon" aria-hidden="true"><slot name="icon" :icon="row.node.icon" :node="row.node" /></span>
        <span v-if="!compact" class="nav-tree__label">{{ row.node.title }}</span>
        <span v-if="!compact && row.node.badge" class="nav-tree__badge">{{ row.node.badge }}</span>
        <svg v-if="!compact" class="nav-tree__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <!-- 叶子：交给宿主路由，组件只报「选了谁」。 -->
      <a
        v-else-if="row.node.path"
        class="nav-tree__row nav-tree__row--link"
        :class="{ 'is-active': row.active }"
        :style="indent(row.depth)"
        :href="row.node.path"
        :title="compact ? row.node.title : undefined"
        @click.prevent="emit('select', row.node)"
      >
        <span v-if="row.node.icon" class="nav-tree__icon" aria-hidden="true"><slot name="icon" :icon="row.node.icon" :node="row.node" /></span>
        <span v-if="!compact" class="nav-tree__label">{{ row.node.title }}</span>
        <span v-if="!compact && row.node.badge" class="nav-tree__badge">{{ row.node.badge }}</span>
      </a>
    </template>
    <slot name="empty" />
  </nav>
</template>

<style scoped>
/* 颜色全部走 CSS 变量（侧栏调色板），调用方换主题即换外观；
   这里只提供兜底值，保证组件搬到别的宿主里也还能看。 */
.nav-tree { display: flex; flex-direction: column; gap: 2px; }
.nav-tree__group {
  display: flex; align-items: center; gap: 6px; width: 100%; margin: 12px 0 4px; padding: 2px 12px;
  background: none; border: 0; cursor: pointer; font: inherit;
  font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--sidebar-muted, #64748b); font-weight: 700;
}
.nav-tree__group:first-child { margin-top: 0; }
.nav-tree__group:hover { color: var(--sidebar-text, #94a3b8); }
.nav-tree__group-label { flex: 1 1 auto; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-tree__count { font-size: 10px; letter-spacing: 0; opacity: .75; }
.nav-tree__chevron { width: 12px; height: 12px; flex: none; transition: transform .18s ease; transform: rotate(90deg); opacity: .7; }
.nav-tree__group.is-collapsed .nav-tree__chevron { transform: rotate(0deg); }
.nav-tree__row {
  position: relative; display: flex; align-items: center; gap: 10px; width: 100%;
  min-height: 38px; padding: 0 12px; border: 0; border-radius: 9px; background: none;
  color: var(--sidebar-text, #a9b6c9); text-decoration: none; cursor: pointer; font: inherit; text-align: left;
  transition: background .16s ease, color .16s ease;
}
.nav-tree__row:hover { background: var(--sidebar-hover-bg, rgba(148, 163, 184, .09)); color: var(--sidebar-text-strong, #f1f5f9); }
.nav-tree__row.is-active { background: var(--sidebar-active-bg, rgba(59, 130, 246, .16)); color: var(--sidebar-active-text, #f8fafc); font-weight: 600; }
.nav-tree__row.is-active::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 2px; border-radius: 2px; background: var(--sidebar-active-bar, #38bdf8); }
.nav-tree__row--folder { color: var(--sidebar-text-strong, #c3cddd); }
.nav-tree__row--folder .nav-tree__chevron { transform: rotate(0deg); margin-left: auto; }
.nav-tree__row--folder.is-expanded .nav-tree__chevron { transform: rotate(90deg); }
.nav-tree__icon { display: inline-flex; flex: none; width: 18px; height: 18px; align-items: center; justify-content: center; }
.nav-tree__label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.nav-tree__badge { margin-left: auto; background: var(--sidebar-badge-bg, #1d4ed8); color: var(--sidebar-badge-text, #fff); font-size: 10px; padding: 2px 6px; border-radius: 999px; }
.nav-tree.is-compact .nav-tree__row { justify-content: center; padding: 0; }
.nav-tree.is-compact .nav-tree__group { justify-content: center; padding: 4px 0; margin: 8px 0 2px; }
.nav-tree.is-compact .nav-tree__group::after { content: ''; display: block; width: 16px; height: 1px; background: var(--sidebar-line, rgba(148, 163, 184, .25)); }
</style>
