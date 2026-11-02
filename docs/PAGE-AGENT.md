# 页面助手插件（alibaba/page-agent）

把 [alibaba/page-agent](https://github.com/alibaba/page-agent) 装进后台的一个可停用能力：
用自然语言操作当前页面（点按钮、填表单、翻页）。

## 为什么这样接

| 关注点 | 做法 | 原因 |
| --- | --- | --- |
| 密钥 | 只存服务端，浏览器拿不到 | 前端产物是公开静态资源，任何打进 JS 的 key 都等于泄露 |
| 供应商地址 | 同上，走同源代理 `/page-agent/llm` | 顺便统一超时、限流文案、错误翻译，换网关不用发版 |
| 实例归属 | 插件服务 `page-agent.runtime`，全站一个 | 面板是长生命周期浮动 UI，换页不该丢历史和中断状态 |
| 可见入口 | 只有一个：外壳顶栏的 AI 图标（图纸元素，点击执行 `page-agent.toggle` 命令；面板是它的展开态） | 全站共用一处入口，同一动作不设第二处入口 |
| 可调项 | 全部是后端设置字段，界面可改 | 组件的每个参数都要能在界面上配，不在代码里写死 |

## 服务端（`server/plugins/page-agent/`）

| 文件 | 作用 |
| --- | --- |
| `settings.ts` | 设置模型、`DEFAULT_PAGE_AGENT_SETTINGS`（唯一默认值来源）、归一化、`publicSettings()` / `entryView()` 两种投影 |
| `proxy.ts` | `POST /page-agent/llm` 的转发实现：注入密钥、套超时、把上游错误翻成可读文案并抹掉 key 片段 |
| `index.ts` | 路由装配与权限判定 |

路由：

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| `GET` | `/page-agent/entry` | 免登录，只回顶栏入口的外观与可见性（匿名访客拿不到网关信息） |
| `GET` | `/page-agent/settings` | 需登录（内部信息：供应商、模型、提示词、脱敏规则） |
| `PUT` / `POST` | `/page-agent/settings` | `system:page-agent:config`；`apiKey` 留空 = 保留原值 |
| `DELETE` | `/page-agent/settings/api-key` | `system:page-agent:config`（显式清空，和「留空保留」区分） |
| `POST` | `/page-agent/probe` | `system:page-agent:config`，连通性自检 |
| `POST` | `/page-agent/llm?page=<路径>`（也接受 `/page-agent/llm/chat/completions`） | 需登录；校验总开关、配置完整性、`allowPaths` 后再转发 |

设置存在 `ui_kv` 的 `page-agent:settings`。环境变量只在存储为空时**播种一次**，
之后界面是唯一真源：`PAGE_AGENT_BASE_URL` / `PAGE_AGENT_MODEL` / `PAGE_AGENT_API_KEY` / `PAGE_AGENT_ENABLED`，
未配置时回落到同一台网关的 `AI_*`（密钥只写一份）。见 `deploy/.env.example`。

## 前端（`src/plugins/page-agent/`）

| 文件 | 作用 |
| --- | --- |
| `index.ts` | 插件声明：注册 `page-agent.runtime` 服务与 `page-agent.toggle` 命令（外壳图纸的 AI 图标点击执行它）、向 `ctx.settings` 贡献设置区、跟随路由同步当前路径 |
| `runtime.ts` | 全站唯一的 PageAgent 宿主：代理 fetch、配置→实例参数、面板 CSS 变量、历史/状态同步 |
| `settings.ts` | 设置区的字段声明（全部参数）、加载/保存、自检/试跑/清空密钥动作 |
| `routes.ts` | 旧地址 `/system/page-agent` → `/system/settings?tab=assistant` 的跳转（不再有独立菜单） |

两级加载对应两套可见性：入口视图免登录（决定「显不显示、长什么样」），
完整设置需登录并在真正跑任务时才拉。保存后 `reload()` 重建实例，下一次任务立即用新参数。

## 界面参数清单

「系统工具 → 系统设置 → 页面助手」里的每一项都落到后端设置字段，不需要改代码：

- **模型连接**：供应商地址、模型、API 密钥（留空沿用 / 显式清空）、单次调用超时、失败重试、额外请求体 JSON、具名 `tool_choice` 降级
- **运行行为**：总开关、最大步数、步间隔、面板语言、内容遮罩、完成后追问下一任务、允许模型执行 JS、读站点 `llms.txt`
- **面板与顶栏入口**：宽/高/距底/圆角/左右留白/层级、运行态渐变 A/B、强调色、面板出现时机，以及入口文案/强调色/是否在图标旁显示文案；下方有同参数的实时示意
- **可用范围与上下文**：路径前缀白名单、按页面追加指令（前缀或 `re:` 正则）、脱敏规则（可开关、可删空）、全局补充指令、完全接管系统提示
- **试运行**：在当前页面试跑、打开面板、当前状态与错误

必填星号来自 `el-form` 的同一份 `rules`，不靠提交后报错；默认值只有后端一份，
页面「恢复默认值」直接采用服务端下发的 `defaults`。

## 两个必须记住的契约

1. **路径形状**：`@page-agent/llms` 自己会拼 `${baseURL}/chat/completions`，
   因此服务端两种形状都收（`/page-agent/llm` 与 `/page-agent/llm/chat/completions`）。
   只挂前者时真机请求会全 404——这是接入时实际踩过的坑。
2. **响应形状**：宿主统一用 `{code,message,data}` 信封，而库只认裸 OpenAI 响应
   （`data.choices[0]`）。`runtime.ts` 的 `proxyFetch` 负责解一层壳，
   失败时转成 `{error:{message}}` 交回库里，让库按 AUTH/RATE_LIMIT 分类处理。
   改代理返回结构时要同时确认这两点。

## 已知边界

- 模型必须支持 function/tool calling，否则助手无法操作页面。实测本机网关：`ds` 能返回
  `tool_calls` 但会「说而不做」（不遵守工具参数），`gpt-6-astra` / `gpt-6.1-sol` / `auto` 正常。
  换模型在设置页改，不需要发版。
- `page-agent` 的 `page-controller` 用了一次直接 `eval`，构建会打一条警告，属库内实现（执行生成脚本用），不影响产物。
- 面板配色/尺寸是库的 CSS 变量（`--width` / `--height` / `--border-radius` / `--side-space` / `--color-1..4`），
  宿主只改值，不复制库的样式。
