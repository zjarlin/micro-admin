// RBAC 插件的演示数据：部门、角色、岗位、菜单树。
import type { PageData, Row } from '@zjarlin/data-page'
import { iso } from '../../shared/seed-clock.ts'

const DEPARTMENT_SEED: Row[] = [
  { id: 1, name: '总部', parentId: null, leader: '林舟', phone: '020-88001234', status: 'active' },
  { id: 2, name: '平台研发部', parentId: 1, leader: '周岚', phone: '020-88001235', status: 'active' },
  { id: 3, name: '前端组', parentId: 2, leader: '陈默', phone: '020-88001236', status: 'active' },
  { id: 4, name: '后端组', parentId: 2, leader: '吴桐', phone: '020-88001237', status: 'active' },
  { id: 5, name: '质量保障部', parentId: 1, leader: '苏禾', phone: '020-88001238', status: 'active' },
  { id: 6, name: '市场运营部', parentId: 1, leader: '何川', phone: '020-88001239', status: 'active' },
]

const ROLE_SEED: Row[] = [
  { id: 1, name: '超级管理员', code: 'admin', description: '拥有全部权限，不受菜单与数据范围限制', status: 'active', userCount: 1, createdAt: iso(-420) },
  { id: 2, name: '系统管理员', code: 'system', description: '维护用户、角色、菜单与参数', status: 'active', userCount: 4, createdAt: iso(-360) },
  { id: 3, name: '审计员', code: 'auditor', description: '只读查看日志、在线用户与服务器状态', status: 'active', userCount: 3, createdAt: iso(-300) },
  { id: 4, name: '运营专员', code: 'operator', description: '公告、字典与日常配置维护', status: 'active', userCount: 6, createdAt: iso(-240) },
  { id: 5, name: '访客', code: 'guest', description: '仅可访问工作台只读看板', status: 'disabled', userCount: 0, createdAt: iso(-180) },
]

const POST_SEED: Row[] = [
  { id: 1, name: '董事长', code: 'ceo', order: 1, status: 'active' },
  { id: 2, name: '项目经理', code: 'pm', order: 2, status: 'active' },
  { id: 3, name: '前端工程师', code: 'fe', order: 3, status: 'active' },
  { id: 4, name: '后端工程师', code: 'be', order: 4, status: 'active' },
  { id: 5, name: '测试工程师', code: 'qa', order: 5, status: 'active' },
]

/** 菜单树按扁平存 `parentId`：与部门表同一种形状，后端不需要为它写特例。 */
const MENU_SEED: Row[] = [
  { id: 1, title: '系统管理', path: '/system', type: 'directory', permission: '', status: 'active', order: 1, parentId: null },
  { id: 11, title: '用户管理', path: '/system/user', type: 'menu', permission: 'system:user:list', status: 'active', order: 1, parentId: 1 },
  { id: 12, title: '角色管理', path: '/system/role', type: 'menu', permission: 'system:role:list', status: 'active', order: 2, parentId: 1 },
  { id: 13, title: '菜单管理', path: '/system/menu', type: 'menu', permission: 'system:menu:list', status: 'active', order: 3, parentId: 1 },
  { id: 14, title: '部门管理', path: '/system/dept', type: 'menu', permission: 'system:dept:list', status: 'active', order: 4, parentId: 1 },
  { id: 15, title: '岗位管理', path: '/system/post', type: 'menu', permission: 'system:post:list', status: 'active', order: 5, parentId: 1 },
  { id: 2, title: '系统工具', path: '/tool', type: 'directory', permission: '', status: 'active', order: 2, parentId: null },
  { id: 21, title: '字典管理', path: '/system/dict', type: 'menu', permission: 'system:dict:list', status: 'active', order: 1, parentId: 2 },
  { id: 22, title: '参数设置', path: '/system/config', type: 'menu', permission: 'system:config:list', status: 'active', order: 2, parentId: 2 },
  { id: 23, title: '通知公告', path: '/system/notice', type: 'menu', permission: 'system:notice:list', status: 'active', order: 3, parentId: 2 },
  { id: 3, title: '系统监控', path: '/monitor', type: 'directory', permission: '', status: 'active', order: 3, parentId: null },
  { id: 31, title: '在线用户', path: '/monitor/online', type: 'menu', permission: 'monitor:online:list', status: 'active', order: 1, parentId: 3 },
  { id: 32, title: '定时任务', path: '/monitor/job', type: 'menu', permission: 'monitor:job:list', status: 'active', order: 2, parentId: 3 },
  { id: 33, title: '服务监控', path: '/monitor/server', type: 'menu', permission: 'monitor:server:view', status: 'active', order: 3, parentId: 3 },
  { id: 34, title: '缓存监控', path: '/monitor/cache', type: 'menu', permission: 'monitor:cache:view', status: 'active', order: 4, parentId: 3 },
]

export function seedRbacPages(): PageData {
  return {
    '/system/roles': ROLE_SEED.map((row) => ({ ...row })),
    '/system/departments': DEPARTMENT_SEED.map((row) => ({ ...row })),
    '/system/posts': POST_SEED.map((row) => ({ ...row })),
    '/system/menus': MENU_SEED.map((row) => ({ ...row })),
  }
}
