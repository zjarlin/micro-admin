// 页面注册表：基线配置写在代码里，覆盖层落在存储里。
//
// 这样两端共用同一条规则：
// - Node 服务通过 `createPageRegistry(store)` 拿到可写注册表，运行期能改页面配置；
// - 改页面配置（页面设计器保存）只写覆盖层，部署新版本仍然带着最新基线；
// - `/ui/pages` 下发的是合并后的结果，前端永远只认后端。
import {
  createStaticRegistry,
  createStoredRegistry,
  type CrudPageSchema,
  type PageRegistry,
  type SchemaStateStore,
} from '@addzero/data-page'
import { userPage } from './user.ts'
import { rolePage } from './role.ts'
import { deptPage } from './dept.ts'
import { postPage } from './post.ts'
import { dictPage } from './dict.ts'
import { configPage } from './config.ts'
import { noticePage } from './notice.ts'
import { menuPage } from './menu.ts'
import { jobPage } from './job.ts'
import { devicePage } from './device.ts'

/** 代码里的基线配置，key 即页面标识。 */
export const basePages: Record<string, CrudPageSchema> = {
  'system.user': userPage,
  'system.role': rolePage,
  'system.dept': deptPage,
  'system.post': postPage,
  'system.dict': dictPage,
  'system.config': configPage,
  'system.notice': noticePage,
  'system.menu': menuPage,
  'monitor.job': jobPage,
  'demo.device': devicePage,
}

/** 基线版本：改动基线 schema 时递增，前端可据此判断缓存失效。 */
export const PAGE_SCHEMA_VERSION = 3

/** 无持久层的场景（纯前端只读演示）用它。 */
export function createBaseRegistry(): PageRegistry {
  return createStaticRegistry(basePages, PAGE_SCHEMA_VERSION)
}

/** 可写注册表：基线 + 覆盖层，运行期改配置不影响已发布的基线。 */
export function createPageRegistry(store: SchemaStateStore): PageRegistry {
  return createStoredRegistry({ base: basePages, baseVersion: PAGE_SCHEMA_VERSION, store })
}

/** 按 key 取基线 schema；未知 key 返回 `null`。 */
export function pageSchemaOf(key: string): CrudPageSchema | null {
  return basePages[key] ?? null
}
