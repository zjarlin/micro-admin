// 轴测预览：把 IFC 计划画成等轴测 SVG。
//
// 不引 three.js 也能看到「2D 画面立起来」的效果，服务端（缩略图、`/scada/ifc/preview`）
// 与浏览器（预览页）共用同一段代码，因此不依赖 DOM、WebGL 或图片解码。
//
// 世界坐标 → 屏幕：标准等轴测，相机在 (+1,+1,+1) 方向
//   screenX = (x - y) * cos(angle)
//   screenY = (x + y) * sin(angle) - z
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
  /** 等轴测角度（弧度），默认 30°。 */
  angle?: number
  padding?: number
  background?: string | null
  /** 是否画图元名称，默认 true（只在有 label 时）。 */
  labels?: boolean
  /** 背景板颜色：立面模式默认画一块画布底板，让「这一页」在 3D 里立得起来。 */
  backdrop?: string | null
  stroke?: string
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

interface Face {
  depth: number
  points: Array<[number, number]>
  fill: string
  stroke: string
}

/**
 * 轴测渲染。
 *
 * 宽高按实际内容裁剪，输出可直接塞进 `<img>`/缩略图卡片，也可内联进页面。
 */
export function renderIsometric(parts: IsoPart[], options: IsoOptions = {}): { svg: string; width: number; height: number } {
  const scale = options.scale ?? 0.18
  const angle = options.angle ?? Math.PI / 6
  const padding = options.padding ?? 16
  const stroke = options.stroke ?? 'rgba(15,23,42,0.55)'
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const project = (x: number, y: number, z: number): [number, number] => [
    (x - y) * cos * scale,
    ((x + y) * sin - z) * scale,
  ]
  const depthOf = ([x, y, z]: Point3): number => x + y + z

  const faces: Face[] = []
  const labels: Array<{ x: number; y: number; text: string }> = []

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
      const centre = part.base.reduce<[number, number, number]>(
        (acc, [x, y, z]) => [acc[0] + x / part.base.length, acc[1] + y / part.base.length, acc[2] + z / part.base.length],
        [0, 0, 0],
      )
      const anchor = project(centre[0], centre[1], centre[2])
      labels.push({ x: anchor[0], y: anchor[1] - 8, text: part.label })
    }
  }

  faces.sort((left, right) => left.depth - right.depth)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const face of faces) {
    for (const [x, y] of face.points) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) return { svg: emptySvg(options.background ?? null, padding), width: padding * 2, height: padding * 2 }

  const width = Math.max(maxX - minX + padding * 2, 40)
  const height = Math.max(maxY - minY + padding * 2, 40)
  const shift = { x: padding - minX, y: padding - minY }

  const body: string[] = []
  if (options.background) {
    body.push(`<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${escapeXml(options.background)}"/>`)
  }
  for (const face of faces) {
    const path = face.points
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${round(x + shift.x)} ${round(y + shift.y)}`)
      .join(' ')
    body.push(`<path d="${path} Z" fill="${face.fill}" stroke="${face.stroke}" stroke-width="0.5" stroke-linejoin="round"/>`)
  }
  for (const item of labels) {
    body.push(
      `<text x="${round(item.x + shift.x)}" y="${round(item.y + shift.y)}" fill="#e2e8f0" stroke="#0b1220" ` +
        `stroke-width="2.4" paint-order="stroke" font-family="Noto Sans SC, Microsoft YaHei, sans-serif" ` +
        `font-size="9" text-anchor="middle">${escapeXml(item.text)}</text>`,
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
  })
  if (!measured.width || !measured.height) {
    return renderPlanIsometric(plan, { ...options, backdrop: null })
  }
  const scale = Math.min(target.width / measured.width, target.height / measured.height)
  return renderPlanIsometric(plan, { ...options, scale: scale > 0 ? scale : 0.1, backdrop: null })
}
