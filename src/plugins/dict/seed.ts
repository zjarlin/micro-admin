// 字典插件的演示数据：字典类型与业务枚举。
import type { PageData, Row } from '@zjarlin/data-page'

const DICT_SEED: Row[] = [
  { id: 1, name: '用户性别', type: 'sys_user_sex', status: 'active', remark: '用户性别列表' },
  { id: 2, name: '菜单状态', type: 'sys_show_hide', status: 'active', remark: '菜单显示与隐藏' },
  { id: 3, name: '系统开关', type: 'sys_normal_disable', status: 'active', remark: '启用与停用' },
  { id: 4, name: '通知类型', type: 'sys_notice_type', status: 'active', remark: '通知与公告' },
  { id: 5, name: '任务分组', type: 'sys_job_group', status: 'disabled', remark: '定时任务分组' },
]

export function seedDictPages(): PageData {
  return { '/system/dicts': DICT_SEED.map((row) => ({ ...row })) }
}
