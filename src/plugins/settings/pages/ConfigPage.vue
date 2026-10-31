<script setup lang="ts">
// 参数设置：schema 驱动。
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@zjarlin/data-page-element/SchemaPage.vue'

const session = useSessionStore()
</script>

<template>
  <SchemaPage page-key="system.config" :can="session.can" />
</template>
