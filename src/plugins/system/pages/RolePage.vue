<script setup lang="ts">
// 角色管理：schema 驱动，页面不再手写表格与弹窗。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.role" :can="session.can" />
</template>
