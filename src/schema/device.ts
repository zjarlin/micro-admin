// 设备台账：**没有任何前端文件**的页面样板。
//
// 这个页面只存在于后端配置里：`menu` 让宿主自动注册路由与侧栏菜单，
// `endpoint` 让通用引擎接管增删改查，`columns` / `fields` / `query` 决定界面。
// 想验证「原型图画好 → 代码即可上线」，就看这一份 schema。
import type { CrudPageSchema } from '@zjarlin/data-page'

export const devicePage: CrudPageSchema = {
  key: 'demo.device',
  title: '设备台账',
  description: '示例：整页只由后端 schema 定义，前端没有任何 .vue / routes.ts 改动。',
  entity: '设备',
  endpoint: '/demo/devices',
  permissions: {
    view: 'demo:device:list',
    add: 'demo:device:add',
    edit: 'demo:device:edit',
    remove: 'demo:device:remove',
    export: 'demo:device:export',
  },
  menu: { group: '组态与画面', icon: 'Cpu', order: 100 },
  uniqueProps: ['code'],
  timestamps: { created: 'createdAt' },
  query: [
    { prop: 'keyword', control: 'input', placeholder: '搜索设备名称或编号', match: 'like', props: ['name', 'code'] },
    {
      prop: 'status',
      control: 'select',
      placeholder: '运行状态',
      options: [
        { label: '在线', value: 'online' },
        { label: '离线', value: 'offline' },
      ],
    },
  ],
  columns: [
    { prop: 'code', label: '设备编号', width: 150, cell: 'code' },
    { prop: 'name', label: '设备名称', minWidth: 180 },
    { prop: 'site', label: '安装位置', minWidth: 150 },
    { prop: 'protocol', label: '协议', width: 110, cell: 'tagMap', tagMap: { Modbus: { label: 'Modbus', tone: 'primary' }, OPCUA: { label: 'OPC UA', tone: 'warning' }, MQTT: { label: 'MQTT', tone: 'success' } } },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      cell: 'status',
      tagMap: { online: { label: '在线', tone: 'success' }, offline: { label: '离线', tone: 'info' } },
    },
    { prop: 'createdAt', label: '接入时间', width: 170, cell: 'datetime' },
  ],
  fields: [
    { prop: 'code', label: '设备编号', control: 'input', required: true, help: '现场唯一编号，创建后不可修改。', disabledOnEdit: true },
    { prop: 'name', label: '设备名称', control: 'input', required: true },
    { prop: 'site', label: '安装位置', control: 'input' },
    {
      prop: 'protocol',
      label: '通讯协议',
      control: 'select',
      default: 'Modbus',
      options: [
        { label: 'Modbus', value: 'Modbus' },
        { label: 'OPC UA', value: 'OPCUA' },
        { label: 'MQTT', value: 'MQTT' },
      ],
    },
    {
      prop: 'status',
      label: '状态',
      control: 'radio',
      default: 'offline',
      options: [
        { label: '在线', value: 'online' },
        { label: '离线', value: 'offline' },
      ],
    },
  ],
  actions: [
    { key: 'edit', label: '编辑', variant: 'primary', kind: 'edit', permission: 'demo:device:edit' },
    { key: 'remove', label: '删除', variant: 'danger', kind: 'delete', permission: 'demo:device:remove', confirm: '删除设备 {name} 后不可恢复，确定继续？' },
  ],
}
