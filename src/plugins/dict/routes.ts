import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'dict', path: '/system/dict', component: () => import('./pages/DictPage.vue'), title: '字典管理', permission: 'system:dict:list' },
]

export const menus: MenuContribution[] = [
  { id: 'sys-dict', title: '字典管理', path: '/system/dict', icon: 'Collection', group: '系统工具', order: 60, permission: 'system:dict:list' },
]
