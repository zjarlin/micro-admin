<script setup lang="ts">
import { onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import type { DictType } from '@/shared/types'

const http = useService<HttpClient>('http')
const crud = useCrud<DictType>(http, { endpoint: '/system/dicts' })
onMounted(() => void crud.load())
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>字典管理</h1><p>字典类型用于约束业务枚举值，例如用户性别、开关状态和通知类型。</p></div><el-button type="primary">新增字典</el-button></header>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索字典名称或类型" :prefix-icon="Search" clearable @keyup.enter="crud.search" />
        <el-button type="primary" @click="crud.search">查询</el-button>
      </div>
      <el-table v-loading="crud.loading" :data="crud.rows">
        <el-table-column prop="name" label="字典名称" min-width="150" />
        <el-table-column prop="type" label="字典类型" min-width="190"><template #default="{ row }"><code class="mono">{{ row.type }}</code></template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="220" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '正常' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="150"><template #default><el-button link type="primary">数据</el-button><el-button link type="primary">编辑</el-button></template></el-table-column>
      </el-table>
      <div class="table-footer"><el-pagination :current-page="crud.page" :page-size="crud.pageSize" :total="crud.total" layout="total, prev, pager, next" @current-change="crud.changePage" /></div>
    </section>
  </div>
</template>
