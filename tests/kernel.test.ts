import { describe, expect, it, vi } from 'vitest'
import { MicroKernel } from '@/kernel/kernel'
import type { PluginDefinition } from '@/kernel/types'

function plugin(id: string, requires: string[] = [], setup = vi.fn()): PluginDefinition {
  return { id, name: id.toUpperCase(), version: '1.0.0', requires, setup: async (ctx) => { setup(ctx); return () => undefined } }
}

describe('MicroKernel', () => {
  it('resolves dependency order before dependents', () => {
    const kernel = new MicroKernel({ plugins: [plugin('c', ['b']), plugin('b', ['a']), plugin('a')] })
    expect(kernel.order).toEqual(['a', 'b', 'c'])
    expect(kernel.list().map((item) => item.order)).toEqual([1, 2, 3])
  })

  it('rejects duplicate plugin ids', () => {
    expect(() => new MicroKernel({ plugins: [plugin('a'), plugin('a')] })).toThrow('duplicate plugin id')
  })

  it('rejects missing dependencies', () => {
    expect(() => new MicroKernel({ plugins: [plugin('a', ['missing'])] })).toThrow('requires missing plugin')
  })

  it('rejects circular dependencies', () => {
    expect(() => new MicroKernel({ plugins: [plugin('a', ['b']), plugin('b', ['a'])] })).toThrow('circular plugin dependency')
  })

  it('registers route, menu, service and slot contributions', async () => {
    const kernel = new MicroKernel({
      plugins: [{
        id: 'demo', name: 'Demo', version: '1.0.0',
        setup(ctx) {
          ctx.routes.add({ name: 'demo', path: '/demo', component: async () => ({ default: {} as never }) })
          ctx.menus.add({ id: 'demo-menu', title: '演示', path: '/demo' })
          ctx.services.register('demo-service', { value: 42 })
          ctx.slots.add({ name: 'main', id: 'slot', component: {} })
          ctx.commands.register('demo.command', () => 'ok')
        },
      }],
    })
    await kernel.start()
    expect(kernel.routeContributions()).toHaveLength(1)
    expect(kernel.menuContributions()).toHaveLength(1)
    expect(kernel.serviceTokens()).toContain('demo-service')
    expect(kernel.slotContributions('main')).toHaveLength(1)
    expect(await kernel.contextFor('demo').commands.execute('demo.command')).toBe('ok')
  })

  it('rejects duplicate contributions', async () => {
    const kernel = new MicroKernel({
      plugins: [{
        id: 'demo', name: 'Demo', version: '1.0.0',
        setup(ctx) {
          ctx.menus.add({ id: 'same', title: 'A', path: '/a' })
          ctx.menus.add({ id: 'same', title: 'B', path: '/b' })
        },
      }],
    })
    await expect(kernel.start()).rejects.toThrow('menu already registered')
    expect(kernel.menuContributions()).toHaveLength(0)
    expect(kernel.getStatus('demo')?.state).toBe('failed')
  })

  it('disables dependents before their dependency', async () => {
    const events: string[] = []
    const base: PluginDefinition = { id: 'base', name: 'Base', version: '1.0.0', setup: () => () => { events.push('base') } }
    const child: PluginDefinition = { id: 'child', name: 'Child', version: '1.0.0', requires: ['base'], setup: () => () => { events.push('child') } }
    const kernel = new MicroKernel({ plugins: [base, child] })
    await kernel.start()
    await kernel.disable('base')
    expect(kernel.getStatus('child')?.enabled).toBe(false)
    expect(events).toEqual(['child', 'base'])
  })

  it('honours explicit enable overrides and skips disabled plugins', async () => {
    const setup = vi.fn()
    const kernel = new MicroKernel({ plugins: [plugin('a', [], setup)], enabled: { a: false } })
    await kernel.start()
    expect(setup).not.toHaveBeenCalled()
    expect(kernel.getStatus('a')?.state).toBe('registered')
  })

  it('runs teardown when a plugin is disabled', async () => {
    const teardown = vi.fn()
    const kernel = new MicroKernel({
      plugins: [{ id: 'a', name: 'A', version: '1.0.0', setup: () => teardown }],
    })
    await kernel.start()
    await kernel.disable('a')
    expect(teardown).toHaveBeenCalledTimes(1)
  })

  it('keeps contribution tracking after reading the plugin context externally', async () => {
    const kernel = new MicroKernel({
      plugins: [{
        id: 'demo', name: 'Demo', version: '1.0.0',
        setup(ctx) {
          ctx.routes.add({ name: 'demo', path: '/demo', component: async () => ({ default: {} as never }) })
          ctx.commands.register('demo.ping', () => 'pong')
        },
      }],
    })
    await kernel.start()
    expect(await kernel.contextFor('demo').commands.execute('demo.ping')).toBe('pong')
    await kernel.disable('demo')
    expect(kernel.routeContributions()).toHaveLength(0)
    await expect(kernel.contextFor('demo').commands.execute('demo.ping')).rejects.toThrow('unknown command')
  })
})
