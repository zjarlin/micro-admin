import type { CrudPageSchema } from '@addzero/data-page'

export const dictPage: CrudPageSchema = {
  key: 'system.dict',
  title: '字典管理',
  description: '字典类型用于约束业务枚举值，例如用户性别、开关状态和通知类型。',
  entity: '字典',
  endpoint: '/system/dicts',
  permissions: { add: 'system:dict:add', edit: 'system:dict:edit', remove: 'system:dict:remove' },
  uniqueProps: ['type'],
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索字典名称或类型',
      match: 'like',
      props: ['name', 'type'],
    },
  ],
  columns: [
    { prop: 'name', label: '字典名称', minWidth: 150 },
    { prop: 'type', label: '字典类型', minWidth: 190, cell: 'code' },
    { prop: 'remark', label: '备注', minWidth: 220 },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
    },
  ],
  fields: [
    { prop: 'name', label: '字典名称', control: 'input', required: true },
    { prop: 'type', label: '字典类型', control: 'input', required: true, disabledOnEdit: true, help: '业务代码里引用的类型编码，创建后不建议修改。' },
    { prop: 'remark', label: '备注', control: 'textarea' },
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
