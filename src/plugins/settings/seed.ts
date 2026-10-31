// 系统工具插件的演示数据：参数与公告。
import type { PageData, Row } from '@zjarlin/data-page'
import { iso } from '../../shared/seed-clock.ts'

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

export function seedSettingsPages(): PageData {
  return {
    '/system/configs': CONFIG_SEED.map((row) => ({ ...row })),
    '/system/notices': NOTICE_SEED.map((row) => ({ ...row })),
  }
}
