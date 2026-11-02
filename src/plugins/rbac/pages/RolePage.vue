<script setup lang="ts">
// 角色管理：schema 驱动列表 + 一个自渲染的「授权菜单」抽屉。
//
// 分层：列表/表单仍然是 `system.role` 那份 schema（后端可改），
// 只有「勾选菜单树」这种声明式字段表达不了的交互由插件自己画
// （`kind: 'custom'` 动作 → 本页监听 `action` 事件打开抽屉）。
import { ref } from 'vue'
import { useSessionStore } from '@/stores/session'
import type { Row } from '@zjarlin/data-page'
import SchemaPage from '@zjarlin/data-page-element/SchemaPage.vue'
import RoleMenuAuthorize from '../components/RoleMenuAuthorize.vue'

const session = useSessionStore()

const authorizeOpen = ref(false)
const authorizeRole = ref<Row | null>(null)
/** 保存后要让列表重新拉一次，拿最新的授权数。 */
const reloadKey = ref(0)

function onAction(payload: { key: string; row: Row }): void {
  if (payload.key !== 'authorize') return
  authorizeRole.value = payload.row
  authorizeOpen.value = true
}

/** 授权列：超管显示通配，其余显示菜单节点数与权限码数。 */
function grantSummary(row: Row): string {
  const permissions = Array.isArray(row.permissions) ? row.permissions : []
  if (permissions.includes('*:*:*')) return '全部（通配）'
  const menus = Array.isArray(row.menuIds) ? row.menuIds.length : 0
  return menus === 0 ? '未授权' : `${menus} 个节点 / ${permissions.length} 个码`
}
</script>

<template>
  <!--
    v-meta 写在页面容器上，而不是 SchemaPage 的插槽里：
    组件标签是黑盒，插件不会下钻它的插槽内容（避免把组件内部结构扫进元树）。
    需要把某块单独列成可配置项时，就包一层真实元素再标。
  -->
  <div v-meta="{ name: '角色管理', desc: '角色列表与「授权菜单」入口', group: 'system' }" class="role-page">
    <SchemaPage
      :key="reloadKey"
      page-key="system.role"
      :can="session.can"
      @action="onAction"
    >
      <template #authorize-cell="{ row }">
        <span class="grant">{{ grantSummary(row) }}</span>
      </template>
    </SchemaPage>
  </div>

  <RoleMenuAuthorize
    v-model="authorizeOpen"
    :role="authorizeRole"
    @saved="reloadKey += 1"
  />
</template>

<style scoped>
.role-page { display: contents; }
.grant { color: var(--muted); font-size: 12px; }
</style>
