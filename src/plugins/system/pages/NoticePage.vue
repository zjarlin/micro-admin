<script setup lang="ts">
import { onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import { formatDateTime } from '@/shared/format'
import type { Notice } from '@/shared/types'

const http = useService<HttpClient>('http')
const crud = useCrud<Notice>(http, { endpoint: '/system/notices' })
onMounted(() => void crud.load())
</script>

<template>
  <div class="page">
    <header class="page-head"><div><h1>通知公告</h1><p>面向内部用户的通知与公告。工作台会读取已发布内容，草稿不会出现在首页。</p></div><el-button type="primary">发布公告</el-button></header>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索标题或发布人" :prefix-icon="Search" clearable @keyup.enter="crud.search" />
        <el-button type="primary" @click="crud.search">查询</el-button>
      </div>
      <el-table v-loading="crud.loading" :data="crud.rows">
        <el-table-column label="标题" min-width="300"><template #default="{ row }"><strong class="notice-title">{{ row.title }}</strong></template></el-table-column>
        <el-table-column label="类型" width="100"><template #default="{ row }"><el-tag :type="row.type === 'announcement' ? 'warning' : 'info'" size="small" effect="plain">{{ row.type === 'announcement' ? '公告' : '通知' }}</el-tag></template></el-table-column>
        <el-table-column prop="author" label="发布人" width="110" />
        <el-table-column label="发布时间" width="180"><template #default="{ row }">{{ formatDateTime(row.publishedAt) }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">{{ row.status === 'published' ? '已发布' : '草稿' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="130"><template #default><el-button link type="primary">编辑</el-button><el-button link type="danger">删除</el-button></template></el-table-column>
      </el-table>
      <div class="table-footer"><el-pagination :current-page="crud.page" :page-size="crud.pageSize" :total="crud.total" layout="total, prev, pager, next" @current-change="crud.changePage" /></div>
    </section>
  </div>
</template>

<style scoped>.notice-title { font-size: 13px; color: var(--app-text); font-weight: 600; }</style>
