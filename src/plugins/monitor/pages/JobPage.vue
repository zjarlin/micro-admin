<script setup lang="ts">
// 定时任务：页面只剩「schema key + 权限」。
// 暂停/恢复不再有分支代码，由 schema 里两条带 `visibleWhen` 的 action 声明。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@/components/data/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="monitor.job" :can="session.can" />
</template>
