<script setup lang="ts">
// 岗位管理：页面只剩「schema key + 权限」。
// 表格、弹窗、校验、分页全部来自后端下发的 system.post schema。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@/components/data/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.post" :can="session.can" />
</template>
