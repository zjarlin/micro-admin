// @vitest-environment node
// 引擎自检：不依赖浏览器与网络，直接驱动 `createPageEngine`。
//
// 这是「通用页面层」的回归入口——页面 schema 改了、引擎语义改了，这里先炸。
import { describe, expect, it } from 'vitest'
import {
  createPageEngine,
  createStoredRegistry,
  type PageData,
  type SchemaStateStore,
} from '@zjarlin/data-page'
import { basePages } from '@/schema/registry'
import { seedPages } from '@/schema/seed'

function memoryStore(initial: PageData = {}): { store: { read: () => PageData; write: (data: PageData) => void }; data: PageData } {
  const box = { data: initial }
  return {
    data: box.data,
    store: {
      read: () => box.data,
      write: (data: PageData) => { box.data = data },
    },
  }
}

function memorySchemas(): SchemaStateStore {
  let state: ReturnType<SchemaStateStore['read']> = null
  return {
    read: () => state,
    write: (next) => { state = next },
  }
}

describe('page engine', () => {
  it('serves registered pages and paginates', () => {
    const engine = createPageEngine({ registry: basePages, version: 3, store: memoryStore().store, seed: seedPages })
    const list = engine.handle({ method: 'GET', path: '/ui/pages', query: new URLSearchParams(), body: undefined })
    expect(Array.isArray(list)).toBe(true)
    expect((list as unknown[]).length).toBeGreaterThan(5)

    const page = engine.handle({
      method: 'GET', path: '/system/users', query: new URLSearchParams('page=1&pageSize=5'), body: undefined,
    }) as { rows: unknown[]; total: number }
    expect(page.rows).toHaveLength(5)
    expect(page.total).toBeGreaterThan(5)
  })

  it('rejects duplicate unique prop and blocks undeletable row', () => {
    const engine = createPageEngine({ registry: basePages, version: 3, store: memoryStore().store, seed: seedPages })
    expect(() => engine.handle({
      method: 'POST', path: '/system/users', query: new URLSearchParams(), body: { username: 'admin', nickname: 'dup' },
    })).toThrowError(/已存在/)
    expect(() => engine.handle({
      method: 'DELETE', path: '/system/users/1', query: new URLSearchParams(), body: undefined,
    })).toThrowError(/不允许删除/)
  })

  it('accepts a runtime-registered page (schema as data)', () => {
    const registry = createStoredRegistry({ base: basePages, baseVersion: 3, store: memorySchemas() })
    const engine = createPageEngine({ registry, store: memoryStore().store, seed: seedPages })
    engine.handle({
      method: 'PUT',
      path: '/ui/pages/demo.probe',
      query: new URLSearchParams(),
      body: { endpoint: '/demo/probes', title: '探针', columns: [{ prop: 'name', label: '名称' }] },
    })
    const created = engine.handle({
      method: 'POST', path: '/demo/probes', query: new URLSearchParams(), body: { name: '第一行' },
    }) as { name: string }
    expect(created.name).toBe('第一行')
  })
})
