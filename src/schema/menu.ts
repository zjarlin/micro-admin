import type { CrudPageSchema } from '@zjarlin/data-page'

export const menuPage: CrudPageSchema = {
  key: 'system.menu',
  title: '菜单管理',
  description: '这里的树是演示数据；运行中的侧边栏由各插件通过 ctx.menus.add() 贡献并经过权限过滤。',
  layout: 'tree-table',
  entity: '菜单',
  endpoint: '/system/menus',
  permissions: { add: 'system:menu:add', edit: 'system:menu:edit', remove: 'system:menu:remove' },
  columns: [
    { prop: 'title', label: '菜单标题', minWidth: 180 },
    { prop: 'path', label: '路由地址', minWidth: 180, cell: 'code' },
    {
      prop: 'type',
      label: '类型',
      width: 90,
      cell: 'tagMap',
      tagMap: {
        directory: { label: '目录', tone: 'warning' },
        menu: { label: '菜单', tone: 'primary' },
        button: { label: '按钮', tone: 'info' },
      },
    },
    { prop: 'permission', label: '权限标识', minWidth: 180, cell: 'code' },
    { prop: 'order', label: '排序', width: 80 },
    {
      prop: 'status',
      label: '状态',
      width: 90,
      cell: 'status',
      tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
    },
  ],
  tree: {
    endpoint: '/system/menus',
    idProp: 'id',
    labelProp: 'title',
    parentProp: 'parentId',
    allLabel: '全部菜单',
    param: 'parentId',
    searchable: false,
  },
}
