// 通用页面插件：把「后端登记的页面」变成真实路由与侧栏菜单。
//
// 这是「后端加一页，前端自动出现」的落点：
// 插件启动时拉一次 `/ui/pages`，凡是 schema 里写了 `menu` 的页面，
// 就注册一条路由 + 一个菜单项。前端不再需要为每个页面写 routes.ts。
//
// 失败策略：拉不到清单只降级（保留手写页面），不让整个后台起不来。
import type { PluginDefinition } from '@/kernel'
import type { CrudPageSchema } from '@zjarlin/data-page'

interface PageSchemaPayload {
  key: string
  version: number
  schema: CrudPageSchema
}

export const pagesPlugin: PluginDefinition = {
  id: 'pages',
  name: '通用页面',
  version: '1.0.0',
  description: '按后端下发的 schema 动态注册页面路由与菜单。',
  author: 'Micro Admin',
  requires: ['core-admin'],
  defaultEnabled: true,
  async setup(ctx) {
    // 兜底：任何 `/p/<key>` 都按后端下发的 schema 渲染。
    // 后端新登记一个页面（哪怕没写 menu）后，这里不需要改代码。
    ctx.routes.add({
      name: 'schema-page',
      path: '/p/:pageKey',
      component: () => import('./DynamicSchemaPage.vue'),
      title: '通用页面',
      permission: 'system:page:view',
    })

    let pages: PageSchemaPayload[] = []
    try {
      pages = await ctx.http.request<PageSchemaPayload[]>('/ui/pages')
    } catch (error) {
      ctx.logger.warn('页面清单读取失败，仅保留手写页面', error)
      return
    }

    let installed = 0
    for (const page of pages) {
      const menu = page.schema.menu
      if (!menu) continue
      const path = menu.path ?? `/p/${page.key}`
      const permission = page.schema.permissions?.view
      ctx.routes.add({
        name: `page-${page.key}`,
        path,
        component: () => import('./DynamicSchemaPage.vue'),
        ...(page.schema.title ? { title: menu.title ?? page.schema.title } : {}),
        ...(permission ? { permission } : {}),
        meta: { pageKey: page.key },
      })
      if (!menu.hidden) {
        ctx.menus.add({
          id: `page-${page.key}`,
          title: menu.title ?? page.schema.title,
          path,
          ...(menu.icon ? { icon: menu.icon } : {}),
          ...(menu.group ? { group: menu.group } : {}),
          ...(menu.order !== undefined ? { order: menu.order } : {}),
          ...(permission ? { permission } : {}),
        })
      }
      installed += 1
    }
    ctx.logger.info(`已从后端注册 ${installed} 个配置页面`)
  },
}
