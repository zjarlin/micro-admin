# @addzero/data-page

配置驱动的通用页面层：一份 JSON schema 描述整页的查询、列、表单、行操作与左树，
引擎据此提供列表/分页/筛选/校验/唯一性/增删改查。

**不含任何 UI 依赖**（不 import Element Plus / DOM / Node 内置模块），
因此同一份实现可以跑在浏览器、Node 服务、桌面壳里。

## 安装

```bash
pnpm add @addzero/data-page
# peer：vue ^3.5
```

## 前端用法

```ts
import { installDataPage } from '@addzero/data-page-element' // 组件库适配层
installDataPage(app, { transport: http })                    // 一次注入

// 之后任意页面：
// <SchemaPage page-key="system.user" :can="session.can" />
```

`transport` 只要求 `request<T>(path, init): Promise<T>`，成功的响应信封由宿主剥好。

## 后端用法

```ts
import { createPageEngine, createStoredRegistry } from '@addzero/data-page'

const engine = createPageEngine({
  registry: createStoredRegistry({ base: pages, baseVersion: 1, store: schemaStore }),
  store: pageStore,          // read(): PageData; write(data): void
  seed: () => ({ '/users': [] }),
})

// 交给 HTTP 外壳：命中返回数据，未命中返回 ENGINE_UNHANDLED
const result = engine.handle({ method, path, query, body })
```

## 发布到别的项目

```bash
pnpm build          # tsc -p tsconfig.build.json → dist/*.js + dist/*.d.ts
npm publish         # publishConfig.exports 让消费方解析到 dist，仓库内仍直接跑 src
```

（`node_modules` 里的 `.ts` 不被 Node 22 接受，所以对外必须先编译。）

## 契约要点

- schema 只能是 JSON：无函数、无 class、无 VNode，因此后端能原样下发。
- 必填只有一个真源：`FieldSchema.required`（或 `rules` 里的 required），
  标签星号、前端校验、服务端 400 全部由它派生。
- 行操作是声明式的（`kind` + 可选 `request`），后端下发后仍可执行。
- 跨资源取值用 `resolveFrom` / `optionsFrom`，业务表只存 id，不冗余名称。
- `PUT /ui/pages/{key}` 可运行期改配置；`createStoredRegistry` 只写覆盖层，不覆盖代码里的基线。

## 端口

| 端口 | 作用 |
| --- | --- |
| `DataTransport` | 发一个请求（唯一外部依赖） |
| `PageStore` | 资源快照读写 |
| `SchemaStateStore` | 页面配置覆盖层读写 |
| `Notifier` | 二次确认与提示（UI 适配层实现） |
| `PageRegistry` | schema 读取（静态/可写两种实现） |

换存储、换 HTTP 框架、换组件库都只替换上表中的某一项，引擎与页面状态机不动。
