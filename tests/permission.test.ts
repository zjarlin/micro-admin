import { describe, expect, it } from 'vitest'
import { filterByPermission, hasPermission } from '@/kernel/permission'
import { compilePluginRoutes } from '@/router'
import { MicroKernel } from '@/kernel/kernel'

describe('permission', () => {
  it('supports wildcard and explicit permission', () => {
    expect(hasPermission(['*:*:*'], 'system:user:list')).toBe(true)
    expect(hasPermission(['system:user:list'], 'system:user:list')).toBe(true)
    expect(hasPermission(['system:user:list'], 'system:role:list')).toBe(false)
    expect(hasPermission([], undefined)).toBe(true)
  })

  it('filters contributions by permission', () => {
    const items = [{ id: 'a', permission: 'a' }, { id: 'b', permission: 'b' }, { id: 'c' }]
    expect(filterByPermission(items, ['a']).map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('compiles only permitted plugin routes into the layout', async () => {
    const kernel = new MicroKernel({
      plugins: [{
        id: 'p', name: 'P', version: '1.0.0',
        setup(ctx) {
          ctx.routes.add({ name: 'open', path: '/open', component: async () => ({ default: {} as never }) })
          ctx.routes.add({ name: 'secret', path: '/secret', permission: 'secret:view', component: async () => ({ default: {} as never }) })
        },
      }],
    })
    await kernel.start()
    const routes = compilePluginRoutes(kernel)
    expect(routes[0]?.children?.map((route) => route.name)).toEqual(['open', 'secret'])
    const secret = routes[0]?.children?.find((route) => route.name === 'secret')
    expect((secret?.meta as Record<string, unknown> | undefined)?.permission).toBe('secret:view')
  })
})
