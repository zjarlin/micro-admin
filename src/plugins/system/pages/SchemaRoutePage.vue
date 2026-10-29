<script setup lang="ts">
// 通用页面路由的落点：只靠 URL 上的 pageKey 渲染后端下发的 schema。
//
// 这里一行业务代码都不写，因此后端新增页面不需要前端发版。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'

const route = useRoute()
const session = useSessionStore()

const pageKey = computed(() => String(route.params.pageKey ?? route.meta.pageKey ?? ''))
</script>

<template>
  <SchemaPage :page-key="pageKey" :can="session.can" />
</template>
