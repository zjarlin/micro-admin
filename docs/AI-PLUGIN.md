# AI 插件、指令集与可配置界面

这份文档面向两类人：

- **画原型/配后台的人**：不写代码，靠 schema + 主题 + 提示词把一套界面做出来；
- **接别的项目的开发者**：把同一套能力当包依赖走，而不是复制代码。

## 三层可配置边界

| 层 | 配置存在哪 | 谁改 | 改完要发版吗 |
| --- | --- | --- | --- |
| 页面结构 | `ui_schema`（`PUT /api/ui/pages/{key}`） | 页面工厂 / AI 生成 | 不要，刷新即生效 |
| 外观 token | `ui_kv` 的 `ui:theme`（`PUT /api/ui/theme`） | 外观主题页 / AI 生成 | 不要，全站即时生效 |
| AI 提示词 | `ui_kv` 的 `ai:prompts`（`PUT /api/ai/prompts`） | AI 工作台 | 不要，下次生成即生效 |

代码里只有「机制」：指令集、解析/执行器、schema 引擎、Element Plus 壳。
凡是「文案、字段、颜色、模型口径」都在上面的配置里。

## 插件边界

```
server/plugins/scada   组态服务：图元库、变量目录、画面持久化
server/plugins/ai      AI 服务：读 Codex 配置、提示词库、/ai/*
server/plugins/theme   外观服务：ui:theme 读写
src/plugins/scada      画布页面 + 对外句柄 workbench.ts
src/plugins/ai         右栏 AI 页签（槽位 scada:assistant）+ AI 工作台
src/plugins/theme      外观主题设置区
src/plugins/pages      通用页面 + 页面工厂
```

- `ai` 声明 `requires: ['core-admin', 'scada']`：需要画布才谈得上生成画面；
- AI 只通过 `src/plugins/scada/workbench.ts` 暴露的句柄读写画布（`readDocument` / `writeDocument` …），
  不 import 画布页面，所以画布换实现、AI 仍可用；
- 画布通过槽位 `scada:assistant` 接收 AI 面板：禁用 `ai` 插件，页签自动消失；
- 主题页在 AI 插件被禁用时隐藏「AI 生成」按钮，手工调色不受影响。

## 组态指令集（`@zjarlin/scada-dsl`）

无 UI 依赖，`pnpm --filter @zjarlin/scada-dsl build` 后即可被别的项目 `import`。
指令清单只有一份真相：`src/grammar.ts` 的 `DSL_OPS`，提示词里的能力清单（`{{catalog}}`）由它生成。

绘图：`add` `remove` `move` `resize` `rotate` `zorder` `lock` `show` `hide` `style` `bind` `unbind`
排版：`align` `distribute` `grid` `stack` `center` `fit` `anchor`
画布：`canvas`

```
canvas size 1280x800 grid=16 background=#0b1220
add basic.text as title name=换热站监控 at 40,40 size 280x40
style title fontSize=24 color=#e2e8f0
anchor title tl margin=40
add machine.pump as pump1 name=1#循环泵 size 140x140
distribute v pump1 pump2 pump3 gap=48
bind pump1.run=103
```

执行规则（`src/apply.ts`）：

- 模型不碰像素：几何全部由执行器按图元默认尺寸、栅格与排版指令算出来；
- 图元 key 允许省略命名空间前缀（`text` → `basic.text`，前提是后缀唯一）；
- 单条指令失败不影响后续，逐行返回 `issues`（`line` / `severity` / `message` / 原文）；
- 锁定图元不参与排版，只记一条 warn；`@last`、`@selection` 可当引用。

## AI 服务端点

| 端点 | 作用 |
| --- | --- |
| `GET /api/ai/config` | 模型来源（env / codex / none）、model、指令条数；不含密钥 |
| `GET /api/ai/catalog` | 指令清单 + 引用语法帮助 |
| `GET/POST /api/ai/prompts`，`DELETE /api/ai/prompts/{id}`，`POST /api/ai/prompts/{id}/reset` | 提示词库（内置不可删，可改可恢复） |
| `POST /api/ai/draw` | 自然语言 → 指令 → 执行 → 返回新文档 + 逐行问题 |
| `POST /api/ai/schema` | 原型描述 → data-page schema（结构校验后返回） |
| `POST /api/ai/theme` | 气质描述 → 外观 token |
| `POST /api/ai/chat` | 通用对话（提示词可选） |

模型配置优先级：`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_TIMEOUT_MS`
→ 本机 Codex 配置（`$CODEX_HOME` 或 `~/.codex` 的 `config.toml` + `auth.json`）。
容器部署时没有 `~/.codex`，因此在 `deploy/.env` 里显式给 `AI_*`（与 Codex 同一个网关、同一把 key）。

## 提示词占位符

`{{catalog}}` 指令清单、`{{refs}}` 引用语法、`{{document}}` 当前画面、`{{symbols}}` 图元清单、
`{{variables}}` 可绑变量、`{{layout}}` 排版体检、`{{grid}}` 栅格、`{{baseline}}` 参考基线。
未知占位符原样保留，便于发现拼写错误。

`maxOutputTokens` 随提示词一起存：画面复杂被截断时，在 AI 工作台把它调大即可，不用改代码。

## 「画原型的人」怎么落地一套界面

1. **页面工厂**（`/pages/studio`）：描述原型 → AI 生成 schema 草稿 → 改 JSON → 保存并上线；
2. **外观主题**（系统设置 → 界面外观）：调色/圆角/密度，或一句话让 AI 生成，先预览再发布；
3. **AI 工作台**（`/ai/studio`）：行业口径不同就改提示词（比如 `page.schema` 的分组命名、权限码规则）；
4. **组态画布**：右栏「AI 助手」说需求，生成的是指令集，可逐条看问题、可手工再调，
   满意后写入画布并保存。

## 给别的项目复用

```bash
pnpm add @zjarlin/scada-dsl        # 指令集：解析、执行、排版体检、上下文描述
pnpm add @zjarlin/data-page        # 页面契约 + CRUD 引擎（无 UI）
pnpm add @zjarlin/ui-server        # Hono 外壳 + SQLite 端口实现
```

服务端装配示例（`server/app.ts`）演示了硬约束：`extensions` 只吃公开端口，
`publicPaths` 只放前言类 GET；插件之间靠构造参数传能力（`symbols` / `tags`），不互相读内部状态。
