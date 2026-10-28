import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'user', path: '/system/user', component: () => import('./pages/UserPage.vue'), title: '用户管理', permission: 'system:user:list' },
  { name: 'role', path: '/system/role', component: () => import('./pages/RolePage.vue'), title: '角色管理', permission: 'system:role:list' },
  { name: 'menu', path: '/system/menu', component: () => import('./pages/MenuPage.vue'), title: '菜单管理', permission: 'system:menu:list' },
  { name: 'dept', path: '/system/dept', component: () => import('./pages/DeptPage.vue'), title: '部门管理', permission: 'system:dept:list' },
  { name: 'post', path: '/system/post', component: () => import('./pages/PostPage.vue'), title: '岗位管理', permission: 'system:post:list' },
  { name: 'dict', path: '/system/dict', component: () => import('./pages/DictPage.vue'), title: '字典管理', permission: 'system:dict:list' },
  { name: 'config', path: '/system/config', component: () => import('./pages/ConfigPage.vue'), title: '参数设置', permission: 'system:config:list' },
  { name: 'notice', path: '/system/notice', component: () => import('./pages/NoticePage.vue'), title: '通知公告', permission: 'system:notice:list' },
]

export const menus: MenuContribution[] = [
  { id: 'sys-user', title: '用户管理', path: '/system/user', icon: 'User', group: '系统管理', order: 10, permission: 'system:user:list' },
  { id: 'sys-role', title: '角色管理', path: '/system/role', icon: 'UserFilled', group: '系统管理', order: 20, permission: 'system:role:list' },
  { id: 'sys-menu', title: '菜单管理', path: '/system/menu', icon: 'Menu', group: '系统管理', order: 30, permission: 'system:menu:list' },
  { id: 'sys-dept', title: '部门管理', path: '/system/dept', icon: 'OfficeBuilding', group: '系统管理', order: 40, permission: 'system:dept:list' },
  { id: 'sys-post', title: '岗位管理', path: '/system/post', icon: 'Postcard', group: '系统管理', order: 50, permission: 'system:post:list' },
  { id: 'sys-dict', title: '字典管理', path: '/system/dict', icon: 'Collection', group: '系统工具', order: 60, permission: 'system:dict:list' },
  { id: 'sys-config', title: '参数设置', path: '/system/config', icon: 'Setting', group: '系统工具', order: 70, permission: 'system:config:list' },
  { id: 'sys-notice', title: '通知公告', path: '/system/notice', icon: 'Bell', group: '系统工具', order: 80, permission: 'system:notice:list' },
]
