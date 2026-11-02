import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

/**
 * 系统工具插件。
 *
 * 两个入口共用一个插件：
 * - 「参数设置 / 通知公告」是若依式的手写页面（schema 驱动）；
 * - 「系统设置」是插件贡献的聚合页（`ctx.settings`）：各插件把设置项交给内核，
 *   由 `SettingsPage.vue` 按分组渲染成标签页，插件不再各自建「XX 设置」页面。
 */
export const settingsPlugin: PluginDefinition = {
  id: 'settings',
  name: '系统工具',
  version: '2.0.0',
  description: '参数设置、通知公告，以及把各插件设置收进一个页面的系统设置。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('settings plugin disposed')
  },
}
