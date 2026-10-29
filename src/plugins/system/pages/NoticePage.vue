<script setup lang="ts">
// 通知公告：schema 驱动 + 标题加粗插槽。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.notice" :can="session.can">
    <template #notice-title="{ row }">
      <strong class="notice-title">{{ row.title }}</strong>
    </template>
  </SchemaPage>
</template>

<style scoped>
.notice-title { font-size: 13px; color: var(--app-text); font-weight: 600; }
</style>
