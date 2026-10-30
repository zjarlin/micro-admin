# @zjarlin/ifc-canvas

组态画面（2D 绘图指令集）→ **IFC4（ISO 16739）** BIM 模型的纯函数工具包。

零依赖、无 DOM：服务端导出 `.ifc`、前端画轴测预览、CLI 批处理都用同一份代码。

## 分层

| 模块 | 职责 | 是否依赖外部 |
| --- | --- | --- |
| `symbols3d` | 15 个内置图元 → 厚度/离地/材质/几何形式的规则表 | 否 |
| `plan` | 场景 → 3D 计划；算缺参、生成最小 AI 请求、决策缓存 | 否 |
| `writer` | 计划 → IFC4 SPF 文本（Project/Site/Building/Storey + 拉伸实体 + 属性集） | 否 |
| `isometric` | 计划 → 等轴测 SVG（缩略图 / 预览） | 否 |
| `guid` | 稳定 22 位 IFC GlobalId | 否 |

## 用法

```ts
import { buildPartScene } from './src/shared/scada/scene.ts'
import { buildPlan, writeIfc, renderPlanIsometricFit } from '@zjarlin/ifc-canvas'

const scene = buildPartScene(document, symbols, new Map())
const plan = buildPlan(scene, { screenName: '水处理总览', symbols, settings: { projection: 'facade' } })

// 规则表没覆盖的图元会被记进 plan.missing / plan.aiRequest，其余直接出模型
const file = writeIfc(plan, { name: '水处理总览', screenId: 1, projectId: 1 })
console.log(file.filename, file.stats, file.warnings)

// 缩略图
const iso = renderPlanIsometricFit(plan, { width: 320, height: 240 })
```

## 两种投影口径

- `facade`（默认）：画面立成一堵墙，画面 y → 世界 Z，图元朝墙内拉伸；缩略图能认出是哪一页。
- `plan`：画面铺在地面，图元沿 +Z 拉伸，规则表里的 `elevation` 是真实离地高度。

## 单位与对齐

- 长度单位固定毫米（`IFCSIUNIT(.MILLI.,.METRE.)`），默认 `1px = 1mm`。
- 2D↔3D 的换算比例、原点策略、向上轴、画布尺寸写在 `Pset_AddzeroScreen` 里，
  实体级信息写在 `Pset_AddzeroPart`（源 widget / part / 厚度 / 材质 / 决策来源）。

## 缺参追问

`plan.aiRequest` 只包含缺失字段（`role` / `depth` / `elevation` / `material`），
不把整份画面发给模型；模型返回的决策用 `applyDecisions(plan, decisions)` 合并后可重新导出。
