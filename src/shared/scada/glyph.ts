// 图元字形：把一个图元定义画成工具条上的小图标。
//
// 为什么用真实几何、而不是一图一手绘 path：
// 图标必须与「放下去的东西」同形，而且新增一个基础图元要自动多一个图标——
// 手绘图标集一定会出现「加了图元忘了加图标」。这里复用画布同一条求值链
// （`buildScene` → 绘制图元），所以图标就是该图元缩小后的样子，没有第二套渲染。
//
// 单色（`currentColor`）是 CAD / Photoshop 工具条的老规矩：图标表示「工具」，
// 不表示配色，因此跟随按钮的前景色，浅色深色都不会糊。
//
// 两条「缩到 18px 还看得清」的取舍（都在本文件里定死，改之前先看这里）：
// - **面板类不画字**：`数值显示` 这种图元在 180×72 的盒子里画 28px 的字，
//   等比缩进 18px 图标后字只有 2px，等于没有。这类只画外形，认的是「一块带点什么的板」；
// - **纯文字图元画字**：`文本` 除了字没有别的可认，就按内容宽度定一个能读的字号拟合进去。
import type { ScadaSymbolDefinition } from './types.ts'
import { createEmptyScadaDocument } from './types.ts'
import { buildScene, type ScadaPrimitive } from './scene.ts'

/** 路径字形：`d` 与样式已按「图标坐标」算好，绘制方不需要认识图形类型。 */
export interface ScadaGlyphPath {
  kind: 'path'
  d: string
  stroke: string | null
  /** 已经除以缩放，交给外层 `transform: scale()` 后正好是图标像素。 */
  strokeWidth: number
  fill: string
  fillOpacity: number
  /** 指针类零件的绕心旋转，原样带过来。 */
  transform: string | null
}

/** 文本字形：只出现在以文字为主的图元上（如「文本」）。 */
export interface ScadaGlyphText {
  kind: 'text'
  x: number
  y: number
  text: string
  fontSize: number
  bold: boolean
}

export type ScadaGlyphPrimitive = ScadaGlyphPath | ScadaGlyphText

export interface ScadaGlyph {
  /** 图标方形边长（px），`viewBox` 用 `0 0 size size`。 */
  size: number
  /** 内容变换：把真实尺寸等比缩进图标并居中。 */
  transform: string
  primitives: ScadaGlyphPrimitive[]
}

/** 描边在图标里的视觉粗细（px）。 */
const STROKE_PX = 1.4
/** 纯文字图元的字号上限（px）：再大就压出图标了。 */
const TEXT_MAX_PX = 6.6
/** 纯文字图元的最小字号（px）：再小不如不画。 */
const TEXT_MIN_PX = 4.6
/** 汉字宽度 ≈ 字号；用它估算一行文字占多宽，据此拟合字号。 */
const TEXT_WIDTH_PER_PX = 1.0
/** 闭合图形的淡填充：小尺寸下只看描边容易看不出是「面」还是「线」。 */
const FILL_OPACITY = 0.14

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/** `scale` 是图标内容的缩放比：描边与字号都要除以它，才能回到图标像素。 */
function pathGlyph(primitive: Extract<ScadaPrimitive, { kind: 'path' }>, scale: number): ScadaGlyphPath {
  // 线性图形只描边、不填充；闭合图形给一层淡填充，缩到 18px 仍能一眼分辨。
  const linear = primitive.fill === 'none'
  return {
    kind: 'path',
    d: primitive.d,
    stroke: 'currentColor',
    strokeWidth: round(STROKE_PX / scale),
    fill: linear ? 'none' : 'currentColor',
    fillOpacity: linear ? 0 : FILL_OPACITY,
    transform: primitive.transform,
  }
}

/**
 * 图元 → 图标字形。
 *
 * 求值口径与画布完全一致：按图元默认尺寸建一块临时画布，只把结果等比缩进图标方块并居中。
 * 求值不出任何绘制图元时返回 null，调用方据此不画图标（而不是画一个空方块）。
 */
export function symbolGlyph(symbol: ScadaSymbolDefinition, size = 18): ScadaGlyph | null {
  const width = Math.max(symbol.defaultWidth, 1)
  const height = Math.max(symbol.defaultHeight, 1)
  const document = createEmptyScadaDocument()
  document.canvas = { width, height, grid: 0, background: '#0f172a', showGrid: false }
  document.widgets = [
    {
      id: 'glyph',
      symbolKey: symbol.key,
      name: symbol.name,
      rect: { x: 0, y: 0, width, height },
      rotation: 'none',
      zIndex: 0,
      props: {},
      bindings: [],
      locked: false,
      visible: true,
      groupId: null,
    },
  ]
  const scene = buildScene(document, { [symbol.key]: symbol }, new Map())
  const widget = scene.widgets[0]
  if (!widget || !widget.primitives.length) return null

  const hasShape = widget.primitives.some((primitive) => primitive.kind === 'path')
  // 面板类：有外形就只画外形（见文件头的取舍说明）。
  const drawn = hasShape
    ? widget.primitives.filter((primitive) => primitive.kind === 'path')
    : widget.primitives

  const padding = size * 0.16
  const content = size - padding * 2
  const scale = Math.min(content / width, content / height)
  if (!Number.isFinite(scale) || scale <= 0) return null
  const tx = padding + (content - width * scale) / 2
  const ty = padding + (content - height * scale) / 2

  const primitives: ScadaGlyphPrimitive[] = drawn.map((primitive) => {
    if (primitive.kind === 'path') return pathGlyph(primitive, scale)
    // 纯文字图元：按内容宽度拟合字号，保证「文本」这类短标签装得进内容区。
    const fitted = (content * scale) / Math.max(primitive.text.length * TEXT_WIDTH_PER_PX, 1)
    return {
      kind: 'text' as const,
      x: round(primitive.x),
      y: round(primitive.y),
      text: primitive.text,
      fontSize: round(Math.min(TEXT_MAX_PX, Math.max(TEXT_MIN_PX, fitted)) / scale),
      bold: primitive.bold,
    }
  })

  return { size, transform: `translate(${round(tx)} ${round(ty)}) scale(${round(scale, 4)})`, primitives }
}
