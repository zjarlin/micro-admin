// 用户插件自带的演示账号：只写账号字段。
//
// 部门/角色是 RBAC 插件的概念，这里只存它们的 id（有 RBAC 时由它解释），
// 这样用户插件在没装 RBAC 的产品里也能独立运行。
import type { PageData, Row } from '@zjarlin/data-page'
import { iso } from '../../shared/seed-clock.ts'

const USERNAMES = [
  'admin', 'auditor', 'chenmo', 'wutong', 'suhe', 'hechuan', 'shenzhi', 'yeqing', 'chengye',
  'gunan', 'tangtang', 'xuzhi', 'lichuan', 'jiangbai', 'wenyan', 'duanqing', 'qinlang', 'mengwan',
]
const NICKNAMES = [
  '林舟', '周岚', '陈默', '吴桐', '苏禾', '何川', '沈知', '叶青', '程野',
  '顾南', '唐棠', '许至', '黎川', '江白', '温言', '段清', '秦朗', '孟晚',
]

const USER_SEED: Row[] = NICKNAMES.map((nickname, index) => ({
  id: index + 1,
  username: USERNAMES[index] ?? `user${index + 1}`,
  nickname,
  phone: `1380000${String(1000 + index).slice(-4)}`,
  email: `user${index + 1}@example.com`,
  // RBAC 演示数据的部门 2..6、角色 1..5；没有 RBAC 时这两列不会被用到。
  deptId: (index % 5) + 2,
  roleId: index === 0 ? 1 : (index % 4) + 2,
  status: index === 16 ? 'disabled' : 'active',
  createdAt: iso(-(180 - index * 6), 9 + (index % 8), (index * 7) % 60),
}))

export function seedUserPages(): PageData {
  return { '/system/users': USER_SEED.map((row) => ({ ...row })) }
}
