// 服务端页面注册表：页面 schema 的权威定义。
//
// 这份文件在真实部署里对应后端的一张 `ui_page` 表或一组 YAML；
// 这里以 TS 常量承载同一份 JSON，`/ui/pages` 接口原样下发，
// 因此前端不需要为每个页面新建 .vue。
import type { CrudPageSchema } from '../schema.ts'
import { userPage } from './user.ts'
import { rolePage } from './role.ts'
import { deptPage } from './dept.ts'
import { postPage } from './post.ts'
import { dictPage } from './dict.ts'
import { configPage } from './config.ts'
import { noticePage } from './notice.ts'
import { menuPage } from './menu.ts'
import { jobPage } from './job.ts'

/** 已登记页面的 schema，key 即页面标识。 */
export const pageRegistry: Record<string, CrudPageSchema> = {
  'system.user': userPage,
  'system.role': rolePage,
  'system.dept': deptPage,
  'system.post': postPage,
  'system.dict': dictPage,
  'system.config': configPage,
  'system.notice': noticePage,
  'system.menu': menuPage,
  'monitor.job': jobPage,
}

/** schema 版本：改动 schema 时递增，前端可据此判断缓存失效。 */
export const PAGE_SCHEMA_VERSION = 2

/** 按 key 取 schema；未知 key 返回 `null` 由调用方决定回落策略。 */
export function pageSchemaOf(key: string): CrudPageSchema | null {
  return pageRegistry[key] ?? null
}
