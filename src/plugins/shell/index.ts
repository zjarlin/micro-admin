import type { PluginDefinition } from '@/kernel'
import { menus, routes } from './routes'

/**
 * 外壳插件：把「后台外壳长什么样」也变成可画、可编译、可下发的图纸。
 *
 * 边界：
 * - 图纸模型与编译器在 workspace 包 `@zjarlin/ui-canvas`（`./shell` 导出），可独立发布；
 * - 存取在服务端 `server/plugins/shell`，与前端共享同一份编译器，不出现第二份实现；
 * - 本插件只提供**设计期**页面（外壳库 + 设计器）；运行期渲染在 `ShellFrame.vue`，
 *   由 `AdminLayout` 消费——外壳不依赖本插件是否启用（停用它只是没了设计入口，外壳照常渲染）。
 */
export const shellPlugin: PluginDefinition = {
  id: 'shell',
  name: '外壳设计',
  version: '1.0.0',
  description: '画布画出整机外壳：侧栏、顶栏图标行、点击事件与在线模板都能在画布上配，发布即生效。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('shell plugin disposed')
  },
}
