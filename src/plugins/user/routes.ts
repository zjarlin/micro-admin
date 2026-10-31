import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'user', path: '/system/user', component: () => import('./pages/UserPage.vue'), title: '用户管理', permission: 'system:user:list' },
]

export const menus: MenuContribution[] = [
  { id: 'sys-user', title: '用户管理', path: '/system/user', icon: 'User', group: '系统管理', order: 10, permission: 'system:user:list' },
]
