// 页面 schema 的取数：配置全部来自后端，前端只认契约不认具体页面。
//
// 三种部署形态共用这一个入口：
// 1. `GET /ui/pages/{key}`：后端按页面 key 下发整页 schema（推荐，改页面不用发版）；
// 2. `GET /ui/pages`：一次拉清单，前端按 key 缓存（离线/低延迟场景）；
// 3. 无接口时回落到本仓库手写的常量 schema（迁移期用，必须能被服务端同 key 覆盖）。
import type { HttpClient } from '../http.ts'
import type { CrudPageSchema } from './schema.ts'

/** 后端下发的单页响应：带版本号便于缓存与审计。 */
export interface PageSchemaResponse {
  key: string
  /** schema 版本，前端可用于缓存失效判断。 */
  version: number
  schema: CrudPageSchema
}

export interface SchemaClientOptions {
  /** 接口前缀，缺省 `/ui/pages`。 */
  basePath?: string
  /** 手写兜底：后端不可用时用本地定义，保证页面不白屏。 */
  fallback?: Record<string, CrudPageSchema>
}

export interface SchemaClient {
  load(key: string): Promise<CrudPageSchema>
  loadAll(): Promise<Record<string, CrudPageSchema>>
  /** 已加载的 schema 版本，便于调试面板展示。 */
  versionOf(key: string): number | null
}

export function createSchemaClient(http: HttpClient, options: SchemaClientOptions = {}): SchemaClient {
  const basePath = options.basePath ?? '/ui/pages'
  const cache = new Map<string, { schema: CrudPageSchema; version: number }>()

  async function load(key: string): Promise<CrudPageSchema> {
    const cached = cache.get(key)
    if (cached) return cached.schema
    try {
      const response = await http.request<PageSchemaResponse>(`${basePath}/${encodeURIComponent(key)}`)
      cache.set(key, { schema: response.schema, version: response.version })
      return response.schema
    } catch (error) {
      const fallback = options.fallback?.[key]
      if (fallback) {
        cache.set(key, { schema: fallback, version: 0 })
        return fallback
      }
      throw error
    }
  }

  async function loadAll(): Promise<Record<string, CrudPageSchema>> {
    const list = await http.request<PageSchemaResponse[]>(basePath)
    const map: Record<string, CrudPageSchema> = { ...(options.fallback ?? {}) }
    for (const item of list) {
      cache.set(item.key, { schema: item.schema, version: item.version })
      map[item.key] = item.schema
    }
    return map
  }

  return {
    load,
    loadAll,
    versionOf: (key) => cache.get(key)?.version ?? null,
  }
}
