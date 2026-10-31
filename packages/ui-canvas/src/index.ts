// 2D 图纸 → 可运行页面：门面。
//
// 三层能力，各司其职：
// - `compile`：图纸 → `CrudPageSchema`（发布即 `PUT /ui/pages/{key}`）；
// - `vibe`：vibeelement 的通道契约、绑定校验与模板安全检查；
// - `render`：线框缩略图与区域对照。
//
// 类型与角色表在 `types` / `roles`，几何装配在 `layout`。
// 包本身不依赖 Vue / DOM，因此服务端能直接编译（发布），前端能直接预览（所见即所得）。
export type {
  UiCanvasSettings,
  UiCompiledPage,
  UiDiagnostic,
  UiDiagnosticLevel,
  UiDrawing,
  UiDrawingAnalysis,
  UiDrawingMeta,
  UiElement,
  UiElementBinding,
  UiElementFragment,
  UiElementProps,
  UiBindingKind,
  UiQuestion,
  UiRect,
  UiFragmentKind,
  UiRegion,
  UiRole,
} from './types.ts'

export type { UiRoleSpec } from './roles.ts'
export { ROLE_LIST, ROLE_SPECS, canConfigure, effectiveProps, specOf } from './roles.ts'

export {
  areaOf,
  centerOf,
  columnWidthOf,
  containsPoint,
  containsRect,
  elementsOfRole,
  findElement,
  horizontalOrder,
  isContainer,
  leavesOf,
  readingOrder,
  regionOf,
  regionsOf,
  spanOf,
} from './layout.ts'

export { compileDrawing } from './compile.ts'

export type { OverlayRegion, WireframeOptions } from './render.ts'
export { overlayRegions, renderWireframe } from './render.ts'

export type {
  VibeAction,
  VibeBindingIssue,
  VibeChannelSpec,
  VibeCodeIssue,
  VibeElementModel,
} from './vibe.ts'
export {
  VIBE_CHANNELS,
  channelsOf,
  defaultCodeOf,
  handlerNamesOf,
  inspectCode,
  modelOf,
  validateBindings,
  validateDrawingVibe,
  vibeSchemaOf,
} from './vibe.ts'

/** 空白图纸：新建时的唯一初始值。 */
export function createEmptyDrawing(key = 'system.demo', title = '未命名页面'): import('./types.ts').UiDrawing {
  return {
    version: 1,
    meta: { key, title, entity: '记录', pageSize: 10 },
    canvas: { width: 1400, height: 900, grid: 20, background: '#f8fafc', showGrid: true },
    elements: [],
  }
}
