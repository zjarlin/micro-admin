// 页面 schema 注册表：引擎取 schema 的唯一入口。
//
// 两种实现，接口相同，因此引擎不关心配置是「写在代码里」还是「存在后端」：
// - `createStaticRegistry`：常量注册表，适合演示与单仓自用；
// - `createStoredRegistry`：覆盖层持久化，运行期可改 schema（页面设计器的落点）。
//
// 版本号语义：每页各有一个版本，改动即 +1。前端据 `version` 判断缓存失效，
// 不需要自己猜「配置是不是变了」。
import type { CrudPageSchema } from './schema.ts'

export interface PageRegistry {
  /** 全局版本（清单变化时递增），随 `/ui/pages` 一起下发。 */
  readonly version: number
  /** 当前全部页面 schema（key → schema）。 */
  schemas(): Record<string, CrudPageSchema>
  /** 单页版本；未知页面返回 0。 */
  versionOf(key: string): number
  /** 支持运行期改配置的实现返回 `true`，只读实现返回 `false`。 */
  readonly writable: boolean
  /** 新增或覆盖一份 schema；只读实现抛错。 */
  upsert(key: string, schema: CrudPageSchema): number
  /** 删除一份运行期新增的 schema；只读实现抛错。 */
  remove(key: string): void
}

/** 常量注册表：配置随代码发布，改页面要重新发版。 */
export function createStaticRegistry(pages: Record<string, CrudPageSchema>, version: number): PageRegistry {
  return {
    version,
    writable: false,
    schemas: () => pages,
    versionOf: () => version,
    upsert: () => {
      throw new Error('页面配置为只读注册表，无法在运行期修改')
    },
    remove: () => {
      throw new Error('页面配置为只读注册表，无法在运行期删除')
    },
  }
}

/** 持久化形状：覆盖层只存被改过的页面，未改的仍走代码里的基线。 */
export interface StoredSchemaState {
  /** 覆盖层的全局版本。 */
  version: number
  /** key → { schema, version }。 */
  pages: Record<string, { schema: CrudPageSchema; version: number }>
  /** 被运行期删除的基线页面 key，避免删掉后又从基线里冒出来。 */
  removed?: string[]
}

export interface SchemaStateStore {
  read(): StoredSchemaState | null
  write(state: StoredSchemaState): void
}

export interface StoredRegistryOptions {
  /** 代码里的基线配置：持久层为空时作为初始值，同时充当兜底。 */
  base: Record<string, CrudPageSchema>
  /** 基线版本号。 */
  baseVersion: number
  store: SchemaStateStore
}

/**
 * 可写注册表：基线 + 覆盖层。
 *
 * 读的时候合并（覆盖层优先），写的时候只落覆盖层，
 * 因此「用代码发布一版默认配置」与「运维在后台改一版」不会互相擦除。
 */
export function createStoredRegistry(options: StoredRegistryOptions): PageRegistry {
  const { base, baseVersion, store } = options

  function read(): StoredSchemaState {
    const existing = store.read()
    if (existing) return existing
    const initial: StoredSchemaState = { version: baseVersion, pages: {}, removed: [] }
    store.write(initial)
    return initial
  }

  return {
    get version() {
      return read().version
    },
    get writable() {
      return true
    },
    schemas(): Record<string, CrudPageSchema> {
      const state = read()
      const removed = new Set(state.removed ?? [])
      const merged: Record<string, CrudPageSchema> = {}
      for (const [key, schema] of Object.entries(base)) {
        if (!removed.has(key)) merged[key] = schema
      }
      for (const [key, entry] of Object.entries(state.pages)) merged[key] = entry.schema
      return merged
    },
    versionOf(key: string): number {
      return read().pages[key]?.version ?? baseVersion
    },
    upsert(key: string, schema: CrudPageSchema): number {
      const state = read()
      const previous = state.pages[key]?.version ?? baseVersion
      const next = previous + 1
      const removed = new Set(state.removed ?? [])
      removed.delete(key)
      store.write({
        version: state.version + 1,
        pages: { ...state.pages, [key]: { schema: { ...schema, key }, version: next } },
        removed: [...removed],
      })
      return next
    },
    remove(key: string): void {
      const state = read()
      const pages = { ...state.pages }
      delete pages[key]
      const removed = new Set(state.removed ?? [])
      if (base[key]) removed.add(key)
      store.write({ version: state.version + 1, pages, removed: [...removed] })
    },
  }
}
