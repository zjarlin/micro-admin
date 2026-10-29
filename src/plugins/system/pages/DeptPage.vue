<script setup lang="ts">
// 部门管理：树表页壳，schema 声明层级与「新增下级」。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.dept" mode="tree" :can="session.can" />
</template>
