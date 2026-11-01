import type { CrudPageSchema } from '@addzero/data-page'

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
    // 授权结果不在表单里编辑，用页面插槽按「已授权菜单数 / 权限码数」渲染：
    // schema 只声明「这一列交给宿主画」，勾选交互在 RoleMenuAuthorize.vue 里。
    { prop: 'menuIds', label: '授权菜单', width: 120, cell: 'custom', slot: 'authorize-cell' },
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
  // 声明了 actions 就整体替换默认的「编辑 / 删除」，所以这里把两个默认动作一并写上。
  // `authorize` 是 `kind: 'custom'`：按钮出现在行上，弹层由页面自己渲染。
  actions: [
    {
      key: 'authorize',
      label: '授权菜单',
      variant: 'primary',
      kind: 'custom',
      permission: 'system:role:authorize',
      // admin 用通配权限，改菜单授权对它没有意义，禁用避免误以为能收窄超管。
      disabledWhen: { prop: 'code', op: 'eq', value: 'admin' },
    },
    { key: 'edit', label: '编辑', kind: 'edit' },
    {
      key: 'remove',
      label: '删除',
      variant: 'danger',
      kind: 'delete',
      permission: 'system:role:remove',
      // 内置角色（有用户在用）不允许删，前后端同一份声明。
      disabledWhen: { prop: 'userCount', op: 'truthy' },
    },
  ],
}
