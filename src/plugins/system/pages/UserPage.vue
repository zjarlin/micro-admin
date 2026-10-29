<script setup lang="ts">
// 用户管理：schema 驱动 + 一个自定义单元格插槽（头像/昵称）。
//
// 左树右表由 schema.tree 声明，不需要在这里写树。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@/components/data/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.user" :can="session.can">
    <template #user-cell="{ row }">
      <div class="user-cell">
        <span class="avatar">{{ String(row.nickname ?? '').slice(0, 1) }}</span>
        <div>
          <strong>{{ row.nickname }}</strong>
          <small>{{ row.username }}</small>
        </div>
      </div>
    </template>
  </SchemaPage>
</template>

<style scoped>
.user-cell { display: flex; align-items: center; gap: 10px; }
.user-cell .avatar {
  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
  background: #eef2ff; color: #3730a3; display: grid; place-items: center;
  font-size: 12px; font-weight: 700;
}
.user-cell div { display: flex; flex-direction: column; }
.user-cell strong { font-size: 13px; color: var(--app-text); font-weight: 600; }
.user-cell small { font-size: 11px; color: var(--muted); }
</style>
