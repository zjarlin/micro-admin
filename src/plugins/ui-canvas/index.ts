import { defineAsyncComponent } from 'vue'
import type { PluginDefinition } from '@/kernel'
import { menus, routes } from './routes'

const UiDrawingGalleryPage = defineAsyncComponent(() => import('./pages/UiDrawingGalleryPage.vue'))

/**
 * 图纸插件：2D 图纸 → 可运行页面。
 *
 * 与 `scada` 插件分工：`scada` 管「画面」（运行期的监控画面），
 * 这里管「图纸」（设计期画出来的后台页面，编译后即上线）。
 * 两者共用一套画布交互与角色表，但上线链路完全不同。
 */
export const uiCanvasPlugin: PluginDefinition = {
  id: 'ui-canvas',
  name: '图纸设计',
  version: '1.0.0',
  description: '把 2D 图纸编译成后台页面：画完即上线，元素可绑数据与事件。',
  author: 'Micro Admin',
  requires: ['core-admin', 'pages'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.slots.add({ name: 'canvas:tab', id: 'ui-canvas.gallery', title: '图纸库', icon: 'Stamp', order: 30, component: UiDrawingGalleryPage })
    return () => ctx.logger.debug('ui-canvas plugin disposed')
  },
}
