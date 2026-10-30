// 种子图纸：把现有「用户管理」页面的几何复刻成一张图纸。
//
// 目的不是「多一份用户管理」，而是证明图纸能表达现有页面：
// 同一份列、字段、查询、动作、权限、左树，编译出来的 schema 与手写基线等价。
// 因此它是可删的示例——`seed.ts` 里的手写基线仍然是权威，图纸是它的另一种写法。

import type { UiDrawing, UiElement } from '../../../packages/ui-canvas/src/index.ts'

/** 元素构造快捷函数：种子只填必要字段，其余走角色默认值。 */
function element(
  id: string,
  role: UiElement['role'],
  rect: UiElement['rect'],
  patch: Partial<UiElement> = {},
): UiElement {
  return {
    id,
    role,
    rect,
    zIndex: patch.zIndex ?? 0,
    text: patch.text ?? '',
    props: patch.props ?? {},
    bindings: patch.bindings ?? [],
    locked: patch.locked ?? false,
    visible: patch.visible ?? true,
  }
}

/** 用户管理图纸：容器 + 列 + 查询 + 表单 + 行操作，覆盖全部叶层角色。 */
function userDrawing(): UiDrawing {
  return {
    version: 1,
    meta: {
      key: 'draft.user-drawing',
      title: '用户管理（图纸版）',
      description: '由图纸编译：改图纸即改页面，不需要发版。',
      entity: '用户',
      endpoint: '/system/users',
      pageSize: 20,
      rowKey: 'id',
      exportable: true,
      permissions: {
        add: 'system:user:add',
        edit: 'system:user:edit',
        remove: 'system:user:remove',
        export: 'system:user:export',
      },
      menu: { title: '用户管理（图纸）', group: '图纸示例', icon: 'User', order: 200, path: '/p/draft.user-drawing' },
      uniqueProps: ['username'],
      undeletableWhen: { prop: 'username', op: 'eq', value: 'admin' },
    },
    canvas: { width: 1440, height: 920, grid: 20, background: '#f8fafc', showGrid: true },
    elements: [
      element('page', 'page', { x: 0, y: 0, width: 1440, height: 920 }, { zIndex: 0 }),
      element('header', 'header', { x: 20, y: 16, width: 1400, height: 52 }, { zIndex: 1 }),
      element('header-title', 'text', { x: 36, y: 30, width: 260, height: 24 }, { zIndex: 2, text: '用户管理（图纸版）' }),
      element('toolbar', 'toolbar', { x: 1180, y: 24, width: 240, height: 36 }, { zIndex: 2, props: { exportable: true } }),
      element('action-new', 'action', { x: 1220, y: 26, width: 96, height: 32 }, {
        zIndex: 3, text: '新增用户',
        props: { label: '新增用户', kind: 'create', variant: 'primary', permission: 'system:user:add' },
      }),
      element('action-export', 'action', { x: 1322, y: 26, width: 88, height: 32 }, {
        zIndex: 3, text: '导出',
        props: { label: '导出', kind: 'request', request: { method: 'POST', path: '/system/users/export' } },
        bindings: [{ kind: 'event', channel: 'click', action: 'request', params: { method: 'POST', path: '/system/users/export' } }],
      }),
      element('filter', 'filter', { x: 20, y: 84, width: 1080, height: 56 }, { zIndex: 1 }),
      element('query-keyword', 'query', { x: 32, y: 96, width: 220, height: 32 }, {
        zIndex: 2,
        props: { prop: 'keyword', control: 'input', placeholder: '搜索用户名或昵称', match: 'like', props: ['username', 'nickname'] },
      }),
      element('query-status', 'query', { x: 264, y: 96, width: 140, height: 32 }, {
        zIndex: 2,
        props: { prop: 'status', control: 'select', options: [{ label: '正常', value: 'active' }, { label: '停用', value: 'disabled' }] },
      }),
      element('tree', 'tree', { x: 20, y: 156, width: 220, height: 520 }, {
        zIndex: 1,
        props: { treeEndpointOf: '/system/departments', treeParam: 'deptId' },
      }),
      element('table', 'table', { x: 256, y: 156, width: 1164, height: 520 }, {
        zIndex: 1,
        props: { endpoint: '/system/users', pageSize: 20 },
        bindings: [{ kind: 'data', channel: 'table.rows' }],
      }),
      element('col-nickname', 'column', { x: 268, y: 186, width: 200, height: 40 }, {
        zIndex: 2, props: { prop: 'nickname', label: '用户' },
      }),
      element('col-dept', 'column', { x: 474, y: 186, width: 140, height: 40 }, {
        zIndex: 2,
        props: { prop: 'deptId', label: '部门', resolveFrom: { endpoint: '/system/departments', keyProp: 'id', labelProp: 'name' } },
      }),
      element('col-role', 'column', { x: 620, y: 186, width: 130, height: 40 }, {
        zIndex: 2,
        props: { prop: 'roleId', label: '角色', resolveFrom: { endpoint: '/system/roles', keyProp: 'id', labelProp: 'name' } },
      }),
      element('col-phone', 'column', { x: 756, y: 186, width: 140, height: 40 }, {
        zIndex: 2, props: { prop: 'phone', label: '手机号' },
      }),
      element('col-email', 'column', { x: 902, y: 186, width: 190, height: 40 }, {
        zIndex: 2, props: { prop: 'email', label: '邮箱' },
      }),
      element('col-status', 'column', { x: 1098, y: 186, width: 110, height: 40 }, {
        zIndex: 2,
        props: {
          prop: 'status', label: '状态', cell: 'status',
          tagMap: { active: { label: '正常', tone: 'success' }, disabled: { label: '停用', tone: 'info' } },
        },
      }),
      element('col-created', 'column', { x: 1214, y: 186, width: 170, height: 40 }, {
        zIndex: 2, props: { prop: 'createdAt', label: '创建时间', cell: 'datetime' },
      }),
      element('action-edit', 'action', { x: 1290, y: 230, width: 56, height: 32 }, {
        zIndex: 3, text: '编辑',
        props: { label: '编辑', kind: 'edit', permission: 'system:user:edit' },
        bindings: [{ kind: 'event', channel: 'click', action: 'dialog' }],
      }),
      element('action-delete', 'action', { x: 1352, y: 230, width: 56, height: 32 }, {
        zIndex: 3, text: '删除',
        props: {
          label: '删除', kind: 'delete', confirm: '确定删除「{nickname}」？',
          request: { method: 'DELETE', path: '/system/users/{id}' },
          disabledWhen: { prop: 'username', op: 'eq', value: 'admin' },
        },
      }),
      element('form', 'form', { x: 420, y: 700, width: 560, height: 200 }, { zIndex: 1 }),
      element('field-username', 'field', { x: 440, y: 726, width: 250, height: 56 }, {
        zIndex: 2, props: { prop: 'username', label: '账号', control: 'input', required: true, disabledOnEdit: true },
      }),
      element('field-nickname', 'field', { x: 710, y: 726, width: 250, height: 56 }, {
        zIndex: 2, props: { prop: 'nickname', label: '昵称', control: 'input', required: true },
      }),
      element('field-dept', 'field', { x: 440, y: 796, width: 520, height: 56 }, {
        zIndex: 2, props: { prop: 'deptId', label: '所属部门', control: 'treeSelect', required: true, treeEndpoint: '/system/departments' },
      }),
      element('stat-users', 'stat', { x: 1100, y: 700, width: 200, height: 96 }, {
        zIndex: 2, text: '用户总数',
        props: { label: '用户总数', prop: 'total', value: 18, code: '' },
        bindings: [{ kind: 'data', channel: 'stat.value', source: 'total' }],
      }),
    ],
  }
}

/** 种子图纸清单。 */
export function seedDrawings(): Array<{
  id: number
  name: string
  description: string | null
  drawingJson: string
  version: number
  publishedKey: string | null
  publishedVersion: number | null
  sortIndex: number
  createdAt: number
  updatedAt: number
}> {
  const now = Date.now()
  const drawing = userDrawing()
  return [{
    id: 1,
    name: '用户管理（图纸版）',
    description: '复刻现有用户管理页：查询 + 左树 + 8 列 + 表单 + 行操作 + 指标卡',
    drawingJson: JSON.stringify(drawing),
    version: 1,
    publishedKey: null,
    publishedVersion: null,
    sortIndex: 0,
    createdAt: now,
    updatedAt: now,
  }]
}
