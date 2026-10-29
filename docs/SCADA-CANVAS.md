# 组态画布（从 okmy_dics 融合）

`scada` 插件把 `okmy_dics` 的组态（SCADA 画面）编辑器搬进本后台：同一份画面文档既能在浏览器里编辑，
也能由真实后端校验/渲染。**不维护第二套渲染实现**——图元求值只有一份（`src/shared/scada/render.ts`），
与 Rust crate `az-scada-canvas` 的 `behavior::resolve_widget` 语义对齐。

## 目录

| 路径 | 职责 | 来源 |
| --- | --- | --- |
| `src/shared/scada/types.ts` | 画面/图元/变量/接口契约 + 文档解析与归一化 | `okmy_dics/frontend/src/types/scada.ts` |
| `src/shared/scada/render.ts` | 几何、吸附、对齐、槽位求值（纯函数，无 DOM） | `.../screens/scada/composables/scada-render.ts` |
| `src/shared/scada/symbols.ts` | 内置图元装载 + 稀疏字段补齐 + 索引 | 新增 |
| `src/assets/scada/builtin-symbols.json` | 图元库唯一数据源（15 个内置图元） | `okmy_dics/creates/az-scada-canvas/builtin-symbols.json` |
| `src/components/scada/ScadaCanvas.vue` | SVG 渲染 + 选择/拖动/缩放/旋转/框选/吸附 | `.../views/ScadaCanvas.vue` |
| `src/components/scada/ScadaSymbolPalette.vue` | 图元库面板（分类/搜索/点击或拖入） | 同上 |
| `src/components/scada/ScadaInspector.vue` | 属性、几何、变量绑定、阈值 | 同上 |
| `src/components/scada/ScadaTagPicker.vue` | 通道变量选择器 | 同上 |
| `src/plugins/scada/pages/ScadaWorkbenchPage.vue` | 工作台编排：画面列表 + 画布 + 属性面板 | 由 `ScadaScene.vue` 精简重写 |
| `src/shared/scada/mock-store.ts` | `VITE_API_MODE=mock` 时的演示后端 | 新增 |

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

`.env` 中 `VITE_API_MODE=http` + `VITE_API_BASE_URL` 即切真实后端；页面代码无需改动。

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
