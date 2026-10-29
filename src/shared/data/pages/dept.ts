import type { CrudPageSchema } from '../schema.ts'

export const deptPage: CrudPageSchema = {
  key: 'system.dept',
  title: '部门管理',
  description: '按组织层级维护部门、负责人和联系方式；父级决定层级归属。',
  entity: '部门',
  endpoint: '/system/departments',
  permissions: { add: 'system:dept:add', edit: 'system:dept:edit', remove: 'system:dept:remove' },
  columns: [
    { prop: 'name', label: '部门名称', minWidth: 220 },
    { prop: 'leader', label: '负责人', width: 120 },
    { prop: 'phone', label: '联系电话', width: 150 },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
    },
  ],
  fields: [
    { prop: 'name', label: '部门名称', control: 'input', required: true },
    { prop: 'leader', label: '负责人', control: 'input' },
    { prop: 'phone', label: '联系电话', control: 'input' },
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
    {
      key: 'addChild',
      label: '新增下级',
      variant: 'primary',
      kind: 'create',
      permission: 'system:dept:add',
    },
    { key: 'edit', label: '编辑', variant: 'primary', kind: 'edit', permission: 'system:dept:edit' },
  ],
  tree: {
    endpoint: '/system/departments',
    idProp: 'id',
    labelProp: 'name',
    parentProp: 'parentId',
    allLabel: '全部部门',
    param: 'parentId',
    searchable: false,
  },
}
