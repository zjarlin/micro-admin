// 服务入口：读取配置、准备存储、启动 HTTP。
//
// 启动方式：`node server/main.ts`（Node 22 原生执行 TS，无需构建步骤）。
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { corsOrigins, loadConfig } from './config.ts'
import { createFileStores } from './store.ts'

const config = loadConfig()
const stores = createFileStores(config.DATA_DIR)

const { app } = createApp({
  pages: stores.pages,
  runtime: stores.runtime,
  corsOrigins: corsOrigins(config),
  staticDir: config.STATIC_DIR,
})

serve({ fetch: app.fetch, hostname: config.SERVER_HOST, port: config.SERVER_PORT }, (info) => {
  console.log(`[server] listening on http://${config.SERVER_HOST}:${info.port}`)
  console.log(`[server] data dir ${config.DATA_DIR}`)
})
