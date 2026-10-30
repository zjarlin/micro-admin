# @zjarlin/ui-server

通用页面的 TypeScript 后端：Hono HTTP 外壳 + zod 配置 + `node:sqlite` 存储。
与 `@zjarlin/data-page` 共用同一份引擎，因此前端、后端、测试只有一套语义。

## 安装

```bash
pnpm add @zjarlin/ui-server
```

## 最小启动

```ts
import { serve } from '@hono/node-server'
import { createSqliteStores, createApp, loadConfig, corsOrigins } from '@zjarlin/ui-server'
import { createStoredRegistry } from '@zjarlin/data-page'
import { myPages, mySeed } from './pages.ts'

const config = loadConfig()                    // 环境变量，默认值只在包里
const stores = createSqliteStores(config.DB_PATH)

const { app } = createApp({
  pages: stores.pages,
  runtime: {
    read: () => stores.kv.get('runtime:data'),
    write: (data) => stores.kv.set('runtime:data', data),
  },
  registry: createStoredRegistry({ base: myPages, baseVersion: 1, store: stores.schemas }),
  seed: mySeed,
  staticDir: config.STATIC_DIR,                // 有 dist/ 时一并托管
})

serve({ fetch: app.fetch, hostname: config.SERVER_HOST, port: config.SERVER_PORT })
```

## 发布到别的项目

仓库内 Node 22 直接执行 `src/*.ts`，不需要构建；发布到 npm 或别的仓库时必须先出产物，
否则 Node 会拒绝对 `node_modules` 里的 TS 做类型剥离：

```bash
pnpm --filter @zjarlin/data-page build     # 产出 dist/*.js + dist/*.d.ts
pnpm --filter @zjarlin/ui-server build
npm publish                                # exports 由 publishConfig 自动切到 dist
```

## 表结构

| 表 | 内容 |
| --- | --- |
| `ui_endpoint` | 一份资源（端点）的全部行，JSON 数组整体存 |
| `ui_schema` | 页面配置覆盖层，按 key 存 schema + 版本 |
| `ui_meta` | 覆盖层版本号与已删除 key |
| `ui_kv` | 宿主自用的单例数据（运行期日志、会话、业务插件状态） |

全部 `CREATE TABLE IF NOT EXISTS`，幂等启动；数据库开启 WAL。

## 安全边界

| 路径 | 规则 |
| --- | --- |
| `POST /auth/login` | 公开 |
| `GET /ui/pages*` | 公开只读（界面元数据，宿主建路由需要） |
| 业务接口 | 令牌校验，失败 401 |
| `PUT/POST/DELETE /ui/pages*` | 需配置权限（默认 `system:page:config`），失败 403 |

## 扩展宿主接口

组态、采集、第三方回调这类不属于 CRUD 的接口走 `extensions`：

```ts
createApp({ ..., extensions: [{ handle({ method, path, query, body }) {
  if (path === '/scada/screens' && method === 'GET') return listScreens()
  return null            // 未命中，交给页面引擎继续匹配
} }] })
```

## 换数据库

实现 `PageStore` / `SchemaStateStore` / `KeyValueStore` 三个端口即可，`createApp` 的其余参数不变。
