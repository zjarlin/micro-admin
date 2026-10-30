// 用户管理页面 schema：原来 169 行的手写页面，现在只剩这份声明。
import type { CrudPageSchema } from '@zjarlin/data-page'

export const userPage: CrudPageSchema = {
  key: 'system.user',
  title: '用户管理',
  description: '维护登录账号、所属部门与角色。删除内置管理员会被服务端拒绝。',
  entity: '用户',
  endpoint: '/system/users',
  exportable: true,
  permissions: {
    add: 'system:user:add',
    edit: 'system:user:edit',
    remove: 'system:user:remove',
    export: 'system:user:export',
  },
  uniqueProps: ['username'],
  timestamps: { created: 'createdAt' },
  undeletableWhen: { prop: 'username', op: 'eq', value: 'admin' },
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索用户名或昵称',
      // 一个输入框匹配两列：由 schema 声明，后端据此生成 like 条件。
      match: 'like',
      props: ['username', 'nickname'],
    },
    {
      prop: 'status',
      control: 'select',
      placeholder: '账号状态',
      options: [
        { label: '正常', value: 'active' },
        { label: '停用', value: 'disabled' },
      ],
    },
  ],
  columns: [
    { prop: 'nickname', label: '用户', minWidth: 180, cell: 'custom', slot: 'user-cell' },
    {
      prop: 'deptId',
      label: '部门',
      minWidth: 130,
      // 存 id、显示名称：部门改名后列表自动跟着变，不在用户表冗余名称。
      resolveFrom: { endpoint: '/system/departments', keyProp: 'id', labelProp: 'name' },
    },
    {
      prop: 'roleId',
      label: '角色',
      width: 120,
      resolveFrom: { endpoint: '/system/roles', keyProp: 'id', labelProp: 'name' },
    },
    { prop: 'phone', label: '手机号', width: 130 },
    { prop: 'email', label: '邮箱', minWidth: 170 },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: {
        active: { label: '正常', tone: 'success' },
        disabled: { label: '停用', tone: 'info' },
      },
    },
    { prop: 'createdAt', label: '创建时间', width: 170, cell: 'datetime' },
  ],
  fields: [
    { prop: 'username', label: '用户名', control: 'input', required: true, disabledOnEdit: true, help: '登录账号，创建后不可修改。' },
    { prop: 'nickname', label: '昵称', control: 'input', required: true },
    { prop: 'phone', label: '手机号', control: 'input', placeholder: '11 位手机号' },
    { prop: 'email', label: '邮箱', control: 'input', rules: [{ kind: 'email' }], placeholder: 'name@example.com' },
    {
      prop: 'deptId',
      label: '部门',
      control: 'select',
      span: 12,
      optionsFrom: { endpoint: '/system/departments', valueProp: 'id', labelProp: 'name' },
    },
    {
      prop: 'roleId',
      label: '角色',
      control: 'select',
      span: 12,
      optionsFrom: { endpoint: '/system/roles', valueProp: 'id', labelProp: 'name' },
    },
    {
      prop: 'status',
      label: '状态',
      control: 'radio',
      default: 'active',
      options: [
        { label: '正常', value: 'active' },
        { label: '停用', value: 'disabled' },
      ],
    },
  ],
  actions: [
    { key: 'edit', label: '编辑', variant: 'primary', kind: 'edit', permission: 'system:user:edit' },
    {
      key: 'toggle',
      label: '启停',
      variant: 'warning',
      kind: 'request',
      permission: 'system:user:edit',
      disabledWhen: { prop: 'username', op: 'eq', value: 'admin' },
      request: { method: 'PUT', path: '/system/users/{id}', body: { status: '{status}' } },
    },
    {
      key: 'remove',
      label: '删除',
      variant: 'danger',
      kind: 'delete',
      permission: 'system:user:remove',
      disabledWhen: { prop: 'username', op: 'eq', value: 'admin' },
      confirm: '删除用户 {nickname} 后不可恢复，确定继续？',
    },
  ],
  tree: {
    endpoint: '/system/departments',
    idProp: 'id',
    labelProp: 'name',
    parentProp: 'parentId',
    param: 'deptId',
    filterProp: 'deptId',
    allLabel: '全部部门',
    captionProp: 'leader',
    searchable: true,
  },
}
