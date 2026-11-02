// 把当前画布压缩成「模型能读的上下文」。
//
// 为什么要压缩：整份文档 JSON 有大段样式与图元 parts，模型读不出重点还费 token。
// 这里只保留「有什么图元、在哪、多大、绑了什么变量」，配合指令集就能做增量修改。
import type { DslDocument, DslSymbol, DslTag } from './types.ts'

export interface DescribeOptions {
  symbols?: DslSymbol[]
  tags?: DslTag[]
  /** 最多列出多少个图元（超出部分只给数量），默认 60。 */
  limit?: number
}

export function describeDocument(document: DslDocument, options: DescribeOptions = {}): string {
  const limit = options.limit ?? 60
  const lines: string[] = []
  const { canvas } = document
  lines.push(`画布 ${canvas.width}x${canvas.height}，栅格 ${canvas.grid}，背景 ${canvas.background}，栅格线 ${canvas.showGrid ? '开' : '关'}`)
  lines.push(`图元 ${document.widgets.length} 个（按 zIndex 升序）：`)
  const widgets = [...document.widgets].sort((a, b) => a.zIndex - b.zIndex).slice(0, limit)
  for (const widget of widgets) {
    const bindings = widget.bindings.length
      ? widget.bindings.map((binding) => `${binding.slot}←${binding.tagLabel ?? `tag#${binding.tagId}`}`).join('，')
      : '无'
    const flags = [widget.locked ? '锁定' : '', widget.visible ? '' : '隐藏'].filter(Boolean).join('/')
    lines.push(
      `- ${widget.id} (${widget.symbolKey}) 名称=${widget.name} 位置=${widget.rect.x},${widget.rect.y} ` +
      `尺寸=${widget.rect.width}x${widget.rect.height} 旋转=${widget.rotation} 绑定=${bindings}${flags ? ` ${flags}` : ''}`,
    )
  }
  if (document.widgets.length > widgets.length) lines.push(`……其余 ${document.widgets.length - widgets.length} 个图元省略`)
  if (options.symbols?.length) {
    lines.push(`可用图元：${options.symbols.map((symbol) => `${symbol.key}(${symbol.name})`).join('，')}`)
  }
  if (options.tags?.length) {
    lines.push(`可绑定变量：${options.tags.map((tag) => `${tag.tagId}=${tag.name}`).join('，')}`)
  }
  return lines.join('\n')
}

/** 生成「AI 排版体检」用的统计：给模型判断布局是否失衡提供依据。 */
export function layoutStats(document: DslDocument): {
  empty: boolean
  overflow: string[]
  overlapping: Array<[string, string]>
  bounds: { x: number; y: number; width: number; height: number }
} {
  const overflow: string[] = []
  const overlapping: Array<[string, string]> = []
  for (const widget of document.widgets) {
    if (
      widget.rect.x < 0 || widget.rect.y < 0 ||
      widget.rect.x + widget.rect.width > document.canvas.width ||
      widget.rect.y + widget.rect.height > document.canvas.height
    ) overflow.push(widget.id)
  }
  const widgets = document.widgets
  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      const a = widgets[i]
      const b = widgets[j]
      if (!a || !b) continue
      const overlapX = Math.max(0, Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x))
      const overlapY = Math.max(0, Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y))
      if (overlapX > 0 && overlapY > 0) overlapping.push([a.id, b.id])
    }
  }
  const xs = widgets.map((w) => w.rect.x)
  const ys = widgets.map((w) => w.rect.y)
  const x2 = widgets.map((w) => w.rect.x + w.rect.width)
  const y2 = widgets.map((w) => w.rect.y + w.rect.height)
  return {
    empty: widgets.length === 0,
    overflow,
    overlapping,
    bounds: widgets.length === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...x2) - Math.min(...xs),
        height: Math.max(...y2) - Math.min(...ys),
      },
  }
}
