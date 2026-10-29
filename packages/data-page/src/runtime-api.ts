// 运行期接口：登录、会话、工作台汇总与监控观测。
//
// 与「页面资源」分开：这些不是 schema 驱动的 CRUD，而是固定的几个只读/鉴权接口。
// 实现不依赖 localStorage / navigator / fetch，存储与 UA 由调用方注入，
// 因此浏览器 mock 与 Node 服务共用同一份逻辑。
import type { PageEngine } from '@addzero/data-page'
import type {
  CacheEntry,
  LoginLog,
  LoginPayload,
  LoginResult,
  OnlineSession,
  OperationLog,
  ServerMetric,
  SessionUser,
} from './runtime-types.ts'

export interface RuntimeData {
  loginLogs: LoginLog[]
  operationLogs: OperationLog[]
  sessions: OnlineSession[]
}

export interface RuntimeStore {
  read(): RuntimeData | null
  write(data: RuntimeData): void
}

export interface RuntimeRequest {
  method: string
  path: string
  body: unknown
  /** 当前请求携带的令牌，未登录为 `null`。 */
  token: string | null
  /** 用于记录登录日志的 UA 文案。 */
  userAgent: string
}

export interface RuntimeReply {
  status: number
  data: unknown
  /** 登录/登出时返回新的令牌，调用方负责持久化。 */
  token?: string | null
}

export const RUNTIME_UNHANDLED = Symbol('runtime-unhandled')

export const ADMIN: SessionUser = {
  id: 1,
  username: 'admin',
  nickname: '超级管理员',
  avatar: '',
  email: 'admin@example.com',
  department: '平台研发部',
  roles: ['admin'],
  permissions: ['*:*:*'],
}

export const AUDITOR: SessionUser = {
  id: 2,
  username: 'auditor',
  nickname: '审计员',
  avatar: '',
  email: 'auditor@example.com',
  department: '质量保障部',
  roles: ['auditor'],
  permissions: ['system:user:list', 'system:role:list', 'monitor:server:view', 'monitor:online:list'],
}

const TOKEN_ADMIN = 'mock-token-admin'
const TOKEN_AUDITOR = 'mock-token-auditor'

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function iso(offsetDays: number, hour = 9, minute = 20): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

function nextId(rows: Array<{ id: number }>): number {
  return Math.max(0, ...rows.map((row) => row.id)) + 1
}

/** 日志与会话由用户清单派生，避免再维护一份用户名字表。 */
export function seedRuntime(usernames: string[], nicknames: string[]): RuntimeData {
  const nameOf = (index: number): string => usernames[index % Math.max(usernames.length, 1)] ?? 'admin'
  const nicknameOf = (index: number): string => nicknames[index % Math.max(nicknames.length, 1)] ?? '林舟'

  const loginLogs: LoginLog[] = Array.from({ length: 16 }, (_, index) => ({
    id: 16 - index,
    username: nameOf(index),
    ip: `10.20.${index % 8}.${30 + index}`,
    location: ['广州', '深圳', '上海', '杭州'][index % 4] ?? '广州',
    browser: ['Chrome 131', 'Safari 18', 'Edge 131'][index % 3] ?? 'Chrome 131',
    os: index % 3 === 1 ? 'macOS 15' : 'Windows 11',
    status: index === 5 || index === 11 ? 'fail' : 'success',
    message: index === 5 || index === 11 ? '密码错误' : '登录成功',
    createdAt: iso(0, 9, 30 - index),
  }))

  const operationLogs: OperationLog[] = Array.from({ length: 18 }, (_, index) => ({
    id: 18 - index,
    module: ['用户管理', '角色管理', '菜单管理', '参数设置', '定时任务'][index % 5] ?? '系统管理',
    action: ['新增', '修改', '删除', '导出', '查询'][index % 5] ?? '查询',
    operator: nicknameOf(index),
    method: ['POST', 'PUT', 'DELETE', 'GET'][index % 4] ?? 'GET',
    duration: 28 + ((index * 37) % 460),
    status: index === 4 || index === 13 ? 'fail' : 'success',
    createdAt: iso(0, 9, 28 - index),
  }))

  const sessions: OnlineSession[] = usernames.slice(0, 5).map((username, index) => ({
    token: `mock-session-${index + 1}`,
    username,
    ip: `10.20.1.${20 + index}`,
    browser: ['Chrome 131 / macOS', 'Safari 18 / iOS', 'Edge 131 / Windows'][index % 3] ?? 'Chrome 131',
    loginAt: iso(0, 8 + index, 10),
    lastActiveAt: iso(0, 9, 30 - index * 4),
  }))

  return { loginLogs, operationLogs, sessions }
}

function serverMetric(): ServerMetric {
  const minute = new Date().getMinutes()
  return {
    host: 'micro-admin-demo',
    os: 'Linux 6.8 / Node 22',
    uptime: '18 天 4 小时',
    cpu: 18 + (minute % 17),
    memory: 42 + (minute % 9),
    disk: 37,
    load: [0.32, 0.45, 0.51],
    updatedAt: new Date().toISOString(),
  }
}

function cacheEntries(): CacheEntry[] {
  return [
    { key: 'login_tokens:*', type: 'Set', ttl: 1800, size: '12 keys' },
    { key: 'sys_config', type: 'Hash', ttl: -1, size: '5 fields' },
    { key: 'sys_dict:sys_user_sex', type: 'Hash', ttl: 3600, size: '3 fields' },
    { key: 'plugin:manifest', type: 'String', ttl: 7200, size: '2.4 KB' },
    { key: 'rate_limit:api', type: 'ZSet', ttl: 60, size: '128 members' },
  ]
}

/**
 * 令牌 → 身份。真实部署替换为 JWT 校验，签名不变。
 *
 * 导出它是为了让 HTTP 外壳能在进入业务前统一拦截未登录请求，
 * 而不是每个资源处理器各写一遍鉴权。
 */
export function authenticate(token: string | null): SessionUser | null {
  if (token === TOKEN_ADMIN) return ADMIN
  if (token === TOKEN_AUDITOR) return AUDITOR
  return null
}

/**
 * 无需登录即可访问的请求。
 *
 * 除了登录，页面 schema 清单也公开只读：宿主要在登录前就知道「有哪些页面」，
 * 才能把它们登记成路由与菜单。schema 只是界面元数据（不含业务数据），
 * 真正的数据接口仍然逐个校验令牌；写配置另有 `canWriteSchema` 把关。
 */
export function isPublicPath(path: string, method = 'GET'): boolean {
  if (path === '/auth/login') return true
  return method === 'GET' && (path === '/ui/pages' || path.startsWith('/ui/pages/'))
}

/** 改页面配置所需权限码：与 `CrudPageSchema.permissions` 同一命名空间。 */
export const SCHEMA_WRITE_PERMISSION = 'system:page:config'

/**
 * 页面配置写权限判定。
 *
 * 页面配置决定「别人看到什么」，属于管理面写操作，因此不与普通资源共用权限：
 * 只读账号（auditor）能看页面，但改不了页面。
 */
export function canWriteSchema(
  user: SessionUser | null,
  permission: string = SCHEMA_WRITE_PERMISSION,
): boolean {
  if (!user) return false
  const granted = user.permissions
  return granted.includes('*:*:*') || granted.includes('*') || granted.includes(permission)
}

export interface RuntimeApi {
  handle(request: RuntimeRequest): RuntimeReply | typeof RUNTIME_UNHANDLED
}

/**
 * 创建运行期接口。
 *
 * `engine` 只用于读取真实资源（用户/角色/公告），保证工作台数字与列表页一致。
 */
export function createRuntimeApi(engine: PageEngine, store: RuntimeStore): RuntimeApi {
  function ensure(): RuntimeData {
    const existing = store.read()
    if (existing) return existing
    const users = engine.rows('/system/users')
    const seeded = seedRuntime(
      users.map((row) => textOf(row.username)),
      users.map((row) => textOf(row.nickname)),
    )
    store.write(seeded)
    return seeded
  }

  return {
    handle(request: RuntimeRequest): RuntimeReply | typeof RUNTIME_UNHANDLED {
      const { method, path, token } = request
      const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as Record<string, unknown>

      if (path === '/auth/login' && method === 'POST') {
        const payload = body as unknown as LoginPayload
        if (payload.username === 'admin' && payload.password === 'admin123') {
          const data = ensure()
          data.loginLogs.unshift({
            id: nextId(data.loginLogs), username: 'admin', ip: '127.0.0.1', location: '本机',
            browser: request.userAgent.includes('Safari') ? 'Safari' : 'Chrome', os: request.userAgent,
            status: 'success', message: '登录成功', createdAt: new Date().toISOString(),
          })
          store.write(data)
          return { status: 200, data: { token: TOKEN_ADMIN, user: ADMIN } satisfies LoginResult, token: TOKEN_ADMIN }
        }
        if (payload.username === 'auditor' && payload.password === 'audit123') {
          return { status: 200, data: { token: TOKEN_AUDITOR, user: AUDITOR } satisfies LoginResult, token: TOKEN_AUDITOR }
        }
        return { status: 401, data: { message: '账号或密码错误' } }
      }

      const known = path === '/auth/profile'
        || path === '/auth/logout'
        || path === '/dashboard/overview'
        || path === '/monitor/server'
        || path === '/monitor/cache'
        || path === '/monitor/online'
        || path.startsWith('/monitor/online/')
      if (!known) return RUNTIME_UNHANDLED

      const user = authenticate(token)
      if (!user) return { status: 401, data: { message: '登录已失效，请重新登录' } }

      if (path === '/auth/profile' && method === 'GET') return { status: 200, data: user }

      if (path === '/auth/logout' && method === 'POST') return { status: 200, data: undefined, token: null }

      if (path === '/dashboard/overview' && method === 'GET') {
        const data = ensure()
        const users = engine.rows('/system/users')
        const roles = engine.rows('/system/roles')
        return {
          status: 200,
          data: {
            metrics: [
              { label: '用户总数', value: users.length, unit: '人', delta: 12.5, trend: 'up' },
              { label: '启用角色', value: roles.filter((role) => role.status === 'active').length, unit: '个', delta: 2.4, trend: 'up' },
              { label: '今日登录', value: data.loginLogs.filter((log) => log.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length, unit: '次', delta: 8.1, trend: 'up' },
              { label: '异常操作', value: data.operationLogs.filter((log) => log.status === 'fail').length, unit: '条', delta: -14.2, trend: 'down' },
            ],
            trend: [42, 55, 49, 68, 73, 66, 88, 79, 92, 87, 103, 96],
            distribution: [
              { label: '平台研发部', value: 46 },
              { label: '质量保障部', value: 24 },
              { label: '市场运营部', value: 18 },
              { label: '其他', value: 12 },
            ],
            notices: engine.rows('/system/notices').slice(0, 4),
            recentOperations: data.operationLogs.slice(0, 6),
            updatedAt: new Date().toISOString(),
          },
        }
      }

      if (path === '/monitor/server' && method === 'GET') return { status: 200, data: serverMetric() }
      if (path === '/monitor/cache' && method === 'GET') return { status: 200, data: cacheEntries() }
      if (path === '/monitor/online' && method === 'GET') return { status: 200, data: ensure().sessions }

      const sessionMatch = path.match(/^\/monitor\/online\/([^/]+)$/)
      if (sessionMatch?.[1] && method === 'DELETE') {
        const data = ensure()
        const target = decodeURIComponent(sessionMatch[1])
        data.sessions = data.sessions.filter((row) => row.token !== target)
        store.write(data)
        return { status: 200, data: undefined }
      }

      return RUNTIME_UNHANDLED
    },
  }
}
