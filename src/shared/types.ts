export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface PageQuery {
  page: number
  pageSize: number
  keyword?: string
  status?: string
}

export interface PageResult<T> {
  rows: T[]
  total: number
}

export interface SessionUser {
  id: number
  username: string
  nickname: string
  avatar: string
  email: string
  department: string
  roles: string[]
  permissions: string[]
}

export interface LoginPayload {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  user: SessionUser
}

export type UserStatus = 'active' | 'disabled'

export interface SysUser {
  id: number
  username: string
  nickname: string
  phone: string
  email: string
  /** 所属部门 id：名称由 `/system/departments` 解析，不冗余存储。 */
  deptId: number | null
  /** 角色 id：名称由 `/system/roles` 解析。 */
  roleId: number | null
  status: UserStatus
  createdAt: string
}

export interface Role {
  id: number
  name: string
  code: string
  description: string
  status: UserStatus
  userCount: number
  createdAt: string
}

export interface Department {
  id: number
  name: string
  parentId: number | null
  leader: string
  phone: string
  status: UserStatus
}

export interface Post {
  id: number
  name: string
  code: string
  order: number
  status: UserStatus
}

export interface DictType {
  id: number
  name: string
  type: string
  status: UserStatus
  remark: string
}

export interface ConfigItem {
  id: number
  name: string
  key: string
  value: string
  builtin: boolean
  remark: string
}

export interface Notice {
  id: number
  title: string
  type: 'notice' | 'announcement'
  author: string
  publishedAt: string
  status: 'draft' | 'published'
}

export interface LoginLog {
  id: number
  username: string
  ip: string
  location: string
  browser: string
  os: string
  status: 'success' | 'fail'
  message: string
  createdAt: string
}

export interface OperationLog {
  id: number
  module: string
  action: string
  operator: string
  method: string
  duration: number
  status: 'success' | 'fail'
  createdAt: string
}

export interface Job {
  id: number
  name: string
  group: string
  cron: string
  target: string
  status: 'running' | 'paused'
  lastRunAt: string
  nextRunAt: string
}

export interface ServerMetric {
  host: string
  os: string
  uptime: string
  cpu: number
  memory: number
  disk: number
  load: number[]
  updatedAt: string
}

export interface CacheEntry {
  key: string
  type: string
  ttl: number
  size: string
}

export interface OnlineSession {
  token: string
  username: string
  ip: string
  browser: string
  loginAt: string
  lastActiveAt: string
}
