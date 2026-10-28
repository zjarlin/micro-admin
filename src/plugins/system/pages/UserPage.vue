<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Download, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useCrud } from '@/shared/useCrud'
import { formatDateTime } from '@/shared/format'
import type { SysUser, UserStatus } from '@/shared/types'
import { useSessionStore } from '@/stores/session'

const http = useService<HttpClient>('http')
const session = useSessionStore()
const crud = useCrud<SysUser>(http, { endpoint: '/system/users' })
const dialog = ref(false)
const formRef = ref<FormInstance>()
const editing = ref<SysUser | null>(null)
const form = reactive({ username: '', nickname: '', phone: '', email: '', department: '平台研发部', role: '运营专员', status: 'active' as UserStatus })
const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}

onMounted(() => void crud.load())

function openCreate(): void {
  editing.value = null
  Object.assign(form, { username: '', nickname: '', phone: '', email: '', department: '平台研发部', role: '运营专员', status: 'active' })
  dialog.value = true
}

function openEdit(row: SysUser): void {
  editing.value = row
  Object.assign(form, row)
  dialog.value = true
}

async function save(): Promise<void> {
  if (!(await formRef.value?.validate().catch(() => false))) return
  try {
    if (editing.value) {
      await http.request<SysUser>(`/system/users/${editing.value.id}`, { method: 'PUT', body: JSON.stringify(form) })
      ElMessage.success('用户已更新')
    } else {
      await http.request<SysUser>('/system/users', { method: 'POST', body: JSON.stringify(form) })
      ElMessage.success('用户已创建')
    }
    dialog.value = false
    await crud.load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function toggleStatus(row: SysUser): Promise<void> {
  await http.request<SysUser>(`/system/users/${row.id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: row.status === 'active' ? 'disabled' : 'active' }),
  })
  await crud.load()
}

async function remove(row: SysUser): Promise<void> {
  await ElMessageBox.confirm(`删除用户 ${row.nickname} 后不可恢复，确定继续？`, '删除用户', { type: 'warning' })
  try {
    await http.request<void>(`/system/users/${row.id}`, { method: 'DELETE' })
    ElMessage.success('已删除')
    await crud.load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除失败')
  }
}

function exportCsv(): void {
  const header = '用户名,昵称,手机号,邮箱,部门,角色,状态\n'
  const rows = crud.rows.map((row) => [row.username, row.nickname, row.phone, row.email, row.department, row.role, row.status].join(',')).join('\n')
  const blob = new Blob([`\uFEFF${header}${rows}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'users.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>用户管理</h1><p>维护登录账号、所属部门与角色；状态切换即时生效，删除内置管理员会被服务端拒绝。</p></div>
      <div class="page-actions">
        <el-button :icon="Download" @click="exportCsv">导出</el-button>
        <el-button type="primary" :icon="Plus" :disabled="!session.can('system:user:add')" @click="openCreate">新增用户</el-button>
      </div>
    </header>

    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="crud.query.keyword" placeholder="搜索用户名或昵称" :prefix-icon="Search" clearable @keyup.enter="crud.search" @clear="crud.search" />
        <el-select v-model="crud.query.status" placeholder="账号状态" clearable @change="crud.search">
          <el-option label="正常" value="active" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-button type="primary" @click="crud.search">查询</el-button>
        <el-button :icon="Refresh" @click="crud.load">重置</el-button>
        <span class="muted">共 {{ crud.total }} 个账号</span>
      </div>

      <el-table v-loading="crud.loading" :data="crud.rows" row-key="id">
        <el-table-column label="用户" min-width="180">
          <template #default="{ row }">
            <div class="user-cell"><span class="avatar">{{ row.nickname.slice(0, 1) }}</span><div><strong>{{ row.nickname }}</strong><small>{{ row.username }}</small></div></div>
          </template>
        </el-table-column>
        <el-table-column prop="department" label="部门" min-width="130" />
        <el-table-column prop="role" label="角色" width="120" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column prop="email" label="邮箱" min-width="170" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '正常' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" :disabled="row.username === 'admin'" @click="toggleStatus(row)">{{ row.status === 'active' ? '停用' : '启用' }}</el-button>
            <el-button link type="danger" :disabled="row.username === 'admin'" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有匹配的用户" :image-size="64" /></template>
      </el-table>

      <div class="table-footer">
        <el-pagination
          :current-page="crud.page"
          :page-size="crud.pageSize"
          :total="crud.total"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50]"
          @current-change="crud.changePage"
          @size-change="crud.changeSize"
        />
      </div>
    </section>

    <el-dialog v-model="dialog" :title="editing ? '编辑用户' : '新增用户'" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="86px">
        <el-form-item label="用户名" prop="username"><el-input v-model="form.username" :disabled="Boolean(editing)" placeholder="登录账号" /></el-form-item>
        <el-form-item label="昵称" prop="nickname"><el-input v-model="form.nickname" placeholder="显示名称" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" placeholder="11 位手机号" /></el-form-item>
        <el-form-item label="邮箱" prop="email"><el-input v-model="form.email" placeholder="name@example.com" /></el-form-item>
        <el-form-item label="部门"><el-select v-model="form.department" style="width: 100%"><el-option v-for="item in ['平台研发部', '质量保障部', '市场运营部']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="角色"><el-select v-model="form.role" style="width: 100%"><el-option v-for="item in ['超级管理员', '系统管理员', '审计员', '运营专员']" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="状态"><el-radio-group v-model="form.status"><el-radio value="active">正常</el-radio><el-radio value="disabled">停用</el-radio></el-radio-group></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.user-cell { display: flex; align-items: center; gap: 10px; }
.user-cell .avatar { width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%; background: #eef2ff; color: #3730a3; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
.user-cell div { display: flex; flex-direction: column; }
.user-cell strong { font-size: 13px; color: var(--app-text); font-weight: 600; }
.user-cell small { font-size: 11px; color: var(--muted); }
</style>
