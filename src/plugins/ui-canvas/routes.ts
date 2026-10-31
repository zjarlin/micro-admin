import type { MenuContribution, RouteContribution } from '@/kernel'

/**
 * 图纸相关页面。
 *
 * 图纸库与画面库、3D 预览同属「画布」视图，菜单入口统一在 `canvas` 插件；
 * 设计器与运行预览是独立的全屏页面（不是画布的另一种视图），保留自己的路由。
 */
export const routes: RouteContribution[] = [
  {
    name: 'ui-canvas-gallery',
    path: '/ui-canvas/gallery',
    redirect: (to) => ({ path: '/canvas', query: { ...to.query, tab: 'ui-canvas.gallery' } }),
    title: '图纸库',
    permission: 'scada:screen:list',
  },
  {
    name: 'ui-canvas-designer',
    path: '/ui-canvas/designer',
    component: () => import('./pages/UiDrawingDesignerPage.vue'),
    title: '图纸设计器',
    permission: 'scada:screen:list',
    // 设计器是 IDE 型页面：画布要吃满视口，不要外壳的边距与滚动。
    meta: { fullBleed: true },
  },
  {
    name: 'ui-canvas-run',
    path: '/ui-canvas/run',
    component: () => import('./pages/UiDrawingRunPage.vue'),
    title: '运行预览',
    permission: 'scada:screen:list',
    meta: { fullBleed: true },
  },
]

/** 菜单入口在 `canvas` 插件，这里不再登记第二份。 */
export const menus: MenuContribution[] = []
