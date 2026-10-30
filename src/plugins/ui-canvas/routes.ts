import type { MenuContribution, RouteContribution } from '@/kernel'

/** 图纸相关页面：库、设计器、运行预览。 */
export const routes: RouteContribution[] = [
  {
    name: 'ui-canvas-gallery',
    path: '/ui-canvas/gallery',
    component: () => import('./pages/UiDrawingGalleryPage.vue'),
    title: '图纸库',
    permission: 'scada:screen:list',
  },
  {
    name: 'ui-canvas-designer',
    path: '/ui-canvas/designer',
    component: () => import('./pages/UiDrawingDesignerPage.vue'),
    title: '图纸设计器',
    permission: 'scada:screen:list',
  },
  {
    name: 'ui-canvas-run',
    path: '/ui-canvas/run',
    component: () => import('./pages/UiDrawingRunPage.vue'),
    title: '运行预览',
    permission: 'scada:screen:list',
  },
]

export const menus: MenuContribution[] = [
  {
    id: 'ui-canvas-gallery',
    title: '图纸库',
    path: '/ui-canvas/gallery',
    icon: 'Stamp',
    group: '组态与画面',
    order: 92,
    permission: 'scada:screen:list',
  },
]
