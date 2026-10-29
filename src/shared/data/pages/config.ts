import type { CrudPageSchema } from '../schema.ts'

export const configPage: CrudPageSchema = {
  key: 'system.config',
  title: '参数设置',
  description: '系统级键值参数，内置参数以锁定标识展示，不允许修改键名。',
  entity: '参数',
  endpoint: '/system/configs',
  permissions: { add: 'system:config:add', edit: 'system:config:edit', remove: 'system:config:remove' },
  uniqueProps: ['key'],
  undeletableWhen: { prop: 'builtin', op: 'truthy' },
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索参数名称或键名',
      match: 'like',
      props: ['name', 'key'],
    },
  ],
  columns: [
    { prop: 'name', label: '参数名称', minWidth: 190 },
    { prop: 'key', label: '参数键名', minWidth: 220, cell: 'code' },
    { prop: 'value', label: '参数键值', minWidth: 160 },
    {
      prop: 'builtin',
      label: '内置',
      width: 80,
      cell: 'tagMap',
      tagMap: { true: { label: '是', tone: 'warning' }, false: { label: '否', tone: 'info' } },
    },
    { prop: 'remark', label: '备注', minWidth: 180 },
  ],
  fields: [
    { prop: 'name', label: '参数名称', control: 'input', required: true },
    { prop: 'key', label: '参数键名', control: 'input', required: true, disabledOnEdit: true },
    { prop: 'value', label: '参数键值', control: 'input', required: true },
    { prop: 'remark', label: '备注', control: 'textarea' },
  ],
  actions: [
    { key: 'edit', label: '编辑', variant: 'primary', kind: 'edit', permission: 'system:config:edit' },
    {
      key: 'remove',
      label: '删除',
      variant: 'danger',
      kind: 'delete',
      permission: 'system:config:remove',
      disabledWhen: { prop: 'builtin', op: 'truthy' },
      confirm: '删除参数 {name} 后不可恢复，确定继续？',
    },
  ],
}
