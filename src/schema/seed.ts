// 演示数据：后端首次启动时写入的唯一初始快照。
//
// 各插件的种子各归各的目录（`plugins/<id>/seed.ts`），这里只装配；
// 落到存储里以后，后续读写都只走 `PageStore`，不会再有第二份数据源。
import type { PageData, Row } from '@zjarlin/data-page'
import { resolvePluginProfile } from '../shared/plugin-profiles.ts'
import { iso } from '../shared/seed-clock.ts'
import { seedUserPages } from '../plugins/user/seed.ts'
import { seedRbacPages } from '../plugins/rbac/seed.ts'
import { seedDictPages } from '../plugins/dict/seed.ts'
import { seedSettingsPages } from '../plugins/settings/seed.ts'

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

/** 按插件档位装配种子：没装的插件不往库里写它的接口。 */
export function seedPages(profile?: string | null): PageData {
  const { ids } = resolvePluginProfile(profile)
  const data: PageData = {}
  if (ids.includes('user')) Object.assign(data, seedUserPages())
  if (ids.includes('rbac')) Object.assign(data, seedRbacPages())
  if (ids.includes('dict')) Object.assign(data, seedDictPages())
  if (ids.includes('settings')) Object.assign(data, seedSettingsPages())
  if (ids.includes('monitor')) data['/monitor/jobs'] = JOB_SEED.map((row) => ({ ...row }))
  if (ids.includes('pages')) data['/demo/devices'] = DEVICE_SEED.map((row) => ({ ...row }))
  return data
}
