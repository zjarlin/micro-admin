// 包入口：组态画面 → IFC4（ISO 16739）模型。
//
// 典型用法（服务端）：
//   const plan = buildPlan(scene, { screenName, symbols, decisions })
//   const file = writeIfc(plan, { name, screenId, projectId })
//
// 典型用法（前端缩略图）：
//   const { svg } = renderPlanIsometric(plan, { scale: 0.12 })
//
// 三层职责：`symbols3d` 决定「画什么」，`plan` 决定「缺什么」，`writer`/`isometric`
// 决定「长什么样」。任意一层都能单独用，互不依赖外部的业务类型。

export * from './types.ts'
export { guidOf, compressGuid } from './guid.ts'
export {
  boundsOf,
  ensureCounterClockwise,
  looksCircular,
  outlineOf,
  rectToMm,
  type Outline,
  type OutlineOptions,
} from './geometry.ts'
export {
  CATEGORY_RULES,
  MATERIAL_LABEL,
  SYMBOL_3D_RULES,
  depthOf,
  ifcEntityOf,
  specOf,
  type Part3DRule,
  type Symbol3DRule,
} from './symbols3d.ts'
export {
  DEFAULT_SETTINGS,
  applyDecisions,
  buildPlan,
  explainPlan,
  planReady,
  visibleParts,
  type PlanOptions,
} from './plan.ts'
export { outlineOfPart, planOutlines, writeIfc } from './writer.ts'
export {
  renderIsometric,
  renderPlanIsometric,
  renderPlanIsometricFit,
  type IsoOptions,
  type IsoPart,
} from './isometric.ts'

import { buildPlan, type PlanOptions } from './plan.ts'
import { writeIfc } from './writer.ts'
import type { ExtrusionPlan, IfcFile, IfcMeta, SceneLike } from './types.ts'

/** 一步到位：场景 → 计划 → IFC 文件。需要 AI 补参时先 `buildPlan` 再 `applyDecisions`。 */
export function exportSceneAsIfc(scene: SceneLike, meta: IfcMeta, options: PlanOptions = {}): { plan: ExtrusionPlan; file: IfcFile } {
  const plan = buildPlan(scene, { screenName: meta.name, ...options })
  return { plan, file: writeIfc(plan, meta) }
}
