// RBAC 对用户页的增强：部门列、角色列、部门左树都在这里，用户插件本身不认识它们。
//
// 这样「只装用户插件」的产品拿到的是纯账号表，装了 rbac 才长成若依那套。
import type { ColumnSchema, CrudPageSchema, FieldSchema } from '@zjarlin/data-page'

const DEPT_COLUMN: ColumnSchema = {
  prop: 'deptId',
  label: '部门',
  minWidth: 130,
  // 存 id、显示名称：部门改名后列表自动跟着变，不在用户表冗余名称。
  resolveFrom: { endpoint: '/system/departments', keyProp: 'id', labelProp: 'name' },
}

const ROLE_COLUMN: ColumnSchema = {
  prop: 'roleId',
  label: '角色',
  width: 120,
  resolveFrom: { endpoint: '/system/roles', keyProp: 'id', labelProp: 'name' },
}

const DEPT_FIELD: FieldSchema = {
  prop: 'deptId',
  label: '部门',
  control: 'select',
  span: 12,
  optionsFrom: { endpoint: '/system/departments', valueProp: 'id', labelProp: 'name' },
}

const ROLE_FIELD: FieldSchema = {
  prop: 'roleId',
  label: '角色',
  control: 'select',
  span: 12,
  optionsFrom: { endpoint: '/system/roles', valueProp: 'id', labelProp: 'name' },
}

/** 插到某个字段之后；找不到锚点就追加到末尾，避免上游改字段顺序时整页崩掉。 */
function insertAfter<T extends { prop: string }>(items: readonly T[], prop: string, additions: readonly T[]): T[] {
  const index = items.findIndex((item) => item.prop === prop)
  if (index < 0) return [...items, ...additions]
  return [...items.slice(0, index + 1), ...additions, ...items.slice(index + 1)]
}

/** 把用户页升级成「带部门与角色」的版本。 */
export function applyRbacToUserPage(base: CrudPageSchema): CrudPageSchema {
  return {
    ...base,
    description: '维护登录账号、所属部门与角色。删除内置管理员会被服务端拒绝。',
    columns: insertAfter(base.columns, 'nickname', [DEPT_COLUMN, ROLE_COLUMN]),
    fields: insertAfter(base.fields ?? [], 'email', [DEPT_FIELD, ROLE_FIELD]),
    tree: {
      endpoint: '/system/departments',
      idProp: 'id',
      labelProp: 'name',
      parentProp: 'parentId',
      param: 'deptId',
      filterProp: 'deptId',
      allLabel: '全部部门',
      captionProp: 'leader',
      searchable: true,
    },
  }
}
