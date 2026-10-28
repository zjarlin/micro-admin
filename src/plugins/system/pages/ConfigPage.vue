<script setup lang="ts">
import { onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import type { ConfigItem } from '@/shared/types'

const http = useService<HttpClient>('http')
const crud = useCrud<ConfigItem>(http, { endpoint: '/system/configs' })
onMounted(() => void crud.load())
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>参数设置</h1><p>系统级键值参数，内置参数以锁定标识展示。真实部署时应由服务端集中维护并缓存。</p></div><el-button type="primary">新增参数</el-button></header>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索参数名称或键名" :prefix-icon="Search" clearable @keyup.enter="crud.search" />
        <el-button type="primary" @click="crud.search">查询</el-button>
      </div>
      <el-table v-loading="crud.loading" :data="crud.rows">
        <el-table-column prop="name" label="参数名称" min-width="190" />
        <el-table-column prop="key" label="参数键名" min-width="220"><template #default="{ row }"><code class="mono">{{ row.key }}</code></template></el-table-column>
        <el-table-column prop="value" label="参数键值" min-width="160" />
        <el-table-column label="内置" width="80"><template #default="{ row }"><el-tag :type="row.builtin ? 'warning' : 'info'" size="small">{{ row.builtin ? '是' : '否' }}</el-tag></template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" />
        <el-table-column label="操作" width="110"><template #default><el-button link type="primary">编辑</el-button></template></el-table-column>
      </el-table>
      <div class="table-footer"><el-pagination :current-page="crud.page" :page-size="crud.pageSize" :total="crud.total" layout="total, prev, pager, next" @current-change="crud.changePage" /></div>
    </section>
  </div>
</template>
