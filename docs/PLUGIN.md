# 插件开发

## 1. 最小插件

插件是一个带 `id`、`name`、`version` 与 `setup()` 的对象。`id` 只能使用小写字母、数字和短横线，并在整个应用内唯一。

```ts
import type { PluginDefinition } from '@/kernel'

export const reportPlugin: PluginDefinition = {
  id: 'report',
  name: '报表中心',
  version: '1.0.0',
  description: '经营日报与导出任务。',
  requires: ['core-admin'],
  defaultEnabled: true,
  setup(ctx) {
    ctx.routes.add({
      name: 'report-daily',
      path: '/report/daily',
      title: '经营日报',
      permission: 'report:daily:list',
      component: () => import('./pages/DailyPage.vue'),
    })

    ctx.menus.add({
      id: 'report-daily',
      title: '经营日报',
      path: '/report/daily',
      icon: 'DataLine',
      group: '数据中心',
      order: 130,
      permission: 'report:daily:list',
    })

    const stop = ctx.events.on('session:changed', () => ctx.logger.debug('session changed'))

    return () => {
      stop()
      ctx.logger.debug('report disposed')
    }
  },
}
```

然后在 `src/plugins/index.ts` 注册：

```ts
export const pluginCatalog: PluginDefinition[] = [
  coreAdminPlugin,
  systemPlugin,
  monitorPlugin,
  reportPlugin,
]
```

`setup()` 内通过 `ctx.routes/menus/services/commands/slots/events` 注册的内容会被内核自动记录；停用插件时自动解绑，不需要手动逐个删除。返回的函数用于关闭定时器、WebSocket、第三方订阅等内核无法自动回收的资源。

## 2. 生命周期

```text
register → 依赖校验 → 拓扑排序 → enable
                                  ├─ setup()
                                  ├─ 注册贡献
                                  └─ enabled
disable → 级联停用依赖者 → 自动解绑贡献 → teardown → disabled
setup 抛错 → rollback 已注册贡献 → failed（错误写入插件状态）
```

- `requires` 是强依赖：依赖未启用时不允许启用。
- 停用被依赖插件时，依赖它的插件会先停用，避免留下悬空消费者。
- 重复插件 ID、缺失依赖、循环依赖、重复贡献 ID 都会直接报错。
- `contextFor(id)` 只用于宿主读取插件已注册的命令；业务插件之间通过 service token 或 command 协作。

## 3. 能力清单

| 能力 | 用途 | 关键字段 |
| --- | --- | --- |
| `ctx.routes` | 注册页面 | `name`、`path`、`component`、`permission` |
| `ctx.menus` | 注册导航 | `id`、`title`、`path`、`group`、`order`、`permission` |
| `ctx.services` | 注册共享服务 | 全局唯一 token |
| `ctx.commands` | 注册可执行命令 | 全局唯一命令名 |
| `ctx.events` | 发布/订阅事件 | 字符串事件名 |
| `ctx.slots` | 向宿主页面注入组件 | `name`、`id`、`component`、`order` |
| `ctx.widgets` | 注册仪表盘小组件 | `id`、`title`、`component`、`span` |
| `ctx.configs` | 注册只读配置 | 字符串 key |
| `ctx.http` | 通过宿主 HTTP 客户端请求 | 与业务后端一致 |

当前内置槽位：

- `dashboard:after-metrics`：工作台指标卡之后，`monitor` 插件用它注入服务健康卡片。

`widgets` 已在内核中提供贡献注册与查询，宿主暂未内置仪表盘网格，可作为后续插件化看板的扩展点。

## 4. 权限约定

权限字符串沿用若依风格：

```text
system:user:list
system:user:add
system:user:edit
system:user:remove
monitor:server:view
```

- 路由 `permission` 控制页面访问。
- 菜单 `permission` 控制导航可见性。
- 页面内按钮应继续调用 `session.can('system:user:add')` 或使用 `v-if` 包装，不要只依赖菜单隐藏。
- `*:*:*` 表示超级管理员，拥有全部权限。

## 5. 数据访问

业务插件不直接读 `import.meta.env`，也不直接创建 `fetch`。统一使用 `ctx.http`：

```ts
interface DailyReport {
  id: number
  title: string
}

const rows = await ctx.http.request<DailyReport[]>('/report/daily')
```

- Mock 模式与真实后端使用同一调用路径。
- 响应格式固定为 `{ code: 0, message: string, data: T }`。
- 非 2xx 或 `code !== 0` 统一抛 `ApiError`，页面可直接展示 `error.message`。

## 6. 测试建议

- 内核层：依赖排序、循环/缺失依赖、重复贡献、级联停用、teardown、失败回滚。
- 插件层：`setup()` 是否注册预期路由/菜单/命令，`teardown` 是否释放外部资源。
- 页面层：权限收窄后的菜单数量与不可见路由。
- 端到端：`tests/e2e/smoke.mjs` 已覆盖登录、动态菜单、CRUD、插件拓扑与审计员权限。

新增插件后至少运行：

```bash
pnpm typecheck
pnpm test
pnpm build
```
