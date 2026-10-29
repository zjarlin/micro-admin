// 通用页面后端引擎：一份 schema 同时决定「渲染什么」和「怎么增删改查」。
//
// 与运行时无关：不 import Vue、不 import node 内置模块、不碰 DOM。
// 因此同一份实现有三种用法：
// 1. 浏览器 mock（本仓库 `VITE_API_MODE=mock`，存储用 localStorage）；
// 2. Node 服务（`server/`，存储用文件或数据库）；
// 3. 单测里直接调用（没有 HTTP 层）。
import type { CrudPageSchema, QuerySchema, Row } from './schema.ts'
import { matchCondition } from './schema.ts'
import { validateRow } from './validate.ts'

/** 资源快照：端点 → 行数组。树资源按其自身形状原样保存。 */
export interface PageData {
  [endpoint: string]: Row[]
}

/** 持久化端口：引擎只负责读写快照，不关心落到 localStorage 还是数据库。 */
export interface PageStore {
  read(): PageData
  write(data: PageData): void
}

export interface EngineRequest {
  method: string
  /** 已去掉 baseUrl 的路径，例如 `/system/users`。 */
  path: string
  query: URLSearchParams
  body: unknown
}

/** 未命中任何 schema 端点，交给上层其余路由继续匹配。 */
export const ENGINE_UNHANDLED = Symbol('page-engine-unhandled')

export interface PageEngineOptions {
  /** 页面注册表：key → schema。 */
  registry: Record<string, CrudPageSchema>
  /** schema 版本号，随响应一起下发。 */
  version: number
  store: PageStore
  /** 存储为空时的种子数据（首次启动或清库后）。 */
  seed?: () => PageData
}

export class EngineError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'EngineError'
    this.status = status
  }
}

export interface PageSchemaPayload {
  key: string
  version: number
  schema: CrudPageSchema
}

export interface PageEngine {
  handle(request: EngineRequest): unknown | typeof ENGINE_UNHANDLED
  /** 直接读取某个端点的行（供工作台等模块复用同一份数据）。 */
  rows(endpoint: string): Row[]
  /** 写入数据快照，通常在批量变更后调用。 */
  replace(endpoint: string, rows: Row[]): void
}

function toNumber(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesQuery(row: Row, item: QuerySchema, raw: string): boolean {
  const props = item.props ?? [item.prop]
  const mode = item.match ?? (item.control === 'select' ? 'eq' : 'like')
  if (mode === 'eq') return textOf(row[props[0] ?? item.prop]) === raw
  if (mode === 'in') {
    const allowed = raw.split(',').map((part) => part.trim()).filter(Boolean)
    return allowed.includes(textOf(row[props[0] ?? item.prop]))
  }
  const needle = raw.toLowerCase()
  return props.some((prop) => textOf(row[prop]).toLowerCase().includes(needle))
}

/** 收集某个树节点及其全部后代 id，用于「含下级」筛选。 */
function descendantIds(rows: Row[], tree: NonNullable<CrudPageSchema['tree']>, rootId: string): string[] {
  const idProp = tree.idProp
  const childrenProp = tree.childrenProp ?? 'children'
  const parentProp = tree.parentProp
  const result = new Set<string>([rootId])
  if (parentProp) {
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) {
        const id = textOf(row[idProp])
        const parent = textOf(row[parentProp])
        if (!result.has(id) && result.has(parent)) {
          result.add(id)
          changed = true
        }
      }
    }
    return [...result]
  }
  const walk = (items: Row[]): void => {
    for (const item of items) {
      result.add(textOf(item[idProp]))
      const children = item[childrenProp]
      if (Array.isArray(children)) walk(children as Row[])
    }
  }
  walk(rows)
  return [...result]
}

function nextRowId(rows: Row[], rowKey: string): number {
  const ids = rows.map((row) => Number(row[rowKey])).filter((value) => Number.isFinite(value))
  return Math.max(0, ...ids) + 1
}

/**
 * 创建引擎。
 *
 * 数据在 `read()` 时取快照、变更后 `write()` 回写；快照不可变假设由 Store 负责，
 * 引擎自身不缓存，避免浏览器与 Node 两种存储出现两套失效逻辑。
 */
export function createPageEngine(options: PageEngineOptions): PageEngine {
  const { registry, store, version } = options
  const schemas = Object.values(registry)
  /** 端点 → schema：列表/写操作都按端点派发，一个 schema 就是一份资源契约。 */
  const byEndpoint = new Map<string, CrudPageSchema>()
  /** 树端点集合：GET 时返回原样数组，而不是分页结果。 */
  const treeEndpoints = new Set<string>()
  for (const schema of schemas) {
    if (!byEndpoint.has(schema.endpoint)) byEndpoint.set(schema.endpoint, schema)
    if (schema.tree) treeEndpoints.add(schema.tree.endpoint)
  }

  function readData(): PageData {
    const data = store.read()
    if (Object.keys(data).length > 0) return data
    const seeded = options.seed?.() ?? {}
    store.write(seeded)
    return seeded
  }

  function schemaOf(key: string): CrudPageSchema {
    const schema = registry[key]
    if (!schema) throw new EngineError(`页面配置不存在：${key}`, 404)
    return schema
  }

  function ensureRows(data: PageData, endpoint: string): Row[] {
    const existing = data[endpoint]
    if (existing) return existing
    const created: Row[] = []
    data[endpoint] = created
    return created
  }

  /** 列表：查询条件、左树筛选、分页全部由 schema 声明驱动。 */
  function list(schema: CrudPageSchema, data: PageData, query: URLSearchParams): { rows: Row[]; total: number } {
    let rows = ensureRows(data, schema.endpoint)
    for (const item of schema.query ?? []) {
      const raw = (query.get(item.param ?? item.prop) ?? '').trim()
      if (!raw) continue
      rows = rows.filter((row) => matchesQuery(row, item, raw))
    }

    const tree = schema.tree
    const treeValue = tree ? (query.get(tree.param) ?? '').trim() : ''
    if (tree && treeValue) {
      const source = treeEndpoints.has(tree.endpoint) ? ensureRows(data, tree.endpoint) : []
      const ids = tree.includeDescendants === false ? [treeValue] : descendantIds(source, tree, treeValue)
      const filterProp = tree.filterProp ?? tree.param
      const allowed = new Set(ids)
      rows = rows.filter((row) => allowed.has(textOf(row[filterProp])))
    }

    const page = toNumber(query.get('page'), 1)
    const pageSize = Math.min(toNumber(query.get('pageSize'), schema.pageSize ?? 10), 500)
    const start = (page - 1) * pageSize
    return { rows: rows.slice(start, start + pageSize), total: rows.length }
  }

  /** 新增/修改共用：必填、规则、唯一性都在这里拦下，前端不需要再写一遍。 */
  function assertValid(schema: CrudPageSchema, candidate: Row, rows: Row[], currentId: string | null): void {
    const issues = validateRow(schema.fields ?? [], candidate)
    const first = issues[0]
    if (first) throw new EngineError(first.message, 400)

    for (const prop of schema.uniqueProps ?? []) {
      const value = textOf(candidate[prop])
      if (!value) continue
      const duplicated = rows.some(
        (row) => textOf(row[prop]) === value && (currentId === null || textOf(row[schema.rowKey ?? 'id']) !== currentId),
      )
      if (duplicated) {
        const label = schema.fields?.find((field) => field.prop === prop)?.label ?? prop
        throw new EngineError(`${label}已存在`, 409)
      }
    }
  }

  return {
    handle(request: EngineRequest): unknown | typeof ENGINE_UNHANDLED {
      const { method, path, query } = request

      if (path === '/ui/pages' && method === 'GET') {
        const payload: PageSchemaPayload[] = schemas.map((schema) => ({ key: schema.key, version, schema }))
        return payload
      }
      if (path.startsWith('/ui/pages/') && method === 'GET') {
        const key = decodeURIComponent(path.slice('/ui/pages/'.length))
        return { key, version, schema: schemaOf(key) } satisfies PageSchemaPayload
      }

      const data = readData()
      const body = isPlainObject(request.body) ? request.body : {}

      const schema = byEndpoint.get(path)
      if (schema) {
        if (method === 'GET') {
          if (treeEndpoints.has(path)) return ensureRows(data, path)
          return list(schema, data, query)
        }
        if (method === 'POST') {
          const rows = ensureRows(data, schema.endpoint)
          const rowKey = schema.rowKey ?? 'id'
          const created: Row = { ...body }
          if (created[rowKey] === undefined) created[rowKey] = nextRowId(rows, rowKey)
          const createdProp = schema.timestamps?.created
          if (createdProp && !created[createdProp]) created[createdProp] = new Date().toISOString()
          const updatedProp = schema.timestamps?.updated
          if (updatedProp && !created[updatedProp]) created[updatedProp] = new Date().toISOString()
          assertValid(schema, created, rows, null)
          rows.unshift(created)
          store.write(data)
          return created
        }
        return ENGINE_UNHANDLED
      }

      // 明细路由：`{endpoint}/{id}`，支持 PUT 全量、PATCH 局部、DELETE 删除。
      for (const [endpoint, target] of byEndpoint) {
        if (!path.startsWith(`${endpoint}/`)) continue
        const id = decodeURIComponent(path.slice(endpoint.length + 1))
        if (!id || id.includes('/')) continue
        const rows = ensureRows(data, endpoint)
        const rowKey = target.rowKey ?? 'id'
        const index = rows.findIndex((row) => textOf(row[rowKey]) === id)
        if (index < 0) throw new EngineError('记录不存在', 404)
        const current = rows[index]
        if (!current) throw new EngineError('记录不存在', 404)

        if (method === 'DELETE') {
          if (target.undeletableWhen && matchCondition(current, target.undeletableWhen)) {
            throw new EngineError('该记录不允许删除', 403)
          }
          rows.splice(index, 1)
          store.write(data)
          return undefined
        }
        if (method === 'PUT' || method === 'PATCH') {
          const merged: Row = { ...current, ...body }
          const touchProp = target.timestamps?.updated
          if (touchProp) merged[touchProp] = new Date().toISOString()
          assertValid(target, merged, rows, id)
          rows[index] = merged
          store.write(data)
          return merged
        }
        return ENGINE_UNHANDLED
      }

      return ENGINE_UNHANDLED
    },

    rows(endpoint: string): Row[] {
      return ensureRows(readData(), endpoint)
    },

    replace(endpoint: string, rows: Row[]): void {
      const data = readData()
      data[endpoint] = rows
      store.write(data)
    },
  }
}
