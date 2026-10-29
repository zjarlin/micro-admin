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
        │ 浏览器 mock（localStorage）        Node 服务（Hono + 文件存储）  │
        └──────────────────────────────────┬─────────────────────────────┘
                                           │ 同一套 HTTP 契约
                              ┌────────────┴────────────┐
                              │ Element Plus 页面壳      │
                              │ SchemaPage → CrudPage /  │
                              │ TreePage                 │
                              └─────────────────────────┘
```

## 1. 目录与职责

| 路径 | 职责 | 依赖 |
| --- | --- | --- |
| `src/shared/data/schema.ts` | 页面契约类型、条件匹配、占位符插值 | 无 |
| `src/shared/data/engine.ts` | 通用资源引擎：列表/分页/筛选/树/校验/写操作 | 无（不含 Vue/DOM/Node） |
| `src/shared/data/validate.ts` | 按 schema 校验数据（前后端共用） | 无 |
| `src/shared/data/rules.ts` | schema → 表单规则、必填判定、空表单 | 无 |
| `src/shared/data/tree.ts` | 建树/过滤/定位，纯函数 | 无 |
| `src/shared/data/use*.ts` | 页面状态机（分页、树、弹窗、行操作、引用） | Vue |
| `src/shared/data/pages/*.ts` | 页面 schema 注册表（后端权威定义） | schema |
| `src/shared/runtime/api.ts` | 登录/工作台/监控等固定接口 | 无 |
| `src/components/data/*` | Element Plus 适配层：表、弹窗、表单、左树、提示 | Vue + Element Plus |
| `server/*` | Hono HTTP 外壳 + 文件存储 | Node + hono + zod |

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

错误码：`400` 校验失败、`401` 未登录、`403` 禁止删除、`404` 资源或记录不存在、`409` 唯一冲突。

列表参数：`page`、`pageSize`（上限 500）、各 `query[].param`、左树 `tree.param`。

## 4. 新增一个页面

1. 写一份 schema，放进 `src/shared/data/pages/` 并在 `registry.ts` 登记；
2. 需要在侧栏出现时，给插件加一条路由 + 菜单（`src/plugins/<id>/routes.ts`）；
3. 页面组件只要一行：

```vue
<template>
  <SchemaPage page-key="system.post" :can="session.can" />
</template>
```

树表页加 `mode="tree"`。特殊单元格用插槽逃生：`<template #user-cell="{ row }">`。
如果后端已经按 key 下发 schema，第 1 步可以省掉——改配置不用发版。

## 5. 真实后端

```bash
node server/main.ts                     # 默认 127.0.0.1:5181
SERVER_PORT=5181 DATA_DIR=/root/DockerCompose/micro-admin/data node server/main.ts
```

- 配置全部来自环境变量，默认值只在 `server/config.ts` 出现一次；
- 数据落在 `DATA_DIR`：`pages.json`（页面资源）+ `runtime.json`（日志/会话），bind mount 即可持久化；
- 提供 `GET /api/health`；其余接口在 `/api/*` 下，未登录一律 401；
- `STATIC_DIR` 存在时同时托管前端构建产物并做 SPA 兜底。

前端切到真实后端（dev）：

```bash
VITE_API_MODE=http VITE_API_BASE_URL=/api \
API_PROXY_TARGET=http://127.0.0.1:5181 pnpm dev
```

`VITE_API_MODE=mock` 时不发网络请求，数据落 `localStorage`，用于纯静态演示与离线开发。

## 6. 移植到别的项目

可整体搬走的是四块：`src/shared/data`、`src/shared/runtime`、`src/components/data`、`server`。
前置依赖：`vue`、`element-plus`、`@element-plus/icons-vue`；后端另需 `hono`、`@hono/node-server`、`zod`。

需要替换的只有一个别名：`@/` 指向项目 `src`。搬成独立包时按下面顺序（本仓库暂不拆，避免多一套发布物）：

1. 新建 `packages/data-page`（`shared/data` + `shared/runtime`）与 `packages/data-page-element`（`components/data`）；
2. 包内相对导入保持 `.ts` 后缀（Node 22 原生执行 TS 依赖这一点）；
3. 根 `tsconfig` 加 `paths`、`vite.config.ts` 加 `resolve.alias`，`server/` 的导入改成包名；
4. `server` 仍留在应用侧（它属于部署形态，不属于 UI 库）。

## 7. 已知边界

- 权限码只做前端可见性（菜单/按钮），服务端尚未按角色校验，接真实 RBAC 时在 `server/app.ts` 统一拦截；
- 写操作是「最后写入胜」，没有乐观锁；需要并发控制时在 schema 加 `version` 字段并在引擎比对；
- 文件存储适合单实例；多副本部署要换成数据库实现（只需实现 `PageStore` / `RuntimeStore` 两个接口）；
- 组态画布（`/scada/*`）目前只有浏览器 mock，真实后端尚未实现该组接口。
