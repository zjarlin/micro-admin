# 配置驱动的通用页面（schema → 页面）

一份 JSON schema 描述整页的查询条件、列、表单、行操作与左树；前端不需要为每个页面写 `.vue`，
后端也不需要为每个实体写一套 CRUD。新增一个后台页面 = 在注册表里加一份 schema。

```
            ┌─────────────────────── 后端与前端共用 ───────────────────────┐
schema.ts ──┤ CrudPageSchema（唯一契约）                                    │
            │ createPageEngine()  列表/分页/筛选/树/校验/唯一性/增删改      │
            │ createRuntimeApi()  登录/工作台/监控（非资源型接口）          │
            └──────────────────────────────┬───────────────────────────────┘
                                           │ 同一份引擎
        ┌──────────────────────────────────┴─────────────────────────────┐
        │ 浏览器（fetch 客户端）             Node 服务（Hono + SQLite）     │
        └──────────────────────────────────┬─────────────────────────────┘
                                           │ 同一套 HTTP 契约
                              ┌────────────┴────────────┐
                              │ Element Plus 页面壳      │
                              │ SchemaPage → CrudPage /  │
                              │ TreePage                 │
                              └─────────────────────────┘
```

## 1. 目录与职责

通用能力全部在**工作区包**里，宿主只剩业务配置与装配：

| 路径 | 职责 | 依赖 |
| --- | --- | --- |
| `packages/data-page/src/schema.ts` | 页面契约类型、条件匹配、占位符插值 | 无 |
| `packages/data-page/src/engine.ts` | 通用资源引擎：列表/分页/筛选/树/校验/写操作/配置读写 | 无（不含 Vue/DOM/Node） |
| `packages/data-page/src/registry.ts` | 页面注册表：静态基线 + 可写覆盖层 | 无 |
| `packages/data-page/src/validate.ts` | 按 schema 校验数据（前后端共用） | 无 |
| `packages/data-page/src/rules.ts` | schema → 表单规则、必填判定、空表单 | 无 |
| `packages/data-page/src/tree.ts` | 建树/过滤/定位，纯函数 | 无 |
| `packages/data-page/src/use*.ts` | 页面状态机（分页、树、弹窗、行操作、引用） | Vue |
| `packages/data-page/src/runtime-*.ts` | 登录/会话/工作台/监控等固定接口与形状 | 无 |
| `packages/data-page-element/src/*` | Element Plus 适配层：表、弹窗、表单、左树、提示 | Vue + Element Plus |
| `packages/ui-server/src/*` | Hono 外壳 + zod 配置 + `node:sqlite` 存储 | Node + hono + zod |
| `src/schema/*.ts` | 本仓库的页面 schema 基线（业务配置） | `@addzero/data-page` |
| `src/plugins/pages/*` | 把后端登记页面变成路由与菜单 | 内核 + 包 |
| `server/*` | 宿主装配：种子、组态插件、启动 | 包 + 业务 |

三个包的职责边界是硬的：`data-page` 不认识 UI，`data-page-element` 不认识 Node，
`ui-server` 不认识具体业务。换组件库重写中间那层，换语言重写最后一层，schema 与数据一行不改。

硬约束：

- `schema.ts` / `engine.ts` / `validate.ts` / `tree.ts` 不 import Vue、Element Plus、DOM、Node 内置模块；
  UI 差异通过注入（`Notifier`、`optionsOf`、`resolveOf`）解决。
- 行操作必须声明式（`kind` + 可选 `request`），否则后端下发后无法执行。
- 必填只有一个来源：`FieldSchema.required`（或 `rules` 里的 required）。
  标签星号、前端校验、服务端 400 都由它派生。

## 2. schema 关键字段

页面级（`CrudPageSchema`）：

| 字段 | 说明 |
| --- | --- |
| `endpoint` | 列表接口，也是该资源的写入口 |
| `uniqueProps` | 唯一字段；服务端重复时返回 409，前端不再另写校验 |
| `timestamps.created/updated` | 服务端自动填写的创建/更新时间字段 |
| `undeletableWhen` | 命中条件的行禁止删除，前端禁用按钮 + 服务端 403 |
| `tree` | 有它即「左树右表」形态 |
| `exportable` | 由列定义生成 CSV |

列级（`ColumnSchema`）：

| 字段 | 说明 |
| --- | --- |
| `cell` | `text` / `code` / `status` / `tagMap` / `datetime` / `dict` / `link` / `custom` |
| `resolveFrom` | 存 id、显示另一份资源的字段（如用户表显示部门名），避免冗余名称 |

字段级（`FieldSchema`）：

| 字段 | 说明 |
| --- | --- |
| `required` / `rules` | 必填与格式校验，唯一真源 |
| `optionsFrom` | 下拉选项来自另一份资源端点 |
| `disabledOnEdit` | 编辑时不可改（如用户名） |
| `help` | 说明文字，渲染成标签旁的小问号 |

查询级（`QuerySchema`）：

| 字段 | 说明 |
| --- | --- |
| `match` | `eq` / `like` / `in`，缺省按控件推断（select→eq，input→like） |
| `props` | `like` 参与匹配的字段；一个输入框可以匹配多列 |

树级（`TreeSchema`）：

| 字段 | 说明 |
| --- | --- |
| `parentProp` | 给了就是扁平表（客户端/服务端建树）；不给表示已是嵌套 `children` |
| `param` / `filterProp` | 选中节点写入的查询参数名 / 列表行上的过滤字段 |
| `includeDescendants` | 选中父节点是否含下级，缺省 `true` |

## 3. HTTP 契约

响应统一 `{ code, message, data }`；`code === 0` 为成功，失败时 `code` 等于 HTTP 状态。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/ui/pages` | 全部页面 schema（`[{ key, version, schema }]`） |
| GET | `/ui/pages/{key}` | 单页 schema |
| GET | `{endpoint}` | 分页列表 `{ rows, total }`；树端点返回原样数组 |
| POST | `{endpoint}` | 新增，返回创建后的行 |
| PUT / PATCH | `{endpoint}/{id}` | 全量替换 / 局部更新 |
| DELETE | `{endpoint}/{id}` | 删除；命中 `undeletableWhen` 返回 403 |
| PUT / POST | `/ui/pages/{key}` | 登记或覆盖整页 schema，返回新版本号（需配置权限） |
| DELETE | `/ui/pages/{key}` | 下线该页；基线页面会被记入覆盖层的 `removed` |

错误码：`400` 校验失败、`401` 未登录、`403` 禁止删除、`404` 资源或记录不存在、`409` 唯一冲突。

列表参数：`page`、`pageSize`（上限 500）、各 `query[].param`、左树 `tree.param`。

## 4. 新增一个页面

**首选：只在后端登记，前端零改动。**

1. 在 `src/schema/` 加一份 schema 并登记到 `registry.ts`（或运行期 `PUT /api/ui/pages/{key}`）；
2. schema 里写 `menu`，宿主启动时自动注册路由 + 侧栏菜单；
3. 访问 `/p/{key}` 即可，渲染组件是通用的 `SchemaRoutePage`。

`src/schema/device.ts` 是这套流程的最小样板：设备台账页没有对应的 `.vue`，
却出现在侧栏、能分页筛选、能增删改、能校验唯一性。

```bash
# 不重启、不发版，直接上线一页
curl -X PUT http://127.0.0.1:5181/api/ui/pages/demo.ticket \
  -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"title":"巡检工单","endpoint":"/demo/tickets","menu":{"group":"运维"},
       "columns":[{"prop":"title","label":"标题"}],
       "fields":[{"prop":"title","label":"标题","control":"input","required":true}]}'
```

**需要自定义时**才写 `.vue`：

```vue
<template>
  <SchemaPage page-key="system.post" :can="session.can" />
</template>
```

特殊单元格用插槽逃生：`<template #user-cell="{ row }">`；没有对应插槽时退回文本，
因此后端新加的 `custom` 列不会显示空白。

**页面形态**由 schema 决定，不再靠组件选择：

| `layout` | 形态 |
| --- | --- |
| 缺省 `table` | 查询 + 分页表 + 弹窗；有 `tree` 时是「左树右表」 |
| `tree-table` | 表格按层级展开（部门、菜单），不分页、无左树 |

## 5. 真实后端

浏览器端**只有真实后端一条链路**（原 `localStorage` mock 已删除，避免第二套副本）。

```bash
node server/main.ts                     # 默认 127.0.0.1:5181
SERVER_PORT=5181 DB_FILE=/root/DockerCompose/micro-admin/data/ui.db node server/main.ts
```

- 配置全部来自环境变量，默认值只在 `packages/ui-server/src/config.ts` 出现一次；
- 存储用 Node 22 内置 `node:sqlite`：单文件、WAL、零外部依赖，包整体搬走不用带容器；
  表 `ui_endpoint`（资源快照）、`ui_schema`（页面配置覆盖层）、`ui_meta`、`ui_kv`（运行期数据）；
- 提供 `GET /api/health`（含页面数与 `schemaWritable`）；其余接口在 `/api/*` 下；
- `STATIC_DIR` 存在时同时托管前端构建产物并做 SPA 兜底，前端与 API 同源。

鉴权边界：

| 路径 | 规则 |
| --- | --- |
| `POST /auth/login` | 公开 |
| `GET /ui/pages`、`GET /ui/pages/{key}` | 公开只读（界面元数据，宿主建路由要用） |
| 其余业务接口 | 必须带有效令牌，否则 401 |
| `PUT/POST/DELETE /ui/pages*` | 需 `system:page:config`（`SCHEMA_WRITE_PERMISSION` 可改），否则 403 |

开发期前端跑 Vite，`/api` 由代理转到 5181（默认值在 `vite.config.ts`）。

## 6. 别的项目怎么依赖

三个包已经抽好，包内没有 `@/` 别名，也没有业务符号：

| 包 | 依赖 | 用途 |
| --- | --- | --- |
| `@addzero/data-page` | `vue`（peer） | 契约、引擎、状态机、运行期接口 |
| `@addzero/data-page-element` | 上面 + `element-plus` | 表格/表单/左树壳 |
| `@addzero/ui-server` | 上面 + `hono` + `zod` | HTTP 外壳 + SQLite 存储 |

接入三步：

```jsonc
// 1. 别的项目的 package.json
{ "dependencies": { "@addzero/data-page": "workspace:*" } }
```

```ts
// 2. 前端：注入传输实现并注册壳组件（一次）
installDataPage(app, { transport: http })
// 或逐组件传 transport prop：
// <SchemaPage page-key="x" :transport="http" />
```

```ts
// 3. 后端：开库、装应用
const stores = createSqliteStores(config.DB_PATH)
const { app } = createApp({
  pages: stores.pages,
  runtime: { read: () => stores.kv.get('runtime:data'), write: (d) => stores.kv.set('runtime:data', d) },
  registry: createStoredRegistry({ base: myPages, baseVersion: 1, store: stores.schemas }),
  seed: mySeed,
  extensions: [myExtension],   // 宿主自有接口
})
serve({ fetch: app.fetch, port: 5181 })
```

包内相对导入一律带 `.ts` 后缀：Node 22 直接执行 TS 依赖这一点（换 tsc/tsup 出包时也兼容）。
要换存储（Postgres/MySQL），实现 `PageStore` / `SchemaStateStore` / `KeyValueStore` 三个端口即可，
引擎与页面层一行不改。

## 7. 已知边界

- 业务接口只校验「已登录」，没有按资源做行级/字段级 RBAC；权限码目前约束菜单、按钮与配置写；
- 写操作是「最后写入胜」，没有乐观锁；需要并发控制时在 schema 加 `version` 字段并在引擎比对；
- SQLite 适合单实例；多副本部署要换成数据库实现（`PageStore` / `SchemaStateStore` / `KeyValueStore`）；
- `node:sqlite` 在 Node 22 仍是实验特性，启动会打印一行 `ExperimentalWarning`，可用
  `node --no-warnings` 或升级到 Node 24 LTS 消除；
- 页面配置覆盖层只存「改过的页面」，删除基线页面会记在 `removed` 里，重新加回需再 PUT 一次；
- 表结构变更（`ui_endpoint` 之类）没有迁移框架，当前按 `CREATE TABLE IF NOT EXISTS` 幂等建表；
  演进到需要改列时，接 `node:sqlite` 的 `PRAGMA user_version` 手写迁移。
