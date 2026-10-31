import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

export const settingsPlugin: PluginDefinition = {
  id: 'settings',
  name: '系统工具',
  version: '2.0.0',
  description: '参数设置与通知公告。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('settings plugin disposed')
  },
}
