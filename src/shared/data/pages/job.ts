import type { CrudPageSchema } from '../schema.ts'

// 定时任务：只读列表 + 声明式启停。
//
// 页面里没有任何「暂停/恢复」的分支代码：两条 action 各自声明可见条件与请求模板，
// 行操作执行器按 schema 调用 `PATCH /monitor/jobs/{id}`。
export const jobPage: CrudPageSchema = {
  key: 'monitor.job',
  title: '定时任务',
  description: '展示 cron 表达式与下次执行时间；暂停/恢复直接写入任务状态。',
  entity: '任务',
  endpoint: '/monitor/jobs',
  permissions: { edit: 'monitor:job:edit' },
  query: [
    {
      prop: 'keyword',
      control: 'input',
      placeholder: '搜索任务名称或分组',
      match: 'like',
      props: ['name', 'group'],
    },
  ],
  columns: [
    { prop: 'name', label: '任务名称', minWidth: 170 },
    { prop: 'group', label: '分组', width: 120 },
    { prop: 'target', label: '调用目标', minWidth: 180, cell: 'code' },
    { prop: 'cron', label: 'cron', width: 150, cell: 'code' },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { running: { label: '运行中', tone: 'success' }, paused: { label: '已暂停', tone: 'info' } },
    },
    { prop: 'nextRunAt', label: '下次执行', width: 170, cell: 'datetime' },
  ],
  actions: [
    {
      key: 'pause',
      label: '暂停',
      variant: 'warning',
      kind: 'request',
      permission: 'monitor:job:edit',
      visibleWhen: { prop: 'status', op: 'eq', value: 'running' },
      request: { method: 'PATCH', path: '/monitor/jobs/{id}', body: { status: 'paused' } },
    },
    {
      key: 'resume',
      label: '恢复',
      variant: 'warning',
      kind: 'request',
      permission: 'monitor:job:edit',
      visibleWhen: { prop: 'status', op: 'eq', value: 'paused' },
      request: { method: 'PATCH', path: '/monitor/jobs/{id}', body: { status: 'running' } },
    },
  ],
}
