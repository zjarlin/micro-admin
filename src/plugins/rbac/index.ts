import type { PluginDefinition } from '@/kernel'
import { routes, menus } from './routes'

/**
 * 角色 / 部门 / 岗位 / 菜单。
 *
 * `optionalRequires: ['user']`：装了用户插件就给它补部门、角色列和左树（服务端 schema 侧完成），
 * 没装也能单独提供权限模型（权限码解析、菜单树）。
 */
export const rbacPlugin: PluginDefinition = {
  id: 'rbac',
  name: '权限体系（RBAC）',
  version: '2.0.0',
  description: '角色、部门、岗位与菜单；工具类产品可以不装，只留用户表。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  optionalRequires: ['user'],
  defaultEnabled: true,
  setup(ctx) {
    for (const route of routes) ctx.routes.add(route)
    for (const menu of menus) ctx.menus.add(menu)
    return () => ctx.logger.debug('rbac plugin disposed')
  },
}
