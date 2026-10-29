// 宿主业务实体类型：schema 只描述形状，具体实体仍由业务侧声明。
//
// 运行期形状（会话/登录日志/监控指标）由 `@addzero/data-page` 提供并在此转出，
// 免得宿主再多一份同名类型。
export type {
  ApiEnvelope,
  CacheEntry,
  LoginLog,
  LoginPayload,
  LoginResult,
  OnlineSession,
  OperationLog,
  ServerMetric,
  SessionUser,
} from '@addzero/data-page'

/** 分页查询与结果：页面层已定义，宿主直接转出，避免两份同名类型。 */
export type { PageQuery, PageResult } from '@addzero/data-page'

export type { UserStatus } from './entity-status.ts'

import type { UserStatus } from './entity-status.ts'

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
