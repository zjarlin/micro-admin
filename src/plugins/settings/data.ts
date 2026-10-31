// 系统工具：参数设置与通知公告。
import type { CrudPageSchema } from '@zjarlin/data-page'
import { configPage } from './config.ts'
import { noticePage } from './notice.ts'

export const settingsPages: Record<string, CrudPageSchema> = {
  'system.config': configPage,
  'system.notice': noticePage,
}
