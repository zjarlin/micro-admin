import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

export const dictPlugin: PluginDefinition = {
  id: 'dict',
  name: '字典管理',
  version: '2.0.0',
  description: '业务枚举与字典类型；与账号、权限无关，可单独打包。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('dict plugin disposed')
  },
}
