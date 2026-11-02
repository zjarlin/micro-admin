// 指令执行器：把解析后的指令作用到文档上。
//
// 设计取向：
// - 指令是「意图」，几何由这里算，模型不需要（也不应该）自己算像素；
// - 单条指令失败只记问题、不影响其它指令，界面上能逐行标红；
// - 锁定的图元不会被排版指令移动，避免 AI 把人工摆好的东西冲掉。
import type {
  DslApplyOptions,
  DslApplyResult,
  DslBinding,
  DslCommand,
  DslDocument,
  DslIssue,
  DslRect,
  DslSymbol,
  DslTag,
  DslWidget,
} from './types.ts'

const ROTATIONS: Record<string, DslWidget['rotation']> = {
  '0': 'none',
  '90': 'deg90',
  '180': 'deg180',
  '270': 'deg270',
}

interface Ctx {
  doc: DslDocument
  symbols: Map<string, DslSymbol>
  tags: DslTag[]
  selection: string[]
  issues: DslIssue[]
  applied: string[]
  last: string | null
  autoIndex: number
}

function issue(ctx: Ctx, command: DslCommand, message: string, severity: DslIssue['severity'] = 'error'): void {
  ctx.issues.push({ line: command.line, severity, message, source: command.source })
}

function numeric(text: string | undefined, fallback: number): number {
  const value = Number(text)
  return Number.isFinite(value) ? value : fallback
}

/** 解析 `x,y` 与 `w x h`（`320x36` 或 `320X36`）。 */
function parsePair(text: string | undefined): [number, number] | null {
  if (!text) return null
  const parts = text.split(/[,xX*]/).map((item) => Number(item.trim()))
  if (parts.length !== 2) return null
  const [a, b] = parts
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [a as number, b as number]
}

function boundsOf(widgets: DslWidget[]): DslRect {
  const xs = widgets.map((w) => w.rect.x)
  const ys = widgets.map((w) => w.rect.y)
  const x2 = widgets.map((w) => w.rect.x + w.rect.width)
  const y2 = widgets.map((w) => w.rect.y + w.rect.height)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...x2) - x, height: Math.max(...y2) - y }
}

function byId(ctx: Ctx, id: string): DslWidget | null {
  return ctx.doc.widgets.find((widget) => widget.id === id) ?? null
}

/**
 * 把参数里的引用展开成图元：`@last` / `@selection` / 具体 id 混写都行。
 * 未知 id 记一条错误，其余继续执行。
 */
function resolveRefs(ctx: Ctx, command: DslCommand, refs: string[]): DslWidget[] {
  const widgets: DslWidget[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const push = (widget: DslWidget | null): void => {
      if (!widget || seen.has(widget.id)) return
      seen.add(widget.id)
      widgets.push(widget)
    }
    if (ref === '@last') {
      if (!ctx.last) issue(ctx, command, '当前没有「最近新增」的图元，@last 无法解析')
      push(ctx.last ? byId(ctx, ctx.last) : null)
      continue
    }
    if (ref === '@selection') {
      if (ctx.selection.length === 0) issue(ctx, command, '@selection 为空：请先在画布上选中图元')
      for (const id of ctx.selection) push(byId(ctx, id))
      continue
    }
    const widget = byId(ctx, ref)
    if (!widget) issue(ctx, command, `找不到图元 "${ref}"`)
    push(widget)
  }
  return widgets
}

/** 从 `[k, v]` 参数游标里读一个值。 */
function takePair(args: string[], keyword: string): [number, number] | null {
  const index = args.indexOf(keyword)
  if (index < 0) return null
  return parsePair(args[index + 1])
}

function applyAdd(ctx: Ctx, command: DslCommand): void {
  const symbolKey = command.args[0]
  if (!symbolKey) {
    issue(ctx, command, 'add 缺少图元类型')
    return
  }
  const resolved = resolveSymbol(ctx, symbolKey)
  const symbol = resolved ? ctx.symbols.get(resolved) : undefined
  if (!symbol) {
    const hint = suggestKey(symbolKey, [...ctx.symbols.keys()])
    issue(
      ctx,
      command,
      `未知图元 "${symbolKey}"${hint ? `，你想用的是 "${hint}"` : ''}；可用：${[...ctx.symbols.keys()].join(' / ')}`,
    )
    return
  }
  const at = takePair(command.args, 'at')
  const size = takePair(command.args, 'size')
  const idIndex = command.args.indexOf('as')
  const symbolRef = resolved ?? symbolKey
  const autoId = `${symbolRef}-${(ctx.autoIndex += 1)}`
  const id = idIndex >= 0 ? (command.args[idIndex + 1] ?? autoId) : autoId
  if (byId(ctx, id)) {
    issue(ctx, command, `图元 id "${id}" 已存在，换一个 as 名字`)
    return
  }
  const width = size?.[0] ?? symbol.defaultWidth
  const height = size?.[1] ?? symbol.defaultHeight
  const offset = Math.min(ctx.doc.widgets.length, 8) * 16
  const props: Record<string, unknown> = {}
  for (const spec of symbol.props ?? []) props[spec.key] = spec.default
  for (const [key, value] of Object.entries(command.options)) {
    if (key === 'name') continue
    props[key] = coerceValue(value)
  }
  const widget: DslWidget = {
    id,
    symbolKey: symbolRef,
    name: command.options.name ?? symbol.name,
    rect: { x: at?.[0] ?? offset, y: at?.[1] ?? offset, width, height },
    rotation: 'none',
    zIndex: ctx.doc.widgets.reduce((max, item) => Math.max(max, item.zIndex), 0) + 1,
    props,
    bindings: [],
    locked: false,
    visible: true,
  }
  ctx.doc.widgets.push(widget)
  ctx.last = id
  ctx.applied.push(`add ${id} (${symbolRef})`)
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  const number = Number(value)
  return Number.isFinite(number) && value.trim() !== '' ? number : value
}

/** 排版指令的统一前置：解析引用、跳过锁定图元。 */
function layoutTargets(ctx: Ctx, command: DslCommand, refs: string[]): DslWidget[] {
  const widgets = resolveRefs(ctx, command, refs)
  const movable = widgets.filter((widget) => {
    if (!widget.locked) return true
    issue(ctx, command, `图元 "${widget.id}" 已锁定，跳过排版`, 'warn')
    return false
  })
  return movable
}

function applyAlign(ctx: Ctx, command: DslCommand): void {
  const edge = command.args[0] ?? ''
  const widgets = layoutTargets(ctx, command, command.args.slice(1))
  if (widgets.length === 0) return
  const single = widgets.length === 1
  const box = single
    ? { x: 0, y: 0, width: ctx.doc.canvas.width, height: ctx.doc.canvas.height }
    : boundsOf(widgets)
  for (const widget of widgets) {
    switch (edge) {
      case 'left': widget.rect.x = box.x; break
      case 'right': widget.rect.x = box.x + box.width - widget.rect.width; break
      case 'top': widget.rect.y = box.y; break
      case 'bottom': widget.rect.y = box.y + box.height - widget.rect.height; break
      case 'hcenter': widget.rect.x = box.x + (box.width - widget.rect.width) / 2; break
      case 'vcenter': widget.rect.y = box.y + (box.height - widget.rect.height) / 2; break
      default:
        issue(ctx, command, `align 的对齐方式 "${edge}" 不支持：left|right|top|bottom|hcenter|vcenter`)
        return
    }
    round(widget.rect)
  }
  ctx.applied.push(`align ${edge} ${widgets.map((w) => w.id).join(',')}`)
}

function applyDistribute(ctx: Ctx, command: DslCommand): void {
  const axis = command.args[0] === 'v' ? 'v' : 'h'
  const widgets = layoutTargets(ctx, command, command.args.slice(1))
  if (widgets.length < 2) {
    issue(ctx, command, 'distribute 至少需要 2 个图元', 'warn')
    return
  }
  const gap = command.options.gap ? numeric(command.options.gap, 0) : null
  const sorted = [...widgets].sort((a, b) => (axis === 'h' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  const first = sorted[0] as DslWidget
  const start = axis === 'h' ? first.rect.x : first.rect.y
  if (gap !== null) {
    let cursor = start
    for (const widget of sorted) {
      if (axis === 'h') {
        widget.rect.x = cursor
        cursor += widget.rect.width + gap
      } else {
        widget.rect.y = cursor
        cursor += widget.rect.height + gap
      }
    }
  } else {
    const last = sorted[sorted.length - 1] as DslWidget
    const end = axis === 'h' ? last.rect.x + last.rect.width : last.rect.y + last.rect.height
    const total = sorted.reduce((sum, widget) => sum + (axis === 'h' ? widget.rect.width : widget.rect.height), 0)
    const step = sorted.length > 1 ? (end - start - total) / (sorted.length - 1) : 0
    let cursor = start
    for (const widget of sorted) {
      if (axis === 'h') {
        widget.rect.x = cursor
        cursor += widget.rect.width + step
      } else {
        widget.rect.y = cursor
        cursor += widget.rect.height + step
      }
    }
  }
  for (const widget of sorted) round(widget.rect)
  ctx.applied.push(`distribute ${axis} ${sorted.map((w) => w.id).join(',')}`)
}

function applyGrid(ctx: Ctx, command: DslCommand): void {
  const cols = Math.max(1, Math.round(numeric(command.options.cols, 1)))
  const gap = numeric(command.options.gap, 16)
  const at = takePair(command.args, 'at') ?? [0, 0]
  const size = takePair(command.args, 'size')
  const refs = command.args.filter((arg) => arg !== 'at' && arg !== 'size' && !/^[\d.,xX*]+$/.test(arg))
  const widgets = layoutTargets(ctx, command, refs)
  if (widgets.length === 0) return
  const rows = Math.max(1, Math.round(numeric(command.options.rows, Math.ceil(widgets.length / cols))))
  const cellWidth = size?.[0] ?? (ctx.doc.canvas.width - (at[0] as number) - gap * (cols - 1)) / cols
  const cellHeight = size?.[1] ?? (ctx.doc.canvas.height - (at[1] as number) - gap * (rows - 1)) / rows
  widgets.forEach((widget, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    widget.rect.x = (at[0] as number) + col * (cellWidth + gap)
    widget.rect.y = (at[1] as number) + row * (cellHeight + gap)
    if (size) {
      widget.rect.width = cellWidth
      widget.rect.height = cellHeight
    }
    round(widget.rect)
  })
  ctx.applied.push(`grid ${cols}x${rows} ${widgets.map((w) => w.id).join(',')}`)
}

function applyStack(ctx: Ctx, command: DslCommand): void {
  const axis = command.args[0] === 'h' ? 'h' : 'v'
  const gap = numeric(command.options.gap, 0)
  const widgets = layoutTargets(ctx, command, command.args.slice(1))
  if (widgets.length === 0) return
  const sorted = [...widgets].sort((a, b) => (axis === 'h' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
  const first = sorted[0] as DslWidget
  let cursor = axis === 'h' ? first.rect.x : first.rect.y
  for (const widget of sorted) {
    if (axis === 'h') {
      widget.rect.x = cursor
      cursor += widget.rect.width + gap
    } else {
      widget.rect.y = cursor
      cursor += widget.rect.height + gap
    }
    round(widget.rect)
  }
  ctx.applied.push(`stack ${axis} ${sorted.map((w) => w.id).join(',')}`)
}

function applyCenter(ctx: Ctx, command: DslCommand): void {
  const widgets = layoutTargets(ctx, command, command.args)
  if (widgets.length === 0) return
  const box = boundsOf(widgets)
  const dx = (ctx.doc.canvas.width - box.width) / 2 - box.x
  const dy = (ctx.doc.canvas.height - box.height) / 2 - box.y
  for (const widget of widgets) {
    widget.rect.x += dx
    widget.rect.y += dy
    round(widget.rect)
  }
  ctx.applied.push(`center ${widgets.map((w) => w.id).join(',')}`)
}

function applyFit(ctx: Ctx, command: DslCommand): void {
  const padding = numeric(command.options.padding, 24)
  const widgets = layoutTargets(ctx, command, command.args)
  if (widgets.length === 0) return
  const box = boundsOf(widgets)
  const scale = Math.min(
    (ctx.doc.canvas.width - padding * 2) / Math.max(box.width, 1),
    (ctx.doc.canvas.height - padding * 2) / Math.max(box.height, 1),
    1,
  )
  for (const widget of widgets) {
    widget.rect.x = padding + (widget.rect.x - box.x) * scale
    widget.rect.y = padding + (widget.rect.y - box.y) * scale
    widget.rect.width *= scale
    widget.rect.height *= scale
    round(widget.rect)
  }
  ctx.applied.push(`fit ${widgets.map((w) => w.id).join(',')} ×${scale.toFixed(2)}`)
}

function applyAnchor(ctx: Ctx, command: DslCommand): void {
  const position = command.args.find((arg) => /^(tl|tr|bl|br|tc|bc|lc|rc)$/.test(arg))
  if (!position) {
    issue(ctx, command, 'anchor 缺少位置：tl|tr|bl|br|tc|bc|lc|rc')
    return
  }
  const margin = numeric(command.options.margin, 0)
  const widgets = layoutTargets(ctx, command, command.args.filter((arg) => arg !== position))
  if (widgets.length === 0) return
  const box = boundsOf(widgets)
  const canvas = ctx.doc.canvas
  let dx = 0
  let dy = 0
  if (position.includes('l')) dx = margin - box.x
  if (position.includes('r')) dx = canvas.width - margin - (box.x + box.width)
  if (position.includes('t')) dy = margin - box.y
  if (position.includes('b')) dy = canvas.height - margin - (box.y + box.height)
  if (position === 'tc') dx = (canvas.width - box.width) / 2 - box.x
  if (position === 'bc') dx = (canvas.width - box.width) / 2 - box.x
  if (position === 'lc') dy = (canvas.height - box.height) / 2 - box.y
  if (position === 'rc') dy = (canvas.height - box.height) / 2 - box.y
  for (const widget of widgets) {
    widget.rect.x += dx
    widget.rect.y += dy
    round(widget.rect)
  }
  ctx.applied.push(`anchor ${position} ${widgets.map((w) => w.id).join(',')}`)
}

function round(rect: DslRect): void {
  rect.x = Math.round(rect.x)
  rect.y = Math.round(rect.y)
  rect.width = Math.round(rect.width)
  rect.height = Math.round(rect.height)
}

function applyDrawOp(ctx: Ctx, command: DslCommand): boolean {
  const widgets = (): DslWidget[] => resolveRefs(ctx, command, command.args.filter((arg) => !['to', 'by', 'at'].includes(arg)))
  switch (command.op) {
    case 'add':
      applyAdd(ctx, command)
      return true
    case 'remove': {
      const targets = widgets()
      const ids = new Set(targets.map((widget) => widget.id))
      ctx.doc.widgets = ctx.doc.widgets.filter((widget) => !ids.has(widget.id))
      if (ctx.last && ids.has(ctx.last)) ctx.last = null
      ctx.applied.push(`remove ${[...ids].join(',')}`)
      return true
    }
    case 'move': {
      const to = takePair(command.args, 'to')
      const by = takePair(command.args, 'by')
      if (!to && !by) {
        issue(ctx, command, 'move 需要 `to x,y` 或 `by dx,dy`')
        return true
      }
      for (const widget of widgets()) {
        if (to) {
          widget.rect.x = to[0]
          widget.rect.y = to[1]
        } else if (by) {
          widget.rect.x += by[0]
          widget.rect.y += by[1]
        }
        round(widget.rect)
      }
      ctx.applied.push(`move ${to ? `to ${to.join(',')}` : `by ${by?.join(',')}`}`)
      return true
    }
    case 'resize': {
      const size = takePair(command.args, 'to') ?? takePair(command.args, 'size')
      if (!size) {
        issue(ctx, command, 'resize 需要 `to wxh`')
        return true
      }
      for (const widget of widgets()) {
        const symbol = ctx.symbols.get(widget.symbolKey)
        widget.rect.width = size[0]
        widget.rect.height = symbol?.keepAspect
          ? Math.round((size[0] * widget.rect.height) / Math.max(widget.rect.width, 1))
          : size[1]
        widget.rect.width = size[0]
        round(widget.rect)
      }
      ctx.applied.push(`resize to ${size.join('x')}`)
      return true
    }
    case 'rotate': {
      const raw = command.options.to ?? command.args[command.args.length - 1] ?? ''
      const rotation = ROTATIONS[raw]
      if (!rotation) {
        issue(ctx, command, `rotate 只支持 0/90/180/270，收到 "${raw}"`)
        return true
      }
      for (const widget of widgets()) widget.rotation = rotation
      ctx.applied.push(`rotate ${raw}°`)
      return true
    }
    case 'zorder': {
      const direction = command.args[command.args.length - 1] ?? 'front'
      const targets = resolveRefs(ctx, command, command.args.slice(0, -1))
      const max = ctx.doc.widgets.reduce((value, widget) => Math.max(value, widget.zIndex), 0)
      for (const widget of targets) {
        if (direction === 'front') widget.zIndex = max + 1
        else if (direction === 'back') widget.zIndex = ctx.doc.widgets.reduce((value, item) => Math.min(value, item.zIndex), 0) - 1
        else widget.zIndex += direction === 'up' ? 1 : -1
      }
      ctx.applied.push(`zorder ${direction}`)
      return true
    }
    case 'lock':
    case 'show':
    case 'hide': {
      const toggle = command.op === 'lock'
        ? (command.args[command.args.length - 1] ?? 'on') !== 'off'
        : command.op === 'show'
      const refs = toggle === false && command.args[command.args.length - 1] === 'off'
        ? command.args.slice(0, -1)
        : command.args
      for (const widget of resolveRefs(ctx, command, refs)) {
        if (command.op === 'lock') widget.locked = toggle
        else widget.visible = toggle
      }
      ctx.applied.push(`${command.op} ${refs.join(',')}`)
      return true
    }
    case 'style': {
      const targets = resolveRefs(ctx, command, command.args)
      for (const widget of targets) {
        for (const [key, value] of Object.entries(command.options)) widget.props[key] = coerceValue(value)
      }
      ctx.applied.push(`style ${targets.map((w) => w.id).join(',')}`)
      return true
    }
    case 'bind': {
      const target = command.args[0] ?? ''
      const [ref, slot] = target.split('.')
      if (!ref || !slot) {
        issue(ctx, command, 'bind 需要 `bind <图元>.<槽位>=<变量>`')
        return true
      }
      const widget = byId(ctx, ref)
      if (!widget) {
        issue(ctx, command, `找不到图元 "${ref}"`)
        return true
      }
      const wanted = command.options.value ?? command.options.tag ?? ''
      const tag = resolveTag(ctx, wanted)
      if (!tag) {
        const available = ctx.tags.map((item) => `${item.tagId}=${item.name}`).join('，')
        issue(ctx, command, `找不到变量 "${wanted}"${available ? `；可用变量：${available}` : '（当前工程没有变量）'}`)
        return true
      }
      const symbol = ctx.symbols.get(widget.symbolKey)
      const slots = symbol?.bindingSlots ?? []
      if (slots.length > 0 && !slots.some((item) => item.key === slot)) {
        issue(ctx, command, `图元 "${ref}" 没有槽位 "${slot}"，可用：${slots.map((s) => s.key).join(' / ')}`)
        return true
      }
      const binding: DslBinding = {
        slot,
        tagId: tag.tagId,
        tagLabel: tag.name,
        ...(command.options.precision ? { precision: numeric(command.options.precision, 0) } : {}),
        ...(command.options.unit ? { unit: command.options.unit } : {}),
      }
      widget.bindings = [...widget.bindings.filter((item) => item.slot !== slot), binding]
      ctx.applied.push(`bind ${ref}.${slot} → ${tag.name}`)
      return true
    }
    case 'unbind': {
      const target = command.args[0] ?? ''
      const [ref, slot] = target.split('.')
      const widget = ref ? byId(ctx, ref) : null
      if (!widget) {
        issue(ctx, command, `找不到图元 "${ref ?? ''}"`)
        return true
      }
      widget.bindings = slot ? widget.bindings.filter((item) => item.slot !== slot) : []
      ctx.applied.push(`unbind ${target}`)
      return true
    }
    default:
      return false
  }
}

/**
 * 图元 key 解析：先精确匹配，再按后缀唯一匹配（`text` → `basic.text`）。
 *
 * 命名空间前缀（basic./display./machine.…）是给人分类用的，模型经常漏写；
 * 只要后缀在清单里唯一就没有歧义，直接接受比让它重试一轮更可靠。
 */
function resolveSymbol(ctx: Ctx, key: string): string | null {
  if (ctx.symbols.has(key)) return key
  const lowered = key.toLowerCase()
  const matches = [...ctx.symbols.keys()].filter((item) => item.toLowerCase().split('.').pop() === lowered)
  return matches.length === 1 ? (matches[0] as string) : null
}

/**
 * 未知 key 的近似提示：先看后缀（`text` → `basic.text`），再看编辑距离。
 * 模型经常漏掉命名空间前缀，给出建议比让它重试一轮更省时。
 */
function suggestKey(key: string, keys: string[]): string | null {
  const lowered = key.toLowerCase()
  const bySuffix = keys.find((item) => item.toLowerCase().split('.').pop() === lowered)
  if (bySuffix) return bySuffix
  let best: { key: string; distance: number } | null = null
  for (const item of keys) {
    const distance = editDistance(lowered, item.toLowerCase())
    if (!best || distance < best.distance) best = { key: item, distance }
  }
  return best && best.distance <= 3 ? best.key : null
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] as number
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] as number
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      previous = current
    }
  }
  return row[b.length] as number
}

function resolveTag(ctx: Ctx, raw: string): DslTag | null {
  if (!raw) return null
  const id = Number(raw)
  if (Number.isFinite(id)) return ctx.tags.find((tag) => tag.tagId === id) ?? null
  const keyword = raw.toLowerCase()
  return ctx.tags.find((tag) => tag.name.toLowerCase().includes(keyword)) ?? null
}

function applyCanvasOp(command: DslCommand, ctx: Ctx): void {
  const size = takePair(command.args, 'size')
  if (size) {
    ctx.doc.canvas.width = size[0]
    ctx.doc.canvas.height = size[1]
  }
  if (command.options.grid !== undefined) ctx.doc.canvas.grid = numeric(command.options.grid, ctx.doc.canvas.grid)
  if (command.options.background) ctx.doc.canvas.background = command.options.background
  if (command.options.gridlines) ctx.doc.canvas.showGrid = command.options.gridlines !== 'off'
  ctx.applied.push('canvas')
}

/**
 * 执行一批指令。
 *
 * `document` 不会被就地修改（先 `structuredClone`），失败的指令只记问题，
 * 调用方可以「全部成功才提交」或「部分应用 + 高亮问题行」。
 */
export function applyCommands(commands: DslCommand[], options: DslApplyOptions): DslApplyResult {
  const ctx: Ctx = {
    doc: structuredClone(options.document),
    symbols: new Map(options.symbols.map((symbol) => [symbol.key, symbol])),
    tags: options.tags ?? [],
    selection: options.selection ?? [],
    issues: [],
    applied: [],
    last: null,
    autoIndex: 0,
  }

  for (const command of commands) {
    if (command.op === 'canvas') {
      applyCanvasOp(command, ctx)
      continue
    }
    if (command.op === 'align') { applyAlign(ctx, command); continue }
    if (command.op === 'distribute') { applyDistribute(ctx, command); continue }
    if (command.op === 'grid') { applyGrid(ctx, command); continue }
    if (command.op === 'stack') { applyStack(ctx, command); continue }
    if (command.op === 'center') { applyCenter(ctx, command); continue }
    if (command.op === 'fit') { applyFit(ctx, command); continue }
    if (command.op === 'anchor') { applyAnchor(ctx, command); continue }
    applyDrawOp(ctx, command)
  }

  return { document: ctx.doc, applied: ctx.applied, issues: ctx.issues }
}
