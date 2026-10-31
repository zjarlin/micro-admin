import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'role', path: '/system/role', component: () => import('./pages/RolePage.vue'), title: '角色管理', permission: 'system:role:list' },
  { name: 'menu', path: '/system/menu', component: () => import('./pages/MenuPage.vue'), title: '菜单管理', permission: 'system:menu:list' },
  { name: 'dept', path: '/system/dept', component: () => import('./pages/DeptPage.vue'), title: '部门管理', permission: 'system:dept:list' },
  { name: 'post', path: '/system/post', component: () => import('./pages/PostPage.vue'), title: '岗位管理', permission: 'system:post:list' },
]

export const menus: MenuContribution[] = [
  { id: 'sys-role', title: '角色管理', path: '/system/role', icon: 'UserFilled', group: '系统管理', order: 20, permission: 'system:role:list' },
  { id: 'sys-menu', title: '菜单管理', path: '/system/menu', icon: 'Menu', group: '系统管理', order: 30, permission: 'system:menu:list' },
  { id: 'sys-dept', title: '部门管理', path: '/system/dept', icon: 'OfficeBuilding', group: '系统管理', order: 40, permission: 'system:dept:list' },
  { id: 'sys-post', title: '岗位管理', path: '/system/post', icon: 'Postcard', group: '系统管理', order: 50, permission: 'system:post:list' },
]
