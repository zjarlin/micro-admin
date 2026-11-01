// DWG（二进制）→ 组态图元。
//
// 为什么需要第三方库：DWG 是带压缩/加密段落的二进制格式，没有可自写的公开规范，
// 唯一可用的开源实现是 GNU LibreDWG。这里用的是它的 WASM 移植
// `@mlightcad/libredwg-web`（GPL-3.0），因此：
//
// 1. **只在这条链上出现**：`dxf.ts` 与 `symbolize.ts` 完全不依赖它，不装这个可选依赖时
//    DXF 导入照常工作；`dwg.ts` 只在遇到 `.dwg` 时被动态 `import()`。
// 2. **不做 DWG → DXF 文本转换**：该库的 `dwg_write_dxf` 在这个 wasm 构建里是坏的
//    （实测 `function signature mismatch`），所以直接把它的 `DwgDatabase` 适配成
//    与 DXF 解析同形状的 `CadEntity[]`，下游（symbolize / 指令集 / 摘要）一份代码。
// 3. **单位统一在边界上换**：libredwg 的圆弧/椭圆角度与 `INSERT.rotation` 是**弧度**，
//    而 DXF 是度。这里换算成度再交给 `geometry.ts`，下游只认度。
import type { CadDrawing, CadEntity, CadLayer, CadPoint, CadUnit } from './types.ts'
import {
  applyTransform,
  arcPoints,
  DEG_PER_RAD,
  ellipsePoints,
  expandPolyline,
  extentsOf,
  IDENTITY,
  MAX_BLOCK_DEPTH,
  MAX_INSERT_EXPANSIONS,
  plainCadText,
  type Transform,
} from './geometry.ts'

// ---------------- 只用到的字段形状（不引库的类型，避免可选依赖进类型检查） ----------------

interface P3 {
  x: number
  y: number
  z?: number
}

interface RawEntity {
  type: string
  handle?: string
  layer?: string
  [key: string]: unknown
}

interface RawLayer {
  name: string
  colorIndex?: number
  frozen?: boolean
  off?: boolean
}

interface RawBlock {
  name: string
  basePoint?: P3
  entities?: RawEntity[]
}

/** `DwgDatabase` 里本模块真正读到的部分。 */
export interface DwgDatabaseLike {
  header?: { ACADVER?: string; INSUNITS?: number }
  version?: { hdr?: string }
  entities?: RawEntity[]
  tables?: {
    BLOCK_RECORD?: { entries?: RawBlock[] }
    LAYER?: { entries?: RawLayer[] }
  }
}

/** `dwg_get_version_type()` 的结果（库里的 `DwgVersion`）。 */
export interface DwgVersionLike {
  hdr?: string
  type?: string
  description?: string
}

const UNIT_MAP: Record<string, CadUnit> = {
  '0': 'unitless',
  '1': 'inch',
  '2': 'foot',
  '4': 'mm',
  '5': 'cm',
  '6': 'm',
}

/** 模型空间块名：`*Model_Space`（R2000+）与 `*MODEL_SPACE`（更早版本）都见过。 */
const MODEL_SPACE_NAMES = ['*Model_Space', '*MODEL_SPACE']

/** 这些实体只挂在块引用上或只属于视口配置，不能当成图纸实体再画一遍。 */
const STRUCTURAL_TYPES = new Set(['ATTRIB', 'ATTDEF', 'VIEWPORT', 'SEQEND', 'VERTEX'])

function point(source: P3 | undefined): CadPoint {
  return { x: source?.x ?? 0, y: source?.y ?? 0 }
}

function textOf(entity: RawEntity): string {
  const value = entity.text
  if (typeof value === 'string') return value
  // ATTRIB 的形状是 `{ text: { text, startPoint, ... } }`：正文嵌在子对象里。
  const nested = value as { text?: unknown } | undefined
  return typeof nested?.text === 'string' ? nested.text : ''
}

/** ATTRIB 的几何也嵌在 `text` 子对象里，需要按子对象的字段读。 */
function attribGeometry(entity: RawEntity): { at: P3; height: number; rotation: number } | null {
  const nested = entity.text as { startPoint?: P3; textHeight?: number; rotation?: number } | undefined
  if (!nested || typeof nested !== 'object') return null
  return { at: nested.startPoint ?? { x: 0, y: 0 }, height: nested.textHeight ?? 0, rotation: nested.rotation ?? 0 }
}

/**
 * 把一份 DWG 数据库适配成与 DXF 同形状的 `CadDrawing`。
 *
 * 不吃原始字节、也不碰 wasm：调用方（`dwg-reader.ts`）负责把文件读成 `DwgDatabase`，
 * 因此这个函数是纯函数，可以脱离 wasm 单测/复用。
 */
export function dwgToDrawing(db: DwgDatabaseLike, version?: DwgVersionLike): CadDrawing {
  const blocks = new Map<string, { base: CadPoint; entities: RawEntity[] }>()
  for (const record of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!record?.name) continue
    blocks.set(record.name, { base: point(record.basePoint), entities: record.entities ?? [] })
  }

  const entities: CadEntity[] = []
  const warnings: string[] = []
  const skipped = new Map<string, number>()
  const expansions = { count: 0 }
  let raw = 0

  const skip = (type: string): void => {
    skipped.set(type, (skipped.get(type) ?? 0) + 1)
  }

  const emit = (entity: RawEntity, transform: Transform, depth: number, layerOverride: string): void => {
    const layer = (layerOverride || entity.layer || '0').trim() || '0'
    switch (entity.type) {
      case 'LINE': {
        const a = applyTransform(point(entity.startPoint as P3), transform)
        const b = applyTransform(point(entity.endPoint as P3), transform)
        entities.push({ kind: 'line', layer, a, b })
        return
      }
      case 'LWPOLYLINE': {
        // 70 是位标记：1 = 闭合、128 = 有 bulge（这里按顶点上的 bulge 值处理，不看这一位）。
        const closed = (Number(entity.flag ?? 0) & 1) === 1
        const vertices = (entity.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined) ?? []
        const points = expandPolyline(vertices.map((vertex) => ({
          point: { x: vertex.x, y: vertex.y },
          bulge: vertex.bulge ?? 0,
        })))
        const transformed = points.map((item) => applyTransform(item, transform))
        if (transformed.length >= 2) entities.push({ kind: 'polyline', layer, closed, points: transformed })
        return
      }
      case 'POLYLINE2D':
      case 'POLYLINE3D': {
        const closed = (Number(entity.flag ?? 0) & 1) === 1
        const vertices = (entity.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined) ?? []
        const points = expandPolyline(vertices.map((vertex) => ({
          point: { x: vertex.x, y: vertex.y },
          bulge: vertex.bulge ?? 0,
        }))).map((item) => applyTransform(item, transform))
        if (points.length >= 2) entities.push({ kind: 'polyline', layer, closed, points })
        return
      }
      case 'CIRCLE': {
        const radius = Number(entity.radius ?? 0) * Math.abs(transform.scaleX || 1)
        if (radius > 0) entities.push({ kind: 'circle', layer, center: applyTransform(point(entity.center as P3), transform), radius })
        return
      }
      case 'ARC': {
        const radius = Number(entity.radius ?? 0) * Math.abs(transform.scaleX || 1)
        if (radius <= 0) return
        // libredwg 给的是弧度：换算成度，并把块旋转叠加上去。
        const center = applyTransform(point(entity.center as P3), transform)
        const start = Number(entity.startAngle ?? 0) * DEG_PER_RAD + transform.rotation
        const end = Number(entity.endAngle ?? 0) * DEG_PER_RAD + transform.rotation
        // 弧不单独成图元：折成开放折线，交给归类层判断是「管道拐弯」还是「圆弧轮廓」。
        entities.push({ kind: 'polyline', layer, closed: false, points: arcPoints(center, radius, start, end) })
        return
      }
      case 'ELLIPSE': {
        const center = applyTransform(point(entity.center as P3), transform)
        const major = point(entity.majorAxisEndPoint as P3)
        const ratio = Number(entity.axisRatio ?? 1)
        const start = Number(entity.startAngle ?? 0)
        const end = Number(entity.endAngle ?? Math.PI * 2)
        if (Math.abs(end - start) >= Math.PI * 2 - 1e-6) {
          entities.push({ kind: 'circle', layer, center, radius: Math.hypot(major.x, major.y) })
          return
        }
        const points = ellipsePoints(center, major, ratio, start, end)
          .map((item) => applyTransform(item, { ...transform, dx: 0, dy: 0 }))
        entities.push({ kind: 'polyline', layer, closed: false, points })
        return
      }
      case 'TEXT':
      case 'MTEXT': {
        const text = entity.type === 'MTEXT' ? plainCadText(textOf(entity)) : textOf(entity).trim()
        if (!text) return
        const at = applyTransform(point((entity.type === 'MTEXT' ? entity.insertionPoint : entity.startPoint) as P3), transform)
        const height = (Number(entity.textHeight ?? 0) || 2.5) * Math.abs(transform.scaleY || 1)
        // MTEXT 的 rotation 是**弧度**，TEXT 的是度（libredwg 两个转换分支不一致，实测确认）。
        const own = entity.type === 'MTEXT' ? Number(entity.rotation ?? 0) * DEG_PER_RAD : Number(entity.rotation ?? 0)
        entities.push({ kind: 'text', layer, at, height, text, rotation: own + transform.rotation })
        return
      }
      case 'POINT': {
        entities.push({ kind: 'point', layer, at: applyTransform(point(entity.position as P3), transform) })
        return
      }
      case 'INSERT': {
        if (depth >= MAX_BLOCK_DEPTH) {
          warnings.push(`块引用嵌套超过 ${MAX_BLOCK_DEPTH} 层，已停止展开`)
          return
        }
        if (expansions.count >= MAX_INSERT_EXPANSIONS) return
        const name = String(entity.name ?? '').trim()
        const block = blocks.get(name)
        if (!block) {
          warnings.push(`块 "${name}" 不在块表里（可能是外部参照），已跳过`)
          return
        }
        expansions.count += 1
        const insert = applyTransform(point(entity.insertionPoint as P3), transform)
        const scaleX = (Number(entity.xScale ?? 0) || 1) * (transform.scaleX || 1)
        const scaleY = (Number(entity.yScale ?? 0) || 1) * (transform.scaleY || 1)
        // INSERT.rotation 也是弧度。
        const rotation = Number(entity.rotation ?? 0) * DEG_PER_RAD + transform.rotation
        // 块内坐标相对块基点：先减基点再变换（与 DXF 分支同一套规则）。
        const shifted: Transform = {
          dx: insert.x - block.base.x * scaleX,
          dy: insert.y - block.base.y * scaleY,
          scaleX,
          scaleY,
          rotation,
        }
        for (const child of block.entities) emit(child, shifted, depth + 1, layer)
        // 属性块的可见文字（尺寸/位号）也画出来：CAD 里它们就是图上的标注。
        //
        // **ATTRIB 的坐标是 libredwg 已经算好的世界坐标**（它按插入点/缩放/旋转把块属性定位过），
        // 再套一次块变换会变成「变换的变换」——实测把一条 100 高的属性文字放大到 3.4 亿高，
        // 整张图因此被撑爆、缩放比归零、几何全被丢弃。所以这里一律用 IDENTITY。
        for (const attrib of (entity.attribs as RawEntity[] | undefined) ?? []) {
          const geometry = attribGeometry(attrib)
          const text = textOf(attrib).trim()
          if (!geometry || !text) continue
          entities.push({
            kind: 'text',
            layer,
            at: applyTransform(point(geometry.at), transform),
            height: Math.abs(geometry.height || 2.5) * Math.abs(transform.scaleY || 1),
            text,
            rotation: geometry.rotation * DEG_PER_RAD + transform.rotation,
          })
        }
        return
      }
      default:
        skip(entity.type)
    }
  }

  // 实体来源优先取模型空间块：顶层 `db.entities` 会混进 ATTRIB / VIEWPORT，
  // 那些是块引用的附属物或视口配置，当成图纸实体会把同一行字画两遍。
  const model = MODEL_SPACE_NAMES.map((name) => blocks.get(name)).find((block) => block && block.entities.length > 0)
  const source = model?.entities ?? (db.entities ?? []).filter((entity) => !STRUCTURAL_TYPES.has(entity.type))
  for (const entity of source) {
    if (STRUCTURAL_TYPES.has(entity.type)) {
      skip(entity.type)
      continue
    }
    raw += 1
    emit(entity, IDENTITY, 0, '')
  }

  for (const [type, count] of skipped) {
    warnings.push(`跳过 ${count} 个 ${type}（组态画面用不到这类实体）`)
  }

  // 读出 0 个实体基本只有两种原因：文件损坏/加密，或版本太老（实测 LibreDWG 的 R14 样本
  // 直接返回 error 2048 且表全空）。抛出比返回一张空画面有用——空画面会被当成「导入成功」。
  if (raw === 0) {
    throw new Error(
      `DWG 里没有读到任何实体（版本 ${version?.hdr ?? '未知'}）：文件可能损坏、加密，或是 R13 之前的老版本；请在 CAD 里另存为 DXF 或较高版本 DWG 再导入`,
    )
  }

  const layers: CadLayer[] = (db.tables?.LAYER?.entries ?? [])
    .filter((layer) => typeof layer?.name === 'string' && layer.name !== '')
    .map((layer) => ({
      name: layer.name,
      visible: !layer.off && !layer.frozen,
      color: typeof layer.colorIndex === 'number' ? layer.colorIndex : null,
      frozen: Boolean(layer.frozen),
    }))

  return {
    version: version?.hdr ?? db.version?.hdr ?? db.header?.ACADVER ?? '',
    units: UNIT_MAP[String(db.header?.INSUNITS ?? 0)] ?? 'other',
    layers,
    entities,
    extents: extentsOf(entities),
    warnings,
    stats: { raw, expanded: entities.length, blocks: blocks.size },
  }
}
