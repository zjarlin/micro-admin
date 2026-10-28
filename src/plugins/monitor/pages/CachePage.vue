<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { CacheEntry } from '@/shared/types'

const http = useService<HttpClient>('http')
const rows = ref<CacheEntry[]>([])
const loading = ref(false)
onMounted(async () => {
  loading.value = true
  try { rows.value = await http.request<CacheEntry[]>('/monitor/cache') } finally { loading.value = false }
})
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>缓存监控</h1><p>展示缓存键、类型、TTL 与规模。生产接入时应对齐实际 Redis 命名空间。</p></div></header>
    <section class="panel">
      <el-table v-loading="loading" :data="rows">
        <el-table-column prop="key" label="缓存键" min-width="220"><template #default="{ row }"><code class="mono">{{ row.key }}</code></template></el-table-column>
        <el-table-column prop="type" label="类型" width="100"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.type }}</el-tag></template></el-table-column>
        <el-table-column label="TTL" width="120"><template #default="{ row }">{{ row.ttl < 0 ? '永久' : `${row.ttl}s` }}</template></el-table-column>
        <el-table-column prop="size" label="规模" width="140" />
        <el-table-column label="操作" width="110"><template #default><el-button link type="danger">清除</el-button></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>
