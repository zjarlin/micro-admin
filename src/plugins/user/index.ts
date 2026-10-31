import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

export const userPlugin: PluginDefinition = {
  id: 'user',
  name: '用户管理',
  version: '2.0.0',
  description: '登录账号与用户资料；不依赖角色/部门，工具类产品可以只装它。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    ctx.commands.register('user.refresh-profile', () => ({ refreshedAt: new Date().toISOString() }))
    return () => ctx.logger.debug('user plugin disposed')
  },
}
