# 组态画布（从 okmy_dics 融合）

`scada` 插件把 `okmy_dics` 的组态（SCADA 画面）编辑器搬进本后台：同一份画面文档既能在浏览器里编辑，
也能由真实后端校验/渲染。**不维护第二套渲染实现**——求值只有一份（`src/shared/scada/render.ts`），
「求值结果 → 可绘制图元」也只有一份（`src/shared/scada/scene.ts`），
与 Rust crate `az-scada-canvas` 的 `behavior::resolve_widget` 语义对齐。

绘制链路分成三层，编辑器和只读端共用前两层：

```
画面文档 + 图元库 + 变量值
      │  buildScene()        scene.ts（纯函数，无 DOM）
      ▼
场景图 ScadaScene { width, height, widgets[].primitives[] }
      ├── sceneToSvg()      scene.ts      → SVG 字符串（服务端 /scada/preview、缩略图）
      └── ScadaSurface.vue  Vue           → 浏览器 SVG DOM（编辑器与只读大屏共用）
              └── ScadaCanvas.vue          → 再叠命中层/选中框/手柄/参考线（只有编辑器要）
```

## 目录

| 路径 | 职责 | 来源 |
| --- | --- | --- |
| `src/shared/scada/types.ts` | 画面/图元/变量/接口契约 + 文档解析与归一化 | `okmy_dics/frontend/src/types/scada.ts` |
| `src/shared/scada/render.ts` | 几何、吸附、对齐、槽位求值（纯函数，无 DOM） | `.../screens/scada/composables/scada-render.ts` |
| `src/shared/scada/symbols.ts` | 图元解析 + 稀疏字段补齐 + 索引（前后端共用） | 新增 |
| `src/shared/scada/library.ts` | 浏览器侧图元库入口（JSON 由 Vite 解析） | 新增 |
| `src/assets/scada/builtin-symbols.json` | 图元库唯一数据源（15 个内置图元） | `okmy_dics/creates/az-scada-canvas/builtin-symbols.json` |
| `src/shared/scada/scene.ts` | 画面 → 场景图（绘制图元）+ 场景 → SVG 字符串（纯函数，无 DOM） | 新增 |
| `src/components/scada/ScadaSurface.vue` | 只读渲染面：吃文档/图元/变量，画 SVG；无选择、无拖动、无 Element Plus | 新增 |
| `src/components/scada/ScadaCanvas.vue` | 交互层：命中层 + 选择/拖动/缩放/旋转/框选/吸附，绘制委托给 `ScadaSurface` | `.../views/ScadaCanvas.vue` |
| `src/components/scada/ScadaSymbolPalette.vue` | 图元库面板（分类/搜索/点击或拖入） | 同上 |
| `src/components/scada/ScadaInspector.vue` | 属性、几何、变量绑定、阈值 | 同上 |
| `src/components/scada/ScadaTagPicker.vue` | 通道变量选择器 | 同上 |
| `src/plugins/scada/pages/ScadaWorkbenchPage.vue` | 工作台编排：画面列表 + 画布 + 属性面板 | 由 `ScadaScene.vue` 精简重写 |
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
POST /scada/preview                   → { svg, issues, missingTagIds }（svg 是真实渲染结果）
```

后端实现在 `server/plugins/scada/`，通过 `@addzero/ui-server` 的 `extensions` 挂在 `/api` 下；
画面数据存 SQLite 的 `ui_kv`（键 `scada:state`）。前端不需要任何开关，浏览器端只有真实后端一条链路。

`/scada/preview` 与保存时的 `previewSvg` 都由服务端用 `buildScene` + `sceneToSvg` 生成，
和编辑器里看到的画面同源；`values`（`tagId` / `raw` / `text` / `quality`）传了就按绑定求值，
不传就落到图元默认属性。

## 与来源实现的差异

1. **补了稀疏字段默认值**：`builtin-symbols.json` 是 serde 稀疏输出（`bindingSlots`/`props`/`parts`/`ports`
   为空时省略，`keepAspect`/`version` 缺省不写），后端靠 `serde(default)` 补齐，前端没有这层。
   不补会让 `symbol.bindingSlots.find(...)` 抛错、整块画布渲染 0 个图元（融合时实际踩到）。
2. **去掉设备专用面板**：采集开关（`ScadaCollectorPanel`）、软告警（`ScadaAlarmPanel`）、
   服务端预览与桌面端导出依赖 Tauri/本地采集器，不属于本后台；导出改为序列化画布 SVG。
3. **画面维度简化为演示工程**：`PROJECT_ID = 1`，接入真实工程上下文时由路由参数注入。
4. **打开画面自动按容器宽度缩放**：1920 宽画布在窄栏里会裁掉右侧图元，另提供「适应宽度」。

## 校验

```bash
npx vue-tsc -b && npx vite build
```
