# Micro Admin

一个 Vue 3 + Vite + TypeScript 的微内核后台管理系统。内核只负责插件发现、依赖排序、启停、路由/菜单/服务/命令/槽位编排与资源回收；登录、工作台、系统管理、系统监控都以插件形式接入，业务能力对标若依常用后台模块。

演示账号：

| 账号 | 密码 | 说明 |
| --- | --- | --- |
| `admin` | `admin123` | 超级管理员，拥有 `*:*:*` 权限 |
| `auditor` | `audit123` | 只读审计账号，只能看到授权菜单 |

> 演示数据保存在浏览器 `localStorage`，不会请求真实后端。清除站点数据即可恢复种子数据。

## 快速开始

```bash
pnpm install
pnpm dev
```

默认地址为 `http://127.0.0.1:5174`。

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

## 目录结构

```text
src/
  kernel/              # 与业务无关的微内核
  plugins/
    core-admin/        # 登录、工作台、插件中心、404、个人中心
    system/            # 若依式系统管理模块
    monitor/           # 系统监控模块
  layouts/             # 管理后台壳
  router/              # 内核启动、路由编译、登录/权限守卫
  shared/              # HTTP、Mock、CRUD、格式化
  stores/              # Pinia：会话、内核状态、UI
  styles/              # 设计变量与后台样式
tests/
  e2e/smoke.mjs        # 真实浏览器冒烟
  *.test.ts            # 内核、权限、HTTP、Mock 单元测试
```

## 真实后端接入

复制 `.env.example` 为 `.env.local`，按后端情况设置：

```dotenv
VITE_API_MODE=http
VITE_API_BASE_URL=/api
API_PROXY_TARGET=http://127.0.0.1:8080
```

- `VITE_API_MODE=mock` 使用内置演示数据；`http` 使用真实后端。
- `VITE_API_BASE_URL` 会拼在请求路径前；后端没有上下文路径时留空。
- Vite 开发代理把 `/api` 原样转发到 `API_PROXY_TARGET`，不会自动去掉 `/api` 前缀。
- 请求统一走 `src/shared/http.ts`，响应约定为 `{ code: 0, message: string, data: T }`，非 0 或非 2xx 会抛出 `ApiError`。

内置接口覆盖：

- `/auth/login`、`/auth/profile`、`/auth/logout`
- `/system/users`、`/system/roles`、`/system/menus`、`/system/departments`
- `/system/posts`、`/system/dicts`、`/system/configs`、`/system/notices`
- `/monitor/online`、`/monitor/jobs`、`/monitor/server`、`/monitor/cache`
- `/dashboard/overview`

## 已实现的后台能力

- 登录/退出、会话恢复、Token 注入、登录后重定向。
- 动态菜单、菜单搜索、侧栏折叠、暗色主题、面包屑。
- 用户 CRUD、搜索、分页、状态切换、内置管理员保护。
- 角色、菜单树、部门树、岗位、字典、参数、通知公告管理。
- 在线用户、定时任务、服务监控、缓存监控。
- 插件中心：依赖拓扑、启停、运行期错误面板、服务与命令清单。
- 工作台：指标卡、趋势图、部门分布、公告、最近操作、插件槽位注入的健康卡片。

## 工程约定

- 统一使用 `pnpm`，Node.js 22+。
- 页面权限通过路由 `meta.permission` + 菜单 `permission` 双重声明。
- 新业务域只新增 `src/plugins/<id>/index.ts` 并加入 `src/plugins/index.ts`；宿主不感知具体页面。
- 不在插件里直接访问 `localStorage` 会话或 `import.meta.env`；通过 `PluginContext` 与共享 service 获取能力。
- 生产构建开启 sourcemap，按 Element Plus、Vue 运行时与插件页面拆包；如需关闭可在 `vite.config.ts` 调整。
