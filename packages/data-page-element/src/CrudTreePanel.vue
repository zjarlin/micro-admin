<script setup lang="ts">
// 左树面板：schema.tree → 可搜索、可折叠的树。
//
// 选中节点写入列表查询参数；根节点「全部」代表不筛选。
import { computed } from 'vue'
import { Search } from '@element-plus/icons-vue'
import type { TreeSchema } from '@zjarlin/data-page'
import type { TreeNode } from '@zjarlin/data-page'

const props = defineProps<{
  schema: TreeSchema
  nodes: TreeNode<Record<string, unknown>>[]
  loading?: boolean
  selectedId: string
  keyword: string
  expandedKeys: string[]
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'keyword', value: string): void
  (event: 'expand', keys: string[]): void
}>()

/** el-tree 需要 `id` / `label` / `children` 三段式，这里把 `TreeNode` 投影过去。 */
interface TreeItem {
  id: string
  label: string
  caption: string
  raw: Record<string, unknown>
  children: TreeItem[]
}

function toItems(nodes: TreeNode<Record<string, unknown>>[]): TreeItem[] {
  return nodes.map((node) => ({
    id: String(node.raw[props.schema.idProp] ?? ''),
    label: String(node.raw[props.schema.labelProp] ?? ''),
    caption: props.schema.captionProp ? String(node.raw[props.schema.captionProp] ?? '') : '',
    raw: node.raw,
    children: toItems(node.children),
  }))
}

const items = computed(() => toItems(props.nodes))
</script>

<template>
  <section class="panel crud-tree">
    <div class="panel-title">
      <h2>{{ schema.allLabel ?? '全部' }}</h2>
    </div>
    <el-input
      v-if="schema.searchable !== false"
      :model-value="keyword"
      size="small"
      clearable
      placeholder="搜索"
      :prefix-icon="Search"
      @update:model-value="emit('keyword', $event)"
    />
    <div v-loading="loading" class="crud-tree__body">
      <button
        type="button"
        class="crud-tree__item crud-tree__all"
        :class="{ 'is-active': !selectedId }"
        @click="emit('select', '')"
      >
        {{ schema.allLabel ?? '全部' }}
      </button>
      <el-tree
        :data="items"
        node-key="id"
        :props="{ label: 'label', children: 'children' }"
        :current-node-key="selectedId"
        :default-expanded-keys="expandedKeys"
        highlight-current
        :expand-on-click-node="false"
        @node-click="(node: TreeItem) => emit('select', node.id)"
      >
        <template #default="{ data }">
          <span class="crud-tree__node">
            <span class="crud-tree__label">{{ data.label }}</span>
            <span v-if="data.caption" class="crud-tree__caption">{{ data.caption }}</span>
          </span>
        </template>
      </el-tree>
      <p v-if="!items.length" class="muted crud-tree__empty">没有数据</p>
    </div>
  </section>
</template>

<style scoped>
.crud-tree { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.crud-tree__body { display: flex; flex-direction: column; gap: 4px; overflow: auto; max-height: 70vh; }
.crud-tree__item {
  padding: 6px 10px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--app-text); font-size: 13px; text-align: left; cursor: pointer;
}
.crud-tree__item:hover { background: rgba(99, 102, 241, .08); }
.crud-tree__item.is-active { border-color: rgba(99, 102, 241, .45); background: rgba(99, 102, 241, .12); }
.crud-tree__node { display: flex; align-items: center; gap: 8px; min-width: 0; }
.crud-tree__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crud-tree__caption { color: var(--muted); font-size: 11px; }
.crud-tree__empty { font-size: 12px; margin: 4px 0; }
</style>
