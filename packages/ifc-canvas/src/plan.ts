// 画面 → 3D 计划：先跑规则表，再算缺什么。
//
// 这一层只做决策与记账，不写文件、不调模型：
// - 规则命中 → 直接给毫米决策（0 token）；
// - 规则未命中 → 记 `missing`，并汇总成最小的 `aiRequest`（只发缺的字段）；
// - 同一 `symbolKey + partId + shape` 的决策进缓存，重复图元不再重复问。

import { boundsOf, outlineOf } from './geometry.ts'
import { depthOf, specOf } from './symbols3d.ts'
import type {
  AiExtrusionDecision,
  AiExtrusionRequest,
  ExtrusionPlan,
  MissingField,
  PartDecision,
  Part3DSpec,
  PartLike,
  PlanItem,
  Point2,
  SceneLike,
  ScenePlanSettings,
  SymbolLike,
  WidgetLike,
} from './types.ts'

export interface PlanOptions {
  screenName?: string
  symbols?: SymbolLike[] | Record<string, SymbolLike>
  settings?: Partial<ScenePlanSettings>
  /** 已保存/已确认的决策：`<widgetId>/<partId>` → 字段覆盖。 */
  decisions?: Record<string, AiExtrusionDecision> | undefined
  /** 只导出可见图元，默认 true。 */
  visibleOnly?: boolean | undefined
  /** 决策缓存（跨画面复用），传入 Map 即可。 */
  cache?: Map<string, PartDecision> | undefined
}

export const DEFAULT_SETTINGS: ScenePlanSettings = {
  unit: 'mm',
  // 1px = 1mm：1920 宽的画面 = 1.92m，符合工业组态常见的「屏上 1px 约 1mm」。
  pixelsPerMeter: 1000,
  origin: 'bottom-left',
  up: '+Z',
  // 默认立成一面墙：这是「复刻现有页面」的口径，缩略图能认出是哪一页。
  projection: 'facade',
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

function indexSymbols(symbols: PlanOptions['symbols']): Record<string, SymbolLike> {
  if (!symbols) return {}
  if (Array.isArray(symbols)) {
    const map: Record<string, SymbolLike> = {}
    for (const symbol of symbols) map[symbol.key] = symbol
    return map
  }
  return symbols
}

function partCacheKey(symbolKey: string, part: PartLike): string {
  return fnv1a(`${symbolKey}|${part.id}|${part.shape}|${part.cornerRadius ?? 0}`)
}

function hintOf(symbolKey: string, part: PartLike, missing: MissingField[]): string {
  const size = `${Math.round(part.rect.width)}x${Math.round(part.rect.height)}px`
  if (!missing.length) return `${symbolKey}/${part.id}（${part.shape}，${size}）已由规则表覆盖`
  return `${symbolKey}/${part.id}（${part.shape}，${size}）缺少 ${missing.join('、')}`
}

/** 决策是否足以出实体。 */
function completeOf(decision: PartDecision | null): boolean {
  if (!decision) return false
  if (decision.form === 'decal' || decision.form === 'skip') return true
  return decision.depth > 0
}

/**
 * 轮廓按几何形式归一：回转体换成圆、管道换成「长度 × 直径」的矩形，
 * 保证 IFC 里的实体和轴测预览是同一个形状（否则会出现「预览是方盒、IFC 是圆柱」）。
 */
function normalizeOutline(decision: PartDecision | null, points: Point2[] | null): Point2[] | null {
  if (!decision || !points || points.length < 3) return points
  const box = boundsOf(points)
  if (decision.form === 'cylinder' || decision.form === 'shell') {
    const radius = Math.max(Math.min(box.width, box.height) / 2, 10)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const circle: Point2[] = []
    for (let i = 0; i < 32; i += 1) {
      const angle = (i / 32) * Math.PI * 2
      circle.push([round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle))])
    }
    return circle
  }
  if (decision.form === 'pipe') {
    const diameter = Math.max(decision.depth, 10)
    const horizontal = box.width >= box.height
    const half = diameter / 2
    if (horizontal) {
      const cy = box.y + box.height / 2
      return [
        [round(box.x), round(cy - half)],
        [round(box.x + box.width), round(cy - half)],
        [round(box.x + box.width), round(cy + half)],
        [round(box.x), round(cy + half)],
      ]
    }
    const cx = box.x + box.width / 2
    return [
      [round(cx - half), round(box.y)],
      [round(cx + half), round(box.y)],
      [round(cx + half), round(box.y + box.height)],
      [round(cx - half), round(box.y + box.height)],
    ]
  }
  return points
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 场景 → 3D 计划。
 *
 * 关键点：`missing` 永远从「规则没覆盖的零件」推导，不因为某条字段为空就整份画面追问，
 * 所以绝大多数内置画面（15 个图元全覆盖）导出的 `aiRequest` 是 `null`。
 */
export function buildPlan(scene: SceneLike, options: PlanOptions = {}): ExtrusionPlan {
  const settings: ScenePlanSettings = { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) }
  const symbols = indexSymbols(options.symbols)
  const scale = settings.pixelsPerMeter / 1000
  const visibleOnly = options.visibleOnly !== false
  const cache = options.cache ?? new Map<string, PartDecision>()
  const items: PlanItem[] = []
  const missingSet = new Set<MissingField>()
  const aiItems: AiExtrusionRequest['items'] = []
  const stats = { widgets: 0, parts: 0, solids: 0, decals: 0, skipped: 0 }

  const ordered = [...scene.widgets].sort(
    (left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id),
  )

  for (const widget of ordered) {
    const parts = visibleOnly ? visibleParts(widget) : widget.parts
    stats.widgets += 1
    for (const part of parts) {
      stats.parts += 1
      const outline = outlineOf(part, {
        scale,
        canvasHeight: scene.height,
        origin: settings.origin,
        plane: settings.projection === 'facade' ? 'facade' : 'plan',
      })
      const key = `${widget.id}/${part.id}`
      const cacheKey = partCacheKey(widget.symbolKey, part)
      const resolved = specOf(symbols[widget.symbolKey], part.id, part.shape)
      const override = options.decisions?.[key]

      let decision: PartDecision | null = null
      let missing: MissingField[] = []

      if (override && override.key === key) {
        decision = mergeOverride(resolved?.spec ?? null, override, part)
      } else if (resolved) {
        const box = outline
          ? boundsOf(outline.points)
          : { width: part.rect.width * scale, height: part.rect.height * scale }
        decision = {
          ...resolved.spec,
          // 立面模式图元挂在墙面上，规则表里的「离地高度」没有意义，改成按层级给一点点错位，
          // 避免同层零件共面闪烁；平面模式才用规则表的真实离地高度。
          elevation: settings.projection === 'facade'
            ? Math.min(widget.zIndex ?? 0, 20) * 6
            : resolved.spec.elevation,
          depth: resolved.spec.form === 'decal' || resolved.spec.form === 'skip'
            ? 0
            : depthOf(resolved.spec.depthRule, box.width, box.height),
          source: resolved.source,
        }
        cache.set(cacheKey, decision)
      } else {
        // 规则表未覆盖：几何能给多少给多少，剩下的记缺失。
        const cached = cache.get(cacheKey)
        if (cached) {
          decision = cached
        } else {
          missing = part.shape === 'text' ? [] : ['role', 'depth', 'elevation', 'material']
          if (part.shape === 'text') {
            decision = {
              role: 'label',
              form: 'decal',
              depthRule: { mode: 'absolute', mm: 0 },
              depth: 0,
              elevation: settings.unit === 'm' ? 1.5 : 1500,
              material: 'none',
              textMode: 'decal',
              source: 'default',
            }
          }
        }
      }

      if (missing.length) {
        for (const field of missing) missingSet.add(field)
        const box = outline ? boundsOf(outline.points) : { x: 0, y: 0, width: 0, height: 0 }
        aiItems.push({
          key,
          symbol: widget.symbolKey,
          part: part.id,
          shape: part.shape,
          widthMm: Math.round(box.width),
          heightMm: Math.round(box.height),
          missing,
        })
      }

      if (decision) {
        if (decision.form === 'decal') stats.decals += 1
        else if (decision.form === 'skip' || !outline) stats.skipped += 1
        else stats.solids += 1
      }

      const finalOutline = normalizeOutline(decision, outline?.points ?? null)

      items.push({
        widgetId: widget.id,
        widgetName: widget.name ?? widget.id,
        symbolKey: widget.symbolKey,
        symbolCategory: symbols[widget.symbolKey]?.category ?? '',
        partId: part.id,
        shape: part.shape,
        rect: part.rect,
        outline: finalOutline,
        closed: outline?.closed ?? false,
        text: part.text ?? null,
        fill: typeof part.fill === 'string' && /^#[0-9a-f]{3,8}$/i.test(part.fill) ? part.fill : null,
        decision,
        missing,
        cacheKey,
        hint: hintOf(widget.symbolKey, part, missing),
      })
    }
  }

  const missing = [...missingSet]
  return {
    screenName: options.screenName ?? 'scada-screen',
    settings,
    canvas: {
      widthMm: Math.round(scene.width * scale * 10) / 10,
      heightMm: Math.round(scene.height * scale * 10) / 10,
    },
    items,
    missing,
    stats,
    aiRequest: aiItems.length
      ? {
          kind: 'ifc-extrusion',
          instruction:
            '你是工业组态到 BIM 的映射器。为每个零件给出毫米单位的三维参数：role（structure/panel/instrument/machine/vessel/pipe/label）、' +
            'form（extrude/cylinder/shell/pipe/decal/skip）、depth（拉伸厚度，mm）、elevation（底面离地高度，mm）、' +
            'material（concrete/steel/stainless/glass/plastic/paint/liquid/none）。只返回 JSON 数组，元素形如 {"key","role","form","depth","elevation","material"}，不要解释。',
          items: aiItems,
        }
      : null,
  }
}

function mergeOverride(
  base: Part3DSpec | null,
  override: AiExtrusionDecision,
  part: PartLike,
): PartDecision {
  const box = { width: part.rect.width, height: part.rect.height }
  return {
    role: override.role ?? base?.role ?? 'machine',
    form: override.form ?? base?.form ?? 'extrude',
    depthRule: base?.depthRule ?? { mode: 'absolute', mm: 300 },
    elevation: override.elevation ?? base?.elevation ?? 0,
    material: override.material ?? base?.material ?? 'steel',
    textMode: base?.textMode ?? 'skip',
    depth: override.depth ?? (base ? depthOf(base.depthRule, box.width, box.height) : 300),
    source: 'override',
  }
}

/** 把 AI/人工决策合并回计划：只改命中 `key` 的零件，其余保持规则结果。 */
export function applyDecisions(plan: ExtrusionPlan, decisions: AiExtrusionDecision[]): ExtrusionPlan {
  const byKey = new Map(decisions.map((decision) => [decision.key, decision]))
  const items = plan.items.map((item) => {
    const key = `${item.widgetId}/${item.partId}`
    const next = byKey.get(key) ?? byKey.get(item.cacheKey)
    if (!next) return item
    const base = item.decision
    const merged: PartDecision = {
      role: next.role ?? base?.role ?? 'machine',
      form: next.form ?? base?.form ?? 'extrude',
      depthRule: base?.depthRule ?? { mode: 'absolute', mm: next.depth ?? 300 },
      elevation: next.elevation ?? base?.elevation ?? 0,
      material: next.material ?? base?.material ?? 'steel',
      textMode: base?.textMode ?? 'skip',
      depth: next.depth ?? base?.depth ?? 300,
      source: 'ai',
    }
    return { ...item, decision: merged, missing: [] as MissingField[] }
  })
  const missing = new Set<MissingField>()
  for (const item of items) for (const field of item.missing) missing.add(field)
  return {
    ...plan,
    items,
    missing: [...missing],
    aiRequest: items.some((item) => item.missing.length) ? plan.aiRequest : null,
  }
}

/** 计划里所有零件是否都能出几何。 */
export function planReady(plan: ExtrusionPlan): boolean {
  return plan.items.every((item) => item.shape === 'text' || completeOf(item.decision))
}

/** 缺参清单：给前端「待补参数」面板用，附一句人类可读的提示。 */
export function explainPlan(plan: ExtrusionPlan): Array<{ key: string; message: string }> {
  return plan.items
    .filter((item) => item.missing.length)
    .map((item) => ({ key: `${item.widgetId}/${item.partId}`, message: item.hint }))
}

/** 只导出可见图元时的部件过滤，供调用方复用同一口径。 */
export function visibleParts(widget: WidgetLike): PartLike[] {
  return widget.parts.filter((part) => part.visible !== false)
}
