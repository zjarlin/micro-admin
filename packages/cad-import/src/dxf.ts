// DXF 解析：只认「画图需要的那一部分」。
//
// 为什么自己写而不引依赖：DXF 是 `组码 / 值` 的文本流，几何部分（ENTITIES + BLOCKS）
// 的读取规则非常稳定；引一个图形库进来，产物体积与许可证都变成新问题，
// 而这里真正要的是「把实体摊平成折线/圆/文字」，不是 CAD 内核。
//
// 支持的实体：LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / TEXT / MTEXT /
// POINT / INSERT（含嵌套块，按递归深度与次数上限保护）。其余实体（HATCH、DIMENSION、
// SPLINE…）直接跳过并记一条 warning——导入组态画面不需要它们，报错反而挡住正常图纸。
//
// 两个容易踩的坑（都已在实现里处理）：
// 1. **组码 70 是按位标记**，`70 = 1` 是闭合、`70 = 128` 才是「有 bulge」。把 70 当布尔读会把
//    带弧的多段线判成闭合；这里逐位判断。
// 2. **LWPOLYLINE 的 bulge 跟随在顶点之后**（组码 42），漏读就把圆角管道画成直角。
import type { CadDrawing, CadEntity, CadLayer, CadPoint, CadUnit } from './types.ts'
import {
  arcPoints,
  applyTransform,
  expandPolyline,
  ellipsePoints,
  extentsOf,
  IDENTITY,
  MAX_BLOCK_DEPTH,
  MAX_INSERT_EXPANSIONS,
  plainCadText,
  type Transform,
} from './geometry.ts'

interface Pair {
  code: number
  value: string
}

const UNIT_MAP: Record<string, CadUnit> = {
  '0': 'unitless',
  '1': 'inch',
  '2': 'foot',
  '4': 'mm',
  '5': 'cm',
  '6': 'm',
}

/** DXF 是行对格式：偶数行组码、奇数行值。整份切分成对，后续按段消费。 */
function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/)
  const pairs: Pair[] = []
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number((lines[index] ?? '').trim())
    if (!Number.isFinite(code)) continue
    pairs.push({ code, value: lines[index + 1] ?? '' })
  }
  return pairs
}

function num(pairs: Pair[], index: number): number {
  const value = Number((pairs[index]?.value ?? '').trim())
  return Number.isFinite(value) ? value : 0
}

/**
 * 把 `pairs` 按 `0 <TYPE>` 切成记录：每条记录从 `0/SECTION|ENTITIES|...` 起，到下一个 `0/...` 止。
 * 返回 `[类型, 起始下标, 结束下标)`，调用方按需再取字段。
 */
function records(pairs: Pair[]): Array<{ type: string; start: number; end: number }> {
  const out: Array<{ type: string; start: number; end: number }> = []
  let current: { type: string; start: number; end: number } | null = null
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index] as Pair
    if (pair.code !== 0) continue
    if (current) {
      current.end = index
      out.push(current)
    }
    current = { type: pair.value.trim().toUpperCase(), start: index, end: pairs.length }
  }
  if (current) out.push(current)
  return out
}

/** 取记录里第一个指定组码的数值。 */
function firstNum(pairs: Pair[], record: { start: number; end: number }, code: number, fallback = 0): number {
  for (let index = record.start; index < record.end; index += 1) {
    if ((pairs[index] as Pair).code === code) return num(pairs, index)
  }
  return fallback
}

function firstText(pairs: Pair[], record: { start: number; end: number }, code: number, fallback = ''): string {
  for (let index = record.start; index < record.end; index += 1) {
    const pair = pairs[index] as Pair
    if (pair.code === code) return pair.value
  }
  return fallback
}

/** 解析 `$INSUNITS` 与版本，用于「单位提示」，不参与几何。 */
function readHeader(pairs: Pair[]): { version: string; units: CadUnit } {
  let version = ''
  let units: CadUnit = 'unitless'
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index] as Pair
    if (pair.code === 9 && pair.value.trim() === '$ACADVER') version = firstText(pairs, { start: index, end: index + 3 }, 1)
    if (pair.code === 9 && pair.value.trim() === '$INSUNITS') units = UNIT_MAP[String(firstNum(pairs, { start: index, end: index + 3 }, 70, 0))] ?? 'other'
    // 到 ENTITIES 段就停：头部之后的内容没必要再扫。
    if (pair.code === 0 && pair.value.trim().toUpperCase() === 'ENTITIES') break
  }
  return { version, units }
}

function readLayers(pairs: Pair[]): CadLayer[] {
  const out: CadLayer[] = []
  for (const record of records(pairs)) {
    if (record.type !== 'LAYER') continue
    const name = firstText(pairs, record, 2, '').trim()
    if (!name) continue
    // 70 同样是位标记：1 = 冻结。
    const flags = firstNum(pairs, record, 70, 0)
    const color = firstNum(pairs, record, 62, 7)
    out.push({
      name,
      // 负色号表示「图层已关闭」，这是 DXF 的约定写法。
      visible: color >= 0 && (flags & 1) === 0,
      color,
      frozen: (flags & 1) !== 0,
    })
  }
  return out
}

// ---------------- 块表（INSERT 展开） ----------------

interface BlockDef {
  base: CadPoint
  /** 块内实体（尚未套用变换）。 */
  entities: Array<{ type: string; start: number; end: number }>
}

function readBlocks(pairs: Pair[]): Map<string, BlockDef> {
  const blocks = new Map<string, BlockDef>()
  let current: BlockDef | null = null
  let name = ''
  for (const record of records(pairs)) {
    if (record.type === 'BLOCK') {
      name = firstText(pairs, record, 2, '').trim()
      current = {
        base: { x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) },
        entities: [],
      }
      continue
    }
    if (record.type === 'ENDBLK') {
      if (current && name) blocks.set(name, current)
      current = null
      name = ''
      continue
    }
    if (current && record.type !== 'BLOCK' && record.type !== 'ENDBLK') current.entities.push(record)
  }
  return blocks
}

// ---------------- 实体读取 ----------------

interface EmitContext {
  pairs: Pair[]
  blocks: Map<string, BlockDef>
  entities: CadEntity[]
  warnings: string[]
  expansions: { count: number }
  skipped: Map<string, number>
}

function emit(ctx: EmitContext, record: { type: string; start: number; end: number }, transform: Transform, depth: number, layerOverride: string): void {
  const { pairs } = ctx
  const layer = (layerOverride || firstText(pairs, record, 8, '0')).trim() || '0'
  switch (record.type) {
    case 'LINE': {
      const a = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const b = applyTransform({ x: firstNum(pairs, record, 11), y: firstNum(pairs, record, 21) }, transform)
      ctx.entities.push({ kind: 'line', layer, a, b })
      return
    }
    case 'LWPOLYLINE': {
      // 70 是位标记：1 = 闭合。顶点是成对出现的 10/20，42 是该顶点**出发段**的凸度。
      const flags = firstNum(pairs, record, 70, 0)
      const closed = (flags & 1) === 1
      const vertices: Array<{ point: CadPoint; bulge: number }> = []
      let pending: { point: CadPoint; bulge: number } | null = null
      for (let index = record.start; index < record.end; index += 1) {
        const pair = pairs[index] as Pair
        if (pair.code === 10) {
          if (pending) vertices.push(pending)
          pending = { point: { x: num(pairs, index), y: 0 }, bulge: 0 }
          continue
        }
        if (pair.code === 20 && pending) {
          pending.point.y = num(pairs, index)
          continue
        }
        if (pair.code === 42 && pending) {
          pending.bulge = num(pairs, index)
        }
      }
      if (pending) vertices.push(pending)
      const transformed = expandPolyline(vertices).map((point) => applyTransform(point, transform))
      if (transformed.length >= 2) ctx.entities.push({ kind: 'polyline', layer, closed, points: transformed })
      return
    }
    case 'POLYLINE': {
      // 老式 POLYLINE：顶点是随后的 VERTEX 记录，闭合标记在 POLYLINE 的 70 上，
      // 每段凸度在 VERTEX 自己的 42 上（同样属于「从该顶点出发」的那一段）。
      const flags = firstNum(pairs, record, 70, 0)
      const closed = (flags & 1) === 1
      const vertices: Array<{ point: CadPoint; bulge: number }> = []
      let cursor = record.end
      while (cursor < pairs.length) {
        const pair = pairs[cursor] as Pair
        if (pair.code !== 0) {
          cursor += 1
          continue
        }
        if (pair.value.trim().toUpperCase() !== 'VERTEX') break
        let x = 0
        let y = 0
        let bulge = 0
        for (let index = cursor; index < pairs.length; index += 1) {
          const item = pairs[index] as Pair
          if (index > cursor && item.code === 0) break
          if (item.code === 10) x = num(pairs, index)
          if (item.code === 20) y = num(pairs, index)
          if (item.code === 42) bulge = num(pairs, index)
        }
        vertices.push({ point: { x, y }, bulge })
        // 跳过这条 VERTEX 记录
        cursor += 1
        while (cursor < pairs.length && (pairs[cursor] as Pair).code !== 0) cursor += 1
      }
      const points = expandPolyline(vertices).map((point) => applyTransform(point, transform))
      if (points.length >= 2) ctx.entities.push({ kind: 'polyline', layer, closed, points })
      return
    }
    case 'CIRCLE': {
      const center = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const radius = firstNum(pairs, record, 40) * Math.abs(transform.scaleX || 1)
      if (radius > 0) ctx.entities.push({ kind: 'circle', layer, center, radius })
      return
    }
    case 'ARC': {
      const center = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const radius = firstNum(pairs, record, 40) * Math.abs(transform.scaleX || 1)
      const start = firstNum(pairs, record, 50) + transform.rotation
      const end = firstNum(pairs, record, 51) + transform.rotation
      if (radius <= 0) return
      // 弧不单独成图元：折成开放折线，交给归类层判断是「管道拐弯」还是「圆弧轮廓」。
      ctx.entities.push({ kind: 'polyline', layer, closed: false, points: arcPoints(center, radius, start, end) })
      return
    }
    case 'ELLIPSE': {
      const center = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const major = { x: firstNum(pairs, record, 11), y: firstNum(pairs, record, 21) }
      const ratio = firstNum(pairs, record, 40, 1)
      // 组码 41/42 是**参数角（弧度）**，不是度：DXF 里椭圆和圆弧的单位不一样。
      const start = firstNum(pairs, record, 41, 0)
      const end = firstNum(pairs, record, 42, Math.PI * 2)
      const full = Math.abs(end - start) >= Math.PI * 2 - 1e-6
      if (full) {
        ctx.entities.push({ kind: 'circle', layer, center, radius: Math.hypot(major.x, major.y) })
        return
      }
      const points = ellipsePoints(center, major, ratio, start, end)
        .map((point) => applyTransform(point, { ...transform, dx: 0, dy: 0 }))
      ctx.entities.push({ kind: 'polyline', layer, closed: false, points })
      return
    }
    case 'TEXT':
    case 'MTEXT': {
      const raw = record.type === 'TEXT' ? firstText(pairs, record, 1, '') : firstText(pairs, record, 1, '')
      const text = record.type === 'MTEXT' ? plainCadText(raw) : raw.trim()
      if (!text) return
      const at = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const height = (firstNum(pairs, record, 40, 2.5) || 2.5) * Math.abs(transform.scaleY || 1)
      const rotation = firstNum(pairs, record, 50, 0) + transform.rotation
      ctx.entities.push({ kind: 'text', layer, at, height, text, rotation })
      return
    }
    case 'POINT': {
      const at = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      ctx.entities.push({ kind: 'point', layer, at })
      return
    }
    case 'INSERT': {
      if (depth >= MAX_BLOCK_DEPTH) {
        ctx.warnings.push(`块引用嵌套超过 ${MAX_BLOCK_DEPTH} 层，已停止展开`)
        return
      }
      if (ctx.expansions.count >= MAX_INSERT_EXPANSIONS) return
      const name = firstText(pairs, record, 2, '').trim()
      const block = ctx.blocks.get(name)
      if (!block) {
        ctx.warnings.push(`块 "${name}" 不在 BLOCKS 段里（可能是外部参照），已跳过`)
        return
      }
      ctx.expansions.count += 1
      const insert = applyTransform({ x: firstNum(pairs, record, 10), y: firstNum(pairs, record, 20) }, transform)
      const scaleX = (firstNum(pairs, record, 41, 1) || 1) * (transform.scaleX || 1)
      const scaleY = (firstNum(pairs, record, 42, 1) || 1) * (transform.scaleY || 1)
      const rotation = firstNum(pairs, record, 50, 0) + transform.rotation
      const child: Transform = {
        dx: insert.x,
        dy: insert.y,
        scaleX,
        scaleY,
        rotation,
      }
      // 块内坐标相对块基点：先减基点再变换。
      const shifted: Transform = { ...child, dx: child.dx - block.base.x * scaleX, dy: child.dy - block.base.y * scaleY }
      for (const entity of block.entities) emit(ctx, entity, shifted, depth + 1, layer)
      return
    }
    default: {
      const type = record.type
      ctx.skipped.set(type, (ctx.skipped.get(type) ?? 0) + 1)
    }
  }
}

/**
 * 二进制格式探测：DWG 魔数 / 二进制 DXF 头。
 *
 * 只看**字节**，不看扩展名：用户把 `.dwg` 改名成 `.dxf`、或者浏览器给的 MIME 不准都很常见，
 * 而 `AC10xx` 后面跟着 6 个保留字节是 DWG 的固定头部，不可能出现在 ASCII DXF 里
 * （ASCII DXF 第 1 个字符一定是组码）。
 *
 * 注意这里不能对文本做 `trimStart()` 后再判 `^\0`：`AC1015\0\0` 的第 1 个字符是 `A`，
 * 那种写法永远不成立，真实 DWG 会一路落到「没有 ENTITIES 段」的误导性报错。
 */
export type CadFileFormat = 'dxf' | 'dwg' | 'binary-dxf'

export function detectCadFormat(bytes: Uint8Array): CadFileFormat {
  // 头部最长要判 18 个字符（`AutoCAD Binary DXF`），别只取 16 字节。
  const head = bytes.subarray(0, 20)
  const ascii = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to))
  if (/^AC10\d{2}$/.test(ascii(0, 6))) return 'dwg'
  if (ascii(0, 18) === 'AutoCAD Binary DXF') return 'binary-dxf'
  return 'dxf'
}

/**
 * 解析一份 DXF 文本。
 *
 * 二进制 DWG 会在这里被识别并给出可读错误（`EOF`/魔数），而不是抛一个看不懂的异常：
 * 用户丢进来的多数是 `.dwg`，提示「请另存为 DXF」比让页面白屏有用。
 */
export function parseDxf(text: string): CadDrawing {
  const head = text.slice(0, 18)
  if (/^AC10\d{2}/.test(head)) {
    throw new Error('这是二进制 DWG（不是 DXF 文本）：请在 CAD 里「另存为 DXF（R2000 及以上）」再导入')
  }
  if (head.startsWith('AutoCAD Binary DXF')) {
    throw new Error('这是二进制 DXF：请另存为 ASCII DXF 再导入')
  }
  const pairs = pairsOf(text)
  if (pairs.length === 0) throw new Error('文件里没有 DXF 组码：确认这是 ASCII DXF 文本文件')

  const header = readHeader(pairs)
  const layers = readLayers(pairs)
  const blocks = readBlocks(pairs)

  const ctx: EmitContext = { pairs, blocks, entities: [], warnings: [], expansions: { count: 0 }, skipped: new Map() }
  let raw = 0
  // 段名在 SECTION 记录自己的 `2` 组码上；只解析 ENTITIES 段，
  // 否则 BLOCKS 段里的块内实体会被当成图纸实体再画一遍（同一根管出现两次）。
  let section = ''
  for (const record of records(pairs)) {
    if (record.type === 'SECTION') {
      section = firstText(pairs, record, 2, '').trim().toUpperCase()
      continue
    }
    if (record.type === 'ENDSEC') {
      section = ''
      continue
    }
    if (section !== 'ENTITIES') continue
    if (record.type === 'TABLE' || record.type === 'ENDTAB') continue
    raw += 1
    emit(ctx, record, IDENTITY, 0, '')
  }

  if (raw === 0) {
    throw new Error('DXF 里没有 ENTITIES 段（可能只存了块表）：请在 CAD 里重新导出整张图纸')
  }

  for (const [type, count] of ctx.skipped) {
    ctx.warnings.push(`跳过 ${count} 个 ${type}（组态画面用不到这类实体）`)
  }

  return {
    version: header.version,
    units: header.units,
    layers,
    entities: ctx.entities,
    extents: extentsOf(ctx.entities),
    warnings: ctx.warnings,
    stats: { raw, expanded: ctx.entities.length, blocks: blocks.size },
  }
}
