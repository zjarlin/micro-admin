<script setup lang="ts">
// 后端登记页面的渲染入口：页面 key 只来自路由 meta。
//
// 这里没有任何页面专属代码，因此后端新增/修改 schema 都不需要前端发版。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SchemaPage from '@zjarlin/data-page-element/SchemaPage.vue'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const pageKey = computed(() => String(route.meta.pageKey ?? route.params.pageKey ?? ''))
</script>

<template>
  <!-- 活元素的 `navigate` 动作走应用路由（不是整页刷新），与手写页面一致。 -->
  <SchemaPage :page-key="pageKey" :can="session.can" :navigate="(path: string) => { void router.push(path) }" />
</template>
