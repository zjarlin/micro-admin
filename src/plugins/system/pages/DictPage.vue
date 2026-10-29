<script setup lang="ts">
// 字典管理：schema 驱动。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@/components/data/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.dict" :can="session.can" />
</template>
