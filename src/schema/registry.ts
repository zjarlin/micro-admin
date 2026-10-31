// 页面注册表：基线配置按插件装配，覆盖层落在存储里。
//
// 这样两端共用同一条规则：
// - Node 服务通过 `createPageRegistry(store, profile)` 拿到可写注册表，运行期能改页面配置；
// - 改页面配置（页面设计器保存）只写覆盖层，部署新版本仍然带着最新基线；
// - `/ui/pages` 下发的是合并后的结果，前端永远只认后端。
import {
  createStaticRegistry,
  createStoredRegistry,
  type CrudPageSchema,
  type PageRegistry,
  type SchemaStateStore,
} from '@zjarlin/data-page'
import { resolvePluginProfile } from '../shared/plugin-profiles.ts'
import { composeBasePages } from './page-sources.ts'

/** 基线版本：改动基线 schema 时递增，前端可据此判断缓存失效。 */
export const PAGE_SCHEMA_VERSION = 4

/** 按插件档位取页面基线（默认 admin：全部插件）。 */
export function basePagesOf(profile?: string | null): Record<string, CrudPageSchema> {
  return composeBasePages(resolvePluginProfile(profile).ids)
}

/** 完整档位的基线快照，供测试与「全量对比」使用。 */
export const basePages: Record<string, CrudPageSchema> = basePagesOf('admin')

/** 无持久层的场景（纯前端只读演示）用它。 */
export function createBaseRegistry(profile?: string | null): PageRegistry {
  return createStaticRegistry(basePagesOf(profile), PAGE_SCHEMA_VERSION)
}

/** 可写注册表：基线 + 覆盖层，运行期改配置不影响已发布的基线。 */
export function createPageRegistry(store: SchemaStateStore, profile?: string | null): PageRegistry {
  return createStoredRegistry({ base: basePagesOf(profile), baseVersion: PAGE_SCHEMA_VERSION, store })
}

/** 按 key 取基线 schema；未知 key 返回 `null`。 */
export function pageSchemaOf(key: string, profile?: string | null): CrudPageSchema | null {
  return basePagesOf(profile)[key] ?? null
}
