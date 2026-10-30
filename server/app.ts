// 宿主装配：把「通用页面后端」与「本仓库业务（种子 / 组态）」接在一起。
//
// 框架能力（Hono 路由、鉴权、错误信封、schema 存储、CRUD）全在 `@zjarlin/ui-server`；
// 这里只做三件事：给种子、挂业务扩展、读配置。
import { createApp as createUiApp, type CreatedApp } from '@zjarlin/ui-server'
import type { PageData, RuntimeStore, PageStore } from '@zjarlin/data-page'
import type { KeyValueStore } from '@zjarlin/ui-server'
import { seedPages } from '../src/schema/seed.ts'
import { createPageRegistry } from '../src/schema/registry.ts'
import type { SchemaStateStore } from '@zjarlin/data-page'
import { createScadaPlugin } from './plugins/scada/index.ts'
import { createUiCanvasPlugin } from './plugins/ui-canvas/index.ts'

export interface HostDeps {
  pages: PageStore
  runtime: RuntimeStore
  schemas: SchemaStateStore
  kv: KeyValueStore
  corsOrigins?: string[] | undefined
  staticDir?: string | undefined
}

export interface HostApp extends CreatedApp {
  /** 供测试/自检读取当前生效的种子形状。 */
  seed: () => PageData
}

export function createApp(deps: HostDeps): HostApp {
  const scada = createScadaPlugin({ kv: deps.kv })
  // 图纸插件必须拿到「已装配的注册表」：发布就是把编译结果 upsert 进去。
  const registry = createPageRegistry(deps.schemas)
  const uiCanvas = createUiCanvasPlugin({ kv: deps.kv, registry })

  const created = createUiApp({
    pages: deps.pages,
    runtime: deps.runtime,
    registry,
    seed: seedPages,
    extensions: [scada, uiCanvas],
    ...(deps.corsOrigins ? { corsOrigins: deps.corsOrigins } : {}),
    ...(deps.staticDir ? { staticDir: deps.staticDir } : {}),
  })

  return { ...created, seed: seedPages }
}
