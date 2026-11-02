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
  type SessionResolver,
  type SessionUser,
} from '@zjarlin/data-page'

/**
 * 静态资源缓存策略。
 *
 * `dist/assets/*` 的文件名带内容哈希，可以永久缓存；其余（头像、favicon、SPA 兜底）
 * 用 `no-cache` + 强校验，保证发布后第一次刷新就能拿到新版本。
 */
function cacheOf(path: string, c: { header: (name: string, value: string) => void }): void {
  const hashed = path.includes('/assets/')
  c.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate')
}

/**
 * 原样返回的响应体：文件下载与图片类接口不能套 JSON 信封。
 *
 * 扩展返回 `RawResponse` 时，HTTP 外壳直接用它的字节与头部回包，
 * 因此 `.svg`、`.ifc` 这类产物不需要再额外开一个静态目录。
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

/** 与前端响应信封对齐：HTTP 状态之外再给业务码。 */
export interface Envelope<T> {
  code: number
  message: string
  data: T
}

/**
 * 宿主扩展：返回 `null` 表示不处理，交给页面引擎继续匹配。
 *
 * 允许返回 Promise：模型调用这类下游 I/O 是异步的，扩展层不该为了同步签名
 * 去阻塞事件循环；内核统一 await，错误照旧走错误信封。
 */
export interface ExtensionUser {
  username?: string
  permissions: string[]
}

export interface ExtensionRequest {
  method: string
  path: string
  query: URLSearchParams
  // 与既有扩展（组态 / 图纸）的形参保持一致：外壳已把非 GET 请求体收敛成对象。
  body: Record<string, unknown>
  /** 当前登录用户；公开路径为 null。扩展自己按权限码收紧。 */
  user: ExtensionUser | null
}

export interface ApiExtension {
  /**
   * 返回值直接进 `data` 信封；返回 `null` 表示不处理。
   * 异步扩展（调模型、拉远端）返回 Promise，外壳会 await 后再判断。
   *
   * 也允许返回 Symbol 表示不处理（各业务域自带 `UNHANDLED` 哨兵），外壳同样跳过：
   * 否则第一个扩展的哨兵会被当成返回值，后面的扩展永远拿不到请求。
   */
  handle(request: ExtensionRequest): unknown | Promise<unknown> | null
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
  /**
   * 会话解析：把静态令牌用户换成按角色授权计算的权限。
   *
   * 通用层不认识宿主的角色/菜单表，所以「谁能看到什么」这条策略由宿主注入；
   * 返回 `null` 表示不接管。每次请求都会调用，改完授权不必重启。
   */
  resolveUser?: SessionResolver | undefined
  /**
   * 免登录读取的扩展路径（例如外壳配置/外观要在登录页之前生效）。
   * 只放前言/外壳这类不含业务数据的 GET 接口，其余仍走令牌。
   */
  publicPaths?: string[] | undefined
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

/**
 * 扩展的「没处理」既有 `null`，也有各模块自己的 `UNHANDLED` 哨兵（Symbol）。
 * 两者都表示继续往后找，不能当成已处理，否则会把 Symbol 序列化成空响应。
 */
function unhandled(result: unknown): boolean {
  return result === null || result === undefined || typeof result === 'symbol'
}

export function createApp(deps: AppDeps): CreatedApp {
  const engine = createPageEngine({
    registry: deps.registry,
    store: deps.pages,
    ...(deps.seed ? { seed: deps.seed } : {}),
  })
  const runtime = createRuntimeApi(
    engine,
    deps.runtime,
    deps.resolveUser ? { resolveUser: deps.resolveUser } : {},
  )
  /** 鉴权与扩展共用同一份解析结果，避免「路由放行、扩展里另算一套」。 */
  const asSession = (user: SessionUser | null): SessionUser | null =>
    user && deps.resolveUser ? (deps.resolveUser(user) ?? user) : user
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
    const isPublic = isPublicPath(path, method) || (method === 'GET' && (deps.publicPaths ?? []).includes(path))
    const user = isPublic ? null : asSession(authenticate(token))
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
        const result = await extension.handle({
          method,
          path,
          query: url.searchParams,
          // 非 GET 请求体由外壳收敛成对象；扩展只拿到结构化输入。
          body: (body && typeof body === 'object' ? body : {}) as Record<string, unknown>,
          user: user ? { username: user.username, permissions: user.permissions } : null,
        })
        if (result instanceof RawResponse) {
          const headers = new Headers({ 'Content-Type': result.contentType })
          const filename = result.options.filename
          if (filename) {
            const encoded = encodeURIComponent(filename)
            const disposition = result.options.inline ? 'inline' : 'attachment'
            headers.set('Content-Disposition', `${disposition}; filename="${encoded}"; filename*=UTF-8''${encoded}`)
          }
          return new Response(result.body, { status: result.options.status ?? 200, headers })
        }
        if (!unhandled(result)) return c.json(envelope(result))
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
    app.use('/*', serveStatic({ root: deps.staticDir, onFound: cacheOf }))
    app.get('*', serveStatic({
      root: deps.staticDir,
      path: 'index.html',
      // 入口 HTML 绝不能被缓存：它引用的是内容哈希文件名，一旦客户端留着旧 HTML，
      // 就会一直加载旧构建（改完布局却仍看到旧界面，正是这种表现）。
      onFound: (_path, c) => c.header('Cache-Control', 'no-cache, must-revalidate'),
    }))
  }

  return { app, engine }
}
