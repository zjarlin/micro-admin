import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

/**
 * 组态画布插件。
 *
 * 画布能力来自 `okmy_dics` 的组态实现（SVG 求值 + 交互），这里只做插件化接入：
 * 图元库、画面文档与变量清单都走后端契约，页面不持有第二套渲染实现。
 */
export const scadaPlugin: PluginDefinition = {
  id: 'scada',
  name: '组态画布',
  version: '1.0.0',
  description: '从 okmy_dics 融合的组态编辑器：图元库、画面文档、变量绑定与导出。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('scada plugin disposed')
  },
}
