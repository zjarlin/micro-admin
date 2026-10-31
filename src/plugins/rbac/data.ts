// RBAC 插件的页面基线：角色、部门、岗位、菜单。
import type { CrudPageSchema } from '@zjarlin/data-page'
import { rolePage } from './role.ts'
import { deptPage } from './dept.ts'
import { postPage } from './post.ts'
import { menuPage } from './menu.ts'

export const rbacPages: Record<string, CrudPageSchema> = {
  'system.role': rolePage,
  'system.dept': deptPage,
  'system.post': postPage,
  'system.menu': menuPage,
}

export { applyRbacToUserPage } from './user-extension.ts'
