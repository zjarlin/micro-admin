import type { MenuContribution, RouteContribution } from '@/kernel'

export const routes: RouteContribution[] = [
  {
    name: 'scada-workbench',
    path: '/scada/workbench',
    component: () => import('./pages/ScadaWorkbenchPage.vue'),
    title: '组态画布',
    permission: 'scada:screen:list',
  },
  {
    name: 'scada-gallery',
    path: '/scada/gallery',
    component: () => import('./pages/ScadaGalleryPage.vue'),
    title: '画面库',
    permission: 'scada:screen:list',
  },
  {
    name: 'scada-preview',
    path: '/scada/preview',
    component: () => import('./pages/ScadaPreviewPage.vue'),
    title: '3D 预览',
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
  {
    // 3D 预览不做菜单入口：从画面库卡片进入，避免同一个动作两个入口。
    id: 'scada-gallery',
    title: '画面库',
    path: '/scada/gallery',
    icon: 'Files',
    group: '组态与画面',
    order: 91,
    permission: 'scada:screen:list',
  },
]
