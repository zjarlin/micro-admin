// HTTP 外壳：Hono 只负责传输（路由、CORS、JSON、错误映射、静态资源）。
//
// 业务全部在共享层：
// - 页面 schema 与 CRUD → `createPageEngine`
// - 登录/工作台/监控     → `createRuntimeApi`
// - 宿主自己的接口       → `extensions`（如组态画面）
// 因此「页面引擎」与「HTTP 传输」可以分开复用：换 Fastify 也只改这一层。
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import {
  createPageEngine,
  createRuntimeApi,
  ENGINE_UNHANDLED,
  RUNTIME_UNHANDLED,
  SCHEMA_WRITE_PERMISSION,
  authenticate,
  canWriteSchema,
  isPublicPath,
  type PageEngine,
  type PageRegistry,
  type PageStore,
  type RuntimeStore,
} from '@zjarlin/data-page'

/** 与前端响应信封对齐：HTTP 状态之外再给业务码。 */
export interface Envelope<T> {
  code: number
  message: string
  data: T
}

/**
 * 原样返回的响应体：文件下载与图片类接口不能套 JSON 信封。
 *
 * 扩展返回 `RawResponse` 时，HTTP 外壳直接用它的字节与头部回包，
 * 因此 `.ifc`、`.svg` 这类产物不需要再额外开一个静态目录。
 */
export class RawResponse {
  // 不用参数属性：`node --experimental-strip-types` 只支持纯类型擦除。
  readonly body: string | Uint8Array
  readonly contentType: string
  readonly options: { filename?: string | undefined; inline?: boolean | undefined; status?: number | undefined }

  constructor(
    body: string | Uint8Array,
    contentType: string,
    options: { filename?: string | undefined; inline?: boolean | undefined; status?: number | undefined } = {},
  ) {
    this.body = body
    this.contentType = contentType
    this.options = options
  }
}

/** 宿主扩展：返回 `null` 表示不处理，交给页面引擎继续匹配。 */
export interface ApiExtension {
  /**
   * 返回值直接进 `data` 信封；返回 `null` 表示不处理。
   * 异步扩展（调模型、拉远端）返回 Promise，外壳会 await 后再判断。
   */
  handle(request: {
    method: string
    path: string
    query: URLSearchParams
    body: unknown
  }): unknown | null
}

export interface AppDeps {
  pages: PageStore
  runtime: RuntimeStore
  /** 页面注册表：传可写实现即可在运行期改配置。 */
  registry: PageRegistry
  /** 首次启动的种子数据（页面资源）。 */
  seed?: (() => PageDataOf) | undefined
  /** 宿主自有接口（组态、采集、第三方回调…）。 */
  extensions?: ApiExtension[] | undefined
  corsOrigins?: string[] | undefined
  staticDir?: string | undefined
  /** 页面配置写权限码，缺省 `system:page:config`。 */
  schemaWritePermission?: string | undefined
}

type PageDataOf = Parameters<PageStore['write']>[0]

export interface CreatedApp {
  app: Hono
  engine: PageEngine
}

export function envelope<T>(data: T, code = 0, message = 'ok'): Envelope<T> {
  return { code, message, data }
}

function bearer(header: string | undefined): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function statusOf(error: unknown): number {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : 500
}

/** 把 `src/shared/scada` 这类模块抛出的 `{ status, message }` 统一翻成响应。 */
function failure(error: unknown): { status: number; message: string } {
  const status = statusOf(error)
  const message = error instanceof Error ? error.message : '服务端错误'
  return { status, message }
}

export function createApp(deps: AppDeps): CreatedApp {
  const engine = createPageEngine({
    registry: deps.registry,
    store: deps.pages,
    ...(deps.seed ? { seed: deps.seed } : {}),
  })
  const runtime = createRuntimeApi(engine, deps.runtime)
  const extensions = deps.extensions ?? []
  const app = new Hono()
  const writePermission = deps.schemaWritePermission ?? SCHEMA_WRITE_PERMISSION

  if (deps.corsOrigins?.length) {
    app.use('/api/*', cors({
      origin: deps.corsOrigins,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }))
  }

  app.get('/api/health', (c) => c.json(envelope({
    status: 'ok',
    pages: Object.keys(engine.registry.schemas()).length,
    schemaVersion: engine.registry.version,
    schemaWritable: engine.registry.writable,
  })))

  app.all('/api/*', async (c) => {
    const url = new URL(c.req.url)
    const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/'
    const method = c.req.method
    const token = bearer(c.req.header('Authorization'))

    // GET/DELETE 不带请求体；其余按 JSON 解析，解析失败当作空对象交给 schema 校验。
    const body: unknown = method === 'GET' || method === 'DELETE'
      ? undefined
      : await c.req.json().catch(() => ({}))

    // 页面清单公开只读：宿主要在建路由之前知道有哪些页面。
    // 业务数据接口仍然逐个校验令牌。
    const isPublic = isPublicPath(path, method)
    const user = isPublic ? null : authenticate(token)
    if (!isPublic && !user) {
      return c.json(envelope(null, 401, '登录已失效，请重新登录'), 401)
    }

    // 页面配置写权限单独收紧：只读账号能看页面，但改不了页面。
    const writesSchema = path.startsWith('/ui/pages') && (method === 'PUT' || method === 'POST' || method === 'DELETE')
    if (writesSchema && !canWriteSchema(user, writePermission)) {
      return c.json(envelope(null, 403, `缺少页面配置权限：${writePermission}`), 403)
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
        if (reply.status >= 400) {
          const message = String((reply.data as { message?: unknown } | undefined)?.message ?? '请求失败')
          return c.json(envelope(null, reply.status, message), reply.status as 401)
        }
        return c.json(envelope(reply.data))
      }

      const handled = engine.handle({ method, path, query: url.searchParams, body })
      if (handled !== ENGINE_UNHANDLED) return c.json(envelope(handled))

      for (const extension of extensions) {
        const result = await extension.handle({ method, path, query: url.searchParams, body })
        if (result === null) continue
        if (result instanceof RawResponse) {
          const headers = new Headers({ 'Content-Type': result.contentType })
          const filename = result.options.filename
          if (filename) {
            const encoded = encodeURIComponent(filename)
            const disposition = result.options.inline ? 'inline' : 'attachment'
            headers.set(
              'Content-Disposition',
              `${disposition}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
            )
          }
          return new Response(result.body, { status: result.options.status ?? 200, headers })
        }
        return c.json(envelope(result))
      }
    } catch (error) {
      const { status, message } = failure(error)
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
