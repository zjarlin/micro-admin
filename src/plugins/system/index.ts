import type { PluginDefinition, MenuContribution, RouteContribution } from '@/kernel'
import { routes, menus } from './routes'

export const systemPlugin: PluginDefinition = {
  id: 'system',
  name: '系统管理',
  version: '1.0.0',
  description: '用户、角色、菜单、部门、岗位、字典、参数与公告。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.commands.register('system.refresh-profile', () => ({ refreshedAt: new Date().toISOString() }))
    return () => ctx.logger.debug('system plugin disposed')
  },
}

export type { MenuContribution, RouteContribution }
