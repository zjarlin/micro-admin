import type { MenuContribution, RouteContribution } from '@/kernel'

/**
 * 组态画布插件的页面。
 *
 * 侧栏菜单不再由本插件提供——「组态画布 / 画面库 / 3D 预览」都是画布类视图，
 * 统一由 `canvas` 插件在 `/canvas` 里用页签切换（见 `canvas:tab` 槽位贡献）。
 * 老地址保留成带查询串的 redirect，收藏与已打开的标签页不会掉到 404。
 */
export const routes: RouteContribution[] = [
  {
    name: 'scada-workbench',
    path: '/scada/workbench',
    redirect: (to) => ({ path: '/canvas', query: { ...to.query, tab: 'scada.workbench' } }),
    title: '组态画布',
    permission: 'scada:screen:list',
  },
  {
    name: 'scada-gallery',
    path: '/scada/gallery',
    redirect: (to) => ({ path: '/canvas', query: { ...to.query, tab: 'scada.gallery' } }),
    title: '画面库',
    permission: 'scada:screen:list',
  },
  {
    name: 'scada-preview',
    path: '/scada/preview',
    redirect: (to) => ({ path: '/canvas', query: { ...to.query, tab: 'scada.preview' } }),
    title: '3D 预览',
    permission: 'scada:screen:list',
  },
]

/** 菜单只剩画布工作台一个入口（由 `canvas` 插件提供），这里不再重复登记。 */
export const menus: MenuContribution[] = []
