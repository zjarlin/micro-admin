# 组态 → IFC（2D 转 3D）

把组态画面当成「绘图指令集」，按规则映射成 IFC4（ISO 16739）BIM 模型，
并在浏览器里用等轴测图复刻原页面。实现全部收敛在 workspace 包 `packages/ifc-canvas`，
服务端与前端共用同一段纯函数代码，没有第二套渲染实现。

## 分层

```
ScadaDocument ──resolveWidget──▶ 零件场景（绝对像素）
                                      │
                            @zjarlin/ifc-canvas
                    ┌─────────────────┼─────────────────┐
              symbols3d           plan             isometric
           （图元 → 3D 规则）  （缺参检测/缓存）    （轴测 SVG）
                                      │
                                  writer
                               （IFC4 SPF 文本）
```

| 文件 | 说明 |
| --- | --- |
| `packages/ifc-canvas/src/symbols3d.ts` | 15 个内置图元的规则表：厚度策略、离地高度、材质、几何形式（拉伸/圆柱/壳体/管道/贴面）、部件级覆盖 |
| `packages/ifc-canvas/src/plan.ts` | 场景 → 3D 计划；缺失字段汇总成 `aiRequest`；同图元同部件的决策进缓存 |
| `packages/ifc-canvas/src/writer.ts` | IFC4 SPF：`IFCPROJECT→IFCSITE→IFCBUILDING→IFCBUILDINGSTOREY` + `IFCEXTRUDEDAREASOLID` + 属性集 |
| `packages/ifc-canvas/src/isometric.ts` | 等轴测投影（`screenX=(x-y)cos`、`screenY=(x+y)sin-z`），面片按深度排序上色 |
| `src/shared/scada/ifc.ts` | 前端/服务端统一入口（包名收敛期用相对导入） |

## 两种三维口径

- `facade`（默认）：画面立成一堵墙，画面 y 变成世界 Z，图元朝墙内拉伸。
  这是「复刻现有页面」口径，九宫格缩略图一眼能认出是哪一页。
- `plan`：画面铺在地面上，图元沿 +Z 拉伸，规则表里的 `elevation` 当真实离地高度。

## 接口

```
POST /scada/screen/extrusion/plan   { screenId, projection }        → 计划 + 缺参清单 + AI 状态
POST /scada/screen/extrusion/apply  { screenId, decisions[] }       → 写回决策并返回新计划
POST /scada/screen/extrusion/ai     { screenId, projection }        → 调模型补参（未配置 key 时 400）
POST /scada/screens/iso             { projectId, projection }        → 九宫格缩略图（批量 SVG）
GET  /scada/screen/ifc?screenId=    → application/x-step 附件（真实 .ifc）
GET  /scada/screen/iso?screenId=    → image/svg+xml（单页轴测图）
```

文件下载走 `@zjarlin/ui-server` 新增的 `RawResponse`：扩展可以返回非 JSON 字节，
不再为导出单独开静态目录。`ApiExtension.handle` 同时支持返回 Promise（缺参追问要等模型）。

## 缺参追问（复用 sub2api 网关的 Responses API）

规则表覆盖全部内置图元，因此默认 **0 token**；只有自定义图元缺 `role/depth/elevation/material`
时才会发请求，且只发缺失字段。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `SUB2API_API_KEY` | 空 | 不配就不启用 AI，接口返回「AI 未启用」 |
| `SUB2API_BASE_URL` | `http://127.0.0.1:18080` | 网关地址 |
| `EXTRUSION_MODEL` | `gpt-4.1-mini` | 决策模型 |
| `EXTRUSION_AI_BACKGROUND` | `1` | 用 Responses 的 `background: true` + 轮询，失败自动回退同步 |
| `EXTRUSION_AI_TIMEOUT_MS` / `EXTRUSION_AI_POLL_MS` | 90000 / 900 | 超时与轮询间隔 |

模型返回的 JSON 进 `sanitizeDecisions`：白名单枚举、数值范围裁剪，脏数据不会写进画面。
决策按 `<widgetId>/<partId>` 存在画面的 `extrusionJson` 里，重复导出结果稳定。

## 界面

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/scada/workbench` | 组态画布 | 原编辑器；支持 `?screenId=` 直接打开指定页 |
| `/scada/gallery` | 画面库 | 九宫格：缩略图 + 图元数 + 更新时间 + 编辑/3D/导出/删除；左栏图标导航 + 筛选栏 |
| `/scada/preview?screenId=` | 3D 预览 | 画面元数据直接渲染轴测图，可调角度/缩放/标签/底板/口径，右栏显示 IFC 摘要、选中图元决策、缺参追问 |

侧栏只有这两个菜单入口（3D 预览从画面库卡片进入），避免同一动作两个入口。

## 验证记录（2026-10-30）

- `/scada/screen/ifc?screenId=1` 返回 `application/x-step`，13,469 字节、235 个实体；
  `web-ifc 0.0.78` 解析为 `IFC4`，识别 1 个 `IFCPROJECT` / 2 个 `IFCTANK` / 2 个 `IFCPUMP` / 7 个 `IFCPROPERTYSET`，
  并成功生成网格（6 个构件、4,488 个顶点分量、1,032 个索引）。
- 12 图元样例画面导出 43,861 字节 / 800 实体 / 22 个实体构件，`plan.missing = []`（规则表全覆盖）。
