import type { CrudPageSchema } from '../schema.ts'

export const postPage: CrudPageSchema = {
  key: 'system.post',
  title: '岗位管理',
  description: '维护岗位编码与排序，供用户档案引用。',
  entity: '岗位',
  endpoint: '/system/posts',
  permissions: { add: 'system:post:add', edit: 'system:post:edit', remove: 'system:post:remove' },
  uniqueProps: ['code'],
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索岗位名称或编码',
      match: 'like',
      props: ['name', 'code'],
    },
  ],
  columns: [
    { prop: 'name', label: '岗位名称', minWidth: 160 },
    { prop: 'code', label: '岗位编码', width: 160, cell: 'code' },
    { prop: 'order', label: '排序', width: 90 },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
    },
  ],
  fields: [
    { prop: 'name', label: '岗位名称', control: 'input', required: true },
    { prop: 'code', label: '岗位编码', control: 'input', required: true, help: '唯一编码，供外部系统引用。' },
    { prop: 'order', label: '排序', control: 'number', default: 0 },
  ],
}
