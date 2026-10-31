// 用户插件的页面声明：只管「账号本身」。
//
// 部门、角色属于 RBAC 插件，用户插件不引用它们（否则工具类产品只想要一张用户表时会被迫装权限体系）。
// RBAC 挂载时由 `rbac` 插件给这份 schema 追加列、表单字段与左树，见 `plugins/rbac/user-extension.ts`。
import type { CrudPageSchema } from '@zjarlin/data-page'

export const userPage: CrudPageSchema = {
  key: 'system.user',
  title: '用户管理',
  description: '维护登录账号与联系方式。删除内置管理员会被服务端拒绝。',
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
}

/** 本插件贡献的页面基线，key 即页面标识。 */
export const userPages: Record<string, CrudPageSchema> = {
  'system.user': userPage,
}
