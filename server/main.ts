// 服务入口：读配置、开 SQLite、装应用、起 HTTP。
//
// 启动方式：`node server/main.ts`（Node 22 原生执行 TS，无需构建步骤）。
import { serve } from '@hono/node-server'
import { corsOrigins, createSqliteStores, loadConfig } from '@zjarlin/ui-server'
import { createApp } from './app.ts'

const config = loadConfig()
const stores = createSqliteStores(config.DB_PATH)

const { app } = createApp({
  pages: stores.pages,
  runtime: {
    // 运行期数据（登录日志、在线会话）同样落 SQLite，不另开文件。
    read: () => stores.kv.get('runtime:data'),
    write: (data) => stores.kv.set('runtime:data', data),
  },
  schemas: stores.schemas,
  kv: stores.kv,
  corsOrigins: corsOrigins(config),
  staticDir: config.STATIC_DIR,
})

serve({ fetch: app.fetch, hostname: config.SERVER_HOST, port: config.SERVER_PORT }, (info) => {
  console.log(`[server] listening on http://${config.SERVER_HOST}:${info.port}`)
  console.log(`[server] sqlite ${config.DB_PATH}`)
  console.log(`[server] 页面可写：PUT /api/ui/pages/{key}`)
})
