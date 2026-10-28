import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  { name: 'online', path: '/monitor/online', component: () => import('./pages/OnlinePage.vue'), title: '在线用户', permission: 'monitor:online:list' },
  { name: 'job', path: '/monitor/job', component: () => import('./pages/JobPage.vue'), title: '定时任务', permission: 'monitor:job:list' },
  { name: 'server', path: '/monitor/server', component: () => import('./pages/ServerPage.vue'), title: '服务监控', permission: 'monitor:server:view' },
  { name: 'cache', path: '/monitor/cache', component: () => import('./pages/CachePage.vue'), title: '缓存监控', permission: 'monitor:cache:view' },
]

export const menus: MenuContribution[] = [
  { id: 'mon-online', title: '在线用户', path: '/monitor/online', icon: 'Connection', group: '系统监控', order: 90, permission: 'monitor:online:list' },
  { id: 'mon-job', title: '定时任务', path: '/monitor/job', icon: 'Timer', group: '系统监控', order: 100, permission: 'monitor:job:list' },
  { id: 'mon-server', title: '服务监控', path: '/monitor/server', icon: 'Monitor', group: '系统监控', order: 110, permission: 'monitor:server:view' },
  { id: 'mon-cache', title: '缓存监控', path: '/monitor/cache', icon: 'Coin', group: '系统监控', order: 120, permission: 'monitor:cache:view' },
]
