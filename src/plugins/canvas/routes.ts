import type { MenuContribution, RouteContribution } from '@/kernel'

/**
 * 画布工作台：**所有画布类页面只有一个入口**。
 *
 * 组态画布 / 画面库 / 图纸库 / 3D 预览本质上是同一件事的不同视图，过去各占一个菜单，
 * 左栏还要再放一条 rail 重复一遍导航——等于同一份导航写三处。
 * 现在侧栏只有「画布」一项，进来用页签切换；页签本身由各插件贡献 `canvas:tab` 槽位决定，
 * 停用某个插件它的页签自然消失，宿主不需要维护对照表。
 */
export const routes: RouteContribution[] = [
  {
    name: 'canvas',
    path: '/canvas',
    component: () => import('./pages/CanvasWorkbenchPage.vue'),
    title: '画布',
    permission: 'scada:screen:list',
    // IDE/CAD 型页面：画布要吃满视口，不要外壳边距与滚动条。
    meta: { fullBleed: true },
  },
]

export const menus: MenuContribution[] = [
  {
    id: 'canvas',
    title: '画布',
    path: '/canvas',
    icon: 'Grid',
    group: '组态与画面',
    order: 90,
    permission: 'scada:screen:list',
  },
]
