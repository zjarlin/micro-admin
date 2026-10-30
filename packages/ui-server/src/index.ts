// 通用页面的 TS 后端门面：SQLite 存储 + Hono 外壳 + 配置。
//
// 宿主只需要三件事：
// 1. `createSqliteStores()` 打开数据库；
// 2. `createPageRegistry()` 给页面注册表（可写实现 = 后台能改配置）；
// 3. `createApp()` 装机，`serve()` 起服务。
export type { KeyValueStore, SqliteStores } from './sqlite-store.ts'
export { createSqliteStores } from './sqlite-store.ts'

export type { ServerConfig } from './config.ts'
export { corsOrigins, loadConfig } from './config.ts'

export type { ApiExtension, AppDeps, CreatedApp, Envelope } from './app.ts'
export { RawResponse, createApp, envelope } from './app.ts'

export type { PageRegistry, PageStore, RuntimeStore } from '@zjarlin/data-page'
