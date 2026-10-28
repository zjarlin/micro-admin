<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import type { MenuNode } from '@/shared/types'

const http = useService<HttpClient>('http')
const rows = ref<MenuNode[]>([])
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    rows.value = await http.request<MenuNode[]>('/system/menus')
  } finally {
    loading.value = false
  }
})

function typeLabel(type: MenuNode['type']): string {
  return { directory: '目录', menu: '菜单', button: '按钮' }[type]
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>菜单管理</h1><p>这里的树是演示数据；运行中的侧边栏实际由各插件通过 <code>ctx.menus.add()</code> 贡献，并经过权限过滤。</p></div>
    </header>
    <section class="panel">
      <div class="panel-title"><h2>菜单结构</h2><el-button size="small">新增菜单</el-button></div>
      <el-table v-loading="loading" :data="rows" row-key="id" default-expand-all :tree-props="{ children: 'children' }">
        <el-table-column prop="title" label="菜单标题" min-width="180" />
        <el-table-column prop="path" label="路由地址" min-width="180"><template #default="{ row }"><code class="mono">{{ row.path }}</code></template></el-table-column>
        <el-table-column label="类型" width="90"><template #default="{ row }"><el-tag size="small" :type="row.type === 'directory' ? 'warning' : row.type === 'menu' ? 'primary' : 'info'">{{ typeLabel(row.type) }}</el-tag></template></el-table-column>
        <el-table-column prop="permission" label="权限标识" min-width="180"><template #default="{ row }"><code class="mono">{{ row.permission || '-' }}</code></template></el-table-column>
        <el-table-column prop="order" label="排序" width="80" />
        <el-table-column label="状态" width="90"><template #default="{ row }"><span class="status-dot" :class="row.status === 'active' ? 'ok' : 'bad'" />{{ row.status === 'active' ? '正常' : '停用' }}</template></el-table-column>
        <el-table-column label="操作" width="120"><template #default><el-button link type="primary">编辑</el-button></template></el-table-column>
      </el-table>
    </section>
  </div>
</template>
