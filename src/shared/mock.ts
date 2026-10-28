import type { HttpClient } from './http'
import type {
  CacheEntry,
  ConfigItem,
  Department,
  DictType,
  Job,
  LoginLog,
  LoginPayload,
  LoginResult,
  MenuNode,
  Notice,
  OnlineSession,
  OperationLog,
  PageQuery,
  PageResult,
  Post,
  Role,
  ServerMetric,
  SessionUser,
  SysUser,
} from './types'

interface MockDatabase {
  users: SysUser[]
  roles: Role[]
  departments: Department[]
  posts: Post[]
  dicts: DictType[]
  configs: ConfigItem[]
  notices: Notice[]
  jobs: Job[]
  loginLogs: LoginLog[]
  operationLogs: OperationLog[]
  sessions: OnlineSession[]
}

const STORAGE_KEY = 'micro-admin.mock.v1'
const SESSION_KEY = 'micro-admin.token'

const adminUser: SessionUser = {
  id: 1,
  username: 'admin',
  nickname: '超级管理员',
  avatar: '',
  email: 'admin@example.com',
  department: '平台研发部',
  roles: ['admin'],
  permissions: ['*:*:*'],
}

const auditorUser: SessionUser = {
  id: 2,
  username: 'auditor',
  nickname: '审计员',
  avatar: '',
  email: 'auditor@example.com',
  department: '质量保障部',
  roles: ['auditor'],
  permissions: ['system:user:list', 'system:role:list', 'monitor:server:view', 'monitor:online:list'],
}

const iso = (offsetDays: number, hour = 9, minute = 20): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

function seed(): MockDatabase {
  const roles: Role[] = [
    { id: 1, name: '超级管理员', code: 'admin', description: '拥有全部权限，不受菜单与数据范围限制', status: 'active', userCount: 1, createdAt: iso(-420) },
    { id: 2, name: '系统管理员', code: 'system', description: '维护用户、角色、菜单与参数', status: 'active', userCount: 4, createdAt: iso(-360) },
    { id: 3, name: '审计员', code: 'auditor', description: '只读查看日志、在线用户与服务器状态', status: 'active', userCount: 3, createdAt: iso(-300) },
    { id: 4, name: '运营专员', code: 'operator', description: '公告、字典与日常配置维护', status: 'active', userCount: 6, createdAt: iso(-240) },
    { id: 5, name: '访客', code: 'guest', description: '仅可访问工作台只读看板', status: 'disabled', userCount: 0, createdAt: iso(-180) },
  ]
  const departments: Department[] = [
    { id: 1, name: '总部', parentId: null, leader: '林舟', phone: '020-88001234', status: 'active' },
    { id: 2, name: '平台研发部', parentId: 1, leader: '周岚', phone: '020-88001235', status: 'active' },
    { id: 3, name: '前端组', parentId: 2, leader: '陈默', phone: '020-88001236', status: 'active' },
    { id: 4, name: '后端组', parentId: 2, leader: '吴桐', phone: '020-88001237', status: 'active' },
    { id: 5, name: '质量保障部', parentId: 1, leader: '苏禾', phone: '020-88001238', status: 'active' },
    { id: 6, name: '市场运营部', parentId: 1, leader: '何川', phone: '020-88001239', status: 'active' },
  ]
  const names = ['林舟', '周岚', '陈默', '吴桐', '苏禾', '何川', '沈知', '叶青', '程野', '顾南', '唐棠', '许至', '黎川', '江白', '温言', '段清', '秦朗', '孟晚']
  const users: SysUser[] = names.map((nickname, index) => ({
    id: index + 1,
    username: ['admin', 'auditor', 'chenmo', 'wutong', 'suhe', 'hechuan', 'shenzhi', 'yeqing', 'chengye', 'gunan', 'tangtang', 'xuzhi', 'lichuan', 'jiangbai', 'wenyan', 'duanqing', 'qinlang', 'mengwan'][index] ?? `user${index + 1}`,
    nickname,
    phone: `1380000${String(1000 + index).slice(-4)}`,
    email: `user${index + 1}@example.com`,
    department: departments[(index % 5) + 1]?.name ?? '平台研发部',
    role: roles[index === 0 ? 0 : (index % 4) + 1]?.name ?? '运营专员',
    status: index === 16 ? 'disabled' : 'active',
    createdAt: iso(-(180 - index * 6), 9 + (index % 8), (index * 7) % 60),
  }))
  const posts: Post[] = [
    { id: 1, name: '董事长', code: 'ceo', order: 1, status: 'active' },
    { id: 2, name: '项目经理', code: 'pm', order: 2, status: 'active' },
    { id: 3, name: '前端工程师', code: 'fe', order: 3, status: 'active' },
    { id: 4, name: '后端工程师', code: 'be', order: 4, status: 'active' },
    { id: 5, name: '测试工程师', code: 'qa', order: 5, status: 'active' },
  ]
  const dicts: DictType[] = [
    { id: 1, name: '用户性别', type: 'sys_user_sex', status: 'active', remark: '用户性别列表' },
    { id: 2, name: '菜单状态', type: 'sys_show_hide', status: 'active', remark: '菜单显示与隐藏' },
    { id: 3, name: '系统开关', type: 'sys_normal_disable', status: 'active', remark: '启用与停用' },
    { id: 4, name: '通知类型', type: 'sys_notice_type', status: 'active', remark: '通知与公告' },
    { id: 5, name: '任务分组', type: 'sys_job_group', status: 'disabled', remark: '定时任务分组' },
  ]
  const configs: ConfigItem[] = [
    { id: 1, name: '主框架页-默认皮肤', key: 'sys.index.skinName', value: 'skin-blue', builtin: true, remark: '默认主题皮肤' },
    { id: 2, name: '用户管理-账号初始密码', key: 'sys.user.initPassword', value: '123456', builtin: true, remark: '新用户初始密码' },
    { id: 3, name: '账号自助-验证码开关', key: 'sys.account.captchaEnabled', value: 'false', builtin: true, remark: '登录验证码' },
    { id: 4, name: '账号自助-是否开启注册', key: 'sys.account.registerUser', value: 'false', builtin: true, remark: '允许用户注册' },
    { id: 5, name: '系统名称', key: 'sys.app.name', value: 'Micro Admin', builtin: false, remark: '侧边栏与登录页标题' },
  ]
  const notices: Notice[] = [
    { id: 1, title: '关于微内核插件规范 v1 的发布说明', type: 'announcement', author: '周岚', publishedAt: iso(-1, 10, 30), status: 'published' },
    { id: 2, title: '本周五 22:00 数据库例行维护', type: 'notice', author: '吴桐', publishedAt: iso(-2, 16, 15), status: 'published' },
    { id: 3, title: '新版审计日志字段调整说明', type: 'notice', author: '苏禾', publishedAt: iso(-4, 11, 5), status: 'published' },
    { id: 4, title: '节前安全巡检安排（草稿）', type: 'announcement', author: '林舟', publishedAt: iso(0, 8, 40), status: 'draft' },
  ]
  const jobs: Job[] = [
    { id: 1, name: '清理过期登录日志', group: '日志维护', cron: '0 30 2 * * ?', target: 'logCleanup.clean', status: 'running', lastRunAt: iso(0, 2, 30), nextRunAt: iso(1, 2, 30) },
    { id: 2, name: '刷新在线会话缓存', group: '缓存维护', cron: '0 */5 * * * ?', target: 'sessionCache.refresh', status: 'running', lastRunAt: iso(0, 9, 25), nextRunAt: iso(0, 9, 30) },
    { id: 3, name: '生成运营日报', group: '运营报表', cron: '0 0 8 * * ?', target: 'dailyReport.generate', status: 'paused', lastRunAt: iso(-1, 8, 0), nextRunAt: iso(1, 8, 0) },
  ]
  const loginLogs: LoginLog[] = Array.from({ length: 16 }, (_, index) => ({
    id: 16 - index,
    username: users[index % 8]?.username ?? 'admin',
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
    operator: users[index % 6]?.nickname ?? '林舟',
    method: ['POST', 'PUT', 'DELETE', 'GET'][index % 4] ?? 'GET',
    duration: 28 + ((index * 37) % 460),
    status: index === 4 || index === 13 ? 'fail' : 'success',
    createdAt: iso(0, 9, 28 - index),
  }))
  const sessions: OnlineSession[] = users.slice(0, 5).map((user, index) => ({
    token: `mock-session-${index + 1}`,
    username: user.username,
    ip: `10.20.1.${20 + index}`,
    browser: ['Chrome 131 / macOS', 'Safari 18 / iOS', 'Edge 131 / Windows'][index % 3] ?? 'Chrome 131',
    loginAt: iso(0, 8 + index, 10),
    lastActiveAt: iso(0, 9, 30 - index * 4),
  }))
  return { users, roles, departments, posts, dicts, configs, notices, jobs, loginLogs, operationLogs, sessions }
}

function loadDatabase(): MockDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as MockDatabase
  } catch {
    // 损坏的本地演示数据不能阻塞登录，直接回落到种子。
  }
  const database = seed()
  saveDatabase(database)
  return database
}

function saveDatabase(database: MockDatabase): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
}

function paginate<T>(rows: T[], query: PageQuery, matcher: (row: T) => boolean): PageResult<T> {
  const filtered = rows.filter(matcher)
  const start = (query.page - 1) * query.pageSize
  return { rows: filtered.slice(start, start + query.pageSize), total: filtered.length }
}

function valueOf(searchParams: URLSearchParams, key: string): string {
  return searchParams.get(key)?.trim() ?? ''
}

function menuTree(): MenuNode[] {
  return [
    {
      id: 1, title: '系统管理', path: '/system', type: 'directory', permission: '', status: 'active', order: 1,
      children: [
        { id: 11, title: '用户管理', path: '/system/user', type: 'menu', permission: 'system:user:list', status: 'active', order: 1 },
        { id: 12, title: '角色管理', path: '/system/role', type: 'menu', permission: 'system:role:list', status: 'active', order: 2 },
        { id: 13, title: '菜单管理', path: '/system/menu', type: 'menu', permission: 'system:menu:list', status: 'active', order: 3 },
        { id: 14, title: '部门管理', path: '/system/dept', type: 'menu', permission: 'system:dept:list', status: 'active', order: 4 },
        { id: 15, title: '岗位管理', path: '/system/post', type: 'menu', permission: 'system:post:list', status: 'active', order: 5 },
      ],
    },
    {
      id: 2, title: '系统工具', path: '/tool', type: 'directory', permission: '', status: 'active', order: 2,
      children: [
        { id: 21, title: '字典管理', path: '/system/dict', type: 'menu', permission: 'system:dict:list', status: 'active', order: 1 },
        { id: 22, title: '参数设置', path: '/system/config', type: 'menu', permission: 'system:config:list', status: 'active', order: 2 },
        { id: 23, title: '通知公告', path: '/system/notice', type: 'menu', permission: 'system:notice:list', status: 'active', order: 3 },
      ],
    },
    {
      id: 3, title: '系统监控', path: '/monitor', type: 'directory', permission: '', status: 'active', order: 3,
      children: [
        { id: 31, title: '在线用户', path: '/monitor/online', type: 'menu', permission: 'monitor:online:list', status: 'active', order: 1 },
        { id: 32, title: '定时任务', path: '/monitor/job', type: 'menu', permission: 'monitor:job:list', status: 'active', order: 2 },
        { id: 33, title: '服务监控', path: '/monitor/server', type: 'menu', permission: 'monitor:server:view', status: 'active', order: 3 },
        { id: 34, title: '缓存监控', path: '/monitor/cache', type: 'menu', permission: 'monitor:cache:view', status: 'active', order: 4 },
      ],
    },
  ]
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

function compareText(a: string, b: string, keyword: string): boolean {
  return keyword === '' || a.toLowerCase().includes(keyword.toLowerCase()) || b.toLowerCase().includes(keyword.toLowerCase())
}

function nextId<T extends { id: number }>(rows: T[]): number {
  return Math.max(0, ...rows.map((row) => row.id)) + 1
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export interface MockLoginResponse extends LoginResult {
  token: string
}

export function createMockHttpClient(options: { delay?: number } = {}): HttpClient {
  const database = loadDatabase()
  const delayMs = options.delay ?? 160
  let token: string | null = localStorage.getItem(SESSION_KEY)

  const respond = async <T>(value: T): Promise<T> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return structuredClone(value)
  }

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const url = new URL(path, location.origin)
      const method = (init.method ?? 'GET').toUpperCase()
      const query: PageQuery = {
        page: Number(valueOf(url.searchParams, 'page') || 1),
        pageSize: Number(valueOf(url.searchParams, 'pageSize') || 10),
      }
      const keyword = valueOf(url.searchParams, 'keyword')
      query.keyword = keyword
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      const route = url.pathname

      if (route === '/auth/login' && method === 'POST') {
        const payload = body as unknown as LoginPayload
        if (payload.username === 'admin' && payload.password === 'admin123') {
          token = 'mock-token-admin'
          localStorage.setItem(SESSION_KEY, token)
          const loginLog: LoginLog = {
            id: nextId(database.loginLogs), username: 'admin', ip: '127.0.0.1', location: '本机',
            browser: navigator.userAgent.includes('Safari') ? 'Safari' : 'Chrome', os: navigator.platform,
            status: 'success', message: '登录成功', createdAt: new Date().toISOString(),
          }
          database.loginLogs.unshift(loginLog)
          saveDatabase(database)
          return respond({ token, user: adminUser } as T)
        }
        if (payload.username === 'auditor' && payload.password === 'audit123') {
          token = 'mock-token-auditor'
          localStorage.setItem(SESSION_KEY, token)
          return respond({ token, user: auditorUser } as T)
        }
        fail(401, '账号或密码错误')
      }

      if (!token) fail(401, '登录已失效，请重新登录')

      if (route === '/auth/profile' && method === 'GET') {
        return respond((token === 'mock-token-auditor' ? auditorUser : adminUser) as T)
      }

      if (route === '/auth/logout' && method === 'POST') {
        token = null
        localStorage.removeItem(SESSION_KEY)
        return respond(undefined as T)
      }

      if (route === '/dashboard/overview' && method === 'GET') {
        return respond({
          metrics: [
            { label: '用户总数', value: database.users.length, unit: '人', delta: 12.5, trend: 'up' },
            { label: '启用角色', value: database.roles.filter((role) => role.status === 'active').length, unit: '个', delta: 2.4, trend: 'up' },
            { label: '今日登录', value: database.loginLogs.filter((log) => log.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length, unit: '次', delta: 8.1, trend: 'up' },
            { label: '异常操作', value: database.operationLogs.filter((log) => log.status === 'fail').length, unit: '条', delta: -14.2, trend: 'down' },
          ],
          trend: [42, 55, 49, 68, 73, 66, 88, 79, 92, 87, 103, 96],
          distribution: [
            { label: '平台研发部', value: 46 },
            { label: '质量保障部', value: 24 },
            { label: '市场运营部', value: 18 },
            { label: '其他', value: 12 },
          ],
          notices: database.notices.slice(0, 4),
          recentOperations: database.operationLogs.slice(0, 6),
          updatedAt: new Date().toISOString(),
        } as T)
      }

      if (route === '/system/users' && method === 'GET') {
        return respond(paginate(database.users, query, (row) => {
          const status = valueOf(url.searchParams, 'status')
          return (status === '' || row.status === status) && compareText(row.username, row.nickname, keyword)
        }) as T)
      }
      if (route === '/system/users' && method === 'POST') {
        const user = body as unknown as Omit<SysUser, 'id' | 'createdAt'>
        if (database.users.some((row) => row.username === user.username)) fail(409, '用户名已存在')
        const created: SysUser = { ...user, id: nextId(database.users), createdAt: new Date().toISOString() }
        database.users.unshift(created)
        saveDatabase(database)
        return respond(created as T)
      }
      const userMatch = route.match(/^\/system\/users\/(\d+)$/)
      if (userMatch?.[1] && method === 'PUT') {
        const index = database.users.findIndex((row) => row.id === Number(userMatch[1]))
        if (index < 0) fail(404, '用户不存在')
        const current = database.users[index]
        if (!current) fail(404, '用户不存在')
        const updated = { ...current, ...(body as Partial<SysUser>) }
        database.users[index] = updated
        saveDatabase(database)
        return respond(updated as T)
      }
      if (userMatch?.[1] && method === 'DELETE') {
        const index = database.users.findIndex((row) => row.id === Number(userMatch[1]))
        if (index < 0) fail(404, '用户不存在')
        if (database.users[index]?.username === 'admin') fail(403, '内置管理员不可删除')
        database.users.splice(index, 1)
        saveDatabase(database)
        return respond(undefined as T)
      }

      if (route === '/system/roles' && method === 'GET') {
        return respond(paginate(database.roles, query, (row) => compareText(row.name, row.code, keyword)) as T)
      }
      const roleMatch = route.match(/^\/system\/roles\/(\d+)$/)
      if (roleMatch?.[1] && method === 'PUT') {
        const index = database.roles.findIndex((row) => row.id === Number(roleMatch[1]))
        if (index < 0) fail(404, '角色不存在')
        const current = database.roles[index]
        if (!current) fail(404, '角色不存在')
        database.roles[index] = { ...current, ...(body as Partial<Role>) }
        saveDatabase(database)
        return respond(database.roles[index] as T)
      }

      if (route === '/system/menus' && method === 'GET') return respond(menuTree() as T)
      if (route === '/system/departments' && method === 'GET') return respond(database.departments as T)
      if (route === '/system/posts' && method === 'GET') return respond(database.posts as T)
      if (route === '/system/dicts' && method === 'GET') {
        return respond(paginate(database.dicts, query, (row) => compareText(row.name, row.type, keyword)) as T)
      }
      if (route === '/system/configs' && method === 'GET') {
        return respond(paginate(database.configs, query, (row) => compareText(row.name, row.key, keyword)) as T)
      }
      if (route === '/system/notices' && method === 'GET') {
        return respond(paginate(database.notices, query, (row) => compareText(row.title, row.author, keyword)) as T)
      }
      if (route === '/monitor/jobs' && method === 'GET') {
        return respond(paginate(database.jobs, query, (row) => compareText(row.name, row.group, keyword)) as T)
      }
      const jobMatch = route.match(/^\/monitor\/jobs\/(\d+)\/status$/)
      if (jobMatch?.[1] && method === 'PATCH') {
        const job = database.jobs.find((row) => row.id === Number(jobMatch[1]))
        if (!job) fail(404, '任务不存在')
        job.status = body.status === 'running' ? 'running' : 'paused'
        saveDatabase(database)
        return respond(job as T)
      }
      if (route === '/monitor/login-logs' && method === 'GET') {
        return respond(paginate(database.loginLogs, query, (row) => compareText(row.username, row.ip, keyword)) as T)
      }
      if (route === '/monitor/operation-logs' && method === 'GET') {
        return respond(paginate(database.operationLogs, query, (row) => compareText(row.module, row.operator, keyword)) as T)
      }
      if (route === '/monitor/server' && method === 'GET') return respond(serverMetric() as T)
      if (route === '/monitor/cache' && method === 'GET') return respond(cacheEntries() as T)
      if (route === '/monitor/online' && method === 'GET') return respond(database.sessions as T)
      const sessionMatch = route.match(/^\/monitor\/online\/([^/]+)$/)
      if (sessionMatch?.[1] && method === 'DELETE') {
        const index = database.sessions.findIndex((row) => row.token === decodeURIComponent(sessionMatch[1] ?? ''))
        if (index >= 0) database.sessions.splice(index, 1)
        saveDatabase(database)
        return respond(undefined as T)
      }

      fail(404, `接口不存在：${method} ${route}`)
    },
  }
}

export function resetMockDatabase(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(SESSION_KEY)
}
