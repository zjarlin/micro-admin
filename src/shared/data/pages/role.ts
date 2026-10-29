import type { CrudPageSchema } from '../schema.ts'

export const rolePage: CrudPageSchema = {
  key: 'system.role',
  title: '角色管理',
  description: '角色决定菜单与按钮权限。超级管理员使用通配权限，其余角色按权限码逐项放行。',
  entity: '角色',
  endpoint: '/system/roles',
  permissions: { add: 'system:role:add', edit: 'system:role:edit', remove: 'system:role:remove' },
  uniqueProps: ['code'],
  timestamps: { created: 'createdAt' },
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索角色名称或编码',
      match: 'like',
      props: ['name', 'code'],
    },
  ],
  columns: [
    { prop: 'name', label: '角色名称', minWidth: 140 },
    { prop: 'code', label: '权限字符', width: 140, cell: 'code' },
    { prop: 'description', label: '描述', minWidth: 240 },
    { prop: 'userCount', label: '用户数', width: 90 },
    {
      prop: 'status',
      label: '状态',
      width: 90,
      cell: 'status',
      tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
    },
    { prop: 'createdAt', label: '创建时间', width: 170, cell: 'datetime' },
  ],
  fields: [
    { prop: 'name', label: '角色名称', control: 'input', required: true },
    { prop: 'code', label: '权限字符', control: 'input', required: true, placeholder: '例如 operator' },
    { prop: 'description', label: '描述', control: 'textarea' },
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
}
