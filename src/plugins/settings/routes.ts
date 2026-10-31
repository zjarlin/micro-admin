import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'config', path: '/system/config', component: () => import('./pages/ConfigPage.vue'), title: '参数设置', permission: 'system:config:list' },
  { name: 'notice', path: '/system/notice', component: () => import('./pages/NoticePage.vue'), title: '通知公告', permission: 'system:notice:list' },
]

export const menus: MenuContribution[] = [
  { id: 'sys-config', title: '参数设置', path: '/system/config', icon: 'Setting', group: '系统工具', order: 70, permission: 'system:config:list' },
  { id: 'sys-notice', title: '通知公告', path: '/system/notice', icon: 'Bell', group: '系统工具', order: 80, permission: 'system:notice:list' },
]
