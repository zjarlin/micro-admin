import { defineAsyncComponent } from 'vue'
import type { PluginDefinition } from '@/kernel'
import { menus, routes } from './routes'

const ScadaWorkbenchPage = defineAsyncComponent(() => import('./pages/ScadaWorkbenchPage.vue'))
const ScadaGalleryPage = defineAsyncComponent(() => import('./pages/ScadaGalleryPage.vue'))
const ScadaPreviewPage = defineAsyncComponent(() => import('./pages/ScadaPreviewPage.vue'))

/**
 * 组态画布插件。
 *
 * 画布能力来自 `okmy_dics` 的组态实现（SVG 求值 + 交互），这里只做插件化接入：
 * 图元库、画面文档与变量清单都走后端契约，页面不持有第二套渲染实现。
 *
 * 三个页面都贡献到 `canvas:tab`：侧栏只有一个「画布」入口，页签由本插件声明，
 * 停用本插件页签整块消失，宿主不需要知道有哪些画布页面。
 */
export const scadaPlugin: PluginDefinition = {
  id: 'scada',
  name: '组态画布',
  version: '1.0.0',
  description: '从 okmy_dics 融合的组态编辑器：图元库、画面文档、变量绑定与导出。',
  author: 'Micro Admin',
  requires: ['core-admin', 'canvas'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.slots.add({ name: 'canvas:tab', id: 'scada.workbench', title: '组态画布', icon: 'EditPen', order: 10, component: ScadaWorkbenchPage })
    ctx.slots.add({ name: 'canvas:tab', id: 'scada.gallery', title: '画面库', icon: 'Files', order: 20, component: ScadaGalleryPage })
    ctx.slots.add({ name: 'canvas:tab', id: 'scada.preview', title: '3D 预览', icon: 'Box', order: 40, component: ScadaPreviewPage })
    return () => ctx.logger.debug('scada plugin disposed')
  },
}
