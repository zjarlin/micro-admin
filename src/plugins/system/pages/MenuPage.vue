<script setup lang="ts">
// 菜单管理：树表页壳；层级字段 `children` 由 schema 声明。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@/components/data/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.menu" mode="tree" :can="session.can" />
</template>
