import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

export const coreAdminPlugin: PluginDefinition = {
  id: 'core-admin',
  name: '核心控制台',
  version: '1.0.0',
  description: '登录、工作台、插件中心与系统基础能力，所有业务插件的最底层依赖。',
  author: 'Micro Admin',
  requires: [],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.commands.register('kernel.reload-plugins', () => {
      ctx.events.emit('kernel:reload-requested', { id: ctx.id })
      return true
    })
    ctx.events.emit('core:ready', { at: new Date().toISOString() })
    return () => {
      ctx.logger.debug('core-admin teardown complete')
    }
  },
}
