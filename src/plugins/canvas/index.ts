import type { PluginDefinition } from '@/kernel'
import { menus, routes } from './routes'

/**
 * 画布宿主插件：只做「一列页签 + 一块吃满视口的舞台」，具体页面全由 `canvas:tab` 槽位贡献。
 *
 * 边界：
 * - 宿主不 import 任何画布页面（组态、图纸都在各自的插件里），因此停用 `scada` 或
 *   `ui-canvas` 时不会留下悬空引用，宿主只是少一个页签；
 * - 页签顺序由槽位 `order` 决定，标题/图标来自槽位声明，宿主不写第二份清单；
 * - 当前页签落在地址栏（`?tab=`），刷新、分享、浏览器前进后退都能复现同一个视图。
 */
export const canvasPlugin: PluginDefinition = {
  id: 'canvas',
  name: '画布',
  version: '1.0.0',
  description: '画布类页面的统一入口：组态画布、画面库、图纸库、3D 预览用页签切换。',
  author: 'Microkernel Admin',
  requires: ['core-admin'],
  optionalRequires: ['scada', 'ui-canvas'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('canvas plugin disposed')
  },
}
