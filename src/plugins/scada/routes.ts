import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  {
    name: 'scada-workbench',
    path: '/scada/workbench',
    component: () => import('./pages/ScadaWorkbenchPage.vue'),
    title: '组态画布',
    permission: 'scada:screen:list',
  },
]

export const menus: MenuContribution[] = [
  {
    id: 'scada-workbench',
    title: '组态画布',
    path: '/scada/workbench',
    icon: 'Grid',
    group: '组态与画面',
    order: 90,
    permission: 'scada:screen:list',
  },
]
