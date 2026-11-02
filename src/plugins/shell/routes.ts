import type { MenuContribution, RouteContribution } from '@/kernel'

/**
 * 外壳相关页面：外壳库（现役 + 所有图纸）与外壳设计器。
 *
 * 外壳属于「系统外观」，与「画布」区分：画布画的是**页面内容**，外壳画的是**整机外框**。
 * 设计器是 IDE 型页面，全出血、吃满视口。
 */
export const routes: RouteContribution[] = [
  {
    name: 'shell-gallery',
    path: '/shell',
    component: () => import('./pages/ShellGalleryPage.vue'),
    title: '外壳设计',
    permission: 'system:shell:config',
  },
  {
    name: 'shell-designer',
    path: '/shell/designer',
    component: () => import('./pages/ShellDesignerPage.vue'),
    title: '外壳设计器',
    permission: 'system:shell:config',
    meta: { fullBleed: true },
  },
]

export const menus: MenuContribution[] = [
  { id: 'sys-shell', title: '外壳设计', path: '/shell', icon: 'Brush', group: '系统工具', order: 75, permission: 'system:shell:config' },
]
