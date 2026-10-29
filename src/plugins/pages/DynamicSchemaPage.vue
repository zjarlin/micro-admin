<script setup lang="ts">
// 后端登记页面的渲染入口：页面 key 只来自路由 meta。
//
// 这里没有任何页面专属代码，因此后端新增/修改 schema 都不需要前端发版。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SchemaPage from '@addzero/data-page-element/SchemaPage.vue'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const session = useSessionStore()
const pageKey = computed(() => String(route.meta.pageKey ?? route.params.pageKey ?? ''))
</script>

<template>
  <SchemaPage :page-key="pageKey" :can="session.can" />
</template>
