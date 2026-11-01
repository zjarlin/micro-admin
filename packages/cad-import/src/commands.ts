// 图元 → 绘图指令集。
//
// 为什么输出指令而不是文档 JSON：指令集是「一行一个意图」，模型读它、改它都便宜
// （一条 `add basic.rect as r1 at 120,80 size 200x120` 大约 12 token，
// 同一格图元的文档 JSON 要 150+ token）。因此 CAD 导入的产物既是可执行脚本，
// 也是「给 AI 的中间表示」：AI 只在需要补语义（这堆框里哪个是泵）时读摘要 + 写指令。
//
// 指令由 `applyCommands` 执行，所以这里不做任何几何校验——画不进去的行会在执行期报错，
// 用户能逐行看到哪一条不合法。
import type { CadShape, CadSymbolizeResult } from './types.ts'

export interface CadCommandOptions {
  /** 画布背景色（缺省沿用组态默认深色）。 */
  background?: string
  /** 栅格间距。 */
  grid?: number
  /** 是否给每个图元加 `style` 行（文本内容、字号等）。默认 true。 */
  withStyle?: boolean
  /** 是否在开头写 `canvas` 行。默认 true。 */
  withCanvas?: boolean
  /** 最多输出多少条 `add`（与 symbolize 的上限一致即可）。 */
  maxShapes?: number
}

/** 指令里的文本参数：含空白就加双引号（解析器认 `"..."`）。 */
function quote(text: string): string {
  const value = text.replace(/"/g, '“')
  return /\s/.test(value) ? `"${value}"` : value
}

function round(value: number): number {
  return Math.round(value)
}

/** 单格图元 → 一条 `add`（+ 可选 `style`）。 */
function linesOf(shape: CadShape, withStyle: boolean): string[] {
  const { x, y, width, height } = shape.rect
  const head = `add ${shape.symbolKey} as ${shape.id} name=${quote(shape.name)} at ${round(x)},${round(y)} size ${round(Math.max(width, 4))}x${round(Math.max(height, 4))}`
  const rotation = shape.rotation === 'none' ? '' : `\nrotate ${shape.id} to ${shape.rotation === 'deg90' ? 90 : shape.rotation === 'deg180' ? 180 : 270}`
  if (!withStyle) return [`${head}${rotation}`]
  const props = Object.entries(shape.props)
    .map(([key, value]) => `${key}=${typeof value === 'number' ? value : quote(String(value))}`)
  if (props.length === 0) return [`${head}${rotation}`]
  return [`${head}${rotation}`, `style ${shape.id} ${props.join(' ')}`]
}

/**
 * 图元 → 指令文本。
 *
 * 顺序刻意固定为「画布 → 从后往前（大面积先画）→ 文字最后」：
 * 组态画布按 `zIndex` 递增绘制，先 add 的在下面，设备框不会被管道压住。
 */
export function shapesToCommands(result: CadSymbolizeResult, options: CadCommandOptions = {}): string {
  const background = options.background ?? '#0f172a'
  const grid = options.grid ?? 10
  const withStyle = options.withStyle !== false
  const withCanvas = options.withCanvas !== false
  const maxShapes = options.maxShapes ?? 240

  const shapes = [...result.shapes].slice(0, maxShapes)
  // 面积大的先画（设备框在底层），文字最后（标注永远压在最上面）。
  const ordered = shapes.sort((left, right) => {
    const leftText = left.symbolKey === 'basic.text' ? 1 : 0
    const rightText = right.symbolKey === 'basic.text' ? 1 : 0
    if (leftText !== rightText) return leftText - rightText
    return right.rect.width * right.rect.height - left.rect.width * left.rect.height
  })

  const lines: string[] = []
  if (withCanvas) {
    lines.push(`canvas size ${result.canvas.width}x${result.canvas.height} grid=${grid} background=${background}`)
  }
  for (const shape of ordered) lines.push(...linesOf(shape, withStyle))
  return lines.join('\n')
}

/**
 * 摘要：给模型看的「图纸有什么」。
 *
 * 这是省 token 的第二道闸门：整份 DXF 有几万行，摘要固定压到 ~60 行以内，
 * 只保留「数量、图层、图元清单（带 id 与位置）」。模型据此判断语义（哪个框是泵、
 * 哪些管道要连变量），再用指令集表达修改。
 */
export function shapesDigest(result: CadSymbolizeResult, options: { limit?: number; textLimit?: number } = {}): string {
  const limit = options.limit ?? 40
  const textLimit = options.textLimit ?? 20
  const lines: string[] = []
  const { stats } = result
  lines.push(`画布 ${result.canvas.width}x${result.canvas.height}，图纸缩放 ${result.scale.toFixed(3)} 像素/单位`)
  lines.push(`实体 ${stats.entities} 个 → 图元 ${stats.used} 个（合并 ${stats.merged} 段，丢弃 ${stats.dropped} 个）`)
  const kinds = Object.entries(stats.byKind).sort((left, right) => right[1] - left[1])
  if (kinds.length) lines.push(`按类型：${kinds.map(([key, count]) => `${key} ${count}`).join('，')}`)

  const layers = new Map<string, number>()
  for (const shape of result.shapes) {
    if (!shape.layer) continue
    layers.set(shape.layer, (layers.get(shape.layer) ?? 0) + 1)
  }
  if (layers.size) {
    const top = [...layers.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8)
    lines.push(`图层：${top.map(([name, count]) => `${name}(${count})`).join('，')}${layers.size > top.length ? `，另有 ${layers.size - top.length} 个` : ''}`)
  }

  const nonText = result.shapes.filter((shape) => shape.symbolKey !== 'basic.text')
  const texts = result.shapes.filter((shape) => shape.symbolKey === 'basic.text')
  lines.push(`几何图元（前 ${Math.min(limit, nonText.length)} 个，按面积降序）：`)
  for (const shape of [...nonText]
    .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)
    .slice(0, limit)) {
    lines.push(`- ${shape.id} ${shape.symbolKey} 名称=${shape.name} 位置=${Math.round(shape.rect.x)},${Math.round(shape.rect.y)} 尺寸=${Math.round(shape.rect.width)}x${Math.round(shape.rect.height)}${shape.merged > 1 ? ` 合并${shape.merged}段` : ''}`)
  }
  if (nonText.length > limit) lines.push(`……其余 ${nonText.length - limit} 个几何图元省略`)

  if (texts.length) {
    lines.push(`标注文字 ${texts.length} 条（前 ${Math.min(textLimit, texts.length)} 条）：`)
    for (const shape of texts.slice(0, textLimit)) {
      const content = String(shape.props.content ?? shape.name)
      lines.push(`- ${shape.id} 位置=${Math.round(shape.rect.x)},${Math.round(shape.rect.y)} 内容=${content}`)
    }
    if (texts.length > textLimit) lines.push(`……其余 ${texts.length - textLimit} 条省略`)
  }
  return lines.join('\n')
}
