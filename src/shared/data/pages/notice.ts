import type { CrudPageSchema } from '../schema.ts'

export const noticePage: CrudPageSchema = {
  key: 'system.notice',
  title: '通知公告',
  description: '面向内部用户的通知与公告；只有「已发布」的内容会出现在工作台。',
  entity: '公告',
  endpoint: '/system/notices',
  permissions: { add: 'system:notice:add', edit: 'system:notice:edit', remove: 'system:notice:remove' },
  timestamps: { created: 'publishedAt' },
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索标题或发布人',
      match: 'like',
      props: ['title', 'author'],
    },
  ],
  columns: [
    { prop: 'title', label: '标题', minWidth: 300, cell: 'custom', slot: 'notice-title' },
    {
      prop: 'type',
      label: '类型',
      width: 100,
      cell: 'tagMap',
      tagMap: { notice: { label: '通知', tone: 'info' }, announcement: { label: '公告', tone: 'warning' } },
    },
    { prop: 'author', label: '发布人', width: 110 },
    { prop: 'publishedAt', label: '发布时间', width: 180, cell: 'datetime' },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { published: { label: '已发布', tone: 'success' }, draft: { label: '草稿', tone: 'info' } },
    },
  ],
  fields: [
    { prop: 'title', label: '标题', control: 'input', required: true },
    {
      prop: 'type',
      label: '类型',
      control: 'radio',
      default: 'notice',
      options: [
        { label: '通知', value: 'notice' },
        { label: '公告', value: 'announcement' },
      ],
    },
    { prop: 'author', label: '发布人', control: 'input', required: true },
    {
      prop: 'status',
      label: '状态',
      control: 'radio',
      default: 'draft',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '已发布', value: 'published' },
      ],
    },
  ],
}
