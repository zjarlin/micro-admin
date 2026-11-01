# Microkernel Admin（微内核控制台）

一个 Vue 3 + Vite + TypeScript 的微内核后台管理系统，外壳三栏布局取自
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `ui-layout`（MIT）。
仓库名 `microkernel-admin`；运行期容器、门户别名与数据目录沿用 `micro-admin`
（已登记 `micro-admin.lyokm.cn` 与 `/root/DockerCompose/micro-admin/data`，改名会牵动门户与证书，
不在代码范围内）。内核只负责插件发现、依赖排序、启停、路由/菜单/服务/命令/槽位编排与资源回收；登录、工作台、系统管理、系统监控都以插件形式接入，业务能力对标若依常用后台模块。

后台页面是**配置驱动**的：一份 schema 描述查询、列、表单、行操作与左树，前端不需要为每个页面写 `.vue`，后端用同一个引擎提供列表与增删改查。仓库自带 TypeScript 后端（Hono + `node:sqlite`），`node server/main.ts` 即可独立运行。

通用层已抽成可被别的项目直接依赖的工作区包：`@addzero/data-page`（契约/引擎/状态机）、
`@addzero/data-page-element`（Element Plus 壳）、`@addzero/ui-server`（HTTP + SQLite）、
`@addzero/app-frame`（三栏布局与 `layout` 面板服务）。详见 [`docs/DATA-PAGE.md`](docs/DATA-PAGE.md)。

组态相关的三个包同样是「能单独搬走」的：`@addzero/scada-dsl`（绘图指令集：语法/解析/执行/文档摘要）、
`@addzero/ifc-canvas`（画面 → IFC4 BIM）、`@addzero/cad-import`（DXF 图纸 → 组态图元 + 绘图指令集）。
详见 [`docs/SCADA-CANVAS.md`](docs/SCADA-CANVAS.md)、[`docs/SCADA-IFC.md`](docs/SCADA-IFC.md)、
[`docs/CAD-IMPORT.md`](docs/CAD-IMPORT.md)。

演示账号：

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `admin` | `admin123` | 超级管理员，拥有 `*:*:*` 权限 |
| `auditor` | `audit123` | 只读审计账号，只能看到授权菜单 |

> 浏览器端只有真实后端一条链路（原 `localStorage` mock 已删除，避免第二套副本）。
> 首次启动后端会把种子数据写进 SQLite；删掉 `DB_FILE` 指向的文件即可恢复初始状态。

## 快速开始

需要两个进程：前端（Vite）与后端（Node 直接跑 TS）。

```bash
pnpm install
pnpm dev:server     # 后端，默认 127.0.0.1:5181，数据落 .data/ui.db
pnpm dev            # 前端，默认 127.0.0.1:5174，/api 代理到 5181
```

默认前端地址为 `http://127.0.0.1:5174`。

生产形态只有一个进程：`pnpm build` 后 `node server/main.ts`，由后端同时托管 `dist/` 与 `/api`。

### 生命周期脚本（推荐，可从任意目录调用）

```bash
scripts/setup.sh     # pnpm install --frozen-lockfile
scripts/start.sh     # 幂等启动 vite dev；已运行只校验不重启
scripts/logs.sh      # 只读查看 PID/端口/健康码/最近日志
scripts/restart.sh   # 先停稳再起；旧进程未退出即失败
scripts/stop.sh      # 只停本项目的、经身份核验的进程；未运行返回 0
scripts/build.sh     # pnpm build，产物 dist/
scripts/verify.sh    # pnpm verify = typecheck + test + build
```

运行期文件全部收敛在项目内 `.run/`（已在 `.gitignore`）：

| 文件 | 用途 |
| --- | --- |
| `.run/micro-admin.pid` | 当前实例 PID（由子 shell `exec` 前写入，与实际进程恒等） |
| `.run/micro-admin.state` | pid/pgid/sid/starttime/port/mode，用于身份与端口复核 |
| `.run/micro-admin.lock` | 生命周期操作串行锁（`flock`，默认等 30s） |
| `.run/logs/dev.log` | dev/preview 服务器输出（超过 20MB 自动轮转为 `.1`） |
| `.run/logs/{build,verify,setup}.log` | 对应脚本的输出 |

端口取 `DEV_PORT`（`.env.local` > `.env` > 5174），也可用 `MICRO_ADMIN_PORT` 覆盖；
`MICRO_ADMIN_SERVE_MODE=preview` 可改跑 `vite preview`（需先 `scripts/build.sh`）。

安全约定：`stop` 只处理 PID 文件记录且 `cwd` 为本项目、命令行含 vite/node/pnpm、启动时间与记录一致
的进程；校验不通过时拒绝动手并返回非 0。仅当该 PID 是自建会话首进程时才按进程组回收。

常用校验：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify       # typecheck + test + build
```

端到端冒烟测试需要先启动预览服务，并指定 Chromium 可执行文件：

```bash
pnpm build
pnpm preview --port 5174 --strictPort

CHROMIUM_BIN=/path/to/chrome-headless-shell \
APP_URL=http://127.0.0.1:5174 \
pnpm test:e2e
```

脚本会验证登录、动态菜单、用户新增、插件拓扑、退出登录与审计员权限收窄，截图输出到 `/tmp/micro-admin-*.png`。

## 微内核模型

```text
Vue 宿主
  ├─ MicroKernel
  │   ├─ 插件注册 / 依赖拓扑 / 启停 / 回滚
  │   ├─ 服务容器（service token）
  │   ├─ 命令总线（command）
  │   ├─ 事件总线（event）
  │   └─ 贡献注册表（route / menu / slot / widget）
  ├─ 插件：core-admin   登录、工作台、插件中心、个人中心
  ├─ 插件：system       用户、角色、菜单、部门、岗位、字典、参数、公告
  └─ 插件：monitor      在线用户、定时任务、服务监控、缓存监控
```

关键约束：

- 插件不直接改 Vue Router，只向 `PluginContext` 声明路由和菜单。
- 插件按 `requires` 做固定依赖拓扑排序；缺失依赖、循环依赖、重复 ID 会直接报错。
- 停用插件时先级联停用依赖它的插件，再执行 `teardown`，并自动回收该插件注册的路由、菜单、服务、命令、槽位与事件监听。
- 权限采用若依风格的 `system:user:list`；`*:*:*` 为超级管理员。路由守卫与菜单过滤使用同一套权限判定。
- 当前是单应用内的“逻辑微内核”，不是 qiankun/Module Federation。插件边界先稳定，后续可把 `setup()` 的加载方式替换为远程模块而不改业务页面。

插件开发细节见 [`docs/PLUGIN.md`](docs/PLUGIN.md)。

## 找到某个页面的源码

顶栏的「瞄准」按钮（**⌘/Ctrl + ⇧ + E**）是元素拾取器：激活后点页面上任何元素，
直接给出 `文件:行:列`、组件链，以及「这一页由哪份 schema / 哪个插件提供」。
配置驱动的页面没有业务 `.vue`，靠这条信息才不会在通用壳里白找。

编译期把位置写进 DOM（`data-source-loc`），所以生产站点同样可用，不依赖 sourcemap。
细节与边界见 [`docs/SOURCE-LOCATOR.md`](docs/SOURCE-LOCATOR.md)。

## 目录结构

```text
packages/                     # 可被别的项目依赖的工作区包
  data-page/                  # 契约、CRUD 引擎、页面注册表、状态机、运行期接口（无 UI）
  data-page-element/          # Element Plus 适配：表格/查询栏/表单弹窗/左树
  ui-server/                  # Hono 外壳 + zod 配置 + node:sqlite 存储
  app-frame/                  # 三栏布局壳 + layout 面板服务（dsh ui-layout 的 Vue 移植）
  nav-tree/                   # 任意层级导航树：森林构建/过滤/展开 + 无业务渲染组件
  scada-dsl/                  # 组态指令集（绘图 + 排版 + 画布），无 UI 依赖，可单独发布
  source-locator/             # 元素 → 源码定位：编译期注入位置 + 浏览器拾取器，无业务符号
src/
  kernel/                     # 与业务无关的微内核
  plugins/
    core-admin/               # 登录、工作台、插件中心、404、个人中心
    system/                   # 若依式系统管理模块
    monitor/                  # 系统监控模块
    scada/                    # 组态画布工作台
    source-finder/            # 元素拾取器（顶栏入口 + ⌘/Ctrl+⇧+E，定位源码）
    ai/                       # AI 插件：提示词库、画布指令生成、页面/主题生成
    theme/                    # 外观主题：颜色/圆角/密度（贡献到系统设置）
    page-agent/               # 页面助手：alibaba/page-agent 的宿主、顶栏入口与设置区
    settings/                 # 系统设置：把各插件的设置贡献渲染成分组标签页
    pages/                    # 把后端登记的页面变成路由与菜单（含页面工厂）
  schema/                     # 本仓库的页面 schema 基线 + 种子数据
  layouts/                    # 管理后台壳
  router/                     # 内核启动、路由编译、登录/权限守卫
  shared/
    scada/                    # 组态画布契约、图元库、几何求值
  components/
    scada/                    # 组态画布组件
  stores/                     # Pinia：会话、内核状态、UI
  styles/                     # 设计变量与后台样式
server/                       # 宿主装配：种子、组态插件、启动
tests/
  e2e/smoke.mjs               # 真实浏览器冒烟
  *.test.ts                   # 内核、权限、HTTP、通用引擎单元测试
```

## 后端

Node 22 原生执行 TS，无需构建步骤：

```bash
node server/main.ts                                                            # 默认 127.0.0.1:5181
SERVER_PORT=5181 DB_FILE=/root/DockerCompose/micro-admin/data/ui.db node server/main.ts
```

- 技术栈：Hono（HTTP 外壳）+ zod（配置校验）+ `node:sqlite`（内置，零外部依赖）。
- 持久化是单个 SQLite 文件（WAL）：`ui_endpoint` 资源快照、`ui_schema` 页面配置覆盖层、`ui_kv` 运行期数据。
  换 Postgres/MySQL 只需实现 `PageStore` / `SchemaStateStore` / `KeyValueStore` 三个端口。
- `GET /api/health` 供健康检查（含页面数与 `schemaWritable`）；其余接口在 `/api/*` 下。
- `GET /ui/pages*` 公开只读（界面元数据）；业务接口需令牌；`PUT/DELETE /ui/pages*` 需 `system:page:config`。
- 响应约定 `{ code: 0, message, data }`，非 0 或非 2xx 抛 `ApiError`；前端只有 `src/shared/http.ts` 一个客户端。

## 通用页面

新增一个后台页面 = 后端登记一份 schema，**前端零改动**：

1. 在 `src/schema/` 写 schema 并登记到 `registry.ts`，或运行期直接 `PUT /api/ui/pages/{key}`；
2. schema 里写 `menu`，宿主启动时会自动注册路由 + 侧栏菜单；
3. 访问 `/p/{key}` 即可，渲染组件是通用的 `SchemaRoutePage`。

`src/schema/device.ts`（设备台账）是最小样板：没有对应的 `.vue`，却在侧栏、能分页筛选、
能增删改、能校验唯一性。页面形态由 `layout` 决定（缺省表格；`tree-table` 是按层级展开的树表），
左树右表由 `tree` 声明。

需要自定义单元格时才写 `.vue`：

```vue
<SchemaPage page-key="system.user" :can="session.can">
  <template #user-cell="{ row }">…</template>
</SchemaPage>
```

schema 字段、HTTP 契约、包依赖方式与已知边界见 [`docs/DATA-PAGE.md`](docs/DATA-PAGE.md)。

别的项目依赖这几个包时，仓库内直接跑源码 TS；`data-page` / `ui-server` 对外发布先出产物
（`app-frame` / `data-page-element` 是 Vue 源码包，由消费方 Vite 编译，与上游 dsh 的用法一致）：

```bash
pnpm build:packages     # packages/{data-page,ui-server} → dist/*.{js,d.ts}
# data-page-element 是 .vue 壳，发源码，由消费方 Vite 编译
```


## 已实现的后台能力

- 登录/退出、会话恢复、Token 注入、登录后重定向。
- 三栏外壳：菜单侧栏（可收起、可拖宽、窄屏自动成图标轨）+ 中栏路由 + 右栏面板
  （检查器/布局设置共用一条轨道，可拖宽、可全屏；`Ctrl/⌘ + B` 收侧栏）。
- 标签页：访问过的页面留成一排标签，支持关闭单个/其它/全部（工作台固定）。
- 动态菜单、菜单搜索、暗色主题、面包屑、布局设置右栏。
- 用户、角色、菜单、部门、岗位、字典、参数、公告、定时任务、设备台账全部由 schema 驱动：
  查询、分页、左树筛选（含下级）、表单校验、唯一性、删除保护、跨资源取值都在同一层实现。
- 在线用户、服务监控、缓存监控；组态画布工作台。
- AI 插件：提示词即配置（画布绘制/排版、页面 schema、外观 token），一条自然语言指令直接改画布；
  另有「页面工厂」把原型描述变成可上线页面、「外观主题」可视化调色并支持 AI 生成。见 [`docs/AI-PLUGIN.md`](docs/AI-PLUGIN.md)。
- 页面助手（`page-agent` 插件）：把 [alibaba/page-agent](https://github.com/alibaba/page-agent) 装成可停用能力，
  用自然语言操作当前页面；模型与密钥留在后端经同源代理调用，顶栏 AI 入口、面板外观、步数、路径白名单、
  脱敏规则、页面指令全部在「系统工具 → 系统设置 → 页面助手」里配。见 [`docs/PAGE-AGENT.md`](docs/PAGE-AGENT.md)。
- 系统设置（`settings` 插件）：设置页本身也是插件，标签页与表单来自各插件的 `ctx.settings` 贡献；
  字段类型（文本/数字/开关/下拉/颜色/密钥/标签/记录表/JSON）与必填校验由内核统一渲染，
  停用插件即整块消失。见 [`docs/PLUGIN.md`](docs/PLUGIN.md) 的「设置贡献」。
- 插件中心：依赖拓扑、启停、运行期错误面板、服务与命令清单。
- 工作台：指标卡、趋势图、部门分布、公告、最近操作、插件槽位注入的健康卡片。

## 工程约定

- 统一使用 `pnpm`，Node.js 22+（`node:sqlite` 仍是实验特性，启动会打印一行警告）。
- 通用能力进 `packages/*`，业务配置进 `src/schema/`，宿主装配进 `server/`；三层不互相反向依赖。
- 页面权限通过路由 `meta.permission` + 菜单 `permission` 双重声明。
- 新业务域只新增 `src/plugins/<id>/index.ts` 并加入 `src/plugins/index.ts`；宿主不感知具体页面。
- 不在插件里直接访问 `localStorage` 会话或 `import.meta.env`；通过 `PluginContext` 与共享 service 获取能力。
- 生产构建开启 sourcemap，按 Element Plus、Vue 运行时与插件页面拆包；如需关闭可在 `vite.config.ts` 调整。
