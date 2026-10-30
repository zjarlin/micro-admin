// 演示数据：后端首次启动时写入的唯一初始快照。
//
// 放在这里而不是服务端入口，是因为它同时被测试与种子工具复用；
// 一旦落到存储里，后续读写都只走 `PageStore`，不会再有第二份数据源。
import type { PageData, Row } from '@zjarlin/data-page'

/** 相对今天的固定时刻，避免种子数据每次运行都漂移。 */
function iso(offsetDays: number, hour = 9, minute = 20): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

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

const USERNAMES = [
  'admin', 'auditor', 'chenmo', 'wutong', 'suhe', 'hechuan', 'shenzhi', 'yeqing', 'chengye',
  'gunan', 'tangtang', 'xuzhi', 'lichuan', 'jiangbai', 'wenyan', 'duanqing', 'qinlang', 'mengwan',
]
const NICKNAMES = [
  '林舟', '周岚', '陈默', '吴桐', '苏禾', '何川', '沈知', '叶青', '程野',
  '顾南', '唐棠', '许至', '黎川', '江白', '温言', '段清', '秦朗', '孟晚',
]

const USER_SEED: Row[] = NICKNAMES.map((nickname, index) => {
  const dept = DEPARTMENT_SEED[(index % 5) + 1]
  const role = ROLE_SEED[index === 0 ? 0 : (index % 4) + 1]
  return {
    id: index + 1,
    username: USERNAMES[index] ?? `user${index + 1}`,
    nickname,
    phone: `1380000${String(1000 + index).slice(-4)}`,
    email: `user${index + 1}@example.com`,
    deptId: dept?.id ?? 2,
    roleId: role?.id ?? 4,
    status: index === 16 ? 'disabled' : 'active',
    createdAt: iso(-(180 - index * 6), 9 + (index % 8), (index * 7) % 60),
  }
})

const POST_SEED: Row[] = [
  { id: 1, name: '董事长', code: 'ceo', order: 1, status: 'active' },
  { id: 2, name: '项目经理', code: 'pm', order: 2, status: 'active' },
  { id: 3, name: '前端工程师', code: 'fe', order: 3, status: 'active' },
  { id: 4, name: '后端工程师', code: 'be', order: 4, status: 'active' },
  { id: 5, name: '测试工程师', code: 'qa', order: 5, status: 'active' },
]

const DICT_SEED: Row[] = [
  { id: 1, name: '用户性别', type: 'sys_user_sex', status: 'active', remark: '用户性别列表' },
  { id: 2, name: '菜单状态', type: 'sys_show_hide', status: 'active', remark: '菜单显示与隐藏' },
  { id: 3, name: '系统开关', type: 'sys_normal_disable', status: 'active', remark: '启用与停用' },
  { id: 4, name: '通知类型', type: 'sys_notice_type', status: 'active', remark: '通知与公告' },
  { id: 5, name: '任务分组', type: 'sys_job_group', status: 'disabled', remark: '定时任务分组' },
]

const CONFIG_SEED: Row[] = [
  { id: 1, name: '主框架页-默认皮肤', key: 'sys.index.skinName', value: 'skin-blue', builtin: true, remark: '默认主题皮肤' },
  { id: 2, name: '用户管理-账号初始密码', key: 'sys.user.initPassword', value: '123456', builtin: true, remark: '新用户初始密码' },
  { id: 3, name: '账号自助-验证码开关', key: 'sys.account.captchaEnabled', value: 'false', builtin: true, remark: '登录验证码' },
  { id: 4, name: '账号自助-是否开启注册', key: 'sys.account.registerUser', value: 'false', builtin: true, remark: '允许用户注册' },
  { id: 5, name: '系统名称', key: 'sys.app.name', value: 'Micro Admin', builtin: false, remark: '侧边栏与登录页标题' },
]

const NOTICE_SEED: Row[] = [
  { id: 1, title: '关于微内核插件规范 v1 的发布说明', type: 'announcement', author: '周岚', publishedAt: iso(-1, 10, 30), status: 'published' },
  { id: 2, title: '本周五 22:00 数据库例行维护', type: 'notice', author: '吴桐', publishedAt: iso(-2, 16, 15), status: 'published' },
  { id: 3, title: '新版审计日志字段调整说明', type: 'notice', author: '苏禾', publishedAt: iso(-4, 11, 5), status: 'published' },
  { id: 4, title: '节前安全巡检安排（草稿）', type: 'announcement', author: '林舟', publishedAt: iso(0, 8, 40), status: 'draft' },
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

const JOB_SEED: Row[] = [
  { id: 1, name: '清理过期登录日志', group: '日志维护', cron: '0 30 2 * * ?', target: 'logCleanup.clean', status: 'running', lastRunAt: iso(0, 2, 30), nextRunAt: iso(1, 2, 30) },
  { id: 2, name: '刷新在线会话缓存', group: '缓存维护', cron: '0 */5 * * * ?', target: 'sessionCache.refresh', status: 'running', lastRunAt: iso(0, 9, 25), nextRunAt: iso(0, 9, 30) },
  { id: 3, name: '生成运营日报', group: '运营报表', cron: '0 0 8 * * ?', target: 'dailyReport.generate', status: 'paused', lastRunAt: iso(-1, 8, 0), nextRunAt: iso(1, 8, 0) },
]

const DEVICE_SEED: Row[] = [
  { id: 1, code: 'PLC-1001', name: '一号线主控 PLC', site: 'A 区配电间', protocol: 'Modbus', status: 'online', createdAt: iso(-60, 9, 12) },
  { id: 2, code: 'HMI-2001', name: '中控室触摸屏', site: '中控室', protocol: 'OPCUA', status: 'online', createdAt: iso(-52, 14, 5) },
  { id: 3, code: 'RTU-3001', name: '泵房远程终端', site: 'B 区泵房', protocol: 'MQTT', status: 'offline', createdAt: iso(-33, 8, 40) },
  { id: 4, code: 'PLC-1002', name: '二号线主控 PLC', site: 'C 区配电间', protocol: 'Modbus', status: 'online', createdAt: iso(-12, 16, 22) },
]

/** 全部由 schema 驱动的资源快照。 */
export function seedPages(): PageData {
  return {
    '/system/users': USER_SEED.map((row) => ({ ...row })),
    '/system/roles': ROLE_SEED.map((row) => ({ ...row })),
    '/system/departments': DEPARTMENT_SEED.map((row) => ({ ...row })),
    '/system/posts': POST_SEED.map((row) => ({ ...row })),
    '/system/dicts': DICT_SEED.map((row) => ({ ...row })),
    '/system/configs': CONFIG_SEED.map((row) => ({ ...row })),
    '/system/notices': NOTICE_SEED.map((row) => ({ ...row })),
    '/system/menus': MENU_SEED.map((row) => ({ ...row })),
    '/monitor/jobs': JOB_SEED.map((row) => ({ ...row })),
    '/demo/devices': DEVICE_SEED.map((row) => ({ ...row })),
  }
}
