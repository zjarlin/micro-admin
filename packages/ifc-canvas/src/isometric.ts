// 轴测预览：把 IFC 计划画成等轴测 SVG。
//
// 不引 three.js 也能看到「2D 画面立起来」的效果，服务端（缩略图、`/scada/ifc/preview`）
// 与浏览器（预览页）共用同一段代码，因此不依赖 DOM、WebGL 或图片解码。
//
// 世界坐标 → 屏幕：正交投影，相机绕 Z 轴转方位角、再抬仰角
//   rx = (x * cos(azimuth) - y * sin(azimuth)) * √2
//   ry = (x * sin(azimuth) + y * cos(azimuth)) * √2
//   screenX = rx * cos(angle)
//   screenY = ry * sin(angle) - z
// 默认方位角 45°、仰角 30° 时 rx=(x-y)、ry=(x+y)，即经典等轴测（与旧版逐像素一致）。
// 方位角可自由旋转（预览页拖动即绕 Z 轴轨道旋转），因此这是**真正的三维视角**，
// 不是一张固定角度的斜投影假 3D；坐标系、地面网格与坐标轴都在同一套世界坐标里画。
//
// 面片按重心深度排序（远的先画），对凸多面体足够，且输出是纯 path，方便做缩略图。

import type { ExtrusionPlan, PartRole, Point2 } from './types.ts'

export type Point3 = [number, number, number]

export interface IsoPart {
  key: string
  /** 近端环（画面一侧）。 */
  base: Point3[]
  /** 远端环（拉伸末端）。 */
  top: Point3[]
  role?: PartRole | undefined
  label?: string | undefined
  color?: string | undefined
}

export interface IsoOptions {
  /** 屏幕像素 / 毫米。默认 0.18：1920mm 宽的画面约 400px。 */
  scale?: number
  /** 仰角（弧度），默认 30°。 */
  angle?: number
  /** 绕 Z 轴的方位角（弧度），默认 45°（经典等轴测）。 */
  azimuth?: number
  padding?: number
  background?: string | null
  /** 是否画图元名称，默认 true（只在有 label 时）。 */
  labels?: boolean
  /** 背景板颜色：立面模式默认画一块画布底板，让「这一页」在 3D 里立得起来。 */
  backdrop?: string | null
  stroke?: string
  /** 地面网格：`true` 自动间距，数字表示毫米间距；默认关。 */
  grid?: boolean | number
  /** X / Y / Z 坐标轴与刻度（毫米）；默认关。 */
  axes?: boolean
  /** 地面板填充色；不传时随网格一起出现一块浅色地面。 */
  ground?: string | null
}

const ROLE_COLORS: Record<PartRole, string> = {
  structure: '#3f4a5f',
  panel: '#2b3446',
  instrument: '#2c3a52',
  machine: '#4a5a72',
  vessel: '#7b8798',
  pipe: '#5b6a80',
  label: '#1f2937',
}

/** 坐标轴配色：CAD 惯例（X 红 / Y 绿 / Z 蓝）。 */
const AXIS_COLORS = { x: '#f87171', y: '#4ade80', z: '#60a5fa' } as const

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** 固定配色微调：factor > 0 提亮，< 0 压暗。 */
function shade(hex: string, factor: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) return hex
  const value = Number.parseInt(match[1], 16)
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  const out = channels.map((channel) => {
    const next = factor >= 0 ? channel + (255 - channel) * factor : channel * (1 + factor)
    return Math.max(0, Math.min(255, Math.round(next)))
  })
  return `#${out.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** 深色填充在 3D 里会糊成一块黑，按亮度抬到最低可辨识灰度。 */
function lift(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) return hex
  const value = Number.parseInt(match[1], 16)
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  const luma = 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
  if (luma >= 46) return hex
  const mix = (46 - luma) / 255
  return `#${channels
    .map((channel) => Math.round(channel + (110 - channel) * mix).toString(16).padStart(2, '0'))
    .join('')}`
}

/** 把任意间距收成 1 / 2 / 5 × 10ⁿ，刻度标签才是人读的数字。 */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 100
  const power = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / power
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * power
}

interface Face {
  depth: number
  points: Array<[number, number]>
  fill: string
  stroke: string
}

interface Line {
  depth: number
  from: [number, number]
  to: [number, number]
  stroke: string
  width: number
  dash?: string | undefined
}

interface TextMark {
  x: number
  y: number
  text: string
  fill: string
  size: number
  anchor: 'start' | 'middle' | 'end'
  outline: boolean
}

interface WorldBounds {
  x0: number
  x1: number
  y0: number
  y1: number
  z0: number
  z1: number
}

function worldBounds(parts: readonly IsoPart[]): WorldBounds | null {
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const part of parts) {
    for (const [x, y, z] of [...part.base, ...part.top]) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (z < z0) z0 = z
      if (z > z1) z1 = z
    }
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1, z0, z1 } : null
}

/**
 * 轴测渲染。
 *
 * 宽高按实际内容裁剪（含地面网格与坐标轴），输出可直接塞进 `<img>`/缩略图卡片，
 * 也可内联进页面。
 */
export function renderIsometric(parts: IsoPart[], options: IsoOptions = {}): { svg: string; width: number; height: number } {
  const scale = options.scale ?? 0.18
  const angle = options.angle ?? Math.PI / 6
  const azimuth = options.azimuth ?? Math.PI / 4
  const padding = options.padding ?? 16
  const stroke = options.stroke ?? 'rgba(15,23,42,0.55)'
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const ca = Math.cos(azimuth)
  const sa = Math.sin(azimuth)
  // 方位角 45° 时把 (x∓y)/√2 还原成 (x∓y)：默认视角与旧版等轴测逐像素一致。
  const K = Math.SQRT2

  const project = (x: number, y: number, z: number): [number, number] => {
    const rx = (x * ca - y * sa) * K
    const ry = (x * sa + y * ca) * K
    return [rx * cos * scale, (ry * sin - z) * scale]
  }
  const depthOf = ([x, y, z]: Point3): number => x * sa + y * ca + z

  const faces: Face[] = []
  const labels: TextMark[] = []
  /** 地面/网格/坐标轴：先画地面与网格（会被模型遮住），坐标轴最后画（永远可见）。 */
  const groundLayer: Line[] = []
  const groundFills: Array<{ points: Array<[number, number]>; fill: string }> = []
  const axisLayer: Line[] = []
  const axisText: TextMark[] = []

  for (const part of parts) {
    if (part.base.length < 3 || part.base.length !== part.top.length) continue
    const color = lift(part.color ?? (part.role ? ROLE_COLORS[part.role] : '#475569'))
    const base = part.base.map(([x, y, z]) => project(x, y, z))
    const top = part.top.map(([x, y, z]) => project(x, y, z))

    for (let i = 0; i < base.length; i += 1) {
      const next = (i + 1) % base.length
      const b0 = base[i]
      const b1 = base[next]
      const t0 = top[i]
      const t1 = top[next]
      const p0 = part.base[i]
      const p1 = part.base[next]
      if (!b0 || !b1 || !t0 || !t1 || !p0 || !p1) continue
      const dx = b1[0] - b0[0]
      // 左上方光源：朝右的面压暗、朝左的面更暗，正面最亮。
      const factor = dx > 0 ? -0.3 : dx < 0 ? -0.12 : -0.4
      faces.push({
        depth: (depthOf(p0) + depthOf(p1)) / 2,
        points: [b0, b1, t1, t0],
        fill: shade(color, factor),
        stroke,
      })
    }

    const baseDepth = part.base.reduce((sum, point) => sum + depthOf(point), 0) / part.base.length
    const topDepth = part.top.reduce((sum, point) => sum + depthOf(point), 0) / part.top.length
    // 近端环稍亮；两端都按重心深度参与排序，凸体足够正确。
    faces.push({ depth: baseDepth + 0.01, points: base, fill: shade(color, 0.16), stroke })
    faces.push({ depth: topDepth, points: top, fill: shade(color, 0.26), stroke })

    if (options.labels !== false && part.label) {
      const centre = part.base.reduce<Point3>(
        (acc, [x, y, z]) => [acc[0] + x / part.base.length, acc[1] + y / part.base.length, acc[2] + z / part.base.length],
        [0, 0, 0],
      )
      const anchor = project(centre[0], centre[1], centre[2])
      labels.push({
        x: anchor[0],
        y: anchor[1] - 8,
        text: part.label,
        fill: '#e2e8f0',
        size: 9,
        anchor: 'middle',
        outline: true,
      })
    }
  }

  const bounds = worldBounds(parts)

  // 地面 + 网格：铺在世界 Z 最低处（立面模式是墙脚，铺地模式是画面所在平面）。
  if (bounds && (options.grid || options.ground)) {
    const spanX = Math.max(bounds.x1 - bounds.x0, 1)
    const spanY = Math.max(bounds.y1 - bounds.y0, 1)
    const margin = Math.max(Math.max(spanX, spanY) * 0.12, 120)
    const floor = bounds.z0
    const gx0 = bounds.x0 - margin
    const gx1 = bounds.x1 + margin
    const gy0 = bounds.y0 - margin
    const gy1 = bounds.y1 + margin
    groundFills.push({
      points: [
        project(gx0, gy0, floor),
        project(gx1, gy0, floor),
        project(gx1, gy1, floor),
        project(gx0, gy1, floor),
      ],
      fill: options.ground ?? 'rgba(15, 23, 42, 0.55)',
    })
    const step = typeof options.grid === 'number' && options.grid > 0
      ? options.grid
      : niceStep(Math.max(spanX, spanY) / 8)
    const gridStroke = 'rgba(148, 163, 184, 0.22)'
    for (let x = Math.ceil(gx0 / step) * step; x <= gx1; x += step) {
      groundLayer.push({ depth: 0, from: project(x, gy0, floor), to: project(x, gy1, floor), stroke: gridStroke, width: 0.5 })
    }
    for (let y = Math.ceil(gy0 / step) * step; y <= gy1; y += step) {
      groundLayer.push({ depth: 0, from: project(gx0, y, floor), to: project(gx1, y, floor), stroke: gridStroke, width: 0.5 })
    }
  }

  // 坐标轴：原点在世界 (0,0,地面)，长度取模型包围盒；每轴 4 段刻度并标毫米数。
  if (options.axes && bounds) {
    const floor = bounds.z0
    // 立面模式下模型在 -Y 侧（离墙距离），Y 轴朝 -Y 画才不会被墙挡住。
    const yDir = bounds.y1 > 0 ? 1 : -1
    const spans: Array<{ key: 'x' | 'y' | 'z'; to: Point3; length: number }> = [
      { key: 'x', to: [bounds.x1, 0, floor], length: bounds.x1 },
      { key: 'y', to: [0, yDir * Math.max(Math.abs(bounds.y0), Math.abs(bounds.y1)), floor], length: Math.max(Math.abs(bounds.y0), Math.abs(bounds.y1)) },
      { key: 'z', to: [0, 0, bounds.z1], length: bounds.z1 },
    ]
    for (const axis of spans) {
      if (axis.length <= 0) continue
      const color = AXIS_COLORS[axis.key]
      const origin = project(0, 0, floor)
      const tip = project(axis.to[0], axis.to[1], axis.to[2])
      axisLayer.push({ depth: 0, from: origin, to: tip, stroke: color, width: 1.2 })
      axisText.push({
        x: tip[0] + (axis.key === 'z' ? 4 : 3),
        y: tip[1] + (axis.key === 'z' ? 0 : 3),
        text: axis.key.toUpperCase(),
        fill: color,
        size: 11,
        anchor: 'start',
        outline: false,
      })
      const tickStep = niceStep(axis.length / 4)
      for (let value = tickStep; value < axis.length; value += tickStep) {
        const ratio = value / axis.length
        const point = project(axis.to[0] * ratio, axis.to[1] * ratio, floor + (axis.to[2] - floor) * ratio)
        // 刻度短线：朝屏幕外侧偏 4px，避免与模型/网格糊在一起。
        axisLayer.push({
          depth: 0,
          from: point,
          to: [point[0] - 4, point[1] + 3],
          stroke: color,
          width: 0.9,
        })
        axisText.push({
          x: point[0] - 5,
          y: point[1] + 4,
          text: `${Math.round(value)}`,
          fill: color,
          size: 8,
          anchor: 'end',
          outline: false,
        })
      }
    }
  }

  faces.sort((left, right) => left.depth - right.depth)

  const collect: Array<[number, number]> = []
  for (const face of faces) collect.push(...face.points)
  for (const fill of groundFills) collect.push(...fill.points)
  for (const line of [...groundLayer, ...axisLayer]) collect.push(line.from, line.to)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of collect) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { svg: emptySvg(options.background ?? null, padding), width: padding * 2, height: padding * 2 }

  // 轴标签画在端点外侧，包围盒留出一点余量，否则最右/最下的字符会被裁掉；
  // 不开坐标轴时不留余量，输出与旧版逐像素一致。
  const slack = options.axes ? 16 : 0
  const width = Math.max(maxX - minX + padding * 2 + slack, 40)
  const height = Math.max(maxY - minY + padding * 2 + slack / 2, 40)
  const shift = { x: padding - minX, y: padding - minY }
  const at = (x: number, y: number): [number, number] => [round(x + shift.x), round(y + shift.y)]

  const body: string[] = []
  if (options.background) {
    body.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${escapeXml(options.background)}"/>`)
  }
  for (const fill of groundFills) {
    const path = fill.points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${at(x, y).join(' ')}`).join(' ')
    body.push(`<path d="${path} Z" fill="${escapeXml(fill.fill)}"/>`)
  }
  for (const line of groundLayer) {
    const [x1, y1] = at(line.from[0], line.from[1])
    const [x2, y2] = at(line.to[0], line.to[1])
    body.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line.stroke}" stroke-width="${line.width}"/>`)
  }
  for (const face of faces) {
    const path = face.points
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${at(x, y).join(' ')}`)
      .join(' ')
    body.push(`<path d="${path} Z" fill="${face.fill}" stroke="${face.stroke}" stroke-width="0.5" stroke-linejoin="round"/>`)
  }
  for (const line of axisLayer) {
    const [x1, y1] = at(line.from[0], line.from[1])
    const [x2, y2] = at(line.to[0], line.to[1])
    body.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line.stroke}" stroke-width="${line.width}" stroke-linecap="round"/>`)
  }
  for (const item of [...labels, ...axisText]) {
    const [x, y] = at(item.x, item.y)
    const outline = item.outline
      ? ' stroke="#0b1220" stroke-width="2.4" paint-order="stroke"'
      : ''
    body.push(
      `<text x="${x}" y="${y}" fill="${item.fill}"${outline} ` +
        `font-family="Noto Sans SC, Microsoft YaHei, sans-serif" font-size="${item.size}" ` +
        `text-anchor="${item.anchor}">${escapeXml(item.text)}</text>`,
    )
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" ` +
    `viewBox="0 0 ${round(width)} ${round(height)}">${body.join('')}</svg>`
  return { svg, width: round(width), height: round(height) }
}

function emptySvg(background: string | null, padding: number): string {
  const size = padding * 2
  const rect = background ? `<rect width="${size}" height="${size}" fill="${escapeXml(background)}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}</svg>`
}

function ringOf(points: Point2[], plane: 'facade' | 'plan', offset: number): Point3[] {
  return points.map(([a, b]) => (plane === 'facade' ? [a, -offset, b] : [a, b, offset]))
}

/** IFC 计划 → 轴测图：跳过贴面与无几何的零件，其他按决策厚度立起来。 */
export function renderPlanIsometric(plan: ExtrusionPlan, options: IsoOptions = {}): { svg: string; width: number; height: number } {
  const plane = plan.settings.projection
  const parts: IsoPart[] = []
  const backdrop = options.backdrop === undefined && plane === 'facade' ? '#0b1220' : options.backdrop
  if (backdrop) {
    // 底板贴在零件后方一点：偏移越大离相机越远，但过大会让图元和底板产生视差错位。
    let farthest = 0
    for (const item of plan.items) {
      if (!item.decision) continue
      farthest = Math.max(farthest, item.decision.elevation + item.decision.depth)
    }
    const inset = farthest + 60
    // 底板比画布再放宽一个视差量，避免远处/近处零件的投影落到板外。
    const margin = inset + 200
    const corners: Point2[] = [
      [-margin, -margin],
      [plan.canvas.widthMm + margin, -margin],
      [plan.canvas.widthMm + margin, plan.canvas.heightMm + margin],
      [-margin, plan.canvas.heightMm + margin],
    ]
    parts.push({
      key: '__backdrop__',
      base: ringOf(corners, plane, inset),
      top: ringOf(corners, plane, inset + 30),
      color: backdrop,
    })
  }
  const labelled = new Set<string>()
  for (const item of plan.items) {
    if (!item.decision || !item.outline) continue
    const decision = item.decision
    if (decision.form === 'decal' || decision.form === 'skip' || decision.depth <= 0) continue
    const first = !labelled.has(item.widgetId)
    labelled.add(item.widgetId)
    parts.push({
      key: `${item.widgetId}/${item.partId}`,
      base: ringOf(item.outline, plane, decision.elevation),
      top: ringOf(item.outline, plane, decision.elevation + decision.depth),
      role: decision.role,
      ...(item.fill ? { color: item.fill } : {}),
      ...(first ? { label: item.widgetName } : {}),
    })
  }
  return renderIsometric(parts, { ...options, ...(backdrop ? { backdrop: null } : {}) })
}

/**
 * 自适应尺寸：先按 scale=1 量一遍包围盒，再折算成目标画框。
 *
 * 九宫格缩略图和预览页的「适应画面」都用它——画面内容常常只占画布一角，
 * 固定 scale 会得到一张「大墙 + 几个小黑点」的图。
 */
export function renderPlanIsometricFit(
  plan: ExtrusionPlan,
  target: { width: number; height: number },
  options: IsoOptions = {},
): { svg: string; width: number; height: number } {
  const measured = renderPlanIsometric(plan, {
    ...options,
    scale: 1,
    padding: 0,
    backdrop: null,
    background: null,
    grid: false,
    axes: false,
    ground: null,
  })
  if (!measured.width || !measured.height) {
    return renderPlanIsometric(plan, { ...options, backdrop: null })
  }
  const scale = Math.min(target.width / measured.width, target.height / measured.height)
  return renderPlanIsometric(plan, { ...options, scale: scale > 0 ? scale : 0.1, backdrop: null })
}
