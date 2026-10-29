<script setup lang="ts">
// 字典管理：schema 驱动。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.dict" :can="session.can" />
</template>
