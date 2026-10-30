// IFC4（ISO 16739-1:2018）SPF 序列化。
//
// 只写「一条能被 BIM 软件打开的通道」所需的最小实体集：
// IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → 构件 + 拉伸实体 + 属性集。
// 几何全部落在楼层坐标系里（不做父子变换叠加），这样 2D 画面的像素坐标能一对一
// 对回 IFC 的 X/Y，`Pset_AddzeroScreen` 里同时记录换算比例，便于反向对齐。
//
// 约束：实体按依赖顺序生成（IFC 要求引用的实例先定义），因此这里不用二次编号。

import { ensureCounterClockwise, outlineOf, boundsOf } from './geometry.ts'
import { ifcEntityOf, MATERIAL_LABEL } from './symbols3d.ts'
import type { ExtrusionPlan, IfcFile, IfcMeta, PartDecision, PlanItem, Point2 } from './types.ts'
import { guidOf } from './guid.ts'

const SCHEMA = 'IFC4'
const VIEW_DEFINITION = 'CoordinationView_V2.0'
const ALIGNMENT_TAG = 'AddzeroAlignment[View:SCREEN_2D_PLANE,Plane:XY,Up:+Z,Origin:bottom-left]'

/** SPF 数值：IFC 的 REAL 要求可识别的小数点，整数也补 `.`。 */
function real(value: number): string {
  if (!Number.isFinite(value)) return '0.'
  const rounded = Math.round(value * 1e6) / 1e6
  if (Number.isInteger(rounded)) return `${rounded}.`
  return String(rounded)
}

/** SPF 字符串：单引号转义，其余按 ISO 10303-21 保持原样（中文用 UTF-8 直接写）。 */
function text(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function label(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? '$' : text(value)
}

/** 枚举：调用方传 `AREA` 这种裸值，这里补点号。 */
function enumValue(name: string): string {
  return `.${name}.`
}

function list(items: Array<string | null>): string {
  const kept = items.filter((item): item is string => item !== null)
  return `(${kept.join(',')})`
}

/** 极简 SPF 构建器：只负责编号、拼接与格式校验。 */
class Spf {
  private readonly lines: string[] = []
  private count = 0

  add(type: string, ...params: Array<string | null>): string {
    this.count += 1
    const id = `#${this.count}`
    const body = params.map((param) => (param === null ? '$' : param)).join(',')
    this.lines.push(`${id}=${type}(${body});`)
    return id
  }

  /** 生成全局唯一且稳定的 GlobalId：同一按键重复导出结果一致。 */
  guid(key: string): string {
    return text(guidOf(key))
  }

  get size(): number {
    return this.count
  }

  join(): string {
    return this.lines.join('\n')
  }
}

function timestampOf(meta: IfcMeta): number {
  if (meta.timestamp) {
    const parsed = Date.parse(meta.timestamp)
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000)
  }
  return Math.floor(Date.now() / 1000)
}

function isoStamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, '')
}

interface Ctx {
  spf: Spf
  ownerHistory: string
  storey: string
  subContext: string
  zAxis: string
  xAxis: string
  elements: string[]
  warnings: string[]
  solids: number
  facade: boolean
}

/** 2D 轮廓 → IfcPolyline（每条边一个 IfcCartesianPoint，首点闭合）。 */
function polylineOf(spf: Spf, points: Point2[]): string | null {
  const cleaned: Point2[] = []
  for (const [x, y] of ensureCounterClockwise(points)) {
    const last = cleaned[cleaned.length - 1]
    if (last && Math.abs(last[0] - x) < 0.001 && Math.abs(last[1] - y) < 0.001) continue
    cleaned.push([x, y])
  }
  if (cleaned.length < 3) return null
  const first = cleaned[0]
  if (!first) return null
  const refs = cleaned.map(([x, y]) => spf.add('IFCCARTESIANPOINT', list([real(x), real(y)])))
  refs.push(refs[0] as string)
  return spf.add('IFCPOLYLINE', list(refs))
}

/** 圆轮廓：位置用 2D 放置，半径毫米。 */
function circleProfile(spf: Spf, cx: number, cy: number, radius: number): string {
  const origin = spf.add('IFCCARTESIANPOINT', list([real(cx), real(cy)]))
  const placement = spf.add('IFCAXIS2PLACEMENT2D', origin, null)
  return spf.add('IFCCIRCLEPROFILEDEF', enumValue('AREA'), null, placement, real(radius))
}

interface SolidSpec {
  position: string
  direction: string
  depth: number
}

/**
 * 画面坐标 → 世界坐标。
 *
 * - `plan`：画面铺在地面，第三维（offset）是离地高度；
 * - `facade`：画面立成墙，第三维是离墙距离（朝 -Y 方向），画面 y 变成世界 Z。
 */
function worldPoint(facade: boolean, x: number, y: number, offset: number): string {
  return facade ? `(${real(x)},${real(-offset)},${real(y)})` : `(${real(x)},${real(y)},${real(offset)})`
}

/** 元素几何：按 form 选轮廓 + 挤出方向，返回 IfcProductDefinitionShape。 */
function shapeOf(ctx: Ctx, item: PlanItem, decision: PartDecision): string | null {
  const { spf, facade } = ctx
  if (!item.outline || item.outline.length < 3) return null
  const bounds = boundsOf(item.outline)
  const depth = decision.depth > 0 ? decision.depth : 0
  if (depth <= 0) return null

  const elevation = decision.elevation
  let solid: SolidSpec
  let profileBody: { kind: 'curve'; ref: string } | { kind: 'profile'; ref: string } | null = null
  // 立面模式下轮廓落在墙面上：placement 的 Z 轴朝墙内（-Y），轮廓平面自然就是 XZ。
  const wallAxis = facade ? spf.add('IFCDIRECTION', list([real(0), real(-1), real(0)])) : null
  const wallRef = facade ? spf.add('IFCDIRECTION', list([real(1), real(0), real(0)])) : null

  if (decision.form === 'pipe') {
    // 管道：沿长边方向扫掠一个圆，圆心在零件中线。
    const horizontal = bounds.width >= bounds.height
    const diameter = Math.max(decision.depth, 10)
    const centre = horizontal
      ? { x: bounds.x, y: bounds.y + bounds.height / 2 }
      : { x: bounds.x + bounds.width / 2, y: bounds.y }
    profileBody = { kind: 'profile', ref: circleProfile(spf, 0, 0, diameter / 2) }
    const axisVector: [number, number, number] = horizontal
      ? [1, 0, 0]
      : facade
        ? [0, 0, 1]
        : [0, 1, 0]
    const axis = spf.add('IFCDIRECTION', list(axisVector.map(real)))
    const refPoint: [number, number, number] = Math.abs(axisVector[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    const ref = spf.add('IFCDIRECTION', list(refPoint.map(real)))
    const location = spf.add('IFCCARTESIANPOINT', worldPoint(facade, centre.x, centre.y, elevation))
    const position = spf.add('IFCAXIS2PLACEMENT3D', location, axis, ref)
    const relative = spf.add('IFCDIRECTION', list([real(0), real(0), real(1)]))
    solid = { position, direction: relative, depth: Math.max(bounds.width, bounds.height) }
  } else if (decision.form === 'cylinder' || decision.form === 'shell') {
    // 回转体：外接圆按外接盒短边定直径，底面落在 elevation。
    const diameter = Math.max(Math.min(bounds.width, bounds.height), 20)
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    profileBody = { kind: 'profile', ref: circleProfile(spf, centre.x, centre.y, diameter / 2) }
    const location = spf.add('IFCCARTESIANPOINT', worldPoint(facade, 0, 0, elevation))
    const position = spf.add('IFCAXIS2PLACEMENT3D', location, wallAxis, wallRef)
    solid = { position, direction: ctx.zAxis, depth }
  } else {
    // 常规拉伸：轮廓直接在楼层坐标系里，底面抬到 elevation。
    const curve = polylineOf(spf, item.outline)
    profileBody = curve ? { kind: 'curve', ref: curve } : null
    const location = spf.add('IFCCARTESIANPOINT', worldPoint(facade, 0, 0, elevation))
    const position = spf.add('IFCAXIS2PLACEMENT3D', location, wallAxis, wallRef)
    solid = { position, direction: ctx.zAxis, depth }
  }

  if (!profileBody) return null
  const sweptArea = profileBody.kind === 'profile'
    ? profileBody.ref
    : spf.add('IFCARBITRARYCLOSEDPROFILEDEF', enumValue('AREA'), label(item.partId), profileBody.ref)
  const extruded = spf.add(
    'IFCEXTRUDEDAREASOLID',
    sweptArea,
    solid.position,
    solid.direction,
    real(solid.depth),
  )
  const representation = spf.add(
    'IFCSHAPEREPRESENTATION',
    ctx.subContext,
    text('Body'),
    text('SweptSolid'),
    list([extruded]),
  )
  ctx.solids += 1
  return spf.add('IFCPRODUCTDEFINITIONSHAPE', null, null, list([representation]))
}

function entityParams(
  entity: string,
  globalId: string,
  owner: string,
  item: PlanItem,
  placement: string,
  shape: string,
): Array<string | null> {
  const base: Array<string | null> = [globalId, owner, label(item.widgetName), label(item.symbolKey), null, placement, shape, label(item.partId)]
  switch (entity) {
    // IFC4 里这两类没有 PredefinedType，多给一个参数整份文件就校验不过。
    case 'IFCCANNOTATION':
    case 'IFCFURNISHINGELEMENT':
      return base
    default:
      // 其余构件都带 PredefinedType；`.NOTDEFINED.` 是每个枚举都合法的取值。
      return [...base, enumValue('NOTDEFINED')]
  }
}

function propertySet(ctx: Ctx, owner: string, name: string, values: Array<{ name: string; type: string; value: string }>): string {
  const props = values.map((entry) => {
    const single = ctx.spf.add('IFCPROPERTYSINGLEVALUE', text(entry.name), null, `${entry.type}(${entry.value})`, null)
    return single
  })
  return ctx.spf.add('IFCPROPERTYSET', ctx.spf.guid(`pset:${name}:${values.map((v) => v.name).join(',')}`), owner, text(name), null, list(props))
}

function textValue(value: string): string {
  return text(value)
}

function realValue(value: number): string {
  return real(value)
}

function intValue(value: number): string {
  return String(Math.round(value))
}

/**
 * 计划 → IFC 文件。
 *
 * 不抛错：缺几何的零件记进 `warnings`，其余照常导出——「能打开一部分」比「整份失败」有用。
 */
export function writeIfc(plan: ExtrusionPlan, meta: IfcMeta): IfcFile {
  const spf = new Spf()
  const stamp = timestampOf(meta)
  const warnings: string[] = []
  const organizationName = meta.organization ?? 'Addzero'
  const author = meta.author ?? 'micro-admin'

  const person = spf.add('IFCPERSON', null, null, text(author), null, null, null, null, null)
  const organization = spf.add('IFCORGANIZATION', null, text(organizationName), null, null, null)
  const personOrg = spf.add('IFCPERSONANDORGANIZATION', person, organization, null)
  const application = spf.add('IFCAPPLICATION', organization, text('0.1.0'), text('@addzero/ifc-canvas'), text('IFCCANVAS'))
  const ownerHistory = spf.add(
    'IFCOWNERHISTORY',
    personOrg,
    application,
    null,
    enumValue('ADDED'),
    null,
    null,
    null,
    intValue(stamp),
  )

  const lengthUnit = spf.add('IFCSIUNIT', '*', enumValue('LENGTHUNIT'), enumValue('MILLI'), enumValue('METRE'))
  const areaUnit = spf.add('IFCSIUNIT', '*', enumValue('AREAUNIT'), null, enumValue('SQUARE_METRE'))
  const volumeUnit = spf.add('IFCSIUNIT', '*', enumValue('VOLUMEUNIT'), null, enumValue('CUBIC_METRE'))
  const angleUnit = spf.add('IFCSIUNIT', '*', enumValue('PLANEANGLEUNIT'), null, enumValue('RADIAN'))
  const unitAssignment = spf.add('IFCUNITASSIGNMENT', list([lengthUnit, areaUnit, volumeUnit, angleUnit]))

  const worldOrigin = spf.add('IFCCARTESIANPOINT', list([real(0), real(0), real(0)]))
  const zAxis = spf.add('IFCDIRECTION', list([real(0), real(0), real(1)]))
  const xAxis = spf.add('IFCDIRECTION', list([real(1), real(0), real(0)]))
  const worldPlacement = spf.add('IFCAXIS2PLACEMENT3D', worldOrigin, zAxis, xAxis)
  const modelContext = spf.add(
    'IFCGEOMETRICREPRESENTATIONCONTEXT',
    null,
    text('Model'),
    intValue(3),
    real(1e-5),
    worldPlacement,
    null,
  )
  const bodyContext = spf.add(
    'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
    text('Body'),
    text('Model'),
    '*',
    '*',
    '*',
    '*',
    modelContext,
    null,
    enumValue('MODEL_VIEW'),
    null,
  )

  const project = spf.add(
    'IFCPROJECT',
    spf.guid(`project:${meta.name}`),
    ownerHistory,
    label(meta.name),
    label('由组态画面导出的 IFC4 模型'),
    null,
    null,
    null,
    list([modelContext]),
    unitAssignment,
  )

  const sitePlacement = spf.add('IFCLOCALPLACEMENT', null, worldPlacement)
  const site = spf.add(
    'IFCSITE',
    spf.guid('site'),
    ownerHistory,
    text('Site'),
    null,
    null,
    sitePlacement,
    null,
    null,
    enumValue('ELEMENT'),
    null,
    null,
    null,
    null,
    null,
  )
  const buildingPlacement = spf.add('IFCLOCALPLACEMENT', sitePlacement, worldPlacement)
  const building = spf.add(
    'IFCBUILDING',
    spf.guid('building'),
    ownerHistory,
    text('Building'),
    null,
    null,
    buildingPlacement,
    null,
    null,
    enumValue('ELEMENT'),
    null,
    null,
    null,
  )
  const storeyPlacement = spf.add('IFCLOCALPLACEMENT', buildingPlacement, worldPlacement)
  const storey = spf.add(
    'IFCBUILDINGSTOREY',
    spf.guid('storey'),
    ownerHistory,
    text('Level 0'),
    null,
    null,
    storeyPlacement,
    null,
    null,
    enumValue('ELEMENT'),
    real(0),
  )

  spf.add('IFCRELAGGREGATES', spf.guid('rel:project-site'), ownerHistory, null, null, project, list([site]))
  spf.add('IFCRELAGGREGATES', spf.guid('rel:site-building'), ownerHistory, null, null, site, list([building]))
  spf.add('IFCRELAGGREGATES', spf.guid('rel:building-storey'), ownerHistory, null, null, building, list([storey]))

  const ctx: Ctx = {
    spf,
    ownerHistory,
    storey,
    subContext: bodyContext,
    zAxis,
    xAxis,
    elements: [],
    warnings,
    solids: 0,
    facade: plan.settings.projection === 'facade',
  }

  for (const item of plan.items) {
    if (!item.decision) {
      if (item.shape !== 'text') warnings.push(`${item.widgetName}/${item.partId}：缺少 3D 参数，未生成实体`)
      continue
    }
    const decision = item.decision
    if (decision.form === 'decal' || decision.form === 'skip') continue
    const shape = shapeOf(ctx, item, decision)
    if (!shape) {
      warnings.push(`${item.widgetName}/${item.partId}：轮廓不可用（${item.shape}），未生成实体`)
      continue
    }

    const identity = spf.add('IFCAXIS2PLACEMENT3D', worldOrigin, null, null)
    const placement = spf.add('IFCLOCALPLACEMENT', storeyPlacement, identity)
    const entity = ifcEntityOf(decision.role, item.symbolKey, item.shape)
    const element = spf.add(entity, ...entityParams(entity, spf.guid(`element:${item.widgetId}:${item.partId}`), ownerHistory, item, placement, shape))
    ctx.elements.push(element)

    const pset = propertySet(ctx, ownerHistory, 'Pset_AddzeroPart', [
      { name: 'SourceWidgetId', type: 'IFCLABEL', value: textValue(item.widgetId) },
      { name: 'SourcePartId', type: 'IFCLABEL', value: textValue(item.partId) },
      { name: 'SymbolKey', type: 'IFCLABEL', value: textValue(item.symbolKey) },
      { name: 'PartRole', type: 'IFCLABEL', value: textValue(decision.role) },
      { name: 'SolidForm', type: 'IFCLABEL', value: textValue(decision.form) },
      { name: 'ExtrusionDepthMm', type: 'IFCREAL', value: realValue(decision.depth) },
      { name: 'ElevationMm', type: 'IFCREAL', value: realValue(decision.elevation) },
      { name: 'MaterialLabel', type: 'IFCLABEL', value: textValue(MATERIAL_LABEL[decision.material]) },
      { name: 'DecisionSource', type: 'IFCLABEL', value: textValue(decision.source) },
    ])
    spf.add('IFCRELDEFINESBYPROPERTIES', spf.guid(`rel:pset:${item.widgetId}:${item.partId}`), ownerHistory, null, null, list([element]), pset)
  }

  if (ctx.elements.length) {
    spf.add(
      'IFCRELCONTAINEDINSPATIALSTRUCTURE',
      spf.guid('rel:storey-elements'),
      ownerHistory,
      null,
      null,
      list(ctx.elements),
      storey,
    )
  } else {
    warnings.push('画面没有任何可出实体的图元，IFC 里只有空间结构')
  }

  // 2D↔3D 对齐声明：换算比例、原点策略、向上轴、画面尺寸全写进属性集。
  const alignment = propertySet(ctx, ownerHistory, 'Pset_AddzeroScreen', [
    { name: 'ScreenName', type: 'IFCLABEL', value: textValue(plan.screenName) },
    { name: 'ScreenId', type: 'IFCINTEGER', value: intValue(meta.screenId ?? 0) },
    { name: 'ProjectId', type: 'IFCINTEGER', value: intValue(meta.projectId ?? 0) },
    { name: 'DocumentVersion', type: 'IFCINTEGER', value: intValue(meta.documentVersion ?? 1) },
    { name: 'CanvasWidthMm', type: 'IFCREAL', value: realValue(plan.canvas.widthMm) },
    { name: 'CanvasHeightMm', type: 'IFCREAL', value: realValue(plan.canvas.heightMm) },
    { name: 'Projection', type: 'IFCLABEL', value: textValue(plan.settings.projection) },
    { name: 'PixelsPerMeter', type: 'IFCREAL', value: realValue(plan.settings.pixelsPerMeter) },
    { name: 'LengthUnit', type: 'IFCLABEL', value: textValue(plan.settings.unit) },
    { name: 'UpAxis', type: 'IFCLABEL', value: textValue(plan.settings.up) },
    { name: 'OriginMode', type: 'IFCLABEL', value: textValue(plan.settings.origin) },
    { name: 'Alignment', type: 'IFCLABEL', value: textValue(ALIGNMENT_TAG) },
    { name: 'ExportedAt', type: 'IFCLABEL', value: textValue(isoStamp(stamp)) },
  ])
  spf.add('IFCRELDEFINESBYPROPERTIES', spf.guid('rel:pset:screen'), ownerHistory, null, null, list([building]), alignment)

  const fileName = `${plan.screenName.replace(/[\\/:*?"<>|]/g, '_') || 'scada-screen'}.ifc`
  const header = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION((${text(`ViewDefinition [${VIEW_DEFINITION}]`)},${text(ALIGNMENT_TAG)}),'2;1');`,
    `FILE_NAME(${text(fileName)},${text(isoStamp(stamp))},(${text(author)}),(${text(organizationName)}),'ifc-canvas 0.1.0','@addzero/ifc-canvas','');`,
    `FILE_SCHEMA((${text(SCHEMA)}));`,
    'ENDSEC;',
    '',
    'DATA;',
  ].join('\n')

  const content = `${header}\n${spf.join()}\nENDSEC;\n\nEND-ISO-10303-21;\n`

  return {
    filename: fileName,
    content,
    stats: {
      // 用 TextEncoder 而不是 Buffer：本包也要能在浏览器里跑（前端预览/导出）。
      bytes: new TextEncoder().encode(content).length,
      entities: spf.size,
      elements: ctx.elements.length,
      solids: ctx.solids,
    },
    warnings,
  }
}

/** 供前端预览用：把计划里的轮廓换算回画面像素，画轴测图时不需要再求值一次。 */
export function planOutlines(plan: ExtrusionPlan): Array<{ key: string; points: Point2[]; elevation: number; depth: number }> {
  return plan.items
    .filter((item) => item.outline && item.decision && item.decision.form !== 'decal' && item.decision.form !== 'skip')
    .map((item) => ({
      key: `${item.widgetId}/${item.partId}`,
      points: item.outline as Point2[],
      elevation: item.decision?.elevation ?? 0,
      depth: item.decision?.depth ?? 0,
    }))
}

/** 复用一次几何求值，避免调用方自己再拼参数。 */
export function outlineOfPart(item: PlanItem, scale: number, canvasHeight: number): Point2[] | null {
  if (item.outline) return item.outline
  const raw = outlineOf(
    { id: item.partId, shape: item.shape, rect: item.rect },
    { scale, canvasHeight, origin: 'bottom-left' },
  )
  return raw?.points ?? null
}
