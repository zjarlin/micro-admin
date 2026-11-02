# 组态画布（从 okmy_dics 融合）

`scada` 插件把 `okmy_dics` 的组态（SCADA 画面）编辑器搬进本后台：同一份画面文档既能在浏览器里编辑，
也能由真实后端校验/渲染。**不维护第二套渲染实现**——图元求值只有一份（`src/shared/scada/render.ts`），
与 Rust crate `az-scada-canvas` 的 `behavior::resolve_widget` 语义对齐。

## 目录

| 路径 | 职责 | 来源 |
| --- | --- | --- |
| `src/shared/scada/types.ts` | 画面/图元/变量/接口契约 + 文档解析与归一化 | `okmy_dics/frontend/src/types/scada.ts` |
| `src/shared/scada/render.ts` | 几何、吸附、对齐、槽位求值（纯函数，无 DOM） | `.../screens/scada/composables/scada-render.ts` |
| `src/shared/scada/symbols.ts` | 图元解析 + 稀疏字段补齐 + 索引（前后端共用） | 新增 |
| `src/shared/scada/library.ts` | 浏览器侧图元库入口（JSON 由 Vite 解析） | 新增 |
| `src/assets/scada/builtin-symbols.json` | 图元库唯一数据源（18 个内置图元，含线段/圆椭圆/三角形） | `okmy_dics/creates/az-scada-canvas/builtin-symbols.json` |
| `src/shared/scada/glyph.ts` | 图元 → 工具条小图标的字形（复用画布同一条求值链，不手绘图标） | 新增 |
| `src/components/scada/ScadaCanvas.vue` | SVG 渲染 + 选择/拖动/缩放/旋转/框选/吸附 | `.../views/ScadaCanvas.vue` |
| `src/components/scada/ScadaSymbolPalette.vue` | 图元库面板（分类/搜索/点击或拖入，列表项带同一份字形） | 同上 |
| `src/components/scada/ScadaShapeStrip.vue` | 工具条「基础图形」那排小图标（CAD/PS 风格）：点一下落到空位，拖到画布落到指定位置 | 新增 |
| `src/components/scada/ScadaInspector.vue` | 属性、几何、变量绑定、阈值 | 同上 |
| `src/components/scada/ScadaTagPicker.vue` | 通道变量选择器 | 同上 |
| `src/components/scada/ScadaCadImportDialog.vue` | CAD 图纸导入（DXF → 指令集 → 画面）：拖放、图层筛选、体积对比、AI 补语义 | 新增 |
| `src/shared/scada/cad.ts` / `cad-api.ts` | CAD 导入包的门面与前端 HTTP 契约 | 新增 |
| `server/plugins/scada/cad.ts` | `POST /scada/cad/import`、`POST /scada/cad/apply` | 新增 |
| `src/plugins/scada/pages/ScadaWorkbenchPage.vue` | 工作台编排：资源轨（画面 + 图元库）+ 画布；属性面板 Teleport 到外壳右栏 | 由 `ScadaScene.vue` 精简重写 |
| `server/plugins/scada/service.ts` | 真实后端：画面 CRUD、校验、点位目录 | 新增 |
| `server/plugins/scada/tags.ts` | 点位目录（换成真实采集通道时只改这里） | 新增 |
| `server/plugins/scada/index.ts` | 装配：读图元 JSON + KV 存储 | 新增 |

## 接口契约

与 `okmy_dics` 的 `plugins/scada` + `backend/.../scada` 保持一致，换后端只改环境变量：

```
GET  /scada/screens?projectId=        → ScadaScreenSummary[]
GET  /scada/screen?screenId=          → ScadaScreenDetail
POST /scada/screen/create             → ScadaScreenDetail
POST /scada/screen/update             → ScadaScreenDetail（保存前必须能通过 /scada/validate）
POST /scada/screen/delete             → { deleted }
GET  /scada/symbols                   → { version, symbols, externalSource }
GET  /scada/tags?projectId=           → { projectId, items, total, writable }
POST /scada/validate                  → { valid, issues, missingTagIds, referencedTagIds, widgetCount }
POST /scada/preview                   → { svg, issues, missingTagIds }
```

后端实现在 `server/plugins/scada/`，通过 `@zjarlin/ui-server` 的 `extensions` 挂在 `/api` 下；
画面数据存 SQLite 的 `ui_kv`（键 `scada:state`）。前端不需要任何开关，浏览器端只有真实后端一条链路。

## 与来源实现的差异

1. **补了稀疏字段默认值**：`builtin-symbols.json` 是 serde 稀疏输出（`bindingSlots`/`props`/`parts`/`ports`
   为空时省略，`keepAspect`/`version` 缺省不写），后端靠 `serde(default)` 补齐，前端没有这层。
   不补会让 `symbol.bindingSlots.find(...)` 抛错、整块画布渲染 0 个图元（融合时实际踩到）。
2. **去掉设备专用面板**：采集开关（`ScadaCollectorPanel`）、软告警（`ScadaAlarmPanel`）、
   服务端预览与桌面端导出依赖 Tauri/本地采集器，不属于本后台；导出改为序列化画布 SVG。
3. **画面维度简化为演示工程**：`PROJECT_ID = 1`，接入真实工程上下文时由路由参数注入。
4. **打开画面自动按容器宽度缩放**：1920 宽画布在窄栏里会裁掉右侧图元，另提供「适应宽度」。
5. **CAD 图纸导入**：工具条「导入图纸」丢一个 `.dxf` 进来，本地解析成绘图指令集再写画面；
   详见 [`CAD-IMPORT.md`](CAD-IMPORT.md)。整条链路默认不花 token，只有语义补全读几十行摘要。
6. **基础图形上工具条**：`线段 / 圆椭圆 / 三角形 / 矩形 / 文本` 除留在图元库外，另以一排 26px 图标按钮出现在工作台工具条上。
   图标**不是手绘图标集**，由 `symbolGlyph()` 复用画布同一条求值链（`buildScene` → 绘制图元）把图元定义缩成 18px 字形，
   所以「放下去的东西」和图标永远同形，新增基础图形会自动多一格图标，不存在「加了图元忘了加图标」。
   图标是单色 `currentColor`（CAD/Photoshop 的规矩：图标表示工具不表示配色），并做了两处 18px 取舍：
   面板类图元只画外形不画字（180×72 里的 28px 字缩到 18px 等于没有），纯文字图元（`文本`）反过来按内容宽度拟合字号。
   放到画布上有两条路径：点一下按栅格落在第一个空位；从图标拖到画布则落在指针位置（按图元中心对齐，除以缩放后取整到栅格）。

## 校验

```bash
npx vue-tsc -b && npx vite build
```
