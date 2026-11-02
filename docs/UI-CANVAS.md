# 图纸 → 页面（AI 零代码）

目标是「做 UI 的人只画 2D 图纸，点发布就上线」。这件事之所以不需要再造一个页面运行时，
是因为**页面本来就已经有一份中间表示**：`CrudPageSchema`。图纸只是它的另一种写法。

```
图纸（UiDrawing，纯 JSON）
      │  compileDrawing
      ▼
CrudPageSchema  ←── 与手写 schema（src/schema/user.ts）完全同构
      │  PUT /ui/pages/{key}
      ▼
createStoredRegistry → GET /ui/pages → pagesPlugin 自动挂路由+菜单
```

同一份 schema 由同一个 `CrudPage` / `TreePage` 壳渲染，所以「设计器里看到的」和「发布后线上的」
天然是同一个东西，不存在两套渲染实现需要对齐。

## 包与边界

| 位置 | 职责 |
| --- | --- |
| `packages/ui-canvas/src/types.ts` | 图纸 IR：`UiDrawing` / `UiElement` / `UiRole` / `UiElementProps` / `UiElementBinding` |
| `packages/ui-canvas/src/roles.ts` | 角色表 L0：18 个角色的尺寸、默认属性、可配置项白名单、可用通道、配色 |
| `packages/ui-canvas/src/layout.ts` | 几何装配：区域划分、叶子元素、阅读顺序、按列宽推断 `span` |
| `packages/ui-canvas/src/compile.ts` | 图纸 → `CrudPageSchema` + 诊断 + 待补问题 + 结构分析 |
| `packages/ui-canvas/src/vibe.ts` | vibeelement 契约：通道表、绑定校验、模板安全检查、默认模板 |
| `packages/ui-canvas/src/render.ts` | 零依赖 SVG 线框（九宫格缩略图、服务端出图） |
| `packages/ui-canvas/src/index.ts` | 门面 |
| `server/plugins/ui-canvas/` | 图纸 CRUD、编译、发布、AI 问模型补参、缩略图接口 |
| `src/plugins/ui-canvas/` | 图纸库（九宫格）、设计器、运行预览三个页面 |
| `src/components/ui-canvas/` | `DrawingCanvas.vue`（画布）、`VibeElement.vue`（活元素） |

`packages/ui-canvas` 零 Vue / 零 DOM 依赖，服务端可直接编译；前端只做交互与预览。

## 编译口径（几处容易踩的坑）

- **角色默认值不得泄漏**：`effectiveProps` 里的角色默认值只用于「没配置时的兜底」，
  编译器读的是元素**显式声明**。曾出现过把下拉框默认的 `match: 'like'` 塞给所有查询、
  把 `span: 24` 覆盖掉几何推断的问题。
- **`span` 由几何推断**：按元素宽度占表单/画布的比例折算（24 栅格），不是角色默认值。
- **行操作列**：现有页面壳里 `schema.actions` 只渲染成表格的「操作」列，
  所以图纸上的页面级按钮不能直接塞进 `actions`。当前规则：
  `create` 由 `fields` 自动出「新增」；文案含「导出」或路径含 `export` → `exportable: true`；
  其余落 `page-action-unsupported` 诊断，不静默丢弃。
- **有「新增」但没表单** → `page-create-without-form`（error），发布被拦。

## vibeelement：能实时预览、能绑数据与事件的元素

普通图元只有角色与属性；vibeelement 多两样东西：

1. `props.code` —— 模板片段（Vue 模板，不是任意脚本）；
2. `bindings` —— 数据通道（读）+ 事件通道（写）。

```jsonc
{
  "role": "action",
  "props": { "code": "<el-button type=\"primary\" @click=\"onClick\">{{ label }}</el-button>" },
  "bindings": [
    { "kind": "event", "channel": "click", "action": "dialog" }
  ]
}
```

- **通道表是唯一的**（`VIBE_CHANNELS`）：`table.rows`、`column.value`、`form.values`、
  `field.value`、`query.value`、`header.title`、`text.value`、`stat.value`、`detail.value`、
  `chart.series`、`tree.nodes`（数据）；`click`、`change`、`submit`、`select`（事件，`change` 支持 `reload` 以便改完条件立刻重查）。
  角色能挂哪些通道由角色表声明，越权绑定直接报 error。
- **模板里只看得到两样东西**：已声明的数据通道值，和 `onClick` / `onChange` 这类处理器名。
  模板拿不到 `http` / `router` / `store`，因此可以安全地下发到别人的浏览器。
- **安全边界**在 `inspectCode`：禁 `<script>`、`v-html`、`eval`、`new Function`、
  动态 `import()`、`require`、`document`、`window`，以及 `@click` 内联表达式。
- **实时预览**：`VibeElement.vue` 用 Vue 完整构建（含运行期编译器）把模板编成渲染函数，
  改一个字即时重渲染。编译器按需 `import()`，只有真的用到 vibeelement 的页面才付这 66KB。
  编译结果被包成一个一次性组件交给 Vue 渲染——不能手工调用渲染函数，否则
  `_resolveComponent('el-button')` 解析不到全局组件，`el-*` 会退化成惰性自定义标签。
- **发布即生效（已闭环）**：`vibeSchemaOf(element)` 把元素装成 schema 里的 `vibe`
  （`code` + `bindings`），编译时写进 `ColumnSchema` / `FieldSchema` / `QuerySchema` /
  `ActionSchema` 的同名可选字段。于是「发布」只是把 schema 写进注册表，线上页面拿到的
  同一份 JSON 里就带着模板，不需要第二次转换、也没有第二套页面运行时。

```jsonc
{ "prop": "status", "label": "状态",
  "vibe": { "code": "<el-tag :type=\"value === 1 ? 'success' : 'info'\">{{ value }}</el-tag>",
            "bindings": [{ "channel": "column.value", "kind": "data", "source": "value" }] } }
```

- **唯一的运行期**：`data-page-element` 的 `VibeElement.vue` —— 设计器预览、运行预览、
  发布后的真实页面共用同一个实现（渲染走 Vue 运行期编译器，按需 `import()`），
  因此「预览里长什么样」就是「上线后长什么样」。
- **数据与事件**：槽位宿主算好取值（`value` / `row` / `label` / `options` / `model` / `filters`）
  交给模板；事件按 `VibeBindingSchema.action` 执行（`navigate` / `request` / `reload` /
  `dialog` / `emit`）。不配动作也有合理默认：单元格点击 = 看详情、行按钮点击 = 点默认按钮、
  表单/查询控件 `change` = 回写值。`navigate` 由宿主决定（应用内注入 `router.push`，
  缺省 `location.assign`）。
- **没配 / 被拒**：没写 `code` 的元素按角色默认样式渲染；模板被 `inspectCode` 拒绝时落
  `vibe-code-rejected` 诊断并退回默认样式——写错只影响这个元素，不会白屏。

## 界面

- **图纸库** `/ui-canvas/gallery`：九宫格，3×3 一屏。左双栏（76px 图标栏 + 210px 筛选栏），
  侧栏工具条放不下的入口都收在这里。
- **设计器** `/ui-canvas/designer?id=`：左双栏（角色库 + 结构树，容器归「页面骨架」、其余按区域分组），
  中间画布（选择/拖动/缩放/框选/吸附/区域线），右侧四页签（属性 / 数据与事件 / vibeelement / 编译）。
- **运行预览** `/ui-canvas/run?id=`：把当前图纸编译出的 schema 直接交给 `CrudPage`，不落库不发版。
- 菜单只有一个入口「图纸库」，其余都从图纸库里进（不重复入口）。

## 接口

```
GET  /ui-canvas/drawings                      图纸清单（九宫格用，含线框与发布状态）
GET  /ui-canvas/drawing?id=                   图纸详情
POST /ui-canvas/drawing/{create,update,delete}
POST /ui-canvas/drawing/compile  { id | drawingJson }   编译（不落库）
POST /ui-canvas/drawing/publish  { id }                 编译→有 error 直接 400→写注册表
POST /ui-canvas/drawing/unpublish{ id }
POST /ui-canvas/drawing/ask      { id, answers }        AI 补参回填（白名单+类型收敛）
POST /ui-canvas/drawings/wireframe                      批量 SVG 缩略图
GET  /ui-canvas/drawing/wireframe?id=                   单张 SVG（RawResponse，不套 JSON 信封）
```

AI 补参复用本仓库已有的 `server/plugins/ai`（配置 + Responses 客户端）：
和组态指令走同一个 sub2api、同一份密钥、同一套超时，只允许用 `UIC_MODEL` 单独选一个
便宜模型给图纸补参，避免占掉贵的额度。没配好时接口返回 400 而不是假装成功。
