<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import { formatDateTime } from '@/shared/format'
import type { Role } from '@/shared/types'

const http = useService<HttpClient>('http')
const crud = useCrud<Role>(http, { endpoint: '/system/roles' })
const dialog = ref(false)
const editing = ref<Role | null>(null)
const formRef = ref<FormInstance>()
const form = reactive({ name: '', code: '', description: '', status: 'active' as Role['status'] })

onMounted(() => void crud.load())

function open(row?: Role): void {
  editing.value = row ?? null
  Object.assign(form, row ?? { name: '', code: '', description: '', status: 'active' })
  dialog.value = true
}

async function save(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  try {
    await http.request<Role>(`/system/roles/${editing.value?.id}`, { method: 'PUT', body: JSON.stringify(form) })
    ElMessage.success('角色已保存')
    dialog.value = false
    await crud.load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>角色管理</h1><p>角色决定菜单与按钮权限。演示中超级管理员使用通配权限，其余角色按权限码逐项放行。</p></div>
      <el-button type="primary" :icon="Plus" @click="open()">新增角色</el-button>
    </header>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索角色名称或编码" :prefix-icon="Search" clearable @keyup.enter="crud.search" />
        <el-button type="primary" @click="crud.search">查询</el-button>
      </div>
      <el-table v-loading="crud.loading" :data="crud.rows">
        <el-table-column prop="name" label="角色名称" min-width="140" />
        <el-table-column label="权限字符" width="140"><template #default="{ row }"><code class="mono">{{ row.code }}</code></template></el-table-column>
        <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip />
        <el-table-column prop="userCount" label="用户数" width="90" />
        <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '正常' : '停用' }}</el-tag></template></el-table-column>
        <el-table-column label="创建时间" width="170"><template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button link type="primary" @click="open(row)">编辑</el-button></template></el-table-column>
      </el-table>
      <div class="table-footer">
        <el-pagination :current-page="crud.page" :page-size="crud.pageSize" :total="crud.total" layout="total, prev, pager, next" @current-change="crud.changePage" />
      </div>
    </section>

    <el-dialog v-model="dialog" :title="editing ? '编辑角色' : '新增角色'" width="480px">
      <el-form ref="formRef" :model="form" label-width="88px">
        <el-form-item label="角色名称" prop="name" :rules="[{ required: true, message: '请输入角色名称' }]"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="权限字符" prop="code" :rules="[{ required: true, message: '请输入权限字符' }]"><el-input v-model="form.code" placeholder="例如 operator" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="状态"><el-radio-group v-model="form.status"><el-radio value="active">正常</el-radio><el-radio value="disabled">停用</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>
