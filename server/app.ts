// HTTP 外壳：Hono 只负责传输（路由、CORS、JSON、错误映射、静态资源）。
//
// 业务全部在共享层：
// - 页面 schema 与 CRUD → `createPageEngine`
// - 登录/工作台/监控     → `createRuntimeApi`
// 因此浏览器 mock 与这个服务端执行的是同一份逻辑，不存在两套实现。
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { createPageEngine, ENGINE_UNHANDLED, type PageEngine } from '../src/shared/data/engine.ts'
import { pageRegistry, PAGE_SCHEMA_VERSION } from '../src/shared/data/pages/registry.ts'
import { seedPages } from '../src/shared/data/seed.ts'
import {
  RUNTIME_UNHANDLED,
  authenticate,
  createRuntimeApi,
  isPublicPath,
  type RuntimeStore,
} from '../src/shared/runtime/api.ts'
import type { PageStore } from '../src/shared/data/engine.ts'

/** 与前端 `ApiEnvelope` 对齐：HTTP 状态之外再给业务码。 */
interface Envelope<T> {
  code: number
  message: string
  data: T
}

export interface AppDeps {
  pages: PageStore
  runtime: RuntimeStore
  corsOrigins?: string[]
  staticDir?: string
}

function envelope<T>(data: T, code = 0, message = 'ok'): Envelope<T> {
  return { code, message, data }
}

function bearer(header: string | undefined): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

export interface CreatedApp {
  app: Hono
  engine: PageEngine
}

export function createApp(deps: AppDeps): CreatedApp {
  const engine = createPageEngine({
    registry: pageRegistry,
    version: PAGE_SCHEMA_VERSION,
    store: deps.pages,
    seed: seedPages,
  })
  const runtime = createRuntimeApi(engine, deps.runtime)
  const app = new Hono()

  if (deps.corsOrigins?.length) {
    app.use('/api/*', cors({
      origin: deps.corsOrigins,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }))
  }

  app.get('/api/health', (c) => c.json(envelope({ status: 'ok', pages: Object.keys(pageRegistry).length, schemaVersion: PAGE_SCHEMA_VERSION })))

  app.all('/api/*', async (c) => {
    const url = new URL(c.req.url)
    const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
    const method = c.req.method
    const token = bearer(c.req.header('Authorization'))

    // GET/DELETE 不带请求体；其余按 JSON 解析，解析失败当作空对象交给 schema 校验。
    const body: unknown = method === 'GET' || method === 'DELETE'
      ? undefined
      : await c.req.json().catch(() => ({}))

    // 除登录外的接口一律先校验令牌，避免资源接口裸奔。
    if (!isPublicPath(path) && !authenticate(token)) {
      return c.json(envelope(null, 401, '登录已失效，请重新登录'), 401)
    }

    try {
      const reply = runtime.handle({
        method,
        path,
        body,
        token,
        userAgent: c.req.header('User-Agent') ?? 'unknown',
      })
      if (reply !== RUNTIME_UNHANDLED) {
        // 成功一律 `code: 0`（与前端 ApiEnvelope 契约一致），失败才把 HTTP 状态当业务码。
        if (reply.status >= 400) {
          const message = String((reply.data as { message?: unknown } | undefined)?.message ?? '请求失败')
          return c.json(envelope(null, reply.status, message), reply.status as 401)
        }
        return c.json(envelope(reply.data))
      }

      const handled = engine.handle({ method, path, query: url.searchParams, body })
      if (handled !== ENGINE_UNHANDLED) return c.json(envelope(handled))
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status: unknown }).status)
        : 500
      const message = error instanceof Error ? error.message : '服务端错误'
      if (status >= 500) console.error('[api]', method, path, error)
      return c.json(envelope(null, status, message), status as 500)
    }

    return c.json(envelope(null, 404, `接口不存在：${method} ${path}`), 404)
  })

  // 前端构建产物：存在 dist 时才挂静态资源与 SPA 兜底。
  if (deps.staticDir && existsSync(deps.staticDir)) {
    app.use('/*', serveStatic({ root: deps.staticDir }))
    app.get('*', serveStatic({ root: deps.staticDir, path: 'index.html' }))
  }

  return { app, engine }
}
