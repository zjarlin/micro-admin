import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  {
    name: 'dashboard',
    path: '/dashboard',
    component: () => import('./pages/DashboardPage.vue'),
    title: '工作台',
    meta: { icon: 'HomeFilled', group: '概览' },
  },
  {
    name: 'plugins',
    path: '/plugins',
    component: () => import('./pages/PluginCenterPage.vue'),
    title: '插件中心',
    meta: { icon: 'Grid', group: '概览' },
  },
  {
    name: 'profile',
    path: '/profile',
    component: () => import('./pages/ProfilePage.vue'),
    title: '个人中心',
    meta: { icon: 'User', hidden: true },
  },
  {
    name: 'not-found',
    path: '/:pathMatch(.*)*',
    component: () => import('./pages/NotFoundPage.vue'),
    title: '页面不存在',
    meta: { hidden: true },
  },
]

export const menus: MenuContribution[] = [
  { id: 'menu-dashboard', title: '工作台', path: '/dashboard', icon: 'HomeFilled', group: '概览', order: 1 },
  { id: 'menu-plugins', title: '插件中心', path: '/plugins', icon: 'Grid', group: '概览', order: 2 },
]
