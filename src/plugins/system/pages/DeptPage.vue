<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { Department } from '@/shared/types'

interface DeptNode extends Department { children: DeptNode[] }

const http = useService<HttpClient>('http')
const rows = ref<Department[]>([])
const loading = ref(false)

const tree = computed<DeptNode[]>(() => {
  const map = new Map<number, DeptNode>()
  for (const row of rows.value) map.set(row.id, { ...row, children: [] })
  const roots: DeptNode[] = []
  for (const node of map.values()) {
    if (node.parentId === null) roots.push(node)
    else map.get(node.parentId)?.children.push(node)
  }
  return roots
})

onMounted(async () => {
  loading.value = true
  try {
    rows.value = await http.request<Department[]>('/system/departments')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>部门管理</h1><p>按组织层级展示部门、负责人和联系方式。</p></div>
      <el-button type="primary">新增部门</el-button>
    </header>
    <section class="panel">
      <el-table v-loading="loading" :data="tree" row-key="id" default-expand-all :tree-props="{ children: 'children' }">
        <el-table-column prop="name" label="部门名称" min-width="220" />
        <el-table-column prop="leader" label="负责人" width="120" />
        <el-table-column prop="phone" label="联系电话" width="150" />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '正常' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="140"><template #default><el-button link type="primary">编辑</el-button><el-button link type="primary">新增下级</el-button></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>
